import { prisma } from '../lib/prisma.js'
import { sendLinePushToUser } from './linePushService.js'

export async function notifyOwnerIfCaregiver(familyMemberId, addedByUserId, messageText) {
  const member = await prisma.familyMember.findUnique({
    where: { id: familyMemberId },
    select: { ownerId: true, owner: { select: { lineUserId: true } } },
  })
  if (!member) return
  if (member.ownerId === addedByUserId) return // owner acting on their own member — no notify

  await sendLinePushToUser(member.owner.lineUserId, messageText)
}
