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
