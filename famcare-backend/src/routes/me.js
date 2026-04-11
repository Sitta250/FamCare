import { Router } from 'express'
import { requireLineUser } from '../middleware/auth.js'
import { toBangkokISO } from '../utils/datetime.js'

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

export default router
