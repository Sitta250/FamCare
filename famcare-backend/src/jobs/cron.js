import cron from 'node-cron'
import { dispatchDueReminders } from '../services/reminderDispatchService.js'
import { dispatchMedicationReminders } from '../services/medicationReminderDispatchService.js'

export function startCronJobs() {
  // Every minute: dispatch due appointment reminders
  cron.schedule('* * * * *', async () => {
    try {
      await dispatchDueReminders()
    } catch (err) {
      console.error('[cron] dispatchDueReminders error:', err.message)
    }
  })

  // Every minute: dispatch medication reminders + missed-dose alerts
  cron.schedule('* * * * *', async () => {
    try {
      await dispatchMedicationReminders()
    } catch (err) {
      console.error('[cron] dispatchMedicationReminders error:', err.message)
    }
  })

  console.log('[cron] jobs started')
}
