import type { Db } from '../db/database'
import { transaction } from '../db/database'
import type {
  RefundMethod,
  ReturnInput,
  ReturnLine,
  ReturnQuote,
  ReturnRecord
} from '../../shared/types'
import { likePattern, recordMovement } from './products'

export const REFUND_METHODS: readonly RefundMethod[] = [
  'cash',
  'card',
  'mobile',
  'credit',
  'exchange'
]

interface ItemRow {
  id: number
  product_id: number | null
  code: string
  name: string
  unit_price_minor: number
  qty: number
  line_total_minor: number
  unit_cost_minor: number
}

interface BillRow {
  id: number
  bill_no: string
  subtotal_minor: number
  discount_minor: number
  tax_minor: number
}

const alreadyReturned = (db: Db, billItemId: number): number =>
  (
    db
      .prepare('SELECT COALESCE(SUM(qty), 0) AS n FROM return_items WHERE bill_item_id = ?')
      .get(billItemId) as { n: number }
  ).n

/**
 * Works out what a return is worth. Each line takes its share of the bill's discount and tax, so a customer
 * gets back what they actually paid for those items.
 */
export function quoteReturn(db: Db, input: ReturnInput): ReturnQuote {
  if (!input || !Number.isInteger(input.billId)) throw new Error('Choose a bill')
  if (!Array.isArray(input.items) || !input.items.length)
    throw new Error('Choose what is being returned')
  const bill = db.prepare('SELECT * FROM bills WHERE id = ?').get(input.billId) as unknown as
    BillRow | undefined
  if (!bill) throw new Error('Bill not found')

  const wanted = new Map<number, number>()
  for (const l of input.items) {
    if (!l || !Number.isInteger(l.billItemId) || !Number.isInteger(l.qty) || l.qty <= 0)
      throw new Error('Enter a whole quantity for each returned item')
    wanted.set(l.billItemId, (wanted.get(l.billItemId) ?? 0) + l.qty)
  }

  const lines: ReturnLine[] = []
  for (const [billItemId, qty] of wanted) {
    const item = db
      .prepare('SELECT * FROM bill_items WHERE id = ? AND bill_id = ?')
      .get(billItemId, bill.id) as unknown as ItemRow | undefined
    if (!item) throw new Error('That item is not on this bill')
    const left = item.qty - alreadyReturned(db, item.id)
    if (qty > left)
      throw new Error(
        left === 0
          ? `${item.name} was already returned`
          : `Only ${left} of ${item.name} can still be returned`
      )
    // What the customer paid for these pieces: the line total (after any item discount) shared by quantity.
    const value = Math.round((item.line_total_minor * qty) / item.qty)
    const share = (part: number): number =>
      bill.subtotal_minor ? Math.round((part * value) / bill.subtotal_minor) : 0
    const net = value - share(bill.discount_minor)
    const tax = share(bill.tax_minor)
    const unit = db
      .prepare('SELECT serial FROM serial_units WHERE bill_item_id = ?')
      .get(item.id) as { serial: string } | undefined
    lines.push({
      billItemId: item.id,
      name: item.name,
      code: item.code,
      serial: unit?.serial ?? null,
      qty,
      unitPriceMinor: Math.round(value / qty),
      netMinor: net,
      taxMinor: tax,
      refundMinor: net + tax,
      unitCostMinor: item.unit_cost_minor
    })
  }
  const sum = (f: (l: ReturnLine) => number): number => lines.reduce((s, l) => s + f(l), 0)
  return {
    lines,
    netMinor: sum((l) => l.netMinor),
    taxMinor: sum((l) => l.taxMinor),
    refundMinor: sum((l) => l.refundMinor)
  }
}

