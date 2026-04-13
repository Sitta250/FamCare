import { prisma } from '../lib/prisma.js'
import { assertCanReadMember } from './accessService.js'
import { toBangkokISO } from '../utils/datetime.js'

const FALLBACK_DAYS = 14

export async function getPreAppointmentReport(actorUserId, appointmentId) {
  const appointment = await prisma.appointment.findUnique({
    where: { id: appointmentId },
    include: { familyMember: true },
  })
  if (!appointment) {
    throw Object.assign(new Error('Appointment not found'), { status: 404, code: 'NOT_FOUND' })
  }

  await assertCanReadMember(actorUserId, appointment.familyMemberId)

  const { familyMemberId } = appointment

  // ── Window start: last completed appointment for this member, or FALLBACK_DAYS ago ──
  const lastCompleted = await prisma.appointment.findFirst({
    where: {
      familyMemberId,
      status: 'COMPLETED',
      id: { not: appointmentId },
      appointmentAt: { lt: appointment.appointmentAt },
    },
    orderBy: { appointmentAt: 'desc' },
  })

  const windowStart = lastCompleted
    ? lastCompleted.appointmentAt
    : new Date(Date.now() - FALLBACK_DAYS * 24 * 60 * 60 * 1000)

  const windowEnd = appointment.appointmentAt

  // ── Symptoms since last visit ──
  const symptoms = await prisma.symptomLog.findMany({
    where: {
      familyMemberId,
      loggedAt: { gte: windowStart, lte: windowEnd },
    },
    orderBy: { loggedAt: 'asc' },
  })

  // ── Medication adherence: counts across all active medications ──
  const activeMeds = await prisma.medication.findMany({
    where: { familyMemberId, active: true },
    include: {
      logs: {
        where: { takenAt: { gte: windowStart, lte: windowEnd } },
      },
    },
  })

  const adherence = activeMeds.map(med => {
    const taken = med.logs.filter(l => l.status === 'TAKEN').length
    const missed = med.logs.filter(l => l.status === 'MISSED').length
    const skipped = med.logs.filter(l => l.status === 'SKIPPED').length
    const total = taken + missed + skipped
    return {
      medicationId: med.id,
      name: med.name,
      dosage: med.dosage ?? null,
      taken,
      missed,
      skipped,
      total,
      adherenceRate: total > 0 ? Math.round((taken / total) * 100) : null,
    }
  })

  // ── Recent health metrics (last 14 days) ──
  const metricsFrom = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000)
  const healthMetrics = await prisma.healthMetric.findMany({
    where: {
      familyMemberId,
      measuredAt: { gte: metricsFrom, lte: windowEnd },
    },
    orderBy: { measuredAt: 'asc' },
  })

  // ── Suggested questions stub ──
  const suggestedQuestions = buildSuggestedQuestions({ symptoms, adherence, healthMetrics })

  return {
    appointment: {
      id: appointment.id,
      title: appointment.title,
      appointmentAt: toBangkokISO(appointment.appointmentAt),
      doctor: appointment.doctor ?? null,
      hospital: appointment.hospital ?? null,
      reason: appointment.reason ?? null,
    },
    windowStart: toBangkokISO(windowStart),
    windowEnd: toBangkokISO(windowEnd),
    basedOnLastVisit: !!lastCompleted,
    symptoms: symptoms.map(s => ({
      id: s.id,
      description: s.description,
      severity: s.severity,
      note: s.note ?? null,
      loggedAt: toBangkokISO(s.loggedAt),
    })),
    medicationAdherence: adherence,
    recentHealthMetrics: healthMetrics.map(m => ({
      id: m.id,
      type: m.type,
      value: m.value,
      unit: m.unit,
      note: m.note ?? null,
      measuredAt: toBangkokISO(m.measuredAt),
    })),
    suggestedQuestions,
  }
}

function buildSuggestedQuestions({ symptoms, adherence, healthMetrics }) {
  const questions = []

  if (symptoms.length > 0) {
    const highSeverity = symptoms.filter(s => s.severity >= 7)
    if (highSeverity.length > 0) {
      questions.push(`อาการ "${highSeverity[0].description}" (ระดับ ${highSeverity[0].severity}/10) ควรกังวลหรือไม่?`)
    } else {
      questions.push(`อาการที่บันทึกไว้ในช่วงนี้ต้องการการรักษาเพิ่มเติมหรือไม่?`)
    }
  }

  const poorAdherence = adherence.filter(a => a.adherenceRate !== null && a.adherenceRate < 80)
  if (poorAdherence.length > 0) {
    questions.push(`การกินยา "${poorAdherence[0].name}" ไม่สม่ำเสมอ (${poorAdherence[0].adherenceRate}%) — ควรปรับเวลาหรือขนาดยาหรือไม่?`)
  }

  const bpMetrics = healthMetrics.filter(m => m.type === 'BLOOD_PRESSURE')
  if (bpMetrics.length > 0) {
    const latest = bpMetrics[bpMetrics.length - 1]
    questions.push(`ค่าความดันโลหิตล่าสุด ${latest.value} ${latest.unit} อยู่ในเกณฑ์ปกติหรือไม่?`)
  }

  if (questions.length === 0) {
    questions.push('มีสิ่งที่ต้องติดตามเป็นพิเศษในการพบแพทย์ครั้งนี้หรือไม่?')
  }

  return questions
}
