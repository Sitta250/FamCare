import { Router } from 'express'
import { requireLineUser } from '../middleware/auth.js'
import { toBangkokISO } from '../utils/datetime.js'
import { deleteUserAndData } from '../services/userService.js'

const router = Router()

router.get('/', requireLineUser, (req, res) => {
  const { id, lineUserId, displayName, photoUrl, phone, createdAt } = req.user
  res.json({
    data: {
      id,
      lineUserId,
      displayName,
      photoUrl,
      phone,
      createdAt: toBangkokISO(createdAt),
    },
  })
})

/**
 * PDPA hard delete — permanently removes the authenticated user and all owned data.
 * After deletion, the same LINE user ID will be re-created as a fresh empty account
 * on next authenticated request.
 */
router.delete('/', requireLineUser, async (req, res, next) => {
  try {
    await deleteUserAndData(req.user.id)
    res.json({ data: { deleted: true } })
  } catch (err) {
    next(err)
  }
})

export default router