/** Records a return: refunds the customer, and (unless the goods are thrown away) puts them back in stock. */
export function createReturn(db: Db, input: ReturnInput, createdBy = ''): ReturnRecord {
  if (!REFUND_METHODS.includes(input?.refundMethod))
    throw new Error('Choose how the refund is given')
  const reason = input.reason?.trim() ?? ''
  if (reason.length > 300) throw new Error('The reason is too long (300 characters at most)')
  const restock = input.restock !== false

  return transaction(db, () => {
    const q = quoteReturn(db, input)
    const restockedCost = restock ? q.lines.reduce((s, l) => s + l.qty * l.unitCostMinor, 0) : 0
    const createdAt = new Date().toISOString()
    const res = db
      .prepare(
        `INSERT INTO returns (return_no, bill_id, created_at, net_minor, tax_minor, refund_minor, refund_method,
                              restocked, restocked_cost_minor, reason, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        `tmp-${crypto.randomUUID()}`,
        input.billId,
        createdAt,
        q.netMinor,
        q.taxMinor,
        q.refundMinor,
        input.refundMethod,
        restock ? 1 : 0,
        restockedCost,
        reason,
        createdBy
      )
    const id = Number(res.lastInsertRowid)
    const returnNo = `RET-${String(id).padStart(6, '0')}`
    db.prepare('UPDATE returns SET return_no = ? WHERE id = ?').run(returnNo, id)

    for (const l of q.lines) {
      const item = db
        .prepare('SELECT product_id FROM bill_items WHERE id = ?')
        .get(l.billItemId) as { product_id: number | null }
      const unit = db
        .prepare('SELECT id, serial, serial2 FROM serial_units WHERE bill_item_id = ?')
        .get(l.billItemId) as { id: number; serial: string; serial2: string | null } | undefined
      db.prepare(
        `INSERT INTO return_items (return_id, bill_item_id, product_id, code, name, serial, serial2, qty,
                                   unit_price_minor, net_minor, tax_minor, refund_minor, unit_cost_minor)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        id,
        l.billItemId,
        item.product_id,
        l.code,
        l.name,
        unit?.serial ?? null,
        unit?.serial2 ?? null,
        l.qty,
        l.unitPriceMinor,
        l.netMinor,
        l.taxMinor,
        l.refundMinor,
        l.unitCostMinor
      )
      if (!restock) continue
      if (item.product_id !== null) {
        db.prepare(
          'UPDATE products SET stock_qty = stock_qty + ?, updated_at = ? WHERE id = ?'
        ).run(l.qty, createdAt, item.product_id)
        recordMovement(db, item.product_id, l.qty, 'return', returnNo)
      }
      // A returned phone is in stock again, ready to be sold to someone else.
      if (unit)
        db.prepare(
          "UPDATE serial_units SET status = 'in_stock', bill_item_id = NULL, sold_at = NULL WHERE id = ?"
        ).run(unit.id)
    }
    return getReturn(db, id)!
  })
}

interface ReturnRow {
  id: number
  return_no: string
  bill_id: number
  bill_no: string
  created_at: string
  net_minor: number
  tax_minor: number
  refund_minor: number
  refund_method: RefundMethod
  restocked: number
  reason: string
  created_by: string
}

function hydrate(db: Db, r: ReturnRow): ReturnRecord {
  const items = (
    db
      .prepare('SELECT * FROM return_items WHERE return_id = ? ORDER BY id')
      .all(r.id) as unknown as {
      bill_item_id: number
      name: string
      code: string
      serial: string | null
      qty: number
      unit_price_minor: number
      net_minor: number
      tax_minor: number
      refund_minor: number
      unit_cost_minor: number
    }[]
  ).map((i): ReturnLine => ({
    billItemId: i.bill_item_id,
    name: i.name,
    code: i.code,
    serial: i.serial,
    qty: i.qty,
    unitPriceMinor: i.unit_price_minor,
    netMinor: i.net_minor,
    taxMinor: i.tax_minor,
    refundMinor: i.refund_minor,
    unitCostMinor: i.unit_cost_minor
  }))
  return {
    id: r.id,
    returnNo: r.return_no,
    billId: r.bill_id,
    billNo: r.bill_no,
    createdAt: r.created_at,
    netMinor: r.net_minor,
    taxMinor: r.tax_minor,
    refundMinor: r.refund_minor,
    refundMethod: r.refund_method,
    restocked: r.restocked === 1,
    reason: r.reason,
    createdBy: r.created_by,
    items
  }
}

const SELECT = 'SELECT r.*, b.bill_no AS bill_no FROM returns r JOIN bills b ON b.id = r.bill_id'

export function getReturn(db: Db, id: number): ReturnRecord | null {
  const r = db.prepare(`${SELECT} WHERE r.id = ?`).get(id) as unknown as ReturnRow | undefined
  return r ? hydrate(db, r) : null
}

export function listReturns(db: Db, search = '', limit = 200): ReturnRecord[] {
  const like = likePattern(search)
  const rows = db
    .prepare(
      `${SELECT} WHERE r.return_no LIKE ? ESCAPE '\\' OR b.bill_no LIKE ? ESCAPE '\\' ORDER BY r.id DESC LIMIT ?`
    )
    .all(like, like, limit) as unknown as ReturnRow[]
  return rows.map((r) => hydrate(db, r))
}

/** Totals of the returns made between two instants, for the reports, day book and dashboard. */
export function returnTotals(
  db: Db,
  lo: string,
  hi: string
): { count: number; netMinor: number; restockedCostMinor: number; paidOutMinor: number } {
  const r = db
    .prepare(
      `SELECT COUNT(*) AS count, COALESCE(SUM(net_minor), 0) AS net,
              COALESCE(SUM(restocked_cost_minor), 0) AS cost,
              COALESCE(SUM(CASE WHEN refund_method = 'credit' THEN 0 ELSE refund_minor END), 0) AS paid
       FROM returns WHERE created_at >= ? AND created_at < ?`
    )
    .get(lo, hi) as unknown as { count: number; net: number; cost: number; paid: number }
  return { count: r.count, netMinor: r.net, restockedCostMinor: r.cost, paidOutMinor: r.paid }
}
