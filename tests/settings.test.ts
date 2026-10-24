import { describe, it, expect } from 'vitest'
import { memoryDb } from './helpers'
import { getSettings, saveSettings, DEFAULT_SETTINGS } from '../src/main/services/settings'

const PNG = 'data:image/png;base64,iVBORw0KGgo='

describe('settings / white-label branding', () => {
  it('returns defaults on a fresh database', () => {
    expect(getSettings(memoryDb())).toEqual(DEFAULT_SETTINGS)
  })
  it('saves and reloads shop name and logo', () => {
    const db = memoryDb()
    saveSettings(db, {
      ...DEFAULT_SETTINGS,
      shopName: 'Ali Traders',
      logoDataUrl: PNG,
      taxRateBp: 1800
    })
    const s = getSettings(db)
    expect(s.shopName).toBe('Ali Traders')
    expect(s.logoDataUrl).toBe(PNG)
    expect(s.taxRateBp).toBe(1800)
  })
  it('can replace and clear the logo', () => {
    const db = memoryDb()
    saveSettings(db, { ...DEFAULT_SETTINGS, logoDataUrl: PNG })
    saveSettings(db, { ...DEFAULT_SETTINGS, logoDataUrl: '' })
    expect(getSettings(db).logoDataUrl).toBe('')
  })
  it('stores printer settings and rejects bad values', () => {
    const db = memoryDb()
    saveSettings(db, {
      ...DEFAULT_SETTINGS,
      receiptWidthMm: 58,
      labelWidthMm: 50,
      labelHeightMm: 30
    })
    expect(getSettings(db)).toMatchObject({
      receiptWidthMm: 58,
      labelWidthMm: 50,
      labelHeightMm: 30
    })
    expect(() => saveSettings(db, { ...DEFAULT_SETTINGS, receiptWidthMm: 70 })).toThrow(
      /Receipt width/
    )
    expect(() => saveSettings(db, { ...DEFAULT_SETTINGS, labelWidthMm: 5 })).toThrow(/Label width/)
    expect(() => saveSettings(db, { ...DEFAULT_SETTINGS, labelHeightMm: 500 })).toThrow(
      /Label height/
    )
  })
  it('stores label code type and rejects unknown values', () => {
    const db = memoryDb()
    expect(getSettings(db).labelCodeType).toBe('barcode')
    saveSettings(db, { ...DEFAULT_SETTINGS, labelCodeType: 'qr' })
    expect(getSettings(db).labelCodeType).toBe('qr')
    expect(() =>
      saveSettings(db, { ...DEFAULT_SETTINGS, labelCodeType: 'datamatrix' as 'qr' })
    ).toThrow(/Label code/)
  })
  it('rejects empty shop name, bad tax rate, and non-image logos', () => {
    const db = memoryDb()
    expect(() => saveSettings(db, { ...DEFAULT_SETTINGS, shopName: '  ' })).toThrow(/Shop name/)
    expect(() => saveSettings(db, { ...DEFAULT_SETTINGS, taxRateBp: 20000 })).toThrow(/Tax rate/)
    expect(() =>
      saveSettings(db, { ...DEFAULT_SETTINGS, logoDataUrl: 'data:text/html;base64,AAAA' })
    ).toThrow(/Logo/)
    expect(() =>
      saveSettings(db, { ...DEFAULT_SETTINGS, logoDataUrl: 'https://evil.example/x.png' })
    ).toThrow(/Logo/)
  })
})
