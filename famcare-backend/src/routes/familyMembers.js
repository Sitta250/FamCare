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
import { getEmergencyCard } from '../services/emergencyCardService.js'
import {
  listEmergencyContacts,
  createEmergencyContact,
  updateEmergencyContact,
  deleteEmergencyContact,
} from '../services/emergencyContactService.js'
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

router.get('/:memberId/emergency-card', async (req, res, next) => {
  try {
    const data = await getEmergencyCard(req.user.id, req.params.memberId)
    res.json({ data })
  } catch (err) { next(err) }
})

router.get('/:memberId/emergency-contacts', async (req, res, next) => {
  try {
    const data = await listEmergencyContacts(req.user.id, req.params.memberId)
    res.json({ data })
  } catch (err) { next(err) }
})

router.post('/:memberId/emergency-contacts', async (req, res, next) => {
  try {
    const data = await createEmergencyContact(req.user.id, req.params.memberId, req.body)
    res.status(201).json({ data })
  } catch (err) { next(err) }
})

router.patch('/:memberId/emergency-contacts/:contactId', async (req, res, next) => {
  try {
    const data = await updateEmergencyContact(req.user.id, req.params.memberId, req.params.contactId, req.body)
    res.json({ data })
  } catch (err) { next(err) }
})

router.delete('/:memberId/emergency-contacts/:contactId', async (req, res, next) => {
  try {
    await deleteEmergencyContact(req.user.id, req.params.memberId, req.params.contactId)
    res.status(204).send()
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
