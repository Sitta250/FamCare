import { Router } from 'express'
import meRouter from './me.js'
import familyMembersRouter from './familyMembers.js'

const router = Router()

router.use('/me', meRouter)
router.use('/family-members', familyMembersRouter)

export default router
