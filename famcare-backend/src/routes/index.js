import { Router } from 'express'
import meRouter from './me.js'
import familyMembersRouter from './familyMembers.js'
import appointmentsRouter from './appointments.js'

const router = Router()

router.use('/me', meRouter)
router.use('/family-members', familyMembersRouter)
router.use('/appointments', appointmentsRouter)

export default router
