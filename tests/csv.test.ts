import { describe, it, expect } from 'vitest'
import { toCsv, money } from '../src/renderer/src/lib/csv'
import { safeCsvName } from '../src/main/services/exportFile'

describe('csv export', () => {
  it('quotes commas, quotes and newlines', () => {
    expect(toCsv([['a,b', 'say "hi"', 'x\ny', 5]])).toBe('"a,b","say ""hi""","x\ny",5\r\n')
  })
  it('defuses spreadsheet formulas in text but keeps negative numbers', () => {
    expect(toCsv([['=HYPERLINK("x")', '+1+1', '@cmd', '-5.00', -5]])).toBe(
      `"'=HYPERLINK(""x"")",'+1+1,'@cmd,-5.00,-5\r\n`
    )
  })
  it('writes money as plain numbers', () => {
    expect(money(123450)).toBe('1234.50')
    expect(money(-5)).toBe('-0.05')
    expect(money(-123450)).toBe('-1234.50')
    expect(money(0)).toBe('0.00')
  })
  it('file names are plain and end in .csv', () => {
    expect(safeCsvName('../../etc/passwd')).toBe('passwd.csv')
    expect(safeCsvName('daily-2026-10-01.csv')).toBe('daily-2026-10-01.csv')
    expect(safeCsvName('')).toBe('export.csv')
  })
})
