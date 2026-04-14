import cron from 'node-cron'
import { dispatchDueReminders } from '../services/reminderDispatchService.js'
import { dispatchMedicationReminders } from '../services/medicationReminderDispatchService.js'
import { checkLowStockAlerts } from '../services/medicationService.js'

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

  // Daily at 08:00 Bangkok: check medications at/below their configured low-stock threshold
  cron.schedule('0 8 * * *', async () => {
    try {
      await checkLowStockAlerts()
    } catch (err) {
      console.error('[cron] checkLowStockAlerts error:', err.message)
    }
  }, { timezone: 'Asia/Bangkok' })

  console.log('[cron] jobs started')
}
