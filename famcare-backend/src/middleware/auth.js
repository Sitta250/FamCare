import { findOrCreateByLineUserId } from '../services/userService.js'

export async function requireLineUser(req, res, next) {
  try {
    const lineUserId = req.headers['x-line-userid']?.trim()
    if (!lineUserId) {
      return res.status(401).json({ error: 'Missing x-line-userid header', code: 'UNAUTHORIZED' })
    }

    const displayName = req.headers['x-line-displayname']?.trim()
    const photoUrl = req.headers['x-line-photourl']?.trim()

    const user = await findOrCreateByLineUserId(lineUserId, { displayName, photoUrl })
    req.user = user
    req.lineUserId = lineUserId
    next()
  } catch (err) {
    next(err)
  }
}
