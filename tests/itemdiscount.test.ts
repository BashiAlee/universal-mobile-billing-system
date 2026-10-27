import { describe, it, expect } from 'vitest'
import { memoryDb } from './helpers'
import { createProduct, getProduct } from '../src/main/services/products'
import { createBill } from '../src/main/services/bills'
import { createPurchase } from '../src/main/services/purchases'
import { DEFAULT_SETTINGS, saveSettings } from '../src/main/services/settings'
import { createReturn, quoteReturn } from '../src/main/services/returns'
import { getReport } from '../src/main/services/reports'
import { getDayBook } from '../src/main/services/daybook'

const today = (): string => new Date().toLocaleDateString('en-CA')

describe('discount on a single item', () => {
  it('is taken off that line; the bill subtotal and tax follow; the list price stays', () => {
    const db = memoryDb()
    saveSettings(db, { ...DEFAULT_SETTINGS, taxRateBp: 1000 })
    const p = createProduct(db, { name: 'Cable', priceMinor: 1000, costMinor: 400, stockQty: 10 })
    const q = createProduct(db, { name: 'Charger', priceMinor: 2000, costMinor: 900, stockQty: 10 })
    const bill = createBill(db, {
      items: [
        { productId: p.id, qty: 2, discountMinor: 300 },
        { productId: q.id, qty: 1 }
      ]
    })
    expect(bill.items[0]).toMatchObject({
      unitPriceMinor: 1000,
      qty: 2,
      discountMinor: 300,
      lineTotalMinor: 1700
    })
    expect(bill.items[1]).toMatchObject({ discountMinor: 0, lineTotalMinor: 2000 })
    expect(bill.subtotalMinor).toBe(3700)
    expect(bill.taxMinor).toBe(370) // 10% of the discounted total
    expect(bill.totalMinor).toBe(4070)
    expect(getProduct(db, p.id)?.stockQty).toBe(8)
  })

  it('refuses a negative, fractional or too-large item discount', () => {
    const db = memoryDb()
    const p = createProduct(db, { name: 'Cable', priceMinor: 1000, stockQty: 10 })
    const sell = (d: number): unknown =>
      createBill(db, { items: [{ productId: p.id, qty: 1, discountMinor: d }] })
    expect(() => sell(-1)).toThrow(/Item discount/)
    expect(() => sell(1.5)).toThrow(/Item discount/)
    expect(() => sell(1001)).toThrow(/cannot be more than its price/)
    expect(sell(1000)).toBeTruthy() // free is allowed
    expect(getProduct(db, p.id)?.stockQty).toBe(9)
  })

  it('discounts of repeated lines for the same product add up', () => {
    const db = memoryDb()
    const p = createProduct(db, { name: 'Cable', priceMinor: 1000, stockQty: 10 })
    const bill = createBill(db, {
      items: [
        { productId: p.id, qty: 1, discountMinor: 100 },
        { productId: p.id, qty: 1, discountMinor: 50 }
      ]
    })
    expect(bill.items).toHaveLength(1)
    expect(bill.items[0]).toMatchObject({ qty: 2, discountMinor: 150, lineTotalMinor: 1850 })
  })

  it('a discount on several phones is shared between them, whole units, nothing lost', () => {
    const db = memoryDb()
    const p = createProduct(db, { name: 'Phone', priceMinor: 50_000, trackSerial: true })
    createPurchase(db, {
      supplierName: 'S',
      items: [
        {
          productId: p.id,
          qty: 3,
          totalCostMinor: 90_000,
          serials: ['IMEI-0001', 'IMEI-0002', 'IMEI-0003']
        }
      ]
    })
    const bill = createBill(db, {
      items: [
        {
          productId: p.id,
          qty: 3,
          discountMinor: 1000,
          serials: ['IMEI-0001', 'IMEI-0002', 'IMEI-0003']
        }
      ]
    })
    expect(bill.items.map((i) => i.discountMinor)).toEqual([334, 333, 333])
    expect(bill.items.reduce((s, i) => s + i.discountMinor, 0)).toBe(1000)
    expect(bill.subtotalMinor).toBe(150_000 - 1000)
  })
})

describe('item discounts in the numbers', () => {
  it('reports: gross minus discounts (items and bill) equals net sales, and profit follows', () => {
    const db = memoryDb()
    const p = createProduct(db, { name: 'Cable', priceMinor: 1000, costMinor: 400, stockQty: 10 })
    createBill(db, { items: [{ productId: p.id, qty: 2, discountMinor: 300 }], discountMinor: 200 })
    const r = getReport(db, { from: today(), to: today() })
    expect(r).toMatchObject({
      grossSalesMinor: 2000,
      discountMinor: 500,
      netSalesMinor: 1500,
      costMinor: 800,
      profitMinor: 700
    })
    expect(r.grossSalesMinor - r.discountMinor).toBe(r.netSalesMinor)
    expect(r.products[0]).toMatchObject({ salesMinor: 1700 }) // per product: after its own discount
  })

  it('day book: each line shows its discount; totals separate item discounts from bill discounts', () => {
    const db = memoryDb()
    const p = createProduct(db, { name: 'Cable', priceMinor: 1000, costMinor: 400, stockQty: 10 })
    createBill(db, { items: [{ productId: p.id, qty: 2, discountMinor: 300 }], discountMinor: 200 })
    const d = getDayBook(db, today())
    expect(d.lines[0]).toMatchObject({ discountMinor: 300, saleMinor: 1700 })
    expect(d).toMatchObject({
      itemDiscountsMinor: 300,
      discountMinor: 200,
      salesMinor: 1500,
      profitMinor: 700
    })
  })

  it('a return of a discounted item refunds what was really paid for it', () => {
    const db = memoryDb()
    const p = createProduct(db, { name: 'Cable', priceMinor: 1000, costMinor: 400, stockQty: 10 })
    const bill = createBill(db, { items: [{ productId: p.id, qty: 2, discountMinor: 300 }] })
    // 1700 paid for 2 cables: one cable is worth 850.
    const q = quoteReturn(db, {
      billId: bill.id,
      items: [{ billItemId: bill.items[0].id, qty: 1 }],
      refundMethod: 'cash'
    })
    expect(q.refundMinor).toBe(850)
    const r = createReturn(db, {
      billId: bill.id,
      items: [{ billItemId: bill.items[0].id, qty: 1 }],
      refundMethod: 'cash'
    })
    expect(r.refundMinor).toBe(850)
    expect(getProduct(db, p.id)?.stockQty).toBe(9)
  })
})
