import { describe, it, expect } from 'vitest'
import { memoryDb } from './helpers'
import {
  createProduct,
  adjustStock,
  listProducts,
  deactivateProduct,
  getProduct,
  updateProduct
} from '../src/main/services/products'
import { createBill, getBill } from '../src/main/services/bills'
import { createPurchase } from '../src/main/services/purchases'
import { getSettings, saveSettings, DEFAULT_SETTINGS } from '../src/main/services/settings'

// QA regression tests: each block documents a defect found during the QA audit (see docs/QA_REPORT.md).

describe('QA: settings integrity', () => {
  it('D4: unknown keys sent over IPC are not persisted', () => {
    const db = memoryDb()
    saveSettings(db, { ...DEFAULT_SETTINGS, evil: 'x' } as never)
    const keys = (db.prepare('SELECT key FROM settings').all() as { key: string }[]).map(
      (r) => r.key
    )
    expect(keys).not.toContain('evil')
  })
  it('D4: non-string text fields are rejected, not stored as "[object Object]"', () => {
    const db = memoryDb()
    expect(() => saveSettings(db, { ...DEFAULT_SETTINGS, address: { a: 1 } } as never)).toThrow()
    expect(getSettings(db).address).toBe('')
  })
  it('D4: a failing save leaves previous settings untouched', () => {
    const db = memoryDb()
    saveSettings(db, { ...DEFAULT_SETTINGS, shopName: 'Keep Me' })
    expect(() =>
      saveSettings(db, { ...DEFAULT_SETTINGS, shopName: 'New', taxRateBp: -1 })
    ).toThrow()
    expect(getSettings(db).shopName).toBe('Keep Me')
  })
})

describe('QA: search', () => {
  it('D5: % and _ are literal characters in product search', () => {
    const db = memoryDb()
    createProduct(db, { name: '50% off tag', priceMinor: 100 })
    createProduct(db, { name: 'Plain pen', priceMinor: 100 })
    expect(listProducts(db, '%').map((p) => p.name)).toEqual(['50% off tag'])
    expect(listProducts(db, '_').length).toBe(0)
  })
})

describe('QA: numeric bounds', () => {
  it('D6: absurd prices/quantities are rejected instead of corrupting totals', () => {
    const db = memoryDb()
    expect(() => createProduct(db, { name: 'X', priceMinor: Number.MAX_SAFE_INTEGER })).toThrow()
    expect(() => createProduct(db, { name: 'X', priceMinor: 100, stockQty: 1e12 })).toThrow()
    const p = createProduct(db, { name: 'Y', priceMinor: 100, stockQty: 5 })
    expect(() => adjustStock(db, p.id, 1e15, 'adjustment')).toThrow()
    expect(() => createBill(db, { items: [{ productId: p.id, qty: 1e15 }] })).toThrow()
  })
})

