/**
 * famcare-backend/src/services/aiService.js
 *
 * Two-phase LLM pipeline for LINE text messages:
 *   1. extractIntent()  — Gemini returns structured JSON intent
 *   2. executeIntent()  — calls backend services based on intent
 *
 * Webhook handler calls: handleAiMessage(userMessage, user, familyMembers)
 */

import { GoogleGenerativeAI } from '@google/generative-ai'
import OpenAI from 'openai'
import { prisma } from '../lib/prisma.js'
import {
  createAppointment,
  listAppointments,
} from './appointmentService.js'
import {
  listMedications,
  createMedicationLog,
  MEDICATION_LOG_STATUSES,
} from './medicationService.js'
import {
  listHealthMetrics,
  createHealthMetric,
} from './healthMetricService.js'
import {
  createSymptomLog,
  listSymptomLogs,
} from './symptomLogService.js'
import { toBangkokISO, bangkokCalendarDate } from '../utils/datetime.js'

// ── Gemini setup ─────────────────────────────────────────────────────────────

let _geminiModel = null

function getGeminiModel() {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) throw new Error('GEMINI_API_KEY is not configured')
  if (!_geminiModel) {
    const genAI = new GoogleGenerativeAI(apiKey)
    _geminiModel = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' })
  }
  return _geminiModel
}

async function callGemini(prompt) {
  const model = getGeminiModel()
  const result = await model.generateContent(prompt)
  const inputTokens = result?.response?.usageMetadata?.promptTokenCount ?? null
  const outputTokens = result?.response?.usageMetadata?.candidatesTokenCount ?? null
  const raw = result?.response?.text()?.trim() ?? ''
  return { raw, inputTokens, outputTokens }
}

// ── DeepSeek setup ────────────────────────────────────────────────────────────

async function callDeepSeek(prompt) {
  const client = new OpenAI({
    apiKey: process.env.DEEPSEEK_API_KEY,
    baseURL: 'https://api.deepseek.com',
  })
  const response = await client.chat.completions.create({
    model: 'deepseek-chat',
    messages: [{ role: 'user', content: prompt }],
  })
  const inputTokens = response.usage?.prompt_tokens ?? null
  const outputTokens = response.usage?.completion_tokens ?? null
  const raw = response.choices[0]?.message?.content?.trim() ?? ''
  return { raw, inputTokens, outputTokens }
}

function isGemini4xx(err) {
  const status = err?.status ?? err?.httpStatus ?? err?.code
  return typeof status === 'number' && status >= 400 && status < 500
}

export async function callLLMWithFailover(
  prompt,
  sleepFn = () => new Promise(r => setTimeout(r, 1000))
) {
  // Stage 1: Gemini — up to 2 attempts; skip retry on 4xx errors
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      if (attempt > 0) await sleepFn()
      const { raw, inputTokens, outputTokens } = await callGemini(prompt)
      return { raw, provider: 'gemini', inputTokens, outputTokens }
    } catch (err) {
      console.warn('[aiService] gemini failed:', err.message)
      if (isGemini4xx(err)) break
    }
  }

  // Stage 2: DeepSeek fallback
  if (process.env.DEEPSEEK_API_KEY) {
    try {
      const { raw, inputTokens, outputTokens } = await callDeepSeek(prompt)
      return { raw, provider: 'deepseek', inputTokens, outputTokens }
    } catch (err) {
      console.warn('[aiService] deepseek failed:', err.message)
    }
  }

  return { raw: '', provider: 'fallback', inputTokens: null, outputTokens: null }
}

// ── Conversation memory helpers ───────────────────────────────────────────────

async function loadHistory(lineUserId, familyMemberId) {
  const rows = await prisma.conversationMessage.findMany({
    where: { lineUserId, familyMemberId: familyMemberId ?? null },
    orderBy: { createdAt: 'asc' },
    take: 20,
    select: { role: true, content: true },
  })
  return rows
}

