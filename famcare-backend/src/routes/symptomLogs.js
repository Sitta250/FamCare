import { Router } from 'express'
import { requireLineUser } from '../middleware/auth.js'
import { uploadAudio, uploadSingle } from '../middleware/upload.js'
import {
  listSymptomLogs,
  createSymptomLog,
  getSymptomLog,
  updateSymptomLog,
  deleteSymptomLog,
  attachPhotoToSymptomLog,
  attachVoiceNoteToSymptomLog,
} from '../services/symptomLogService.js'

const router = Router()

router.use(requireLineUser)

router.get('/', async (req, res, next) => {
  try {
    const { familyMemberId, limit, cursor, from, to } = req.query
    const data = await listSymptomLogs(req.user.id, { familyMemberId, limit, cursor, from, to })
    res.json({ data })
  } catch (err) { next(err) }
})

router.post('/', async (req, res, next) => {
  try {
    const data = await createSymptomLog(req.user.id, req.body)
    res.status(201).json({ data })
  } catch (err) { next(err) }
})

router.post('/:id/photo', uploadSingle, async (req, res, next) => {
  try {
    const data = await attachPhotoToSymptomLog(req.user.id, req.params.id, req.file)
    res.json({ data })
  } catch (err) { next(err) }
})

router.post('/:id/voice-note', uploadAudio, async (req, res, next) => {
  try {
    const data = await attachVoiceNoteToSymptomLog(req.user.id, req.params.id, req.file)
    res.json({ data })
  } catch (err) { next(err) }
})

router.get('/:id', async (req, res, next) => {
  try {
    const data = await getSymptomLog(req.user.id, req.params.id)
    res.json({ data })
  } catch (err) { next(err) }
})

router.patch('/:id', async (req, res, next) => {
  try {
    const data = await updateSymptomLog(req.user.id, req.params.id, req.body)
    res.json({ data })
  } catch (err) { next(err) }
})

router.delete('/:id', async (req, res, next) => {
  try {
    await deleteSymptomLog(req.user.id, req.params.id)
    res.status(204).send()
  } catch (err) { next(err) }
})

export default router
