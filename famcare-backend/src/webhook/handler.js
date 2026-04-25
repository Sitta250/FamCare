import { messagingApi } from '@line/bot-sdk'
import { prisma } from '../lib/prisma.js'
import { findOrCreateByLineUserId } from '../services/userService.js'
import { createMedicationLog, MEDICATION_LOG_STATUSES } from '../services/medicationService.js'
import { createAppointment } from '../services/appointmentService.js'
import { listFamilyMembers, createFamilyMember } from '../services/familyMemberService.js'
import { uploadBuffer } from '../services/cloudinaryService.js'
import { handleAiMessage, executeIntent } from '../services/aiService.js'
import { parseThaiBuddhistDate } from '../utils/datetime.js'

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

function replyWithQuickReply(client, replyToken, text, items) {
  if (!client || !replyToken) return Promise.resolve()
  return client.replyMessage({
    replyToken,
    messages: [{
      type: 'text',
      text,
      quickReply: {
        items: items.map(item => ({
          type: 'action',
          action: { type: 'postback', label: item.label, data: item.postbackData },
        })),
      },
    }],
  })
}

function getLineUserId(event) {
  return event?.source?.userId ?? null
}

async function guardLineUserId(event, client) {
  const lineUserId = getLineUserId(event)
  if (lineUserId) return lineUserId

  console.warn('[webhook] missing source.userId on event:', JSON.stringify({
    type: event?.type,
    sourceType: event?.source?.type ?? null,
  }))
  await reply(client, event?.replyToken, 'FamCare received your message')
  return null
}

// ── Text message handling ────────────────────────────────────────────────────

const AI_FALLBACK_TEXT = 'ขออภัย ระบบขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้ง'
const ONBOARDING_TIMEOUT_MS = 10 * 60 * 1000

async function getActiveOnboardingSession(lineUserId) {
  const session = await prisma.onboardingSession.findUnique({ where: { lineUserId } })
  if (!session) return null
  if (Date.now() - session.updatedAt.getTime() > ONBOARDING_TIMEOUT_MS) {
    await prisma.onboardingSession.delete({ where: { lineUserId } })
    return null
  }
  return session
}

async function handleOnboardingText(event, user, session) {
  const client = getLineClient()
  const text = event.message.text.trim()

  if (session.step === 'AWAITING_NAME') {
    await prisma.onboardingSession.update({
      where: { lineUserId: user.lineUserId },
      data: { name: text, step: 'AWAITING_DOB' },
    })
    return reply(client, event.replyToken, 'เกิดวันที่เท่าไหร่ครับ? (ตัวอย่าง: 15 มีนาคม 2500)')
  }

  if (session.step === 'AWAITING_DOB') {
    const dob = parseThaiBuddhistDate(text)
    if (!dob) {
      return reply(client, event.replyToken, 'ไม่สามารถอ่านวันเกิดได้ กรุณาลองใหม่ เช่น "15 มีนาคม 2500"')
    }
    try {
      await createFamilyMember(user.id, { name: session.name, dateOfBirth: dob, relation: 'สมาชิก' })
      await prisma.onboardingSession.delete({ where: { lineUserId: user.lineUserId } })
      return reply(client, event.replyToken, `✅ เพิ่ม ${session.name} เรียบร้อยแล้ว ตอนนี้คุณสามารถเริ่มบันทึกข้อมูลสุขภาพได้เลยครับ`)
    } catch (err) {
      await prisma.onboardingSession.delete({ where: { lineUserId: user.lineUserId } }).catch(() => {})
      return reply(client, event.replyToken, 'เกิดข้อผิดพลาดในการเพิ่มสมาชิก กรุณาลองใหม่')
    }
  }
}

function sendOnboardingPrompt(client, replyToken) {
  return replyWithQuickReply(client, replyToken, 'ยินดีต้อนรับ! กรุณาเพิ่มสมาชิกในครอบครัวเพื่อเริ่มใช้งาน', [
    { label: 'เพิ่มสมาชิกตอนนี้', postbackData: JSON.stringify({ action: 'onboard_start' }) },
    { label: 'เปิดแอป FamCare', postbackData: JSON.stringify({ action: 'onboard_app' }) },
  ])
}

