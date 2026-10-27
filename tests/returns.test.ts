import { describe, it, expect } from 'vitest'
import { memoryDb } from './helpers'
import type { Db } from '../src/main/db/database'
import { createProduct, getProduct, listMovements } from '../src/main/services/products'
import { createBill, deleteBill, getBill } from '../src/main/services/bills'
import { createPurchase } from '../src/main/services/purchases'
import { getUnit } from '../src/main/services/serials'
import { DEFAULT_SETTINGS, saveSettings } from '../src/main/services/settings'
import { createReturn, listReturns, quoteReturn } from '../src/main/services/returns'
import { getReport } from '../src/main/services/reports'
import { getDayBook, addExpense } from '../src/main/services/daybook'
import { getDashboard } from '../src/main/services/dashboard'

const today = (): string => new Date().toLocaleDateString('en-CA')

/** Two items at 10.00 each (cost 6.00), 4.00 discount and 10% tax: total 17.60. */
function shop(): { db: Db; a: number; b: number; billId: number; items: number[] } {
  const db = memoryDb()
  saveSettings(db, { ...DEFAULT_SETTINGS, taxRateBp: 1000 })
  const a = createProduct(db, { name: 'A', priceMinor: 1000, costMinor: 600, stockQty: 10 })
  const b = createProduct(db, { name: 'B', priceMinor: 1000, costMinor: 600, stockQty: 10 })
  const bill = createBill(db, {
    items: [
      { productId: a.id, qty: 1 },
      { productId: b.id, qty: 1 }
    ],
    discountMinor: 400
  })
  return { db, a: a.id, b: b.id, billId: bill.id, items: bill.items.map((i) => i.id) }
}

describe('what a return is worth', () => {
  it('each item gets its share of the discount and the tax, so returning everything refunds the whole bill', () => {
    const { db, billId, items } = shop()
    expect(getBill(db, billId)?.totalMinor).toBe(1760)
    const one = quoteReturn(db, {
      billId,
      items: [{ billItemId: items[0], qty: 1 }],
      refundMethod: 'cash'
    })
    expect(one).toMatchObject({ netMinor: 800, taxMinor: 80, refundMinor: 880 })
    const all = quoteReturn(db, {
      billId,
      items: items.map((i) => ({ billItemId: i, qty: 1 })),
      refundMethod: 'cash'
    })
    expect(all.refundMinor).toBe(1760)
  })

  it('refuses nonsense: nothing chosen, too many, wrong bill, bad method', () => {
    const { db, billId, items } = shop()
    const other = createBill(db, { items: [{ productId: 1, qty: 1 }] })
    expect(() => quoteReturn(db, { billId, items: [], refundMethod: 'cash' })).toThrow(
      /Choose what/
    )
    expect(() =>
      quoteReturn(db, { billId, items: [{ billItemId: items[0], qty: 2 }], refundMethod: 'cash' })
    ).toThrow(/Only 1 of A/)
    expect(() =>
      quoteReturn(db, { billId, items: [{ billItemId: items[0], qty: 0 }], refundMethod: 'cash' })
    ).toThrow(/whole quantity/)
    expect(() =>
      quoteReturn(db, {
        billId: other.id,
        items: [{ billItemId: items[0], qty: 1 }],
        refundMethod: 'cash'
      })
    ).toThrow(/not on this bill/)
    expect(() =>
      createReturn(db, {
        billId,
        items: [{ billItemId: items[0], qty: 1 }],
        refundMethod: 'gold' as 'cash'
      })
    ).toThrow(/how the refund/)
    expect(() =>
      quoteReturn(db, { billId: 999, items: [{ billItemId: 1, qty: 1 }], refundMethod: 'cash' })
    ).toThrow(/Bill not found/)
  })
})

