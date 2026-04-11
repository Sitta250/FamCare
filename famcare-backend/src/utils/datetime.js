const BANGKOK_TZ = 'Asia/Bangkok'

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
