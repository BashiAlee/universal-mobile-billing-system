import type { Db } from '../db/database'
import { transaction } from '../db/database'
import type { ShopSettings } from '../../shared/types'

export const DEFAULT_SETTINGS: ShopSettings = {
  shopName: 'My Shop',
  address: '',
  phone: '',
  currencySymbol: 'Rs',
  taxRateBp: 0,
  logoDataUrl: '',
  receiptFooter: 'Thank you for shopping with us!',
  receiptWidthMm: 80,
  labelWidthMm: 40,
  labelHeightMm: 30,
  labelCodeType: 'barcode',
  receiptPrinter: '',
  labelPrinter: ''
}

const MAX_LOGO_CHARS = 1_500_000 // ~1.1 MB of image data once base64-decoded
const LOGO_PATTERN = /^data:image\/(png|jpeg|webp|svg\+xml);base64,[A-Za-z0-9+/=]+$/

export function getSettings(db: Db): ShopSettings {
  const rows = db.prepare('SELECT key, value FROM settings').all() as {
    key: string
    value: string
  }[]
  const stored = Object.fromEntries(rows.map((r) => [r.key, r.value]))
  return {
    shopName: stored.shopName ?? DEFAULT_SETTINGS.shopName,
    address: stored.address ?? DEFAULT_SETTINGS.address,
    phone: stored.phone ?? DEFAULT_SETTINGS.phone,
    currencySymbol: stored.currencySymbol ?? DEFAULT_SETTINGS.currencySymbol,
    taxRateBp:
      stored.taxRateBp !== undefined ? Number(stored.taxRateBp) : DEFAULT_SETTINGS.taxRateBp,
    logoDataUrl: stored.logoDataUrl ?? DEFAULT_SETTINGS.logoDataUrl,
    receiptFooter: stored.receiptFooter ?? DEFAULT_SETTINGS.receiptFooter,
    receiptWidthMm:
      stored.receiptWidthMm !== undefined
        ? Number(stored.receiptWidthMm)
        : DEFAULT_SETTINGS.receiptWidthMm,
    labelWidthMm:
      stored.labelWidthMm !== undefined
        ? Number(stored.labelWidthMm)
        : DEFAULT_SETTINGS.labelWidthMm,
    labelHeightMm:
      stored.labelHeightMm !== undefined
        ? Number(stored.labelHeightMm)
        : DEFAULT_SETTINGS.labelHeightMm,
    labelCodeType: stored.labelCodeType === 'qr' ? 'qr' : 'barcode',
    receiptPrinter: stored.receiptPrinter ?? DEFAULT_SETTINGS.receiptPrinter,
    labelPrinter: stored.labelPrinter ?? DEFAULT_SETTINGS.labelPrinter
  }
}

const TEXT_FIELDS = ['shopName', 'address', 'phone', 'currencySymbol', 'receiptFooter'] as const

export function validateSettings(s: ShopSettings): void {
  for (const k of TEXT_FIELDS) if (typeof s[k] !== 'string') throw new Error(`${k} must be text`)
  if (s.shopName.length > 100 || s.address.length > 200 || s.phone.length > 50)
    throw new Error('Shop name, address or phone is too long')
  if (s.currencySymbol.length > 10) throw new Error('Currency symbol is too long (max 10)')
  if (s.receiptFooter.length > 200) throw new Error('Receipt footer is too long (max 200)')
  if (typeof s.logoDataUrl !== 'string') throw new Error('Invalid logo')
  if (!s.shopName.trim()) throw new Error('Shop name is required')
  if (!Number.isInteger(s.taxRateBp) || s.taxRateBp < 0 || s.taxRateBp > 10000)
    throw new Error('Tax rate must be between 0% and 100%')
  if (s.receiptWidthMm !== 58 && s.receiptWidthMm !== 80)
    throw new Error('Receipt width must be 58 mm or 80 mm')
  for (const [label, v] of [
    ['Label width', s.labelWidthMm],
    ['Label height', s.labelHeightMm]
  ] as const)
    if (!Number.isInteger(v) || v < 15 || v > 200)
      throw new Error(`${label} must be between 15 and 200 mm`)
  if (s.labelCodeType !== 'barcode' && s.labelCodeType !== 'qr')
    throw new Error('Label code must be barcode or QR')
  for (const [label, v] of [
    ['Receipt printer', s.receiptPrinter],
    ['Label printer', s.labelPrinter]
  ] as const)
    if (typeof v !== 'string' || v.length > 200) throw new Error(`${label} name is invalid`)
  if (s.logoDataUrl) {
    if (s.logoDataUrl.length > MAX_LOGO_CHARS) throw new Error('Logo is too large (max about 1 MB)')
    if (!LOGO_PATTERN.test(s.logoDataUrl))
      throw new Error('Logo must be a png, jpeg, webp or svg image')
  }
}

export function saveSettings(db: Db, s: ShopSettings): ShopSettings {
  validateSettings(s)
  const up = db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  )
  // Only known keys are written (extra properties from the renderer are ignored), all or nothing.
  transaction(db, () => {
    for (const k of Object.keys(DEFAULT_SETTINGS) as (keyof ShopSettings)[]) up.run(k, String(s[k]))
  })
  return getSettings(db)
}
