import { Router } from 'express'
import { requireLineUser } from '../middleware/auth.js'
import { toBangkokISO } from '../utils/datetime.js'
import { deleteUserAndData, updateChatMode } from '../services/userService.js'

const router = Router()

function serializeMe(user) {
  const { id, lineUserId, displayName, photoUrl, phone, chatMode, createdAt } = user
  return {
    id,
    lineUserId,
    displayName,
    photoUrl,
    phone,
    chatMode,
    createdAt: toBangkokISO(createdAt),
  }
}

router.get('/', requireLineUser, (req, res) => {
  res.json({ data: serializeMe(req.user) })
})

router.patch('/', requireLineUser, async (req, res, next) => {
  try {
    const user = await updateChatMode(req.user.id, req.body.chatMode)
    res.json({ data: serializeMe(user) })
  } catch (err) {
    next(err)
  }
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
