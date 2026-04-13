import { prisma } from '../lib/prisma.js'
import { sendLinePushToUser } from './linePushService.js'
import { toBangkokISO } from '../utils/datetime.js'

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
      recipients.set(familyMember.owner.id, familyMember.owner.lineUserId)
      for (const access of familyMember.accessList) {
        recipients.set(access.grantedTo.id, access.grantedTo.lineUserId)
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
