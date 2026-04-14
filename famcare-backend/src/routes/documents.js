import { Router } from 'express'
import { requireLineUser } from '../middleware/auth.js'
import { uploadSingle } from '../middleware/upload.js'
import {
  listDocuments,
  createDocument,
  getDocument,
  deleteDocument,
} from '../services/documentService.js'

const router = Router()

router.use(requireLineUser)

router.get('/', async (req, res, next) => {
  try {
    const familyMemberId = req.query.familyMemberId ?? req.query.memberId
    const keyword = req.query.keyword ?? req.query.q
    const { from, to, date } = req.query

    const data = await listDocuments(req.user.id, {
      familyMemberId,
      keyword,
      from,
      to,
      date,
    })
    res.json({ data })
  } catch (err) { next(err) }
})

router.post('/', uploadSingle, async (req, res, next) => {
  try {
    const data = await createDocument(req.user.id, {
      ...req.body,
      file: req.file,
    })
    res.status(201).json({ data })
  } catch (err) { next(err) }
})

router.get('/:id', async (req, res, next) => {
  try {
    const data = await getDocument(req.user.id, req.params.id)
    res.json({ data })
  } catch (err) { next(err) }
})

router.delete('/:id', async (req, res, next) => {
  try {
    await deleteDocument(req.user.id, req.params.id)
    res.status(204).send()
  } catch (err) { next(err) }
})

export default router