async function saveExchange(lineUserId, familyMemberId, userMsg, botReply) {
  await prisma.conversationMessage.createMany({
    data: [
      { lineUserId, familyMemberId: familyMemberId ?? null, role: 'USER', content: userMsg },
      { lineUserId, familyMemberId: familyMemberId ?? null, role: 'BOT', content: botReply },
    ],
  })
  const toKeep = await prisma.conversationMessage.findMany({
    where: { lineUserId, familyMemberId: familyMemberId ?? null },
    orderBy: { createdAt: 'desc' },
    take: 20,
    select: { id: true },
  })
  const keepIds = toKeep.map(r => r.id)
  await prisma.conversationMessage.deleteMany({
    where: {
      lineUserId,
      familyMemberId: familyMemberId ?? null,
      id: { notIn: keepIds },
    },
  })
}

async function resolveMemoryScope(lineUserId, resolvedFamilyMemberId) {
  if (resolvedFamilyMemberId) return resolvedFamilyMemberId
  const last = await prisma.conversationMessage.findFirst({
    where: { lineUserId, familyMemberId: { not: null } },
    orderBy: { createdAt: 'desc' },
    select: { familyMemberId: true },
  })
  return last?.familyMemberId ?? null
}

// ── Intent extraction prompt ──────────────────────────────────────────────────

function buildIntentPrompt(userMessage, familyMembers, history = []) {
  const membersJson = JSON.stringify(
    familyMembers.map(m => ({ id: m.id, name: m.name }))
  )

  // Today's date in Bangkok for relative date resolution
  const todayYmd = bangkokCalendarDate()

  let historyBlock = ''
  if (history.length > 0) {
    const lines = history.map(h => `${h.role === 'USER' ? 'User' : 'Bot'}: ${h.content}`).join('\n')
    historyBlock = `Conversation so far:\n${lines}\n\n`
  }

  return `${historyBlock}You are FamCare intent extractor. Analyze the user message and return ONLY valid JSON — no markdown, no explanation.

Today's date (Bangkok, YYYY-MM-DD): ${todayYmd}
User's family members: ${membersJson}

Detect the user's intent from this list:
- "add_appointment"     — user wants to schedule a doctor/hospital visit
- "list_appointments"  — user wants to see upcoming appointments
- "log_medication"     — user is reporting they took/missed/skipped a medication
- "list_medications"   — user wants to see medications for a family member
- "log_health_metric"  — user is recording blood pressure, blood sugar, weight, temperature
- "list_health_metrics"— user wants to see recent health readings
- "log_symptom"        — user is describing a symptom or complaint
- "list_symptoms"      — user wants to see recent symptom logs
- "chat"               — anything else; general question or conversation

JSON shape per intent:

add_appointment:
{
  "intent": "add_appointment",
  "familyMemberId": "<id from list or null if unclear>",
  "title": "<appointment title in Thai>",
  "appointmentAt": "<ISO 8601 with +07:00 or null if no date/time>",
  "doctor": "<doctor name or null>",
  "hospital": "<hospital name or null>",
  "reason": "<reason or null>"
}

list_appointments:
{
  "intent": "list_appointments",
  "familyMemberId": "<id or null>"
}

log_medication:
{
  "intent": "log_medication",
  "familyMemberId": "<id or null>",
  "medicationName": "<name as mentioned by user>",
  "status": "TAKEN" | "MISSED" | "SKIPPED",
  "takenAt": "<ISO 8601 +07:00 or null for now>"
}

list_medications:
{
  "intent": "list_medications",
  "familyMemberId": "<id or null>"
}

log_health_metric:
{
  "intent": "log_health_metric",
  "familyMemberId": "<id or null>",
  "type": "BLOOD_PRESSURE" | "BLOOD_SUGAR" | "WEIGHT" | "TEMPERATURE" | "CUSTOM",
  "value": <numeric value>,
  "systolic": <number or null>,
  "diastolic": <number or null>,
  "unit": "<unit string>",
  "note": "<optional note or null>"
}

list_health_metrics:
{
  "intent": "list_health_metrics",
  "familyMemberId": "<id or null>",
  "type": "BLOOD_PRESSURE" | "BLOOD_SUGAR" | "WEIGHT" | "TEMPERATURE" | "CUSTOM" | null
}

log_symptom:
{
  "intent": "log_symptom",
  "familyMemberId": "<id or null>",
  "description": "<symptom description in Thai>",
  "severity": <1-10 or null>
}

list_symptoms:
{
  "intent": "list_symptoms",
  "familyMemberId": "<id or null>"
}

chat:
{
  "intent": "chat",
  "reply": "<helpful Thai or English response>"
}

Rules:
- If family member is mentioned by name, match to the list and use their id
- If only one family member exists and no name is specified, use that member's id
- For dates: "วันนี้"=today, "พรุ่งนี้"=tomorrow relative to ${todayYmd}
- For blood pressure (ความดัน) the user often says "120/80" — set systolic/diastolic, type=BLOOD_PRESSURE, value=120
- Always respond with ONLY the JSON object, nothing else

User message: "${userMessage.replace(/"/g, '\\"')}"`
}

