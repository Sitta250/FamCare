import { Router } from 'express'
import { requireLineUser } from '../middleware/auth.js'
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
    const { familyMemberId, q, from, to } = req.query
    const data = await listDocuments(req.user.id, { familyMemberId, q, from, to })
    res.json({ data })
  } catch (err) { next(err) }
})

router.post('/', async (req, res, next) => {
  try {
    const data = await createDocument(req.user.id, req.body)
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
