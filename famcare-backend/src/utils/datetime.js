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

export function toBangkokISO(date) {
  if (!date) return null
  // Returns an ISO-like string offset to Bangkok (UTC+7)
  const d = new Date(date)
  const offset = 7 * 60 * 60 * 1000
  const local = new Date(d.getTime() + offset)
  return local.toISOString().replace('Z', '+07:00')
}
