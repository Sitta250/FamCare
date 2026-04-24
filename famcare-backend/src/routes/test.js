import { Router } from 'express'
import { sendLinePushToUser } from '../services/linePushService.js'

const router = Router()

router.post('/push', async (req, res, next) => {
  try {
    const userId = typeof req.body?.userId === 'string' ? req.body.userId.trim() : ''
    const message = typeof req.body?.message === 'string' ? req.body.message.trim() : ''

    if (!userId) {
      throw Object.assign(new Error('userId is required'), {
        status: 400,
        code: 'BAD_REQUEST',
      })
    }

    if (!message) {
      throw Object.assign(new Error('message is required'), {
        status: 400,
        code: 'BAD_REQUEST',
      })
    }

    await sendLinePushToUser(userId, message)
    res.json({ data: { ok: true } })
  } catch (err) {
    next(err)
  }
})

export default router