// ── Intent validation ─────────────────────────────────────────────────────────

const KNOWN_INTENTS = new Set([
  'add_appointment', 'list_appointments', 'log_medication', 'list_medications',
  'log_health_metric', 'list_health_metrics', 'log_symptom', 'list_symptoms', 'chat',
])

const VALID_MEDICATION_STATUSES = new Set(['TAKEN', 'MISSED', 'SKIPPED'])
const VALID_METRIC_TYPES = new Set(['BLOOD_PRESSURE', 'BLOOD_SUGAR', 'WEIGHT', 'TEMPERATURE', 'CUSTOM'])

/**
 * Pure validation function — no Prisma calls, no side effects except console.warn.
 * Returns { valid: true, intent: correctedIntent } or { valid: false, replyText: string }.
 *
 * @param {object} intent        Parsed intent object from LLM
 * @param {Array}  familyMembers Array of { id, name }
 */
export function validateIntent(intent, familyMembers) {
  // Structural check
  if (typeof intent !== 'object' || intent === null) {
    return { valid: false, replyText: 'ขออภัย ไม่เข้าใจคำสั่ง กรุณาลองใหม่อีกครั้ง' }
  }
  if (!KNOWN_INTENTS.has(intent.intent)) {
    return { valid: false, replyText: 'ขออภัย ไม่เข้าใจคำสั่ง กรุณาลองใหม่อีกครั้ง' }
  }

  // Work on a copy to avoid mutating the original
  const i = { ...intent }

  // familyMemberId: if set and not in list, clear it
  if (i.familyMemberId != null && !familyMembers.some(m => m.id === i.familyMemberId)) {
    i.familyMemberId = null
  }

  // log_medication: status enum
  if (i.intent === 'log_medication') {
    if (!VALID_MEDICATION_STATUSES.has(i.status)) {
      console.warn('[aiService] invalid medication status, defaulting to TAKEN:', i.status)
      i.status = 'TAKEN'
    }
  }

  // log_health_metric: type enum + numeric value
  if (i.intent === 'log_health_metric') {
    if (!VALID_METRIC_TYPES.has(i.type)) {
      console.warn('[aiService] invalid metric type, defaulting to CUSTOM:', i.type)
      i.type = 'CUSTOM'
    }
    if (typeof i.value !== 'number' || !isFinite(i.value)) {
      return { valid: false, replyText: 'กรุณาระบุค่าตัวเลขสำหรับค่าสุขภาพ เช่น น้ำหนัก 65 กก.' }
    }
  }

  // log_symptom: severity clamp 1–10
  if (i.intent === 'log_symptom') {
    const sev = i.severity
    if (sev == null || typeof sev !== 'number' || !isFinite(sev)) {
      i.severity = 1
    } else if (sev < 1) {
      i.severity = 1
    } else if (sev > 10) {
      i.severity = 10
    }
  }

  // add_appointment: validate appointmentAt if present
  if (i.intent === 'add_appointment' && i.appointmentAt != null) {
    if (isNaN(new Date(i.appointmentAt).getTime())) {
      i.appointmentAt = null
      return { valid: false, replyText: 'กรุณาระบุวันและเวลานัดหมายในรูปแบบที่ถูกต้อง เช่น "พรุ่งนี้บ่าย 2 โมง"' }
    }
  }

  // chat: content guardrails — SQL keywords, triple backtick, URLs
  if (i.intent === 'chat' && typeof i.reply === 'string') {
    if (
      /SELECT|DROP|INSERT/i.test(i.reply) ||
      /```/.test(i.reply) ||
      /https?:\/\//i.test(i.reply)
    ) {
      i.reply = FALLBACK_TEXT
    }
  }

  return { valid: true, intent: i }
}

// ── Parse Gemini JSON response safely ────────────────────────────────────────

function parseIntentJson(raw) {
  // Strip markdown code fences if model misbehaves
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
  try {
    return JSON.parse(cleaned)
  } catch {
    return null
  }
}

// ── Destructive intent confirmation ──────────────────────────────────────────

/**
 * Intents that require user confirmation before execution.
 * Update this set when Feature 8 adds delete/update intents.
 * @type {Set<string>}
 */
const DESTRUCTIVE_INTENTS = new Set([
  'delete_appointment',
  'delete_medication',
  'delete_symptom',
  'update_appointment',
])

function buildDestructiveSummary(intent, familyMembers) {
  const memberName = intent.familyMemberId
    ? memberNameById(intent.familyMemberId, familyMembers)
    : ''
  const ofMember = memberName ? `ของ${memberName}` : ''

  switch (intent.intent) {
    case 'delete_appointment':
      return `ลบนัดหมาย "${intent.title ?? 'นัดหมาย'}" ${ofMember}`.trim()
    case 'update_appointment':
      return `อัปเดตนัดหมาย "${intent.title ?? 'นัดหมาย'}" ${ofMember}`.trim()
    case 'delete_medication':
      return `ลบยา "${intent.medicationName ?? intent.name ?? 'ยา'}" ${ofMember}`.trim()
    case 'delete_symptom':
      return `ลบบันทึกอาการ ${ofMember}`.trim()
    default:
      return `ดำเนินการ "${intent.intent}" ${ofMember}`.trim()
  }
}

function buildConfirmFlexBubble(summary) {
  return {
    type: 'bubble',
    body: {
      type: 'box',
      layout: 'vertical',
      contents: [
        { type: 'text', text: '⚠️ ยืนยันการดำเนินการ', weight: 'bold', size: 'md' },
        { type: 'text', text: summary, wrap: true, size: 'sm', margin: 'md' },
      ],
    },
    footer: {
      type: 'box',
      layout: 'horizontal',
      spacing: 'sm',
      contents: [
        {
          type: 'button',
          style: 'primary',
          color: '#FF4444',
          action: {
            type: 'postback',
            label: 'ยืนยัน',
            data: JSON.stringify({ action: 'confirm_destructive' }),
          },
        },
        {
          type: 'button',
          style: 'secondary',
          action: {
            type: 'postback',
            label: 'ยกเลิก',
            data: JSON.stringify({ action: 'cancel_destructive' }),
          },
        },
      ],
    },
  }
}

async function storePendingAndBuildConfirmation(lineUserId, intent, familyMembers) {
  await prisma.pendingAction.upsert({
    where: { lineUserId },
    create: { lineUserId, intentJson: JSON.stringify(intent) },
    update: { intentJson: JSON.stringify(intent), createdAt: new Date() },
  })

  const summary = buildDestructiveSummary(intent, familyMembers)
  const flexContents = buildConfirmFlexBubble(summary)

  return {
    type: 'flexMessage',
    altText: `ยืนยัน: ${summary}`,
    contents: flexContents,
  }
}

// ── Ambiguity resolution ──────────────────────────────────────────────────────

const INTENTS_REQUIRING_MEMBER = new Set([
  'add_appointment', 'list_appointments', 'log_medication', 'list_medications',
  'log_health_metric', 'list_health_metrics', 'log_symptom', 'list_symptoms',
])

function buildAmbiguityQuickReply(intent, familyMembers) {
  const pendingIntent = { ...intent }
  delete pendingIntent.note
  delete pendingIntent.reason

  const encodedIntent = encodeURIComponent(JSON.stringify(pendingIntent))

  const items = familyMembers.slice(0, 13).map(m => {
    const postbackData = JSON.stringify({
      action: 'resolve_member',
      familyMemberId: m.id,
      pendingIntent: encodedIntent,
    })
    if (postbackData.length > 300) {
      console.warn('[aiService] postback data exceeds 300 bytes for member:', m.id)
    }
    return {
      label: m.name.slice(0, 20),
      postbackData,
    }
  })

  return { type: 'quickReply', text: 'ข้อมูลนี้เกี่ยวกับใครครับ?', items }
}

// ── Intent execution ──────────────────────────────────────────────────────────

export async function executeIntent(intent, userId, familyMembers) {
  switch (intent.intent) {

    case 'add_appointment': {
      const memberId = resolveOrPickFirstMember(intent.familyMemberId, familyMembers)
      if (!memberId) return '❌ ไม่พบข้อมูลสมาชิกในครอบครัว กรุณาเพิ่มสมาชิกในแอปก่อน'

      const appt = await createAppointment(userId, {
        familyMemberId: memberId,
        title: intent.title ?? 'นัดหมายแพทย์',
        appointmentAt: intent.appointmentAt ?? defaultNextWeek(),
        doctor: intent.doctor ?? null,
        hospital: intent.hospital ?? null,
        reason: intent.reason ?? null,
      })

      const memberName = memberNameById(memberId, familyMembers)
      const dateStr = toBangkokISO(new Date(appt.appointmentAt))
      return `✅ เพิ่มนัดหมายสำหรับ${memberName}แล้ว\n📋 ${appt.title}\n📅 ${formatDateForDisplay(dateStr)}${intent.hospital ? `\n🏥 ${intent.hospital}` : ''}${intent.doctor ? `\n👨‍⚕️ ${intent.doctor}` : ''}`
    }

    case 'list_appointments': {
      const memberId = resolveOrPickFirstMember(intent.familyMemberId, familyMembers)
      if (!memberId) return 'ไม่พบข้อมูลสมาชิกในครอบครัว'

      const appointments = await listAppointments(userId, {
        familyMemberId: memberId,
        status: 'UPCOMING',
      })

      if (!appointments.length) {
        const memberName = memberNameById(memberId, familyMembers)
        return `📅 ไม่มีนัดหมายที่กำลังจะมาถึงสำหรับ${memberName}`
      }

      const lines = appointments.slice(0, 5).map(a => {
        const date = formatDateForDisplay(toBangkokISO(new Date(a.appointmentAt)))
        return `• ${a.title} — ${date}${a.hospital ? ` (${a.hospital})` : ''}`
      })

      const memberName = memberNameById(memberId, familyMembers)
      return `📅 นัดหมายที่กำลังจะมาถึงของ${memberName}:\n${lines.join('\n')}`
    }

    case 'log_medication': {
      const memberId = resolveOrPickFirstMember(intent.familyMemberId, familyMembers)
      if (!memberId) return 'ไม่พบข้อมูลสมาชิกในครอบครัว'

      // Find medication by name fuzzy match
      const medications = await listMedications(userId, memberId, { active: 'true' })
      const medication = findMedicationByName(medications, intent.medicationName)

      if (!medication) {
        return `❌ ไม่พบยาชื่อ "${intent.medicationName}" สำหรับ${memberNameById(memberId, familyMembers)}\nกรุณาตรวจสอบชื่อยาในแอป`
      }

      const status = MEDICATION_LOG_STATUSES.has(intent.status) ? intent.status : 'TAKEN'
      await createMedicationLog(userId, medication.id, {
        status,
        takenAt: intent.takenAt ?? new Date().toISOString(),
      })

      const statusLabel = { TAKEN: 'กิน ✅', MISSED: 'ลืมกิน ⚠️', SKIPPED: 'งด ⏭️' }[status]
      return `💊 บันทึกยา ${medication.name} — ${statusLabel}`
    }

    case 'list_medications': {
      const memberId = resolveOrPickFirstMember(intent.familyMemberId, familyMembers)
      if (!memberId) return 'ไม่พบข้อมูลสมาชิกในครอบครัว'

      const medications = await listMedications(userId, memberId, { active: 'true' })
      if (!medications.length) {
        return `💊 ไม่มียาที่บันทึกไว้สำหรับ${memberNameById(memberId, familyMembers)}`
      }

      const lines = medications.slice(0, 8).map(m => `• ${m.name}${m.dosage ? ` (${m.dosage})` : ''}`)
      return `💊 รายการยาของ${memberNameById(memberId, familyMembers)}:\n${lines.join('\n')}`
    }

    case 'log_health_metric': {
      const memberId = resolveOrPickFirstMember(intent.familyMemberId, familyMembers)
      if (!memberId) return 'ไม่พบข้อมูลสมาชิกในครอบครัว'

      const payload = {
        familyMemberId: memberId,
        type: intent.type ?? 'CUSTOM',
        value: intent.value,
        unit: intent.unit ?? '',
        note: intent.note ?? null,
        measuredAt: new Date().toISOString(),
      }

      // Blood pressure special handling — service uses value + value2 (not systolic/diastolic)
      if (intent.type === 'BLOOD_PRESSURE' && intent.systolic && intent.diastolic) {
        payload.value = intent.systolic
        payload.value2 = intent.diastolic
      }

      await createHealthMetric(userId, payload)

      const typeLabel = {
        BLOOD_PRESSURE: '🩺 ความดันโลหิต',
        BLOOD_SUGAR: '🩸 น้ำตาลในเลือด',
        WEIGHT: '⚖️ น้ำหนัก',
        TEMPERATURE: '🌡️ อุณหภูมิ',
        CUSTOM: '📊 ค่าสุขภาพ',
      }[intent.type] ?? '📊 ค่าสุขภาพ'

      const valueStr = intent.type === 'BLOOD_PRESSURE' && intent.systolic && intent.diastolic
        ? `${intent.systolic}/${intent.diastolic} mmHg`
        : `${intent.value} ${intent.unit ?? ''}`

      return `✅ บันทึก${typeLabel}ของ${memberNameById(memberId, familyMembers)}: ${valueStr}`
    }

    case 'list_health_metrics': {
      const memberId = resolveOrPickFirstMember(intent.familyMemberId, familyMembers)
      if (!memberId) return 'ไม่พบข้อมูลสมาชิกในครอบครัว'

      const metrics = await listHealthMetrics(userId, {
        familyMemberId: memberId,
        type: intent.type ?? undefined,
      })

      if (!metrics.length) return `📊 ไม่มีข้อมูลสุขภาพสำหรับ${memberNameById(memberId, familyMembers)}`

      const lines = metrics.slice(0, 5).map(m => {
        const val = m.type === 'BLOOD_PRESSURE' && m.value != null && m.value2 != null
          ? `${m.value}/${m.value2} mmHg`
          : `${m.value} ${m.unit ?? ''}`
        const date = formatDateForDisplay(toBangkokISO(new Date(m.measuredAt)))
        return `• ${date}: ${val}`
      })

      const typeLabel = intent.type ? ` (${intent.type})` : ''
      return `📊 ค่าสุขภาพล่าสุดของ${memberNameById(memberId, familyMembers)}${typeLabel}:\n${lines.join('\n')}`
    }

    case 'log_symptom': {
      const memberId = resolveOrPickFirstMember(intent.familyMemberId, familyMembers)
      if (!memberId) return 'ไม่พบข้อมูลสมาชิกในครอบครัว'

      await createSymptomLog(userId, {
        familyMemberId: memberId,
        description: intent.description ?? 'อาการที่แจ้งผ่าน LINE',
        severity: intent.severity ?? 1,
        loggedAt: new Date().toISOString(),
      })

      return `🩹 บันทึกอาการของ${memberNameById(memberId, familyMembers)}: "${intent.description}"`
    }

    case 'list_symptoms': {
      const memberId = resolveOrPickFirstMember(intent.familyMemberId, familyMembers)
      if (!memberId) return 'ไม่พบข้อมูลสมาชิกในครอบครัว'

      const logs = await listSymptomLogs(userId, { familyMemberId: memberId, limit: '5' })
      if (!logs.length) return `🩹 ไม่มีบันทึกอาการสำหรับ${memberNameById(memberId, familyMembers)}`

      const lines = logs.map(s => {
        const date = formatDateForDisplay(toBangkokISO(new Date(s.loggedAt)))
        return `• ${date}: ${s.description}`
      })
      return `🩹 อาการล่าสุดของ${memberNameById(memberId, familyMembers)}:\n${lines.join('\n')}`
    }

    case 'chat':
      return intent.reply ?? 'ขออภัย ไม่เข้าใจคำถาม กรุณาลองใหม่อีกครั้ง'

    default:
      return 'ขออภัย ไม่เข้าใจคำสั่ง กรุณาลองใหม่อีกครั้ง'
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function resolveOrPickFirstMember(familyMemberId, familyMembers) {
  if (familyMemberId && familyMembers.some(m => m.id === familyMemberId)) {
    return familyMemberId
  }
  return familyMembers[0]?.id ?? null
}

function memberNameById(id, familyMembers) {
  return familyMembers.find(m => m.id === id)?.name ?? ''
}

function findMedicationByName(medications, nameQuery) {
  if (!nameQuery) return null
  const q = nameQuery.toLowerCase()
  return medications.find(m => m.name.toLowerCase().includes(q)) ?? null
}

function defaultNextWeek() {
  return new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
}

function formatDateForDisplay(bangkokIso) {
  // e.g. "2026-05-01T09:00:00+07:00" → "1 พ.ค. 2026 09:00 น."
  try {
    const d = new Date(bangkokIso)
    const thMonths = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.']
    // Use Bangkok offset
    const bkk = new Date(d.toLocaleString('en-US', { timeZone: 'Asia/Bangkok' }))
    const day = bkk.getDate()
    const month = thMonths[bkk.getMonth()]
    const year = bkk.getFullYear()
    const hh = String(bkk.getHours()).padStart(2, '0')
    const mm = String(bkk.getMinutes()).padStart(2, '0')
    return `${day} ${month} ${year} ${hh}:${mm} น.`
  } catch {
    return bangkokIso
  }
}

// ── Telemetry ─────────────────────────────────────────────────────────────────

export function logTelemetry({ provider, intent, durationMs, inputTokens, outputTokens, success, lineUserId, familyMemberId }) {
  try {
    const entry = {
      provider,
      intent: intent ?? null,
      durationMs,
      inputTokens: inputTokens ?? null,
      outputTokens: outputTokens ?? null,
      success,
      lineUserId,
      familyMemberId: familyMemberId ?? null,
    }
    console.log(`[aiService:telemetry] ${JSON.stringify(entry)}`)
  } catch {
    // never throw from telemetry
  }
}

// ── Rate limiting ─────────────────────────────────────────────────────────────

const DAILY_LIMIT = 50
const RATE_LIMIT_TEXT = 'ขออภัย วันนี้ใช้ FamCare AI ครบ 50 ครั้งแล้ว กรุณาลองใหม่พรุ่งนี้ครับ'

/**
 * Check and increment daily AI usage for a LINE user.
 * Returns true if the call is allowed, false if the limit is reached.
 *
 * Note: read-then-write is not a single atomic DB operation. Under high
 * concurrency a user could briefly exceed 50. Acceptable for this domain
 * (family caregivers, not adversarial users).
 *
 * @param {string} lineUserId
 * @returns {Promise<boolean>}
 */
export async function checkAndIncrementRateLimit(lineUserId) {
  const today = bangkokCalendarDate()

  const existing = await prisma.aiUsageLog.findUnique({
    where: { lineUserId_date: { lineUserId, date: today } },
    select: { count: true },
  })

  if (existing && existing.count >= DAILY_LIMIT) {
    return false // limit reached — do not increment
  }

  await prisma.aiUsageLog.upsert({
    where: { lineUserId_date: { lineUserId, date: today } },
    create: { lineUserId, date: today, count: 1 },
    update: { count: { increment: 1 } },
  })

  return true
}

// ── Main entry point ──────────────────────────────────────────────────────────

const FALLBACK_TEXT = 'ขออภัย ระบบขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้ง'

/**
 * handleAiMessage — call this from webhook handler instead of getGeminiReply()
 *
 * @param {string} userMessage   Raw LINE text message
 * @param {object} user          Prisma User record (must have .id and .lineUserId)
 * @param {Array}  familyMembers Array of { id, name } from listFamilyMembers()
 * @returns {Promise<{type: 'text', text: string} | {type: 'quickReply', text: string, items: Array} | {type: 'flexMessage', altText: string, contents: object}>}
 */
export async function handleAiMessage(userMessage, user, familyMembers) {
  // Rate limit check — before any LLM call or telemetry
  try {
    const allowed = await checkAndIncrementRateLimit(user.lineUserId)
    if (!allowed) return { type: 'text', text: RATE_LIMIT_TEXT }
  } catch (err) {
    // DB unavailable — degrade gracefully, allow the call through
    console.warn('[aiService] rate limit check failed, allowing call:', err.message)
  }

  const start = Date.now()
  let provider = 'fallback', inputTokens = null, outputTokens = null
  let intentStr = null, success = false, intent = null

  try {
    // 1. Resolve last active scope for history pre-load
    const lastScope = await resolveMemoryScope(user.lineUserId, null)
    const history = await loadHistory(user.lineUserId, lastScope)

    const prompt = buildIntentPrompt(userMessage, familyMembers, history)
    const llmResult = await callLLMWithFailover(prompt)
    provider = llmResult.provider
    inputTokens = llmResult.inputTokens
    outputTokens = llmResult.outputTokens

    console.log(`[aiService] provider=${provider}`)
    if (provider === 'fallback') {
      return { type: 'text', text: FALLBACK_TEXT }
    }

    intent = parseIntentJson(llmResult.raw)
    intentStr = intent?.intent ?? null

    if (!intent) {
      console.warn('[aiService] failed to parse intent JSON:', llmResult.raw)
      return { type: 'text', text: FALLBACK_TEXT }
    }

    const validation = validateIntent(intent, familyMembers)
    if (!validation.valid) {
      console.warn('[aiService] intent validation failed:', llmResult.raw)
      return { type: 'text', text: validation.replyText }
    }
    intent = validation.intent
    intentStr = intent.intent

    console.log(`[aiService] intent=${intent.intent} member=${intent.familyMemberId ?? 'auto'}`)

    // 2. Ambiguity resolution — ask user to pick a member when intent needs one and multiple exist
    if (
      INTENTS_REQUIRING_MEMBER.has(intent.intent) &&
      !intent.familyMemberId &&
      familyMembers.length > 1
    ) {
      return buildAmbiguityQuickReply(intent, familyMembers)
    }

    // 3. Destructive confirmation — store pending action and return Flex Message
    if (DESTRUCTIVE_INTENTS.has(intent.intent)) {
      return await storePendingAndBuildConfirmation(user.lineUserId, intent, familyMembers)
    }

    const result = await executeIntent(intent, user.id, familyMembers)
    success = true

    // 4. Determine final scope and save exchange (fire-and-forget)
    const finalScope = intent.familyMemberId ?? lastScope ?? null
    saveExchange(user.lineUserId, finalScope, userMessage, result).catch(err =>
      console.error('[aiService] saveExchange failed:', err.message)
    )

    return { type: 'text', text: result }
  } catch (err) {
    console.error('[aiService] error:', err.message)
    return { type: 'text', text: FALLBACK_TEXT }
  } finally {
    logTelemetry({
      provider,
      intent: intentStr,
      durationMs: Date.now() - start,
      inputTokens,
      outputTokens,
      success,
      lineUserId: user.lineUserId,
      familyMemberId: intent?.familyMemberId ?? null,
    })
  }
}