describe('making a return', () => {
  it('puts the goods back in stock, records it, and an item cannot be returned twice', () => {
    const { db, a, billId, items } = shop()
    expect(getProduct(db, a)?.stockQty).toBe(9)
    const r = createReturn(
      db,
      {
        billId,
        items: [{ billItemId: items[0], qty: 1 }],
        refundMethod: 'cash',
        reason: 'wrong colour'
      },
      'sara'
    )
    expect(r).toMatchObject({
      returnNo: 'RET-000001',
      refundMinor: 880,
      refundMethod: 'cash',
      restocked: true,
      createdBy: 'sara',
      reason: 'wrong colour'
    })
    expect(getProduct(db, a)?.stockQty).toBe(10)
    expect(listMovements(db, a)[0]).toMatchObject({ delta: 1, reason: 'return', ref: 'RET-000001' })
    const bill = getBill(db, billId)!
    expect(bill.refundedMinor).toBe(880)
    expect(bill.items[0].returnedQty).toBe(1)
    expect(bill.items[1].returnedQty).toBe(0)
    expect(() =>
      createReturn(db, { billId, items: [{ billItemId: items[0], qty: 1 }], refundMethod: 'cash' })
    ).toThrow(/already returned/)
    expect(listReturns(db).map((x) => x.returnNo)).toEqual(['RET-000001'])
    expect(listReturns(db, 'RET-000001')).toHaveLength(1)
  })

  it('damaged goods are refunded but not put back in stock', () => {
    const { db, a, billId, items } = shop()
    const r = createReturn(db, {
      billId,
      items: [{ billItemId: items[0], qty: 1 }],
      refundMethod: 'card',
      restock: false
    })
    expect(r.restocked).toBe(false)
    expect(getProduct(db, a)?.stockQty).toBe(9)
    expect(listMovements(db, a).some((m) => m.reason === 'return')).toBe(false)
  })

  it('a returned phone is in stock again and can be sold to someone else; the bill still shows its IMEI', () => {
    const db = memoryDb()
    const p = createProduct(db, { name: 'Phone', priceMinor: 50_000, trackSerial: true })
    createPurchase(db, {
      supplierName: 'S',
      items: [{ productId: p.id, qty: 1, totalCostMinor: 30_000, serials: ['IMEI-0001'] }]
    })
    const bill = createBill(db, { items: [{ productId: p.id, qty: 1, serials: ['IMEI-0001'] }] })
    expect(getUnit(db, 'IMEI-0001')?.status).toBe('sold')
    createReturn(db, {
      billId: bill.id,
      items: [{ billItemId: bill.items[0].id, qty: 1 }],
      refundMethod: 'cash'
    })
    expect(getUnit(db, 'IMEI-0001')?.status).toBe('in_stock')
    expect(getProduct(db, p.id)?.stockQty).toBe(1)
    expect(getBill(db, bill.id)?.items[0].serial).toBe('IMEI-0001')
    const again = createBill(db, { items: [{ productId: p.id, qty: 1, serials: ['IMEI-0001'] }] })
    expect(again.items[0].serial).toBe('IMEI-0001')
    expect(getProduct(db, p.id)?.stockQty).toBe(0)
  })

  it('a bill that has returns cannot be deleted', () => {
    const { db, billId, items } = shop()
    createReturn(db, { billId, items: [{ billItemId: items[0], qty: 1 }], refundMethod: 'cash' })
    expect(() => deleteBill(db, billId)).toThrow(/has returns/)
  })
})

describe('returns in the numbers', () => {
  it('sales and profit go down by the returned value; cost only when the goods came back', () => {
    const { db, billId, items } = shop()
    const before = getReport(db, { from: today(), to: today() })
    expect(before).toMatchObject({
      netSalesMinor: 1600,
      costMinor: 1200,
      profitMinor: 400,
      returnsMinor: 0
    })
    createReturn(db, { billId, items: [{ billItemId: items[0], qty: 1 }], refundMethod: 'cash' })
    const restocked = getReport(db, { from: today(), to: today() })
    expect(restocked).toMatchObject({
      netSalesMinor: 800,
      costMinor: 600,
      profitMinor: 200,
      returnsMinor: 800,
      returnsCount: 1
    })
    createReturn(db, {
      billId,
      items: [{ billItemId: items[1], qty: 1 }],
      refundMethod: 'cash',
      restock: false
    })
    const thrown = getReport(db, { from: today(), to: today() })
    // Everything refunded, but the second item's cost is lost: a loss of 6.00.
    expect(thrown).toMatchObject({ netSalesMinor: 0, costMinor: 600, profitMinor: -600 })
    expect(thrown.daily[0]).toMatchObject({ netSalesMinor: 0, costMinor: 600, profitMinor: -600 })
  })

  it('the day book takes the refund out of the cash and shows the return; credit refunds move no money', () => {
    const { db, billId, items } = shop()
    createReturn(db, { billId, items: [{ billItemId: items[0], qty: 1 }], refundMethod: 'cash' })
    addExpense(db, { day: today(), title: 'tea', amountMinor: 100 })
    const d = getDayBook(db, today())
    expect(d.returns).toEqual([
      {
        returnNo: 'RET-000001',
        billNo: 'INV-000001',
        netMinor: 800,
        refundMinor: 880,
        method: 'cash',
        restockedCostMinor: 600
      }
    ])
    expect(d).toMatchObject({
      salesMinor: 800,
      returnsMinor: 800,
      refundedMinor: 880,
      costMinor: 600,
      profitMinor: 200
    })
    // received 17.60 - refunded 8.80 - expense 1.00
    expect(d.closingMinor).toBe(1760 - 880 - 100)

    createReturn(db, { billId, items: [{ billItemId: items[1], qty: 1 }], refundMethod: 'credit' })
    const d2 = getDayBook(db, today())
    expect(d2.refundedMinor).toBe(880) // the credit return did not hand any money back
  })

  it('the dashboard money-in is reduced by money handed back', () => {
    const { db, billId, items } = shop()
    createReturn(db, {
      billId,
      items: [{ billItemId: items[0], qty: 1 }],
      refundMethod: 'exchange'
    })
    expect(getDashboard(db, { from: today(), to: today() }).receivedMinor).toBe(1760 - 880)
  })
})
