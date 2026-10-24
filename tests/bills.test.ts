import { describe, it, expect } from 'vitest'
import { memoryDb } from './helpers'
import { createProduct, getProduct, listMovements } from '../src/main/services/products'
import { createBill, computeTax, getBill, listBills } from '../src/main/services/bills'
import { saveSettings, DEFAULT_SETTINGS } from '../src/main/services/settings'

describe('billing', () => {
  it('computes tax with half-up rounding', () => {
    expect(computeTax(1000, 1800)).toBe(180)
    expect(computeTax(1005, 1800)).toBe(181) // 180.9 -> 181
    expect(computeTax(1000, 0)).toBe(0)
    expect(computeTax(3, 5000)).toBe(2) // 1.5 -> 2
  })
  it('creates a bill, decrements stock, logs a sale movement', () => {
    const db = memoryDb()
    saveSettings(db, { ...DEFAULT_SETTINGS, taxRateBp: 1000 })
    const a = createProduct(db, { name: 'A', priceMinor: 1000, stockQty: 10 })
    const b = createProduct(db, { name: 'B', priceMinor: 250, stockQty: 4 })
    const bill = createBill(db, {
      items: [
        { productId: a.id, qty: 2 },
        { productId: b.id, qty: 1 }
      ],
      discountMinor: 250
    })
    expect(bill.billNo).toBe('INV-000001')
    expect(bill.subtotalMinor).toBe(2250)
    expect(bill.taxMinor).toBe(200) // 10% of 2000
    expect(bill.totalMinor).toBe(2200)
    expect(getProduct(db, a.id)?.stockQty).toBe(8)
    expect(listMovements(db, a.id)[0]).toMatchObject({
      delta: -2,
      reason: 'sale',
      ref: 'INV-000001'
    })
  })
  it('records cash received and lets the receipt derive change', () => {
    const db = memoryDb()
    const a = createProduct(db, { name: 'A', priceMinor: 11700, stockQty: 5 })
    const bill = createBill(db, {
      items: [{ productId: a.id, qty: 1 }],
      paymentMethod: 'cash',
      tenderedMinor: 20000
    })
    expect(bill.tenderedMinor).toBe(20000)
    expect(bill.tenderedMinor - bill.totalMinor).toBe(8300) // change 83.00
    expect(getBill(db, bill.id)?.tenderedMinor).toBe(20000)
  })
  it('rejects insufficient cash received and ignores it for non-cash payments', () => {
    const db = memoryDb()
    const a = createProduct(db, { name: 'A', priceMinor: 1000, stockQty: 5 })
    expect(() =>
      createBill(db, { items: [{ productId: a.id, qty: 1 }], tenderedMinor: 500 })
    ).toThrow(/less than/)
    expect(getProduct(db, a.id)?.stockQty).toBe(5)
    const card = createBill(db, {
      items: [{ productId: a.id, qty: 1 }],
      paymentMethod: 'card',
      tenderedMinor: 99999
    })
    expect(card.tenderedMinor).toBe(0)
    const noTender = createBill(db, { items: [{ productId: a.id, qty: 1 }] })
    expect(noTender.tenderedMinor).toBe(0)
  })
  it('merges repeated scans of the same product', () => {
    const db = memoryDb()
    const a = createProduct(db, { name: 'A', priceMinor: 100, stockQty: 10 })
    const bill = createBill(db, {
      items: [
        { productId: a.id, qty: 1 },
        { productId: a.id, qty: 2 }
      ]
    })
    expect(bill.items).toHaveLength(1)
    expect(bill.items[0].qty).toBe(3)
  })
  it('rolls back everything when stock is insufficient', () => {
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
    expect(listBills(db)).toHaveLength(0)
  })
  it('validates input', () => {
    const db = memoryDb()
    const a = createProduct(db, { name: 'A', priceMinor: 100, stockQty: 5 })
    expect(() => createBill(db, { items: [] })).toThrow(/at least one/)
    expect(() => createBill(db, { items: [{ productId: a.id, qty: 0 }] })).toThrow(/Quantity/)
    expect(() =>
      createBill(db, { items: [{ productId: a.id, qty: 1 }], discountMinor: 101 })
    ).toThrow(/Discount/)
    expect(() => createBill(db, { items: [{ productId: 999, qty: 1 }] })).toThrow(
      /no longer exists/
    )
  })
  it('keeps price snapshot after the product price changes', () => {
    const db = memoryDb()
    const a = createProduct(db, { name: 'A', priceMinor: 100, stockQty: 5 })
    const bill = createBill(db, { items: [{ productId: a.id, qty: 1 }] })
    db.prepare('UPDATE products SET price_minor = 999 WHERE id = ?').run(a.id)
    expect(getBill(db, bill.id)?.items[0].unitPriceMinor).toBe(100)
  })
  it('lists and searches bills', () => {
    const db = memoryDb()
    const a = createProduct(db, { name: 'A', priceMinor: 100, stockQty: 5 })
    createBill(db, { items: [{ productId: a.id, qty: 1 }], customerName: 'Zara' })
    createBill(db, { items: [{ productId: a.id, qty: 1 }] })
    expect(listBills(db)).toHaveLength(2)
    expect(listBills(db, 'Zara')).toHaveLength(1)
  })
})
