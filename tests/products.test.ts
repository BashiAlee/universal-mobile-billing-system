import { describe, it, expect } from 'vitest'
import { memoryDb } from './helpers'
import {
  createProduct,
  getProductByCode,
  listProducts,
  updateProduct,
  adjustStock,
  deactivateProduct,
  lowStockProducts,
  listMovements
} from '../src/main/services/products'

describe('products & stock', () => {
  it('generates a unique code when none given', () => {
    const db = memoryDb()
    const a = createProduct(db, { name: 'Soap', priceMinor: 5000 })
    const b = createProduct(db, { name: 'Shampoo', priceMinor: 9000 })
    expect(a.code).toBe('P-000001')
    expect(b.code).toBe('P-000002')
  })
  it('rejects duplicate codes and invalid input', () => {
    const db = memoryDb()
    createProduct(db, { name: 'A', priceMinor: 1, code: 'X1' })
    expect(() => createProduct(db, { name: 'B', priceMinor: 1, code: 'X1' })).toThrow()
    expect(() => createProduct(db, { name: '', priceMinor: 1 })).toThrow(/name/)
    expect(() => createProduct(db, { name: 'C', priceMinor: -5 })).toThrow(/Price/)
    expect(() => createProduct(db, { name: 'D', priceMinor: 1.5 })).toThrow(/Price/)
  })
  it('records an initial stock movement and looks up by code', () => {
    const db = memoryDb()
    const p = createProduct(db, { name: 'Rice', priceMinor: 100, stockQty: 10 })
    expect(listMovements(db, p.id)).toHaveLength(1)
    expect(getProductByCode(db, p.code)?.name).toBe('Rice')
    expect(getProductByCode(db, 'nope')).toBeNull()
  })
  it('adjusts stock, refuses negative stock, logs movements', () => {
    const db = memoryDb()
    const p = createProduct(db, { name: 'Oil', priceMinor: 100, stockQty: 5 })
    expect(adjustStock(db, p.id, 3, 'purchase').stockQty).toBe(8)
    expect(() => adjustStock(db, p.id, -9, 'adjustment')).toThrow(/Not enough stock/)
    expect(adjustStock(db, p.id, 8, 'purchase').stockQty).toBe(16)
    expect(listMovements(db, p.id).map((m) => m.delta)).toEqual([8, 3, 5])
  })
  it('updates details but not stock; deactivated products are hidden', () => {
    const db = memoryDb()
    const p = createProduct(db, { name: 'Tea', priceMinor: 100, stockQty: 4 })
    const u = updateProduct(db, p.id, { name: 'Green Tea', priceMinor: 150 })
    expect(u.name).toBe('Green Tea')
    expect(u.stockQty).toBe(4)
    deactivateProduct(db, p.id)
    expect(listProducts(db)).toHaveLength(0)
    expect(listProducts(db, '', true)).toHaveLength(1)
    expect(getProductByCode(db, p.code)).toBeNull()
  })
  it('reports low stock', () => {
    const db = memoryDb()
    createProduct(db, { name: 'Low', priceMinor: 1, stockQty: 2, lowStockThreshold: 5 })
    createProduct(db, { name: 'Fine', priceMinor: 1, stockQty: 50, lowStockThreshold: 5 })
    expect(lowStockProducts(db).map((p) => p.name)).toEqual(['Low'])
  })
})
