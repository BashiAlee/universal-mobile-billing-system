import { describe, it, expect } from 'vitest'
import { memoryDb } from './helpers'
import type { Db } from '../src/main/db/database'
import type { Product } from '../src/shared/types'
import {
  adjustStock,
  createProduct,
  getProduct,
  listProducts,
  updateProduct
} from '../src/main/services/products'
import { createPurchase } from '../src/main/services/purchases'
import { createBill } from '../src/main/services/bills'
import { getUnit, listUnits } from '../src/main/services/serials'

const IMEI_A = '356938035643809'
const IMEI_B = '356938035643817'
const IMEI_C = '490154203237518'

function phone(db: Db = memoryDb()): { db: Db; p: Product } {
  const p = createProduct(db, {
    name: '',
    brand: 'Samsung',
    model: 'A15',
    ram: '6',
    storage: '128',
    color: 'Black',
    category: 'Phone',
    priceMinor: 4_500_000,
    trackSerial: true
  })
  return { db, p }
}

describe('product details', () => {
  it('builds the name from brand, model, ram/storage and color when none is typed', () => {
    const { p } = phone()
    expect(p.name).toBe('Samsung A15 6/128 Black')
    expect(p).toMatchObject({ category: 'Phone', brand: 'Samsung', trackSerial: true })
  })
  it('keeps a typed name, and stores cover compatibility', () => {
    const db = memoryDb()
    const c = createProduct(db, {
      name: 'Silicone cover',
      priceMinor: 100,
      compatibleWith: 'Samsung A15'
    })
    expect(c.name).toBe('Silicone cover')
    expect(c.compatibleWith).toBe('Samsung A15')
  })
  it('still needs a name when nothing can build one', () => {
    expect(() => createProduct(memoryDb(), { name: ' ', priceMinor: 1 })).toThrow(
      /name is required/
    )
  })
  it('every word searched must match: name, details, or an IMEI', () => {
    const { db } = phone()
    createProduct(db, { name: 'Silicone cover', priceMinor: 100, compatibleWith: 'Samsung A15' })
    createProduct(db, { name: 'Charger', priceMinor: 100 })
    expect(listProducts(db, 'a15 128').map((x) => x.name)).toEqual(['Samsung A15 6/128 Black'])
    expect(listProducts(db, 'samsung a15').map((x) => x.name)).toEqual([
      'Samsung A15 6/128 Black',
      'Silicone cover'
    ])
    expect(listProducts(db, 'charger black')).toHaveLength(0)
  })
  it('details can be edited, but IMEI tracking only changes while stock is 0', () => {
    const { db, p } = phone()
    const up = updateProduct(db, p.id, { name: '', brand: 'Samsung', model: 'A16', priceMinor: 1 })
    expect(up.name).toBe('Samsung A16')
    expect(up.trackSerial).toBe(true) // not sent, so unchanged
    createPurchase(db, {
      supplierName: 'S',
      items: [{ productId: p.id, qty: 1, totalCostMinor: 100, serials: [IMEI_A] }]
    })
    expect(() => updateProduct(db, p.id, { name: 'x', priceMinor: 1, trackSerial: false })).toThrow(
      /0 stock/
    )
  })
  it('a tracked product cannot start with stock or have stock adjusted by hand', () => {
    const db = memoryDb()
    expect(() =>
      createProduct(db, { name: 'P', priceMinor: 1, trackSerial: true, stockQty: 3 })
    ).toThrow(/0 stock/)
    const { p } = phone(db)
    expect(() => adjustStock(db, p.id, 1, 'adjustment')).toThrow(/tracked by IMEI/)
  })
})

