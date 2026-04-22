import { prisma } from '../lib/prisma.js'
import { sendLinePushToUser } from './linePushService.js'
import { parseNotificationPrefs } from './familyAccessService.js'

export async function notifyOwnerIfCaregiver(familyMemberId, addedByUserId, messageText) {
  const member = await prisma.familyMember.findUnique({
    where: { id: familyMemberId },
    select: { ownerId: true, owner: { select: { lineUserId: true } } },
  })
  if (!member) return
  if (member.ownerId === addedByUserId) return // owner acting on their own member — no notify

  await sendLinePushToUser(member.owner.lineUserId, messageText)
}

export async function fanoutToFamily(
  familyMemberId,
  actorUserId,
  messageText,
  eventType = 'appointmentReminders'
) {
  const member = await prisma.familyMember.findUnique({
    where: { id: familyMemberId },
    select: {
      ownerId: true,
      owner: { select: { id: true, lineUserId: true, chatMode: true } },
      accessList: {
        where: { role: 'CAREGIVER' },
        select: {
          grantedToUserId: true,
          notificationPrefs: true,
          grantedTo: { select: { lineUserId: true } },
        },
      },
    },
  })

  if (!member || member.owner.chatMode !== 'GROUP') return

  const recipients = new Set()

  if (member.ownerId !== actorUserId) {
    recipients.add(member.owner.lineUserId)
  }

  for (const access of member.accessList) {
    if (access.grantedToUserId === actorUserId) continue

    const prefs = parseNotificationPrefs(access.notificationPrefs)
    if (prefs[eventType]) {
      recipients.add(access.grantedTo.lineUserId)
    }
  }

  await Promise.all(
    [...recipients].map((lineUserId) =>
      sendLinePushToUser(lineUserId, messageText).catch((err) => {
        console.error('[caregiver-notify] fanout failed:', err.message)
      })
    )
  )
}
