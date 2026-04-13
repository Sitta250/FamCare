import {
  bangkokCalendarDate,
  toBangkok,
  utcInstantFromBangkokYmdHm,
} from './datetime.js'

describe('datetime', () => {
  describe('utcInstantFromBangkokYmdHm', () => {
    it('maps Bangkok midnight to the prior UTC day evening', () => {
      const d = utcInstantFromBangkokYmdHm('2024-06-15', '00:00')
      expect(d.toISOString()).toBe('2024-06-14T17:00:00.000Z')
    })

    it('maps Bangkok 07:00 to UTC midnight on the same calendar date', () => {
      const d = utcInstantFromBangkokYmdHm('2024-01-01', '07:00')
      expect(d.toISOString()).toBe('2024-01-01T00:00:00.000Z')
    })
  })

  describe('toBangkok', () => {
    it('returns null for nullish input', () => {
      expect(toBangkok(null)).toBeNull()
      expect(toBangkok(undefined)).toBeNull()
    })
  })

  describe('bangkokCalendarDate', () => {
    it('returns YYYY-MM-DD', () => {
      const s = bangkokCalendarDate(new Date('2024-06-15T12:00:00Z'))
      expect(s).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    })
  })
})