describe('IMEI tracking', () => {
  it('a purchase records each IMEI, sets stock to the count and remembers the supplier', () => {
    const { db, p } = phone()
    createPurchase(db, {
      supplierName: 'Mobile Wholesale',
      items: [
        {
          productId: p.id,
          qty: 2,
          totalCostMinor: 8_000_000,
          serials: [IMEI_A, IMEI_B],
          condition: 'new'
        }
      ]
    })
    expect(getProduct(db, p.id)).toMatchObject({ stockQty: 2, costMinor: 4_000_000 })
    const u = getUnit(db, IMEI_A)!
    expect(u).toMatchObject({
      status: 'in_stock',
      condition: 'new',
      costMinor: 4_000_000,
      supplierName: 'Mobile Wholesale',
      purchaseNo: 'PUR-000001',
      billNo: null
    })
  })
  it('IMEIs are matched ignoring case and spaces around them', () => {
    const { db, p } = phone()
    createPurchase(db, {
      supplierName: 'S',
      items: [{ productId: p.id, qty: 1, totalCostMinor: 1, serials: [' ab-12345 '] }]
    })
    expect(getUnit(db, 'AB-12345')).not.toBeNull()
    expect(getUnit(db, 'ab-12345')).not.toBeNull()
  })
  it('a used phone keeps its condition', () => {
    const { db, p } = phone()
    createPurchase(db, {
      supplierName: 'Customer trade-in',
      items: [
        { productId: p.id, qty: 1, totalCostMinor: 100, serials: [IMEI_C], condition: 'used' }
      ]
    })
    expect(getUnit(db, IMEI_C)?.condition).toBe('used')
  })
  it('rejects wrong counts, missing IMEIs, bad IMEIs, repeats and untracked products', () => {
    const { db, p } = phone()
    const other = createProduct(db, { name: 'Cover', priceMinor: 1 })
    const buy = (item: object): unknown =>
      createPurchase(db, { supplierName: 'S', items: [item as never] })
    expect(() => buy({ productId: p.id, qty: 2, totalCostMinor: 1, serials: [IMEI_A] })).toThrow(
      /must match/
    )
    expect(() => buy({ productId: p.id, qty: 1, totalCostMinor: 1 })).toThrow(/Enter the IMEI/)
    expect(() => buy({ productId: p.id, qty: 1, totalCostMinor: 1, serials: ['x'] })).toThrow(
      /not a valid IMEI/
    )
    expect(() =>
      buy({ productId: p.id, qty: 2, totalCostMinor: 1, serials: [IMEI_A, IMEI_A.toLowerCase()] })
    ).toThrow(/more than once/)
    expect(() =>
      buy({ productId: other.id, qty: 1, totalCostMinor: 1, serials: [IMEI_A] })
    ).toThrow(/not tracked by IMEI/)
    expect(getProduct(db, p.id)?.stockQty).toBe(0)
    expect(listUnits(db)).toHaveLength(0)
  })
  it('a duplicate IMEI is refused and the whole purchase is rolled back', () => {
    const { db, p } = phone()
    const line = { productId: p.id, qty: 1, totalCostMinor: 100 }
    createPurchase(db, { supplierName: 'S', items: [{ ...line, serials: [IMEI_A] }] })
    expect(() =>
      createPurchase(db, {
        supplierName: 'Other',
        items: [
          { ...line, serials: [IMEI_B] },
          { ...line, serials: [IMEI_A] }
        ]
      })
    ).toThrow(/already in the system \(in stock\)/)
    expect(getProduct(db, p.id)?.stockQty).toBe(1)
    expect(getUnit(db, IMEI_B)).toBeNull()
  })
})

describe('selling by IMEI', () => {
  function stocked(): { db: Db; p: Product } {
    const { db, p } = phone()
    createPurchase(db, {
      supplierName: 'Wholesale',
      items: [{ productId: p.id, qty: 2, totalCostMinor: 8_000_000, serials: [IMEI_A, IMEI_B] }]
    })
    return { db, p }
  }

  it('marks the unit sold, links it to the bill and takes stock down', () => {
    const { db, p } = stocked()
    const bill = createBill(db, {
      customerName: 'Ali',
      items: [{ productId: p.id, qty: 1, serials: [IMEI_B.toLowerCase()] }]
    })
    expect(bill.items).toHaveLength(1)
    expect(bill.items[0]).toMatchObject({ serial: IMEI_B, qty: 1, unitPriceMinor: 4_500_000 })
    expect(getProduct(db, p.id)?.stockQty).toBe(1)
    expect(getUnit(db, IMEI_B)).toMatchObject({
      status: 'sold',
      billNo: bill.billNo,
      customerName: 'Ali',
      supplierName: 'Wholesale'
    })
    expect(listUnits(db, { productId: p.id, status: 'in_stock' }).map((u) => u.serial)).toEqual([
      IMEI_A
    ])
  })
  it('selling two phones gives one line per unit, each with its own IMEI', () => {
    const { db, p } = stocked()
    const bill = createBill(db, { items: [{ productId: p.id, qty: 2, serials: [IMEI_A, IMEI_B] }] })
    expect(bill.items.map((i) => i.serial)).toEqual([IMEI_A, IMEI_B])
    expect(bill.subtotalMinor).toBe(9_000_000)
    expect(getProduct(db, p.id)?.stockQty).toBe(0)
  })
  it('profit uses the cost of the actual unit sold', () => {
    const { db, p } = phone()
    createPurchase(db, {
      supplierName: 'S',
      items: [
        { productId: p.id, qty: 1, totalCostMinor: 3_000_000, serials: [IMEI_A] },
        { productId: p.id, qty: 1, totalCostMinor: 4_000_000, serials: [IMEI_B], condition: 'used' }
      ]
    })
    createBill(db, { items: [{ productId: p.id, qty: 1, serials: [IMEI_A] }] })
    const cost = db.prepare('SELECT unit_cost_minor AS c FROM bill_items').get() as { c: number }
    expect(cost.c).toBe(3_000_000)
  })
  it('refuses: no IMEI chosen, wrong product, sold already, repeated, or IMEI on an untracked item', () => {
    const { db, p } = stocked()
    const cover = createProduct(db, { name: 'Cover', priceMinor: 10, stockQty: 5 })
    expect(() => createBill(db, { items: [{ productId: p.id, qty: 1 }] })).toThrow(
      /Choose the IMEI/
    )
    expect(() =>
      createBill(db, { items: [{ productId: p.id, qty: 1, serials: ['NOPE-0001'] }] })
    ).toThrow(/not a Samsung/)
    expect(() =>
      createBill(db, { items: [{ productId: p.id, qty: 2, serials: [IMEI_A, IMEI_A] }] })
    ).toThrow(/more than once/)
    expect(() =>
      createBill(db, { items: [{ productId: cover.id, qty: 1, serials: [IMEI_A] }] })
    ).toThrow(/not tracked/)
    createBill(db, { items: [{ productId: p.id, qty: 1, serials: [IMEI_A] }] })
    expect(() =>
      createBill(db, { items: [{ productId: p.id, qty: 1, serials: [IMEI_A] }] })
    ).toThrow(/already sold|Not enough stock/)
    expect(getProduct(db, p.id)?.stockQty).toBe(1)
    expect(getProduct(db, cover.id)?.stockQty).toBe(5)
  })
  it('a sold IMEI cannot be bought in again, and the message says which bill sold it', () => {
    const { db, p } = stocked()
    const bill = createBill(db, { items: [{ productId: p.id, qty: 1, serials: [IMEI_A] }] })
    expect(() =>
      createPurchase(db, {
        supplierName: 'S',
        items: [{ productId: p.id, qty: 1, totalCostMinor: 1, serials: [IMEI_A] }]
      })
    ).toThrow(new RegExp(`sold on ${bill.billNo}`))
  })
  it('finds units by part of an IMEI', () => {
    const { db } = stocked()
    expect(listUnits(db, { search: '643809' })).toHaveLength(1)
    expect(listUnits(db, { search: '3569380' })).toHaveLength(2)
  })
})

