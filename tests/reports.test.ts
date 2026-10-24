import { describe, it, expect } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { memoryDb } from './helpers'
import { migrate } from '../src/main/db/database'
import { createProduct, getProduct, updateProduct } from '../src/main/services/products'
import { createBill } from '../src/main/services/bills'
import { createPurchase, createSupplierNote } from '../src/main/services/purchases'
import { getSettings, saveSettings } from '../src/main/services/settings'
import { getReport } from '../src/main/services/reports'

const today = (): string => {
  const n = new Date()
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`
}
const wide = { from: '2000-01-01', to: '2100-01-01' }

describe('reports', () => {
  it('stock goes down automatically when a bill is saved', () => {
    const db = memoryDb()
    const p = createProduct(db, { name: 'Cover', priceMinor: 12000, costMinor: 5000, stockQty: 10 })
    createBill(db, { items: [{ productId: p.id, qty: 3 }] })
    expect(getProduct(db, p.id)!.stockQty).toBe(7)
  })

  it('computes sales, discount, cost and profit; tax is not income', () => {
    const db = memoryDb()
    saveSettings(db, { ...getSettings(db), taxRateBp: 1000 }) // 10 %
    const p = createProduct(db, { name: 'Cover', priceMinor: 12000, costMinor: 5000, stockQty: 10 })
    createBill(db, { items: [{ productId: p.id, qty: 2 }], discountMinor: 4000 })
    const r = getReport(db, wide)
    expect(r.bills).toBe(1)
    expect(r.grossSalesMinor).toBe(24000)
    expect(r.discountMinor).toBe(4000)
    expect(r.netSalesMinor).toBe(20000)
    expect(r.taxMinor).toBe(2000)
    expect(r.totalBilledMinor).toBe(22000)
    expect(r.costMinor).toBe(10000)
    expect(r.profitMinor).toBe(10000)
    expect(r.daily).toEqual([
      { period: today(), bills: 1, netSalesMinor: 20000, costMinor: 10000, profitMinor: 10000 }
    ])
    expect(r.monthly[0].period).toBe(today().slice(0, 7))
    expect(r.products[0]).toMatchObject({
      name: 'Cover',
      qty: 2,
      salesMinor: 24000,
      profitMinor: 14000
    })
  })

  it('keeps old profit correct when the cost price changes later', () => {
    const db = memoryDb()
    const p = createProduct(db, { name: 'X', priceMinor: 1000, costMinor: 400, stockQty: 5 })
    createBill(db, { items: [{ productId: p.id, qty: 1 }] })
    updateProduct(db, p.id, { name: 'X', priceMinor: 1000, costMinor: 900 })
    expect(getReport(db, wide).profitMinor).toBe(600)
  })

  it('splits by payment method, counts supplier spend and values current stock', () => {
    const db = memoryDb()
    const p = createProduct(db, { name: 'X', priceMinor: 1000, costMinor: 400, stockQty: 5 })
    createBill(db, { items: [{ productId: p.id, qty: 1 }], paymentMethod: 'cash' })
    createBill(db, { items: [{ productId: p.id, qty: 1 }], paymentMethod: 'credit' })
    createPurchase(db, {
      supplierName: 'ABC',
      items: [{ productId: p.id, qty: 10, totalCostMinor: 4000 }]
    })
    createSupplierNote(db, { supplierName: 'ABC', description: 'misc', amountMinor: 1000 })
    const r = getReport(db, wide)
    expect(r.byPayment.map((x) => x.method).sort()).toEqual(['cash', 'credit'])
    expect(r.supplierSpendMinor).toBe(5000)
    // 3 left + 10 bought = 13 units at the new cost of 400 each
    expect(r.stockCostValueMinor).toBe(13 * 400)
    expect(r.stockRetailValueMinor).toBe(13 * 1000)
  })

  it('only includes bills inside the date range and rejects bad ranges', () => {
    const db = memoryDb()
    const p = createProduct(db, { name: 'X', priceMinor: 1000, stockQty: 5 })
    createBill(db, { items: [{ productId: p.id, qty: 1 }] })
    expect(getReport(db, { from: '2000-01-01', to: '2000-01-31' }).bills).toBe(0)
    expect(getReport(db, { from: today(), to: today() }).bills).toBe(1)
    expect(() => getReport(db, { from: '2026-02-01', to: '2026-01-01' })).toThrow(/before/)
    expect(() => getReport(db, { from: 'abc', to: today() })).toThrow(/valid dates/)
  })

  it('upgrading from schema v3 backfills the cost on existing bill lines', () => {
    const db = new DatabaseSync(':memory:')
    migrate(db, 3)
    db.exec(`INSERT INTO products (id, code, name, price_minor, cost_minor, stock_qty, created_at, updated_at)
             VALUES (1, 'P-1', 'Old', 1000, 450, 0, 'x', 'x')`)
    db.exec(`INSERT INTO bills (id, bill_no, created_at, subtotal_minor, discount_minor, tax_minor, total_minor, payment_method)
             VALUES (1, 'INV-1', '2026-01-05T10:00:00.000Z', 1000, 0, 0, 1000, 'cash')`)
    db.exec(`INSERT INTO bill_items (bill_id, product_id, code, name, unit_price_minor, qty, line_total_minor)
             VALUES (1, 1, 'P-1', 'Old', 1000, 1, 1000)`)
    migrate(db)
    const r = getReport(db, { from: '2026-01-01', to: '2026-01-31' })
    expect(r.costMinor).toBe(450)
    expect(r.profitMinor).toBe(550)
  })
})
