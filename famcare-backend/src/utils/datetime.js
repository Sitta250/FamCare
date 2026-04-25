const BANGKOK_TZ = 'Asia/Bangkok'

/** YYYY-MM-DD calendar date in Asia/Bangkok (cron / medication schedules). */
export function bangkokCalendarDate(d = new Date()) {
  return d.toLocaleDateString('sv-SE', { timeZone: BANGKOK_TZ })
}

/** HH:mm 24h clock in Asia/Bangkok. */
export function bangkokClockHm(d = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: BANGKOK_TZ,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(d)
  const h = parts.find((p) => p.type === 'hour')?.value ?? '00'
  const m = parts.find((p) => p.type === 'minute')?.value ?? '00'
  return `${h.padStart(2, '0')}:${m.padStart(2, '0')}`
}

/**
 * Bangkok wall clock YYYY-MM-DD + HH:mm → UTC instant. Thailand is UTC+7 year-round.
 */
export function utcInstantFromBangkokYmdHm(ymd, hm) {
  const [y, mo, day] = ymd.split('-').map(Number)
  const [h, mi] = hm.split(':').map(Number)
  return new Date(Date.UTC(y, mo - 1, day, h - 7, mi, 0, 0))
}

export function toBangkok(date) {
  if (!date) return null
  return new Date(date).toLocaleString('en-CA', {
    timeZone: BANGKOK_TZ,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

const THAI_MONTHS = {
  'มกราคม': 1, 'กุมภาพันธ์': 2, 'มีนาคม': 3, 'เมษายน': 4,
  'พฤษภาคม': 5, 'มิถุนายน': 6, 'กรกฎาคม': 7, 'สิงหาคม': 8,
  'กันยายน': 9, 'ตุลาคม': 10, 'พฤศจิกายน': 11, 'ธันวาคม': 12,
}

/**
 * Parse a Thai-language or numeric date string into a UTC Date.
 * Converts Buddhist Era years (>= 2400) to CE by subtracting 543.
 *
 * Supported formats:
 *   "15 มีนาคม 2500"  (Thai month name)
 *   "15/03/2569"       (day/month/year)
 *   "2569-03-15"       (ISO-like, year first)
 *
 * @param {string} str
 * @returns {Date|null}
 */
export function parseThaiBuddhistDate(str) {
  if (!str || typeof str !== 'string') return null
  const s = str.trim()

  let day, month, year

  // Format: "15 มีนาคม 2500"
  const thaiMonthMatch = s.match(/^(\d{1,2})\s+([\u0E00-\u0E7F]+)\s+(\d{4})$/)
  if (thaiMonthMatch) {
    day = parseInt(thaiMonthMatch[1], 10)
    month = THAI_MONTHS[thaiMonthMatch[2]]
    year = parseInt(thaiMonthMatch[3], 10)
    if (!month) return null
  }

  // Format: "15/03/2569" or "15-03-2569"
  if (day === undefined) {
    const slashMatch = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/)
    if (slashMatch) {
      day = parseInt(slashMatch[1], 10)
      month = parseInt(slashMatch[2], 10)
      year = parseInt(slashMatch[3], 10)
    }
  }

  // Format: "2569-03-15" (year first)
  if (day === undefined) {
    const isoMatch = s.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/)
    if (isoMatch) {
      year = parseInt(isoMatch[1], 10)
      month = parseInt(isoMatch[2], 10)
      day = parseInt(isoMatch[3], 10)
    }
  }

  if (day === undefined || !month || !year) return null
  if (month < 1 || month > 12 || day < 1 || day > 31) return null

  // Convert Buddhist Era to CE
  const ceYear = year >= 2400 ? year - 543 : year

  const date = new Date(Date.UTC(ceYear, month - 1, day))
  if (isNaN(date.getTime())) return null
  return date
}

export function toBangkokISO(date) {
  if (!date) return null
  // Returns an ISO-like string offset to Bangkok (UTC+7)
  const d = new Date(date)
  const offset = 7 * 60 * 60 * 1000
  const local = new Date(d.getTime() + offset)
  return local.toISOString().replace('Z', '+07:00')
}
