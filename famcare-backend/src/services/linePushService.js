import { messagingApi } from '@line/bot-sdk'

let lineClient = null

function getClient() {
  if (!lineClient && process.env.LINE_CHANNEL_ACCESS_TOKEN) {
    lineClient = new messagingApi.MessagingApiClient({
      channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
    })
  }
  return lineClient
}

export async function sendLinePushToUser(lineUserId, text) {
  if (typeof lineUserId !== 'string' || lineUserId.trim().length === 0) {
    console.warn('[push] skip send: missing/invalid lineUserId')
    return
  }

  const client = getClient()
  if (!client) {
    console.log(`[push] (no token) → ${lineUserId}: ${text}`)
    return
  }
  await client.pushMessage({
    to: lineUserId,
    messages: [{ type: 'text', text }],
  })
}