async function handleTextMessage(event) {
  const client = getLineClient()
  const lineUserId = await guardLineUserId(event, client)
  if (!lineUserId) return

  const user = await findOrCreateByLineUserId(lineUserId)

  // 1. Check for active onboarding session
  const session = await getActiveOnboardingSession(lineUserId)
  if (session) {
    return handleOnboardingText(event, user, session)
  }

  // 2. Check if user has no family members
  const familyMembers = await listFamilyMembers(user.id)
  if (familyMembers.length === 0) {
    return sendOnboardingPrompt(client, event.replyToken)
  }

  // 3. Normal AI flow
  let response
  try {
    response = await handleAiMessage(event.message.text, user, familyMembers)
  } catch (err) {
    console.error('[webhook] AI message handling failed:', err.message)
    response = { type: 'text', text: AI_FALLBACK_TEXT }
  }

  if (response.type === 'quickReply') {
    return replyWithQuickReply(client, event.replyToken, response.text, response.items)
  }
  if (response.type === 'flexMessage') {
    return client.replyMessage({
      replyToken: event.replyToken,
      messages: [{ type: 'flex', altText: response.altText, contents: response.contents }],
    })
  }
  return reply(client, event.replyToken, response.text)
}

// ── Postback handling ────────────────────────────────────────────────────────
//
// Postback data format (JSON string):
//   {"action":"add_appointment","familyMemberId":"...","title":"...","appointmentAt":"2026-05-01T09:00:00+07:00"}
//
// Additional supported actions:
//   {"action":"list_appointments","familyMemberId":"..."}
//   {"action":"log_medication","medicationId":"...","status":"TAKEN","takenAt":"..."}

async function handlePostback(event) {
  const client = getLineClient()
  const lineUserId = await guardLineUserId(event, client)
  if (!lineUserId) return

  let data
  try {
    data = JSON.parse(event.postback.data)
  } catch {
    console.warn('[webhook] postback data is not valid JSON:', event.postback.data)
    return reply(client, event.replyToken, 'ไม่สามารถประมวลผลคำสั่งได้')
  }

  const { action } = data

  if (action === 'onboard_start') {
    const user = await findOrCreateByLineUserId(lineUserId)
    const members = await listFamilyMembers(user.id)
    if (members.length > 0) {
      return reply(client, event.replyToken, 'คุณมีสมาชิกในครอบครัวแล้ว พิมพ์คำถามได้เลยครับ')
    }
    await prisma.onboardingSession.upsert({
      where: { lineUserId },
      create: { lineUserId, step: 'AWAITING_NAME' },
      update: { step: 'AWAITING_NAME', name: null },
    })
    return reply(client, event.replyToken, 'ชื่อสมาชิกที่ต้องการดูแลคือใครครับ?')
  }

  if (action === 'onboard_app') {
    return reply(client, event.replyToken, 'กรุณาเปิดแอป FamCare เพื่อเพิ่มสมาชิกในครอบครัว หลังจากนั้นกลับมาคุยกับบอทได้เลยครับ')
  }

  if (action === 'resolve_member') {
    const { familyMemberId, pendingIntent: encodedIntent } = data
    let intent
    try {
      intent = JSON.parse(decodeURIComponent(encodedIntent))
    } catch {
      return reply(client, event.replyToken, 'ไม่สามารถประมวลผลคำสั่งได้')
    }

    intent.familyMemberId = familyMemberId

    const user = await findOrCreateByLineUserId(lineUserId)
    const familyMembers = await listFamilyMembers(user.id)

    try {
      const result = await executeIntent(intent, user.id, familyMembers)
      return reply(client, event.replyToken, result)
    } catch (err) {
      console.error('[webhook] resolve_member executeIntent failed:', err.message)
      return reply(client, event.replyToken, 'เกิดข้อผิดพลาด กรุณาลองใหม่')
    }
  }

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

  if (action === 'confirm_destructive') {
    const user = await findOrCreateByLineUserId(lineUserId)
    const pending = await prisma.pendingAction.findUnique({ where: { lineUserId } })
    if (!pending) {
      return reply(client, event.replyToken, 'ไม่พบคำสั่งที่รอยืนยัน')
    }

    // Delete before executing to prevent double-execution
    await prisma.pendingAction.delete({ where: { lineUserId } })

    let intent
    try {
      intent = JSON.parse(pending.intentJson)
    } catch {
      console.warn('[webhook] confirm_destructive: malformed intentJson')
      return reply(client, event.replyToken, 'ไม่สามารถประมวลผลคำสั่งได้')
    }

    const familyMembers = await listFamilyMembers(user.id)
    try {
      const result = await executeIntent(intent, user.id, familyMembers)
      return reply(client, event.replyToken, result)
    } catch (err) {
      console.error('[webhook] confirm_destructive failed:', err.message)
      return reply(client, event.replyToken, `เกิดข้อผิดพลาด: ${err.message}`)
    }
  }

  if (action === 'cancel_destructive') {
    const user = await findOrCreateByLineUserId(lineUserId)
    await prisma.pendingAction.deleteMany({ where: { lineUserId: user.lineUserId } }).catch(() => {})
    return reply(client, event.replyToken, 'ยกเลิกแล้วครับ')
  }

  console.log(`[webhook] unhandled postback action: ${action}`)
  return reply(client, event.replyToken, 'รับทราบคำสั่งแล้ว')
}

