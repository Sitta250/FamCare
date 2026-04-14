import { Router } from 'express'
import { requireLineUser } from '../middleware/auth.js'
import {
  listHealthMetrics,
  createHealthMetric,
  getHealthMetric,
  updateHealthMetric,
  deleteHealthMetric,
} from '../services/healthMetricService.js'
import {
  listThresholds,
  upsertThreshold,
  deleteThreshold,
} from '../services/healthMetricThresholdService.js'

const router = Router()

router.use(requireLineUser)

router.get('/', async (req, res, next) => {
  try {
    const { familyMemberId, type, from, to } = req.query
    const data = await listHealthMetrics(req.user.id, { familyMemberId, type, from, to })
    res.json({ data })
  } catch (err) { next(err) }
})

router.post('/', async (req, res, next) => {
  try {
    const data = await createHealthMetric(req.user.id, req.body)
    res.status(201).json({ data })
  } catch (err) { next(err) }
})

router.get('/:memberId/thresholds', async (req, res, next) => {
  try {
    const data = await listThresholds(req.user.id, req.params.memberId)
    res.json({ data })
  } catch (err) { next(err) }
})

router.put('/:memberId/thresholds/:type', async (req, res, next) => {
  try {
    const data = await upsertThreshold(req.user.id, req.params.memberId, req.params.type, req.body)
    res.json({ data })
  } catch (err) { next(err) }
})

router.delete('/:memberId/thresholds/:type', async (req, res, next) => {
  try {
    await deleteThreshold(req.user.id, req.params.memberId, req.params.type)
    res.status(204).send()
  } catch (err) { next(err) }
})

router.get('/:id', async (req, res, next) => {
  try {
    const data = await getHealthMetric(req.user.id, req.params.id)
    res.json({ data })
  } catch (err) { next(err) }
})

router.patch('/:id', async (req, res, next) => {
  try {
    const data = await updateHealthMetric(req.user.id, req.params.id, req.body)
    res.json({ data })
  } catch (err) { next(err) }
})

router.delete('/:id', async (req, res, next) => {
  try {
    await deleteHealthMetric(req.user.id, req.params.id)
    res.status(204).send()
  } catch (err) { next(err) }
})

export default router
