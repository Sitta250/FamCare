import { prisma } from '../lib/prisma.js'

export async function findOrCreateByLineUserId(lineUserId, { displayName, photoUrl } = {}) {
  return prisma.user.upsert({
    where: { lineUserId },
    update: {
      ...(displayName && { displayName }),
      ...(photoUrl && { photoUrl }),
    },
    create: {
      lineUserId,
      displayName: displayName || 'LINE User',
      photoUrl: photoUrl || null,
    },
  })
}