describe('dual-SIM phones (two IMEIs, one phone)', () => {
  const IMEI_A2 = '356938035643900'
  function dual(): { db: Db; p: Product } {
    const { db, p } = phone()
    createPurchase(db, {
      supplierName: 'S',
      items: [
        {
          productId: p.id,
          qty: 2,
          totalCostMinor: 8_000_000,
          serials: [IMEI_A, IMEI_B],
          serials2: [IMEI_A2, '']
        }
      ]
    })
    return { db, p }
  }
  it('two IMEIs on a phone count as one unit of stock, and either finds it', () => {
    const { db, p } = dual()
    expect(getProduct(db, p.id)?.stockQty).toBe(2)
    expect(getUnit(db, IMEI_A2)).toMatchObject({ serial: IMEI_A, serial2: IMEI_A2 })
    expect(getUnit(db, IMEI_B)?.serial2).toBeNull()
    expect(listUnits(db, { search: '643900' })).toHaveLength(1)
    expect(listProducts(db, '643900')).toHaveLength(1)
  })
  it('selling by the second IMEI sells that phone; both numbers then say sold', () => {
    const { db, p } = dual()
    const bill = createBill(db, { items: [{ productId: p.id, qty: 1, serials: [IMEI_A2] }] })
    expect(bill.items[0]).toMatchObject({ serial: IMEI_A, serial2: IMEI_A2 })
    expect(getUnit(db, IMEI_A)?.status).toBe('sold')
    expect(getUnit(db, IMEI_A2)?.billNo).toBe(bill.billNo)
    expect(getProduct(db, p.id)?.stockQty).toBe(1)
  })
  it('the same phone cannot be put on a bill twice using its two IMEIs', () => {
    const { db, p } = dual()
    expect(() =>
      createBill(db, { items: [{ productId: p.id, qty: 2, serials: [IMEI_A, IMEI_A2] }] })
    ).toThrow(/twice/)
    expect(getProduct(db, p.id)?.stockQty).toBe(2)
  })
  it('refuses a second IMEI that is already used anywhere, or equal to the first', () => {
    const { db, p } = dual()
    const buy = (s: string[], s2: string[]): unknown =>
      createPurchase(db, {
        supplierName: 'S',
        items: [{ productId: p.id, qty: s.length, totalCostMinor: 1, serials: s, serials2: s2 }]
      })
    expect(() => buy([IMEI_C], [IMEI_A2])).toThrow(/already in the system/)
    expect(() => buy([IMEI_A2], [''])).toThrow(/already in the system/)
    expect(() => buy([IMEI_C], [IMEI_C])).toThrow(/more than once/)
    expect(() => buy([IMEI_C], [])).toThrow(/must match/)
    expect(getProduct(db, p.id)?.stockQty).toBe(2)
  })
})