// ── Audio/voice message handling ─────────────────────────────────────────────

async function handleAudioMessage(event) {
  const client = getLineClient()
  const lineUserId = await guardLineUserId(event, client)
  if (!lineUserId) return
  const messageId = event.message.id

  const contentUrl = `https://api-data.line.me/v2/bot/message/${messageId}/content`
  console.log(`[webhook] audio from ${lineUserId}, contentUrl: ${contentUrl}`)

  try {
    const user = await findOrCreateByLineUserId(lineUserId)

    const fullUser = await prisma.user.findUnique({
      where: { id: user.id },
      include: {
        familyMembers: { take: 1, orderBy: { createdAt: 'asc' } },
      },
    })

    const member = fullUser?.familyMembers?.[0]
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

// ── Main event dispatcher ────────────────────────────────────────────────────

async function handleEvent(event) {
  const sourceLineUserId = getLineUserId(event) ?? 'unknown'

  if (event.type === 'message') {
    const msgType = event.message.type

    if (msgType === 'text') {
      console.log(`[webhook] text from ${sourceLineUserId}: ${event.message.text}`)
      return handleTextMessage(event)
    }

    if (msgType === 'audio') {
      console.log(`[webhook] audio from ${sourceLineUserId}, id: ${event.message.id}`)
      return handleAudioMessage(event)
    }

    console.log(`[webhook] unhandled message type: ${msgType}`)
    return
  }

  if (event.type === 'postback') {
    console.log(`[webhook] postback from ${sourceLineUserId}: ${event.postback.data}`)
    return handlePostback(event)
  }

  if (event.type === 'follow') {
    console.log(`[webhook] follow from ${sourceLineUserId}`)
    if (sourceLineUserId !== 'unknown') {
      await findOrCreateByLineUserId(sourceLineUserId)
    }
    const client = getLineClient()
    if (client && event.replyToken) {
      await reply(
        client,
        event.replyToken,
        '👋 ยินดีต้อนรับสู่ FamCare!\nแอปช่วยดูแลสุขภาพและนัดหมายของสมาชิกในครอบครัว\n\nคุณสามารถพิมพ์บอกได้เลย เช่น:\n• "นัดหมอพรุ่งนี้ 10 โมง"\n• "แม่กินยาแล้ว"\n• "ความดันแม่ 120/80"'
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