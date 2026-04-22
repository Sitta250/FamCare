import { Router } from 'express'
import { requireLineUser } from '../middleware/auth.js'
import { uploadInsurancePhotos } from '../middleware/upload.js'
import {
  createInsuranceCard,
  deleteInsuranceCard,
  getInsuranceCard,
  listInsuranceCards,
  updateInsuranceCard,
} from '../services/insuranceService.js'

const router = Router()

router.use(requireLineUser)

router.post('/', uploadInsurancePhotos, async (req, res, next) => {
  try {
    const result = await createInsuranceCard(req.user.id, {
      ...req.body,
      files: req.files,
    })
    res.status(201).json({
      data: result.card,
      ocrSuccess: result.ocrSuccess,
      extractedFields: result.extractedFields,
    })
  } catch (err) { next(err) }
})

router.get('/', async (req, res, next) => {
  try {
    const familyMemberId = req.query.familyMemberId ?? req.query.memberId
    const data = await listInsuranceCards(req.user.id, { familyMemberId })
    res.json({ data })
  } catch (err) { next(err) }
})

router.get('/:id', async (req, res, next) => {
  try {
    const data = await getInsuranceCard(req.user.id, req.params.id)
    res.json({ data })
  } catch (err) { next(err) }
})

router.patch('/:id', uploadInsurancePhotos, async (req, res, next) => {
  try {
    const result = await updateInsuranceCard(req.user.id, req.params.id, {
      ...req.body,
      files: req.files,
    })
    res.json({
      data: result.card,
      ocrSuccess: result.ocrSuccess,
      extractedFields: result.extractedFields,
    })
  } catch (err) { next(err) }
})

router.delete('/:id', async (req, res, next) => {
  try {
    await deleteInsuranceCard(req.user.id, req.params.id)
    res.status(204).send()
  } catch (err) { next(err) }
})

export default router
