import { messagingApi } from '@line/bot-sdk'
import { prisma } from '../lib/prisma.js'
import { findOrCreateByLineUserId, updateChatMode } from '../services/userService.js'
import { createAppointment } from '../services/appointmentService.js'
import { createMedicationLog, MEDICATION_LOG_STATUSES } from '../services/medicationService.js'
import { uploadBuffer } from '../services/cloudinaryService.js'
import { parseIntent } from '../services/thaiNlpService.js'
import { fanoutToFamily } from '../services/caregiverNotifyService.js'

let lineClient = null

function getLineClient() {
  if (!lineClient && process.env.LINE_CHANNEL_ACCESS_TOKEN) {
    lineClient = new messagingApi.MessagingApiClient({
      channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
    })
  }
  return lineClient
}

function reply(client, replyToken, text) {
  if (!client || !replyToken) return Promise.resolve()
  return client.replyMessage({
    replyToken,
    messages: [{ type: 'text', text }],
  })
}

// ── Text message handling ────────────────────────────────────────────────────

async function handleTextMessage(event) {
  const client = getLineClient()
  const text = event.message.text.trim()
  const lineUserId = event.source.userId
  const intent = parseIntent(text)

  if (intent.intent === 'chatMode') {
    try {
      const user = await findOrCreateByLineUserId(lineUserId)
      await updateChatMode(user.id, intent.data.mode)
      const modeText = intent.data.mode === 'GROUP' ? 'โหมดกลุ่ม' : 'โหมดส่วนตัว'
      return reply(client, event.replyToken, `✅ เปลี่ยนเป็น${modeText}แล้ว`)
    } catch (err) {
      console.error('[webhook] chatMode update failed:', err.message)
      return reply(client, event.replyToken, `เกิดข้อผิดพลาด: ${err.message}`)
    }
  }

  if (intent.intent === 'appointment') {
    if (!intent.data.appointmentAt) {
      return reply(
        client,
        event.replyToken,
        "📅 กรุณาระบุวันและเวลาของนัดหมาย เช่น 'นัดหมอพรุ่งนี้ 10 โมง'"
      )
    }

    try {
      const user = await findOrCreateByLineUserId(lineUserId)
      const member = await findFirstOwnedFamilyMember(lineUserId)

      if (!member) {
        return reply(client, event.replyToken, 'กรุณาเพิ่มสมาชิกในครอบครัวก่อน')
      }

      const appt = await createAppointment(user.id, {
        familyMemberId: member.id,
        title: intent.data.title,
        appointmentAt: intent.data.appointmentAt,
      })

      fanoutToFamily(
        member.id,
        user.id,
        `📅 ${user.displayName || 'ผู้ใช้'} เพิ่มนัดหมาย "${appt.title}"`,
        'appointmentReminders'
      ).catch((err) => console.error('[webhook] appointment fanout failed:', err.message))

      return reply(
        client,
        event.replyToken,
        `✅ เพิ่มนัดหมาย "${appt.title}" เรียบร้อยแล้ว\nวันที่: ${appt.appointmentAt}`
      )
    } catch (err) {
      console.error('[webhook] appointment from text failed:', err.message)
      return reply(client, event.replyToken, `เกิดข้อผิดพลาด: ${err.message}`)
    }
  }

  return reply(
    client,
    event.replyToken,
    "สวัสดี! ส่ง 'นัดหมอพรุ่งนี้ 10 โมง' เพื่อเพิ่มนัดหมาย\nหรือ 'โหมดกลุ่ม'/'โหมดส่วนตัว' เพื่อตั้งค่าการแจ้งเตือน"
  )
}

// ── Postback handling ────────────────────────────────────────────────────────
//
// Postback data format (JSON string):
//   {"action":"add_appointment","familyMemberId":"...","title":"...","appointmentAt":"2026-05-01T09:00:00+07:00"}
//
// Additional supported actions: (stubs — expand as Rich Menu grows)
//   {"action":"list_appointments","familyMemberId":"..."}
//   {"action":"log_medication","medicationId":"...","status":"TAKEN","takenAt":"..."}

async function handlePostback(event) {
  const client = getLineClient()
  const lineUserId = event.source.userId

  let data
  try {
    data = JSON.parse(event.postback.data)
  } catch {
    console.warn('[webhook] postback data is not valid JSON:', event.postback.data)
    return reply(client, event.replyToken, 'ไม่สามารถประมวลผลคำสั่งได้')
  }

  const { action } = data

  if (action === 'add_appointment') {
    try {
      const user = await findOrCreateByLineUserId(lineUserId)
      const appt = await createAppointment(user.id, {
        familyMemberId: data.familyMemberId,
        title: data.title ?? 'นัดหมายจาก LINE',
        appointmentAt: data.appointmentAt ?? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        doctor: data.doctor ?? null,
        hospital: data.hospital ?? null,
        reason: data.reason ?? null,
      })
      return reply(
        client,
        event.replyToken,
        `✅ เพิ่มนัดหมาย "${appt.title}" เรียบร้อยแล้ว\nวันที่: ${appt.appointmentAt}`
      )
    } catch (err) {
      console.error('[webhook] add_appointment failed:', err.message)
      return reply(client, event.replyToken, `เกิดข้อผิดพลาด: ${err.message}`)
    }
  }

  if (action === 'list_appointments') {
    return reply(
      client,
      event.replyToken,
      'กรุณาเปิดแอปพลิเคชัน FamCare เพื่อดูรายการนัดหมายทั้งหมด'
    )
  }

  if (action === 'log_medication') {
    if (!data.medicationId) {
      return reply(client, event.replyToken, 'กรุณาระบุ medicationId')
    }

    if (!MEDICATION_LOG_STATUSES.has(data.status)) {
      return reply(client, event.replyToken, 'สถานะไม่ถูกต้อง ต้องเป็น TAKEN, MISSED หรือ SKIPPED')
    }

    try {
      const user = await findOrCreateByLineUserId(lineUserId)
      const medication = await prisma.medication.findUnique({
        where: { id: data.medicationId },
        select: { name: true },
      })
      const log = await createMedicationLog(user.id, data.medicationId, {
        status: data.status,
        takenAt: data.takenAt ?? new Date().toISOString(),
      })

      return reply(
        client,
        event.replyToken,
        `✅ บันทึกการกินยา ${medication?.name ?? data.medicationId} (${log.status}) เรียบร้อยแล้ว`
      )
    } catch (err) {
      console.error('[webhook] log_medication failed:', err.message)
      return reply(client, event.replyToken, `เกิดข้อผิดพลาด: ${err.message}`)
    }
  }

  console.log(`[webhook] unhandled postback action: ${action}`)
  return reply(client, event.replyToken, 'รับทราบคำสั่งแล้ว')
}

