import { Router } from 'express'
import { requireLineUser } from '../middleware/auth.js'
import { grantAccess, listAccessForMember, revokeAccess } from '../services/familyAccessService.js'

// Mounted at /api/v1/family-members/:memberId/access
const router = Router({ mergeParams: true })

router.use(requireLineUser)

router.get('/', async (req, res, next) => {
  try {
    const data = await listAccessForMember(req.user.id, req.params.memberId)
    res.json({ data })
  } catch (err) { next(err) }
})

router.post('/', async (req, res, next) => {
  try {
    const { grantedToLineUserId, role } = req.body
    const data = await grantAccess(req.user.id, req.params.memberId, { grantedToLineUserId, role })
    res.status(201).json({ data })
  } catch (err) { next(err) }
})

router.delete('/:grantedToUserId', async (req, res, next) => {
  try {
    await revokeAccess(req.user.id, req.params.memberId, req.params.grantedToUserId)
    res.status(204).send()
  } catch (err) { next(err) }
})

export default router
