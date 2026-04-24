import { prisma } from '../lib/prisma.js'
import { sendLinePushToUser } from './linePushService.js'
import { parseNotificationPrefs } from './familyAccessService.js'
import { toBangkokISO } from '../utils/datetime.js'

function normalizeLineUserId(value) {
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  return normalized.length > 0 ? normalized : null
}

export async function dispatchDueReminders() {
  const now = new Date()
  const window = new Date(now.getTime() + 5 * 60 * 1000)

  const due = await prisma.reminder.findMany({
    where: {
      sent: false,
      scheduledAt: { lte: window },
      appointment: { status: { not: 'CANCELLED' } },
    },
    include: {
      appointment: {
        include: {
          familyMember: {
            include: {
              owner: true,
              accessList: {
                where: { role: 'CAREGIVER' },
                include: { grantedTo: true },
              },
            },
          },
        },
      },
    },
  })

  for (const reminder of due) {
    try {
      const { appointment } = reminder
      const { familyMember } = appointment

      // Collect distinct LINE user ids: owner + caregivers
      const recipients = new Map()
      const ownerLineUserId = normalizeLineUserId(familyMember.owner.lineUserId)
      if (ownerLineUserId) {
        recipients.set(familyMember.owner.id, ownerLineUserId)
      } else {
        console.warn(
          `[reminder] skip owner recipient for reminder ${reminder.id}: missing/invalid lineUserId (user ${familyMember.owner.id})`
        )
      }
      if (familyMember.owner.chatMode === 'GROUP') {
        for (const access of familyMember.accessList) {
          const prefs = parseNotificationPrefs(access.notificationPrefs)
          if (prefs.appointmentReminders) {
            const caregiverLineUserId = normalizeLineUserId(access.grantedTo.lineUserId)
            if (caregiverLineUserId) {
              recipients.set(access.grantedTo.id, caregiverLineUserId)
            } else {
              console.warn(
                `[reminder] skip caregiver recipient for reminder ${reminder.id}: missing/invalid lineUserId (user ${access.grantedTo.id})`
              )
            }
          }
        }
      }

      if (recipients.size === 0) {
        console.warn(
          `[reminder] skip reminder ${reminder.id}: no valid LINE recipients for appointment ${appointment.id}`
        )
        continue
      }

      const timeStr = toBangkokISO(appointment.appointmentAt)
      const text = `แจ้งเตือน: ${appointment.title} ของ ${familyMember.name}\nเวลา: ${timeStr}\n${appointment.hospital ? `สถานที่: ${appointment.hospital}` : ''}`.trim()

      for (const lineUserId of recipients.values()) {
        await sendLinePushToUser(lineUserId, text)
      }

      // Mark sent — only update if still unsent (idempotent)
      await prisma.reminder.updateMany({
        where: { id: reminder.id, sent: false },
        data: { sent: true },
      })

      console.log(`[reminder] dispatched ${reminder.type} for appointment ${appointment.id}`)
    } catch (err) {
      console.error(`[reminder] failed for reminder ${reminder.id}:`, err.message)
    }
  }
}
