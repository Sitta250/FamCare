import { Router } from 'express'
import { requireLineUser } from '../middleware/auth.js'
import {
  listMedications,
  createMedication,
  getMedication,
  updateMedication,
  deleteMedication,
  listMedicationLogs,
  createMedicationLog,
  updateMedicationSchedule,
  getMedicationSchedule,
} from '../services/medicationService.js'

const router = Router()

router.use(requireLineUser)

router.get('/', async (req, res, next) => {
  try {
    const { familyMemberId } = req.query
    const data = await listMedications(req.user.id, familyMemberId)
    res.json({ data })
  } catch (err) { next(err) }
})

router.post('/', async (req, res, next) => {
  try {
    const data = await createMedication(req.user.id, req.body)
    res.status(201).json({ data })
  } catch (err) { next(err) }
})

// Sub-routes before generic `/:id` (e.g. avoid treating "logs" as a medication id)
router.get('/:id/logs', async (req, res, next) => {
  try {
    const data = await listMedicationLogs(req.user.id, req.params.id)
    res.json({ data })
  } catch (err) { next(err) }
})

router.post('/:id/logs', async (req, res, next) => {
  try {
    const data = await createMedicationLog(req.user.id, req.params.id, req.body)
    res.status(201).json({ data })
  } catch (err) { next(err) }
})

router.get('/:id/schedule', async (req, res, next) => {
  try {
    const data = await getMedicationSchedule(req.user.id, req.params.id)
    res.json({ data })
  } catch (err) { next(err) }
})

router.put('/:id/schedule', async (req, res, next) => {
  try {
    const { times } = req.body
    const data = await updateMedicationSchedule(req.user.id, req.params.id, times)
    res.json({ data })
  } catch (err) { next(err) }
})

router.get('/:id', async (req, res, next) => {
  try {
    const data = await getMedication(req.user.id, req.params.id)
    res.json({ data })
  } catch (err) { next(err) }
})

router.patch('/:id', async (req, res, next) => {
  try {
    const data = await updateMedication(req.user.id, req.params.id, req.body)
    res.json({ data })
  } catch (err) { next(err) }
})

router.delete('/:id', async (req, res, next) => {
  try {
    await deleteMedication(req.user.id, req.params.id)
    res.status(204).send()
  } catch (err) { next(err) }
})

export default router
