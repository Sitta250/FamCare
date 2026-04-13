import { prisma } from '../lib/prisma.js'

const DEFAULT_OFFSETS = {
  SEVEN_DAYS: 7 * 24 * 60 * 60 * 1000,
  TWO_DAYS:   2 * 24 * 60 * 60 * 1000,
  ONE_DAY:    1 * 24 * 60 * 60 * 1000,
  TWO_HOURS:  2 * 60 * 60 * 1000,
}

/**
 * Sync reminder rows for an appointment.
 * @param {string}   appointmentId
 * @param {Date}     appointmentAt
 * @param {number[]|null} customOffsetsMs  Optional array of ms offsets (positive).
 *   When provided, creates one CUSTOM reminder per offset instead of the default 4.
 */
export async function syncRemindersForAppointment(appointmentId, appointmentAt, customOffsetsMs = null) {
  const apptTime = new Date(appointmentAt).getTime()
  const now = Date.now()

  let newReminders
  if (customOffsetsMs && customOffsetsMs.length > 0) {
    newReminders = customOffsetsMs
      .map(ms => ({ type: 'CUSTOM', scheduledAt: new Date(apptTime - ms) }))
      .filter(r => r.scheduledAt.getTime() > now)
  } else {
    newReminders = Object.entries(DEFAULT_OFFSETS)
      .map(([type, offset]) => ({ type, scheduledAt: new Date(apptTime - offset) }))
      .filter(r => r.scheduledAt.getTime() > now)
  }

  await prisma.$transaction([
    prisma.reminder.deleteMany({
      where: { appointmentId, sent: false },
    }),
    ...(newReminders.length > 0
      ? [prisma.reminder.createMany({
          data: newReminders.map(r => ({ appointmentId, type: r.type, scheduledAt: r.scheduledAt })),
        })]
      : []),
  ])
}

export async function deleteUnsentReminders(appointmentId) {
  await prisma.reminder.deleteMany({
    where: { appointmentId, sent: false },
  })
}
