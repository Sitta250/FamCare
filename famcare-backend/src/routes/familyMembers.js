import { Router } from 'express'
import { requireLineUser } from '../middleware/auth.js'
import {
  listFamilyMembers,
  createFamilyMember,
  getFamilyMember,
  updateFamilyMember,
  deleteFamilyMember,
} from '../services/familyMemberService.js'
import { getEmergencyInfo } from '../services/emergencyInfoService.js'
import familyAccessRouter from './familyAccess.js'

const router = Router()

router.use(requireLineUser)

router.get('/', async (req, res, next) => {
  try {
    const data = await listFamilyMembers(req.user.id)
    res.json({ data })
  } catch (err) { next(err) }
})

router.post('/', async (req, res, next) => {
  try {
    const data = await createFamilyMember(req.user.id, req.body)
    res.status(201).json({ data })
  } catch (err) { next(err) }
})

// Sub-routes before generic `/:id` so paths like `.../emergency-info` are not captured as ids
router.get('/:id/emergency-info', async (req, res, next) => {
  try {
    const data = await getEmergencyInfo(req.user.id, req.params.id)
    res.json({ data })
  } catch (err) { next(err) }
})

router.get('/:id', async (req, res, next) => {
  try {
    const data = await getFamilyMember(req.user.id, req.params.id)
    res.json({ data })
  } catch (err) { next(err) }
})

router.patch('/:id', async (req, res, next) => {
  try {
    const data = await updateFamilyMember(req.user.id, req.params.id, req.body)
    res.json({ data })
  } catch (err) { next(err) }
})

router.delete('/:id', async (req, res, next) => {
  try {
    await deleteFamilyMember(req.user.id, req.params.id)
    res.status(204).send()
  } catch (err) { next(err) }
})

router.use('/:memberId/access', familyAccessRouter)

export default router
