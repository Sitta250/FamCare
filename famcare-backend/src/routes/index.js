import { Router } from 'express'
import meRouter from './me.js'
import familyMembersRouter from './familyMembers.js'
import appointmentsRouter from './appointments.js'
import medicationsRouter from './medications.js'
import healthMetricsRouter from './healthMetrics.js'
import documentsRouter from './documents.js'
import symptomLogsRouter from './symptomLogs.js'

const router = Router()

router.use('/me', meRouter)
router.use('/family-members', familyMembersRouter)
router.use('/appointments', appointmentsRouter)
router.use('/medications', medicationsRouter)
router.use('/health-metrics', healthMetricsRouter)
router.use('/documents', documentsRouter)
router.use('/symptom-logs', symptomLogsRouter)

export default router