describe('QA: billing validation', () => {
  it('D8: unknown payment methods are rejected', () => {
    const db = memoryDb()
    const p = createProduct(db, { name: 'A', priceMinor: 100, stockQty: 5 })
    expect(() =>
      createBill(db, { items: [{ productId: p.id, qty: 1 }], paymentMethod: 'bitcoin<script>' })
    ).toThrow(/payment/i)
    expect(getProduct(db, p.id)?.stockQty).toBe(5)
  })
  it('D10: malformed line items are rejected cleanly', () => {
    const db = memoryDb()
    expect(() => createBill(db, { items: [{ productId: 'abc', qty: 1 }] } as never)).toThrow()
    expect(() => createBill(db, { items: [null] } as never)).toThrow()
    expect(() => createBill(db, { items: 'x' } as never)).toThrow()
  })
  it('failed sale (one line short of stock) leaves stock and bill count unchanged', () => {
    const db = memoryDb()
    const a = createProduct(db, { name: 'A', priceMinor: 100, stockQty: 5 })
    const b = createProduct(db, { name: 'B', priceMinor: 100, stockQty: 1 })
    expect(() =>
      createBill(db, {
        items: [
          { productId: a.id, qty: 2 },
          { productId: b.id, qty: 2 }
        ]
      })
    ).toThrow(/Not enough stock/)
    expect(getProduct(db, a.id)?.stockQty).toBe(5)
    expect((db.prepare('SELECT COUNT(*) c FROM bills').get() as { c: number }).c).toBe(0)
    expect((db.prepare('SELECT COUNT(*) c FROM stock_movements').get() as { c: number }).c).toBe(
      1 + 1
    )
  })
  it('historical bills stay readable after the product is edited or removed', () => {
    const db = memoryDb()
    const p = createProduct(db, { name: 'Old name', priceMinor: 500, stockQty: 3 })
    const bill = createBill(db, { items: [{ productId: p.id, qty: 2 }] })
    updateProduct(db, p.id, { name: 'New name', priceMinor: 999 })
    deactivateProduct(db, p.id)
    const again = getBill(db, bill.id)!
    expect(again.items[0].name).toBe('Old name')
    expect(again.items[0].unitPriceMinor).toBe(500)
    expect(again.totalMinor).toBe(1000)
  })
  it('bill numbers are unique and sequential across many bills', () => {
    const db = memoryDb()
    const p = createProduct(db, { name: 'A', priceMinor: 10, stockQty: 1000 })
    const nos = Array.from(
      { length: 100 },
      () => createBill(db, { items: [{ productId: p.id, qty: 1 }] }).billNo
    )
    expect(new Set(nos).size).toBe(100)
    expect(nos[99]).toBe('INV-000100')
    expect(getProduct(db, p.id)?.stockQty).toBe(900)
  })
  it('selling the last unit twice cannot oversell', () => {
    const db = memoryDb()
    const p = createProduct(db, { name: 'Last', priceMinor: 100, stockQty: 1 })
    createBill(db, { items: [{ productId: p.id, qty: 1 }] })
    expect(() => createBill(db, { items: [{ productId: p.id, qty: 1 }] })).toThrow(/Not enough/)
    expect(getProduct(db, p.id)?.stockQty).toBe(0)
  })
})

describe('QA: stock rules', () => {
  it('D9: stock cannot be adjusted on a removed product', () => {
    const db = memoryDb()
    const p = createProduct(db, { name: 'Gone', priceMinor: 100, stockQty: 1 })
    deactivateProduct(db, p.id)
    expect(() => adjustStock(db, p.id, 5, 'adjustment')).toThrow(/not found|removed/i)
  })
  it('purchase on a removed product is refused and changes nothing', () => {
    const db = memoryDb()
    const p = createProduct(db, { name: 'Gone', priceMinor: 100, stockQty: 1 })
    deactivateProduct(db, p.id)
    expect(() =>
      createPurchase(db, {
        supplierName: 'S',
        items: [{ productId: p.id, qty: 5, totalCostMinor: 100 }]
      })
    ).toThrow()
    expect((db.prepare('SELECT COUNT(*) c FROM purchases').get() as { c: number }).c).toBe(0)
  })
  it('duplicate product code is refused on create and update', () => {
    const db = memoryDb()
    createProduct(db, { name: 'A', code: 'DUP', priceMinor: 1 })
    const b = createProduct(db, { name: 'B', priceMinor: 1 })
    expect(() => createProduct(db, { name: 'C', code: 'DUP', priceMinor: 1 })).toThrow()
    expect(() => updateProduct(db, b.id, { name: 'B', code: 'DUP', priceMinor: 1 })).toThrow()
  })
})

describe('QA: SQL injection', () => {
  it('hostile search text is treated as data', () => {
    const db = memoryDb()
    createProduct(db, { name: 'Safe', priceMinor: 1 })
    expect(() => listProducts(db, "'; DROP TABLE products; --")).not.toThrow()
    expect(listProducts(db, '').length).toBe(1)
    createProduct(db, { name: `Robert'); DROP TABLE bills;--`, priceMinor: 1 })
    expect((db.prepare('SELECT COUNT(*) c FROM products').get() as { c: number }).c).toBe(2)
  })
})
