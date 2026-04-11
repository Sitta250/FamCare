import { prisma } from '../lib/prisma.js'

const OFFSETS = {
  SEVEN_DAYS: 7 * 24 * 60 * 60 * 1000,
  TWO_DAYS:   2 * 24 * 60 * 60 * 1000,
  ONE_DAY:    1 * 24 * 60 * 60 * 1000,
  TWO_HOURS:  2 * 60 * 60 * 1000,
}

export async function syncRemindersForAppointment(appointmentId, appointmentAt) {
  const apptTime = new Date(appointmentAt).getTime()
  const now = Date.now()

  const newReminders = Object.entries(OFFSETS)
    .map(([type, offset]) => ({ type, scheduledAt: new Date(apptTime - offset) }))
    .filter(r => r.scheduledAt.getTime() > now)

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
