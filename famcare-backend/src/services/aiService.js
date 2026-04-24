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
  return result?.response?.text()?.trim() ?? ''
}

// ── Intent extraction prompt ──────────────────────────────────────────────────

function buildIntentPrompt(userMessage, familyMembers) {
  const membersJson = JSON.stringify(
    familyMembers.map(m => ({ id: m.id, name: m.name }))
  )

  // Today's date in Bangkok for relative date resolution
  const todayYmd = bangkokCalendarDate()

  return `You are FamCare intent extractor. Analyze the user message and return ONLY valid JSON — no markdown, no explanation.

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

// ── Intent execution ──────────────────────────────────────────────────────────

async function executeIntent(intent, userId, familyMembers) {
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

// ── Main entry point ──────────────────────────────────────────────────────────

const FALLBACK_TEXT = 'ขออภัย ระบบขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้ง'

/**
 * handleAiMessage — call this from webhook handler instead of getGeminiReply()
 *
 * @param {string} userMessage   Raw LINE text message
 * @param {object} user          Prisma User record (must have .id)
 * @param {Array}  familyMembers Array of { id, name } from listFamilyMembers()
 * @returns {Promise<string>}    Reply text for LINE
 */
export async function handleAiMessage(userMessage, user, familyMembers) {
  try {
    const prompt = buildIntentPrompt(userMessage, familyMembers)
    const raw = await callGemini(prompt)
    const intent = parseIntentJson(raw)

    if (!intent) {
      console.warn('[aiService] failed to parse intent JSON:', raw)
      return FALLBACK_TEXT
    }

    console.log(`[aiService] intent=${intent.intent} member=${intent.familyMemberId ?? 'auto'}`)

    return await executeIntent(intent, user.id, familyMembers)
  } catch (err) {
    console.error('[aiService] error:', err.message)
    return FALLBACK_TEXT
  }
}