describe('adding and deleting phones without a purchase', () => {
  it('adds phones to a tracked product, with optional second IMEI, cost and condition', async () => {
    const { addUnits } = await import('../src/main/services/serials')
    const { db, p } = phone()
    const after = addUnits(db, {
      productId: p.id,
      units: [
        { serial: IMEI_A, serial2: '356938035643900', costMinor: 4_000_000 },
        { serial: IMEI_B, condition: 'used' }
      ]
    })
    expect(after.stockQty).toBe(2)
    expect(getUnit(db, '356938035643900')).toMatchObject({
      serial: IMEI_A,
      costMinor: 4_000_000,
      purchaseNo: null
    })
    expect(getUnit(db, IMEI_B)).toMatchObject({ condition: 'used', status: 'in_stock' })
  })
  it('refuses repeats, existing IMEIs, untracked products; nothing is half added', async () => {
    const { addUnits } = await import('../src/main/services/serials')
    const { db, p } = phone()
    addUnits(db, { productId: p.id, units: [{ serial: IMEI_A }] })
    expect(() =>
      addUnits(db, { productId: p.id, units: [{ serial: IMEI_B }, { serial: IMEI_A }] })
    ).toThrow(/already in the system/)
    expect(getProduct(db, p.id)?.stockQty).toBe(1)
    expect(getUnit(db, IMEI_B)).toBeNull()
    expect(() =>
      addUnits(db, { productId: p.id, units: [{ serial: IMEI_B }, { serial: IMEI_B }] })
    ).toThrow(/more than once/)
    const cover = createProduct(db, { name: 'Cover', priceMinor: 1 })
    expect(() => addUnits(db, { productId: cover.id, units: [{ serial: IMEI_C }] })).toThrow(
      /not tracked/
    )
    expect(() => addUnits(db, { productId: p.id, units: [] })).toThrow(/at least one/)
  })
  it('a phone in stock can be deleted (stock drops); a sold one cannot', async () => {
    const { addUnits, removeUnit } = await import('../src/main/services/serials')
    const { db, p } = phone()
    addUnits(db, { productId: p.id, units: [{ serial: IMEI_A }, { serial: IMEI_B }] })
    removeUnit(db, getUnit(db, IMEI_A)!.id)
    expect(getUnit(db, IMEI_A)).toBeNull()
    expect(getProduct(db, p.id)?.stockQty).toBe(1)
    createBill(db, { items: [{ productId: p.id, qty: 1, serials: [IMEI_B] }] })
    expect(() => removeUnit(db, getUnit(db, IMEI_B)!.id)).toThrow(/already sold/)
    expect(getProduct(db, p.id)?.stockQty).toBe(0)
  })
})

describe('deleting a bill', () => {
  it('puts items and phones back in stock and removes the bill from reports; numbers are not reused', async () => {
    const { deleteBill, getBill, listBills } = await import('../src/main/services/bills')
    const { getReport } = await import('../src/main/services/reports')
    const { listMovements } = await import('../src/main/services/products')
    const db = memoryDb()
    const cover = createProduct(db, {
      name: 'Cover',
      priceMinor: 1000,
      costMinor: 400,
      stockQty: 5
    })
    const { p } = phone(db)
    createPurchase(db, {
      supplierName: 'S',
      items: [{ productId: p.id, qty: 1, totalCostMinor: 100, serials: [IMEI_A] }]
    })
    const bill = createBill(db, {
      items: [
        { productId: cover.id, qty: 2 },
        { productId: p.id, qty: 1, serials: [IMEI_A] }
      ]
    })
    expect(getProduct(db, cover.id)?.stockQty).toBe(3)
    expect(getUnit(db, IMEI_A)?.status).toBe('sold')

    deleteBill(db, bill.id)
    expect(getBill(db, bill.id)).toBeNull()
    expect(getProduct(db, cover.id)?.stockQty).toBe(5)
    expect(getProduct(db, p.id)?.stockQty).toBe(1)
    expect(getUnit(db, IMEI_A)).toMatchObject({ status: 'in_stock', billNo: null })
    expect(listMovements(db, cover.id).some((m) => m.reason === 'sale')).toBe(false)
    expect(listBills(db)).toHaveLength(0)
    const d = new Date().toLocaleDateString('en-CA')
    expect(getReport(db, { from: d, to: d }).netSalesMinor).toBe(0)

    // The phone can be sold again, and the new bill gets a new number.
    const again = createBill(db, { items: [{ productId: p.id, qty: 1, serials: [IMEI_A] }] })
    expect(again.billNo).not.toBe(bill.billNo)
    expect(() => deleteBill(db, 9999)).toThrow(/not found/)
  })
})
