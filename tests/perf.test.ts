import { describe, it, expect } from 'vitest'
import { memoryDb } from './helpers'
import { createProduct, listProducts, getProductByCode } from '../src/main/services/products'
import { createBill, listBills } from '../src/main/services/bills'

// Measures realistic load and prints timings (no pass/fail time limits: the project defines none).
describe('performance (measured, not asserted)', () => {
  it('20,000 products and 2,000 bills', () => {
    const db = memoryDb()
    const t = (label: string, fn: () => void): number => {
      const s = performance.now()
      fn()
      const ms = performance.now() - s
      console.log(`PERF ${label}: ${ms.toFixed(1)} ms`)
      return ms
    }
    t('create 20,000 products (one transaction each)', () => {
      for (let i = 0; i < 20000; i++)
        createProduct(db, { name: `Product ${i}`, priceMinor: 100 + i, stockQty: 1000 })
    })
    let found: unknown
    t('lookup by code (scan) x100', () => {
      for (let i = 1; i <= 100; i++)
        found = getProductByCode(db, `P-${String(i * 150).padStart(6, '0')}`)
    })
    expect(found).toBeTruthy()
    t('search "Product 19" (LIKE, 20k rows)', () => {
      expect(listProducts(db, 'Product 19').length).toBeGreaterThan(1000)
    })
    t('list all 20,000 products', () => {
      expect(listProducts(db, '').length).toBe(20000)
    })
    t('create 2,000 bills of 5 lines', () => {
      for (let i = 0; i < 2000; i++)
        createBill(db, {
          items: [1, 2, 3, 4, 5].map((n) => ({ productId: n + (i % 100) * 5, qty: 1 }))
        })
    })
    t('list latest 200 bills (hydrated)', () => {
      expect(listBills(db).length).toBe(200)
    })
    t('search bills "INV-0019"', () => {
      expect(listBills(db, 'INV-0019').length).toBeGreaterThan(0)
    })
  })
})
