import { describe, it, expect } from 'vitest'
import { memoryDb } from './helpers'
import { createProduct, getProduct, listMovements } from '../src/main/services/products'
import {
  createPurchase,
  createSupplierNote,
  listPurchases,
  listSuppliers
} from '../src/main/services/purchases'
import { migrate } from '../src/main/db/database'

describe('purchases (supplier bills)', () => {
  it('adds stock, sets unit cost, records movement: 200 covers from ABC Traders for 10000', () => {
    const db = memoryDb()
    const cover = createProduct(db, { name: 'Phone cover', priceMinor: 12000, stockQty: 5 })
    const pur = createPurchase(db, {
      supplierName: 'ABC Traders',
      items: [{ productId: cover.id, qty: 200, totalCostMinor: 1_000_000 }]
    })
    expect(pur.purchaseNo).toBe('PUR-000001')
    expect(pur.totalMinor).toBe(1_000_000)
    expect(pur.items[0]).toMatchObject({ qty: 200, unitCostMinor: 5000, lineTotalMinor: 1_000_000 })
    const after = getProduct(db, cover.id)!
    expect(after.stockQty).toBe(205)
    expect(after.costMinor).toBe(5000)
    expect(listMovements(db, cover.id)[0]).toMatchObject({
      delta: 200,
      reason: 'purchase',
      ref: 'PUR-000001'
    })
  })
  it('rounds the unit cost when the total does not divide evenly but keeps the exact line total', () => {
    const db = memoryDb()
    const p = createProduct(db, { name: 'X', priceMinor: 1000 })
    const pur = createPurchase(db, {
      supplierName: 'S',
      items: [{ productId: p.id, qty: 3, totalCostMinor: 1000 }]
    })
    expect(pur.items[0].unitCostMinor).toBe(333)
    expect(pur.items[0].lineTotalMinor).toBe(1000)
    expect(pur.totalMinor).toBe(1000)
  })
  it('handles several products and merges repeated lines', () => {
    const db = memoryDb()
    const a = createProduct(db, { name: 'A', priceMinor: 1 })
    const b = createProduct(db, { name: 'B', priceMinor: 1 })
    const pur = createPurchase(db, {
      supplierName: 'S',
      items: [
        { productId: a.id, qty: 2, totalCostMinor: 200 },
        { productId: a.id, qty: 3, totalCostMinor: 300 },
        { productId: b.id, qty: 1, totalCostMinor: 50 }
      ]
    })
    expect(pur.items).toHaveLength(2)
    expect(pur.totalMinor).toBe(550)
    expect(getProduct(db, a.id)?.stockQty).toBe(5)
  })
  it('validates input and rolls back on a bad line', () => {
    const db = memoryDb()
    const a = createProduct(db, { name: 'A', priceMinor: 1 })
    expect(() =>
      createPurchase(db, {
        supplierName: ' ',
        items: [{ productId: a.id, qty: 1, totalCostMinor: 1 }]
      })
    ).toThrow(/Supplier/)
    expect(() => createPurchase(db, { supplierName: 'S', items: [] })).toThrow(/at least one/)
    expect(() =>
      createPurchase(db, {
        supplierName: 'S',
        items: [{ productId: a.id, qty: 0, totalCostMinor: 1 }]
      })
    ).toThrow(/Quantity/)
    expect(() =>
      createPurchase(db, {
        supplierName: 'S',
        items: [{ productId: a.id, qty: 1, totalCostMinor: -1 }]
      })
    ).toThrow(/Cost/)
    expect(() =>
      createPurchase(db, {
        supplierName: 'S',
        items: [
          { productId: a.id, qty: 5, totalCostMinor: 10 },
          { productId: 999, qty: 1, totalCostMinor: 10 }
        ]
      })
    ).toThrow(/no longer exists/)
    expect(getProduct(db, a.id)?.stockQty).toBe(0)
    expect(listPurchases(db)).toHaveLength(0)
  })
  it('lists, searches and remembers suppliers', () => {
    const db = memoryDb()
    const a = createProduct(db, { name: 'A', priceMinor: 1 })
    const line = [{ productId: a.id, qty: 1, totalCostMinor: 1 }]
    createPurchase(db, { supplierName: 'ABC Traders', items: line })
    createPurchase(db, { supplierName: 'XYZ Co', items: line })
    createPurchase(db, { supplierName: 'ABC Traders', items: line })
    expect(listPurchases(db)).toHaveLength(3)
    expect(listPurchases(db, 'XYZ')).toHaveLength(1)
    expect(listSuppliers(db)).toEqual(['ABC Traders', 'XYZ Co'])
  })
  it('migration is idempotent', () => {
    const db = memoryDb()
    migrate(db)
    expect((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(
      6
    )
  })

  it('quick note: records vendor, what and cost without touching stock', () => {
    const db = memoryDb()
    const cover = createProduct(db, { name: 'Phone cover', priceMinor: 12000, stockQty: 5 })
    const n = createSupplierNote(db, {
      supplierName: ' ABC Traders ',
      description: '200 phone covers',
      amountMinor: 1_000_000,
      date: '2026-03-04'
    })
    expect(n).toMatchObject({
      supplierName: 'ABC Traders',
      note: '200 phone covers',
      totalMinor: 1_000_000,
      items: []
    })
    expect(n.purchaseNo).toBe('PUR-000001')
    expect(n.createdAt.startsWith('2026-03-0')).toBe(true)
    expect(getProduct(db, cover.id)!.stockQty).toBe(5)
    expect(listSuppliers(db)).toEqual(['ABC Traders'])
    expect(listPurchases(db, 'covers')).toHaveLength(1) // searchable by what it covered
  })
  it('quick note rejects missing supplier, description, bad amount and bad date', () => {
    const db = memoryDb()
    const ok = { supplierName: 'S', description: 'x', amountMinor: 100 }
    expect(() => createSupplierNote(db, { ...ok, supplierName: ' ' })).toThrow(/Supplier/)
    expect(() => createSupplierNote(db, { ...ok, description: ' ' })).toThrow(/Describe/)
    expect(() => createSupplierNote(db, { ...ok, amountMinor: 0 })).toThrow(/greater than 0/)
    expect(() => createSupplierNote(db, { ...ok, amountMinor: 1.5 })).toThrow(/greater than 0/)
    expect(() => createSupplierNote(db, { ...ok, date: '2026-13-45' })).toThrow(/valid date/)
    expect(() => createSupplierNote(db, { ...ok, date: 'yesterday' })).toThrow(/valid date/)
  })
})
