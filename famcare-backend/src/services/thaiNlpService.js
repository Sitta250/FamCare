import { bangkokCalendarDate, utcInstantFromBangkokYmdHm } from '../utils/datetime.js'

const THAI_MONTHS = {
  มกราคม: 1,
  กุมภาพันธ์: 2,
  มีนาคม: 3,
  เมษายน: 4,
  พฤษภาคม: 5,
  มิถุนายน: 6,
  กรกฎาคม: 7,
  สิงหาคม: 8,
  กันยายน: 9,
  ตุลาคม: 10,
  พฤศจิกายน: 11,
  ธันวาคม: 12,
}

const APPOINTMENT_TITLES = ['นัดหมาย', 'นัดพยาบาล', 'นัดหมอ', 'นัด']

export function parseIntent(text) {
  const normalized = String(text || '').trim()

  if (!normalized) {
    return { intent: 'unknown', data: {} }
  }

  if (normalized.includes('โหมดกลุ่ม')) {
    return { intent: 'chatMode', data: { mode: 'GROUP' } }
  }

  if (normalized.includes('โหมดส่วนตัว')) {
    return { intent: 'chatMode', data: { mode: 'PRIVATE' } }
  }

  const title = detectAppointmentTitle(normalized)
  if (!title) {
    return { intent: 'unknown', data: {} }
  }

  return {
    intent: 'appointment',
    data: {
      title,
      appointmentAt: parseAppointmentAt(normalized),
    },
  }
}

function detectAppointmentTitle(text) {
  return APPOINTMENT_TITLES.find((candidate) => text.includes(candidate)) ?? null
}

function parseAppointmentAt(text) {
  const dateYmd = parseDateToken(text)
  const timeHm = parseTimeToken(text)

  if (!dateYmd || !timeHm) {
    return null
  }

  return utcInstantFromBangkokYmdHm(dateYmd, timeHm)
}

function parseDateToken(text) {
  const todayYmd = bangkokCalendarDate()

  if (text.includes('วันนี้')) {
    return todayYmd
  }

  if (text.includes('พรุ่งนี้')) {
    return addDaysToYmd(todayYmd, 1)
  }

  if (text.includes('มะรืน')) {
    return addDaysToYmd(todayYmd, 2)
  }

  return parseExplicitDate(text, todayYmd)
}

function parseExplicitDate(text, todayYmd) {
  const monthNames = Object.keys(THAI_MONTHS).join('|')
  const match = text.match(new RegExp(`(\\d{1,2})\\s*(${monthNames})(?:\\s*(\\d{4}))?`))

  if (!match) {
    return null
  }

  const day = Number(match[1])
  const month = THAI_MONTHS[match[2]]
  const today = ymdParts(todayYmd)
  let year = match[3] ? Number(match[3]) : today.year

  if (!isValidCalendarDate(year, month, day)) {
    return null
  }

  if (!match[3]) {
    const candidate = formatYmd(year, month, day)
    if (candidate < todayYmd) {
      year += 1
      if (!isValidCalendarDate(year, month, day)) {
        return null
      }
    }
  }

  return formatYmd(year, month, day)
}

function parseTimeToken(text) {
  if (text.includes('เที่ยง')) {
    return '12:00'
  }

  const afternoon = text.match(/บ่าย\s*(\d{1,2})\s*โมง/)
  if (afternoon) {
    const hour = Number(afternoon[1])
    if (hour >= 1 && hour <= 11) {
      return `${String(hour + 12).padStart(2, '0')}:00`
    }
  }

  const evening = text.match(/เย็น\s*(\d{1,2})\s*โมง/)
  if (evening) {
    const hour = Number(evening[1])
    if (hour >= 1 && hour <= 4) {
      return `${String(hour + 17).padStart(2, '0')}:00`
    }
  }

  const bare = text.match(/(^|[\s])(\d{1,2})\s*โมง/)
  if (bare) {
    const hour = Number(bare[2])

    // Thai "X โมง" without a qualifier is ambiguous; treat it as morning.
    if (hour >= 1 && hour <= 6) {
      return `${String(hour + 6).padStart(2, '0')}:00`
    }

    if (hour >= 7 && hour <= 11) {
      return `${String(hour).padStart(2, '0')}:00`
    }
  }

  return null
}

function addDaysToYmd(ymd, days) {
  const { year, month, day } = ymdParts(ymd)
  const date = new Date(Date.UTC(year, month - 1, day + days))
  return formatYmd(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate())
}

function ymdParts(ymd) {
  const [year, month, day] = ymd.split('-').map(Number)
  return { year, month, day }
}

function formatYmd(year, month, day) {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function isValidCalendarDate(year, month, day) {
  const candidate = new Date(Date.UTC(year, month - 1, day))
  return candidate.getUTCFullYear() === year
    && candidate.getUTCMonth() === month - 1
    && candidate.getUTCDate() === day
}
