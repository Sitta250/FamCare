import { prisma } from '../lib/prisma.js'
import { sendLinePushToUser } from './linePushService.js'
import {
  bangkokCalendarDate,
  bangkokClockHm,
  utcInstantFromBangkokYmdHm,
} from '../utils/datetime.js'

// Minutes after scheduled time before a dose is considered missed
const MISSED_WINDOW_MINUTES = 120

async function getRecipients(familyMemberId) {
  const member = await prisma.familyMember.findUnique({
    where: { id: familyMemberId },
    select: {
      missedDoseAlertsEnabled: true,
      owner: { select: { lineUserId: true } },
      accessList: {
        where: { role: 'CAREGIVER' },
        select: { grantedTo: { select: { lineUserId: true } } },
      },
    },
  })
  if (!member) return { recipients: [], missedAlertsEnabled: false }

  const recipients = [member.owner.lineUserId]
  for (const a of member.accessList) {
    recipients.push(a.grantedTo.lineUserId)
  }
  return { recipients: [...new Set(recipients)], missedAlertsEnabled: member.missedDoseAlertsEnabled }
}

export async function dispatchMedicationReminders() {
  const now = new Date()
  const todayStr = bangkokCalendarDate(now)
  const currentTime = bangkokClockHm(now)

  // ── 1. Reminder pass: fire schedules matching current minute ──────────────
  const dueSchedules = await prisma.medicationSchedule.findMany({
    where: {
      timeLocal: currentTime,
      OR: [{ lastSentDate: null }, { lastSentDate: { not: todayStr } }],
    },
    include: {
      medication: {
        include: { familyMember: true },
      },
    },
  })

  for (const schedule of dueSchedules) {
    const med = schedule.medication
    if (!med.active) continue

    try {
      const { recipients } = await getRecipients(med.familyMemberId)
      const text = `💊 เตือนกินยา: ${med.name}${med.dosage ? ` (${med.dosage})` : ''}\nสำหรับ: ${med.familyMember.name}\nเวลา: ${schedule.timeLocal}`

      for (const lineUserId of recipients) {
        await sendLinePushToUser(lineUserId, text)
      }

      await prisma.medicationSchedule.update({
        where: { id: schedule.id },
        data: { lastSentDate: todayStr },
      })

      console.log(`[med-reminder] sent reminder for schedule ${schedule.id} (${med.name} @ ${schedule.timeLocal})`)
    } catch (err) {
      console.error(`[med-reminder] reminder failed for schedule ${schedule.id}:`, err.message)
    }
  }

  // ── 2. Missed-dose pass: schedules earlier than cutoff clock today ─────────
  const cutoffInstant = new Date(now.getTime() - MISSED_WINDOW_MINUTES * 60 * 1000)
  const cutoffTimeStr = bangkokClockHm(cutoffInstant)

  const pastSchedules = await prisma.medicationSchedule.findMany({
    where: {
      timeLocal: { lte: cutoffTimeStr },
      OR: [{ lastMissedSentDate: null }, { lastMissedSentDate: { not: todayStr } }],
    },
    include: {
      medication: {
        include: { familyMember: true },
      },
    },
  })

  for (const schedule of pastSchedules) {
    const med = schedule.medication
    if (!med.active) continue

    try {
      const { recipients, missedAlertsEnabled } = await getRecipients(med.familyMemberId)
      if (!missedAlertsEnabled) continue

      const windowStart = utcInstantFromBangkokYmdHm(todayStr, schedule.timeLocal)
      const windowEnd = new Date(windowStart.getTime() + MISSED_WINDOW_MINUTES * 60 * 1000)

      const takenLog = await prisma.medicationLog.findFirst({
        where: {
          medicationId: med.id,
          status: 'TAKEN',
          takenAt: { gte: windowStart, lte: windowEnd },
        },
      })

      if (takenLog) {
        await prisma.medicationSchedule.update({
          where: { id: schedule.id },
          data: { lastMissedSentDate: todayStr },
        })
        continue
      }

      const text = `⚠️ ยังไม่กินยา: ${med.name}${med.dosage ? ` (${med.dosage})` : ''}\nสำหรับ: ${med.familyMember.name}\nเวลาที่กำหนด: ${schedule.timeLocal}\nกรุณาตรวจสอบ`

      for (const lineUserId of recipients) {
        await sendLinePushToUser(lineUserId, text)
      }

      await prisma.medicationSchedule.update({
        where: { id: schedule.id },
        data: { lastMissedSentDate: todayStr },
      })

      console.log(`[med-reminder] sent missed alert for schedule ${schedule.id} (${med.name})`)
    } catch (err) {
      console.error(`[med-reminder] missed-dose check failed for schedule ${schedule.id}:`, err.message)
    }
  }
}
