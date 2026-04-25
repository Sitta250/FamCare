import { parseThaiBuddhistDate } from '../utils/datetime.js'

describe('parseThaiBuddhistDate', () => {
  test('full Thai month name + BE year → correct CE date', () => {
    const d = parseThaiBuddhistDate('15 มีนาคม 2500')
    expect(d).toBeInstanceOf(Date)
    expect(d.getUTCFullYear()).toBe(1957)
    expect(d.getUTCMonth()).toBe(2) // March = 2 (0-indexed)
    expect(d.getUTCDate()).toBe(15)
  })

  test('Thai month "มกราคม" BE 2569 → January 1 2026', () => {
    const d = parseThaiBuddhistDate('1 มกราคม 2569')
    expect(d).toBeInstanceOf(Date)
    expect(d.getUTCFullYear()).toBe(2026)
    expect(d.getUTCMonth()).toBe(0)
    expect(d.getUTCDate()).toBe(1)
  })

  test('numeric slash format with BE year → correct CE date', () => {
    const d = parseThaiBuddhistDate('15/03/2569')
    expect(d).toBeInstanceOf(Date)
    expect(d.getUTCFullYear()).toBe(2026)
    expect(d.getUTCMonth()).toBe(2)
    expect(d.getUTCDate()).toBe(15)
  })

  test('ISO-like format with BE year → correct CE date', () => {
    const d = parseThaiBuddhistDate('2569-03-15')
    expect(d).toBeInstanceOf(Date)
    expect(d.getUTCFullYear()).toBe(2026)
    expect(d.getUTCMonth()).toBe(2)
    expect(d.getUTCDate()).toBe(15)
  })

  test('invalid string → null', () => {
    expect(parseThaiBuddhistDate('invalid')).toBeNull()
    expect(parseThaiBuddhistDate('')).toBeNull()
    expect(parseThaiBuddhistDate(null)).toBeNull()
    expect(parseThaiBuddhistDate('ไม่รู้วันเกิด')).toBeNull()
  })

  test('CE year (< 2400) is not modified', () => {
    const d = parseThaiBuddhistDate('1990-01-01')
    expect(d).toBeInstanceOf(Date)
    expect(d.getUTCFullYear()).toBe(1990)
  })

  test('year boundary: 2399 treated as CE, 2400 treated as BE', () => {
    const ce = parseThaiBuddhistDate('01/01/2399')
    expect(ce.getUTCFullYear()).toBe(2399)

    const be = parseThaiBuddhistDate('01/01/2400')
    expect(be.getUTCFullYear()).toBe(1857) // 2400 - 543
  })

  test('dash separator numeric format', () => {
    const d = parseThaiBuddhistDate('15-03-2569')
    expect(d).toBeInstanceOf(Date)
    expect(d.getUTCFullYear()).toBe(2026)
  })
})
