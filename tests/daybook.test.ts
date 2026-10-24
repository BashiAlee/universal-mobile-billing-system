import { describe, it, expect } from 'vitest'
import { memoryDb } from './helpers'
import { createProduct } from '../src/main/services/products'
import { createBill } from '../src/main/services/bills'
import { addExpense, deleteExpense, getDayBook, saveDayBook } from '../src/main/services/daybook'

const ymd = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const today = (): string => ymd(new Date())
const offset = (n: number): string => {
  const d = new Date()
  d.setDate(d.getDate() + n)
  return ymd(d)
}

describe('day book', () => {
  it('lists the day sales with buy and sale, profit and expenses', () => {
    const db = memoryDb()
    const p = createProduct(db, { name: 'Cable', priceMinor: 55000, costMinor: 53000, stockQty: 5 })
    createBill(db, { items: [{ productId: p.id, qty: 2 }] })
    addExpense(db, { day: today(), title: 'Ali Noor Trading', amountMinor: 120000 })
    const d = getDayBook(db, today())
    expect(d.lines).toHaveLength(1)
    expect(d.lines[0]).toMatchObject({
      name: 'Cable',
      qty: 2,
      costMinor: 106000,
      saleMinor: 110000
    })
    expect(d.salesMinor).toBe(110000)
    expect(d.profitMinor).toBe(4000)
    expect(d.expensesMinor).toBe(120000)
    expect(d.netProfitMinor).toBe(4000 - 120000)
  })

  it('carries the remaining balance forward to the next day', () => {
    const db = memoryDb()
    saveDayBook(db, { day: offset(-1), openingMinor: 100000, notes: '' })
    addExpense(db, { day: offset(-1), title: 'Tea', amountMinor: 25000 })
    const next = getDayBook(db, today())
    expect(next.openingManual).toBe(false)
    expect(next.openingMinor).toBe(75000)
    expect(next.closingMinor).toBe(75000)
  })

  it('a typed opening balance overrides the carried one and can be reset', () => {
    const db = memoryDb()
    saveDayBook(db, { day: offset(-1), openingMinor: 100000, notes: '' })
    saveDayBook(db, { day: today(), openingMinor: 5000, notes: 'drawer 500' })
    let d = getDayBook(db, today())
    expect(d).toMatchObject({ openingMinor: 5000, openingManual: true, notes: 'drawer 500' })
    d = saveDayBook(db, { day: today(), openingMinor: null, notes: 'drawer 500' })
    expect(d).toMatchObject({ openingMinor: 100000, openingManual: false, notes: 'drawer 500' })
  })

  it('credit bills are not counted as money received', () => {
    const db = memoryDb()
    const p = createProduct(db, { name: 'Cover', priceMinor: 10000, costMinor: 4000, stockQty: 5 })
    createBill(db, { items: [{ productId: p.id, qty: 1 }], paymentMethod: 'credit' })
    createBill(db, { items: [{ productId: p.id, qty: 1 }], paymentMethod: 'cash' })
    const d = getDayBook(db, today())
    expect(d.receivedMinor).toBe(10000)
    expect(d.creditMinor).toBe(10000)
    expect(d.salesMinor).toBe(20000)
  })

  it('validates input and can remove an expense', () => {
    const db = memoryDb()
    expect(() => getDayBook(db, 'nope')).toThrow('valid date')
    expect(() => addExpense(db, { day: today(), title: ' ', amountMinor: 100 })).toThrow()
    expect(() => addExpense(db, { day: today(), title: 'x', amountMinor: 0 })).toThrow()
    expect(() => addExpense(db, { day: today(), title: 'x', amountMinor: 1.5 })).toThrow()
    expect(() => saveDayBook(db, { day: today(), openingMinor: -1, notes: '' })).toThrow()
    const e = addExpense(db, { day: today(), title: 'Rent', amountMinor: 5000 })
    deleteExpense(db, e.id)
    expect(getDayBook(db, today()).expenses).toHaveLength(0)
  })
})

describe('dashboard', () => {
  it('compares with the previous period and counts alerts', async () => {
    const { getDashboard } = await import('../src/main/services/dashboard')
    const db = memoryDb()
    const a = createProduct(db, {
      name: 'A',
      priceMinor: 10000,
      costMinor: 4000,
      stockQty: 1,
      lowStockThreshold: 2
    })
    createProduct(db, { name: 'B', priceMinor: 1000, costMinor: 2000, stockQty: 50 })
    createBill(db, { items: [{ productId: a.id, qty: 1 }] })
    addExpense(db, { day: today(), title: 'Tea', amountMinor: 3000 })
    addExpense(db, { day: today(), title: 'tea', amountMinor: 2000 })
    addExpense(db, { day: offset(-1), title: 'Rent', amountMinor: 7000 })
    const d = getDashboard(db, { from: today(), to: today() })
    expect(d.report.netSalesMinor).toBe(10000)
    expect(d.expensesMinor).toBe(5000)
    expect(d.expensesByTitle).toEqual([{ title: 'Tea', totalMinor: 5000 }])
    expect(d.previous.expensesMinor).toBe(7000)
    expect(d.previous.salesMinor).toBe(0)
    expect(d.lowStockCount).toBe(1) // A has 0 left
    expect(d.sellInLossCount).toBe(1) // B sells below cost
    expect(d.series.sales).toEqual([10000])
    expect(() => getDashboard(db, { from: today(), to: offset(-3) })).toThrow()
  })
})
