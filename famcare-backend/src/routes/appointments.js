import { Router } from 'express'
import { requireLineUser } from '../middleware/auth.js'
import {
  listAppointments,
  createAppointment,
  getAppointment,
  updateAppointment,
  deleteAppointment,
} from '../services/appointmentService.js'

const router = Router()

router.use(requireLineUser)

router.get('/', async (req, res, next) => {
  try {
    const { familyMemberId, status, from, to } = req.query
    const data = await listAppointments(req.user.id, { familyMemberId, status, from, to })
    res.json({ data })
  } catch (err) { next(err) }
})

router.post('/', async (req, res, next) => {
  try {
    const data = await createAppointment(req.user.id, req.body)
    res.status(201).json({ data })
  } catch (err) { next(err) }
})

router.get('/:id', async (req, res, next) => {
  try {
    const data = await getAppointment(req.user.id, req.params.id)
    res.json({ data })
  } catch (err) { next(err) }
})

router.patch('/:id', async (req, res, next) => {
  try {
    const data = await updateAppointment(req.user.id, req.params.id, req.body)
    res.json({ data })
  } catch (err) { next(err) }
})

router.delete('/:id', async (req, res, next) => {
  try {
    await deleteAppointment(req.user.id, req.params.id)
    res.status(204).send()
  } catch (err) { next(err) }
})

export default router