// ── Audio/voice message handling ─────────────────────────────────────────────
//
// LINE does not embed a content URL directly in the event payload.
// To download audio content, use:
//   GET https://api-data.line.me/v2/bot/message/{messageId}/content
//   Authorization: Bearer {LINE_CHANNEL_ACCESS_TOKEN}
//
// For MVP: store the content-access URL on the first SymptomLog-eligible member
// found for this LINE user. Operators can later download the file server-side.

async function handleAudioMessage(event) {
  const client = getLineClient()
  const lineUserId = event.source.userId
  const messageId = event.message.id

  const contentUrl = `https://api-data.line.me/v2/bot/message/${messageId}/content`
  console.log(`[webhook] audio from ${lineUserId}, contentUrl: ${contentUrl}`)

  try {
    // Find the user's first owned family member to associate the audio
    const user = await prisma.user.findUnique({
      where: { lineUserId },
      include: {
        familyMembers: { take: 1, orderBy: { createdAt: 'asc' } },
      },
    })

    const member = user?.familyMembers?.[0]
    if (member) {
      const voiceNoteUrl = await resolveVoiceNoteUrl(messageId, contentUrl)
      await prisma.symptomLog.create({
        data: {
          familyMemberId: member.id,
          addedByUserId: user.id,
          description: 'บันทึกเสียง (จาก LINE)',
          severity: 1,
          voiceNoteUrl,
          loggedAt: new Date(),
        },
      })
      console.log(`[webhook] audio URL stored on SymptomLog for member ${member.id}`)
    } else {
      console.log('[webhook] audio received but no family member found for user')
    }
  } catch (err) {
    console.error('[webhook] audio log failed:', err.message)
  }

  return reply(
    client,
    event.replyToken,
    '🎤 รับบันทึกเสียงแล้ว กรุณาตรวจสอบในแอปพลิเคชัน FamCare'
  )
}

async function resolveVoiceNoteUrl(messageId, contentUrl) {
  if (!process.env.LINE_CHANNEL_ACCESS_TOKEN || !process.env.CLOUDINARY_URL) {
    console.warn('[webhook] voice upload skipped: missing token/cloudinary config')
    return contentUrl
  }

  try {
    const response = await fetch(contentUrl, {
      headers: {
        Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
      },
    })

    if (!response.ok) {
      throw new Error(`LINE content fetch failed: ${response.status}`)
    }

    const arrayBuffer = await response.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)
    const upload = await uploadBuffer(buffer, {
      folder: 'famcare/voice',
      resourceType: 'video',
      originalname: `${messageId}.m4a`,
    })

    return upload.secure_url || contentUrl
  } catch (err) {
    console.error('[webhook] voice upload failed:', err.message)
    return contentUrl
  }
}

async function findFirstOwnedFamilyMember(lineUserId) {
  const user = await prisma.user.findUnique({
    where: { lineUserId },
    include: {
      familyMembers: { take: 1, orderBy: { createdAt: 'asc' } },
    },
  })

  return user?.familyMembers?.[0] ?? null
}

// ── Main event dispatcher ────────────────────────────────────────────────────

async function handleEvent(event) {
  if (event.type === 'message') {
    const msgType = event.message.type

    if (msgType === 'text') {
      console.log(`[webhook] text from ${event.source.userId}: ${event.message.text}`)
      return handleTextMessage(event)
    }

    if (msgType === 'audio') {
      console.log(`[webhook] audio from ${event.source.userId}, id: ${event.message.id}`)
      return handleAudioMessage(event)
    }

    console.log(`[webhook] unhandled message type: ${msgType}`)
    return
  }

  if (event.type === 'postback') {
    console.log(`[webhook] postback from ${event.source.userId}: ${event.postback.data}`)
    return handlePostback(event)
  }

  if (event.type === 'follow') {
    console.log(`[webhook] follow from ${event.source.userId}`)
    const client = getLineClient()
    if (client && event.replyToken) {
      await reply(
        client,
        event.replyToken,
        '👋 ยินดีต้อนรับสู่ FamCare!\nแอปช่วยดูแลสุขภาพและนัดหมายของสมาชิกในครอบครัว'
      )
    }
    return
  }

  console.log(`[webhook] unhandled event type: ${event.type}`)
}

export async function handleLineWebhook(req, res) {
  // Always respond 200 quickly so LINE doesn't retry
  res.status(200).send()

  const events = req.body?.events ?? []
  for (const event of events) {
    try {
      await handleEvent(event)
    } catch (err) {
      console.error('[webhook] event handler error:', err.message)
    }
  }
}
