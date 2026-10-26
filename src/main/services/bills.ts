import type { Db } from '../db/database'
import { transaction } from '../db/database'
import type { Bill, BillInput, BillItem } from '../../shared/types'
import { getProduct, recordMovement, likePattern, MAX_QTY } from './products'
import { getSettings } from './settings'
import { normalizeSerials } from './serials'

/** Tax = subtotalAfterDiscount * rate, rounded half up to a whole minor unit. */
export function computeTax(taxableMinor: number, taxRateBp: number): number {
  return Math.floor((taxableMinor * taxRateBp + 5000) / 10000)
}

export const PAYMENT_METHODS = ['cash', 'card', 'mobile', 'credit'] as const
const MAX_BILL_MINOR = 1_000_000_000_000_000 // keeps every sum below Number.MAX_SAFE_INTEGER

export function createBill(db: Db, input: BillInput, createdBy = ''): Bill {
  if (!Array.isArray(input.items) || !input.items.length)
    throw new Error('Add at least one item to the bill')
  const discountMinor = input.discountMinor ?? 0
  if (!Number.isInteger(discountMinor) || discountMinor < 0)
    throw new Error('Discount must be a whole number >= 0')

  // Merge duplicate lines for the same product.
  const qtyByProduct = new Map<number, number>()
  const serialsByProduct = new Map<number, string[]>()
  for (const line of input.items) {
    if (!line || !Number.isInteger(line.productId)) throw new Error('Invalid item on the bill')
    if (!Number.isInteger(line.qty) || line.qty <= 0)
      throw new Error('Quantity must be a whole number > 0')
    const merged = (qtyByProduct.get(line.productId) ?? 0) + line.qty
    if (merged > MAX_QTY) throw new Error('Quantity is too large')
    qtyByProduct.set(line.productId, merged)
    if (line.serials !== undefined) {
      const sers = normalizeSerials(line.serials)
      if (sers.length !== line.qty)
        throw new Error(`Quantity (${line.qty}) must match the number of IMEIs (${sers.length})`)
      serialsByProduct.set(line.productId, [
        ...(serialsByProduct.get(line.productId) ?? []),
        ...sers
      ])
    }
  }
  const allSerials = [...serialsByProduct.values()].flat()
  const repeated = allSerials.find((x, i) => allSerials.indexOf(x) !== i)
  if (repeated) throw new Error(`IMEI ${repeated} is on the bill twice`)
  const paymentMethod = input.paymentMethod || 'cash'
  if (!(PAYMENT_METHODS as readonly string[]).includes(paymentMethod))
    throw new Error('Unknown payment method')

  return transaction(db, () => {
    const seenUnits = new Set<number>()
    const settings = getSettings(db)
    let subtotal = 0
    const lines: {
      productId: number
      code: string
      name: string
      price: number
      cost: number
      qty: number
      total: number
      /** Set for a tracked unit: its IMEI row id and number. */
      unitId?: number
      serial?: string
    }[] = []

    for (const [productId, qty] of qtyByProduct) {
      const p = getProduct(db, productId)
      if (!p || !p.active) throw new Error('A product on this bill no longer exists')
      if (p.stockQty < qty)
        throw new Error(`Not enough stock for ${p.name} (have ${p.stockQty}, need ${qty})`)
      const sers = serialsByProduct.get(productId)
      if (p.trackSerial) {
        if (sers?.length !== qty) throw new Error(`Choose the IMEI of every ${p.name} being sold`)
        // A tracked product is billed one line per unit so each line carries its own IMEI and cost.
        for (const serial of sers) {
          const u = db
            .prepare(
              'SELECT id, product_id, status, cost_minor FROM serial_units WHERE serial = ? OR serial2 = ?'
            )
            .get(serial, serial) as
            { id: number; product_id: number; status: string; cost_minor: number } | undefined
          if (!u || u.product_id !== productId)
            throw new Error(`IMEI ${serial} is not a ${p.name} in stock`)
          if (u.status !== 'in_stock') throw new Error(`IMEI ${serial} is already sold`)
          // The same phone can be named by either of its two IMEIs; it may only be on the bill once.
          if (seenUnits.has(u.id)) throw new Error(`IMEI ${serial} is on the bill twice`)
          seenUnits.add(u.id)
          subtotal += p.priceMinor
          if (subtotal > MAX_BILL_MINOR) throw new Error('Bill total is too large')
          lines.push({
            productId,
            code: p.code,
            name: p.name,
            price: p.priceMinor,
            cost: u.cost_minor,
            qty: 1,
            total: p.priceMinor,
            unitId: u.id,
            serial
          })
        }
        continue
      }
      if (sers) throw new Error(`${p.name} is not tracked by IMEI`)
      const total = p.priceMinor * qty
      subtotal += total
      if (subtotal > MAX_BILL_MINOR) throw new Error('Bill total is too large')
      lines.push({
        productId,
        code: p.code,
        name: p.name,
        price: p.priceMinor,
        cost: p.costMinor,
        qty,
        total
      })
    }

    if (discountMinor > subtotal) throw new Error('Discount cannot exceed the subtotal')
    const tax = computeTax(subtotal - discountMinor, settings.taxRateBp)
    const total = subtotal - discountMinor + tax
    const tendered = paymentMethod === 'cash' ? (input.tenderedMinor ?? 0) : 0
    if (!Number.isInteger(tendered) || tendered < 0)
      throw new Error('Cash received must be a valid amount')
    if (tendered > 0 && tendered < total)
      throw new Error('Cash received is less than the bill total')
    const createdAt = new Date().toISOString()

    const res = db
      .prepare(
        `INSERT INTO bills (bill_no, created_at, subtotal_minor, discount_minor, tax_minor, total_minor, payment_method, customer_name, tendered_minor, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        `tmp-${crypto.randomUUID()}`,
        createdAt,
        subtotal,
        discountMinor,
        tax,
        total,
        paymentMethod,
        input.customerName?.trim() ?? '',
        tendered,
        createdBy
      )
    const billId = Number(res.lastInsertRowid)
    const billNo = `INV-${String(billId).padStart(6, '0')}`
    db.prepare('UPDATE bills SET bill_no = ? WHERE id = ?').run(billNo, billId)

    const insItem = db.prepare(
      `INSERT INTO bill_items (bill_id, product_id, code, name, unit_price_minor, qty, line_total_minor, unit_cost_minor) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    for (const l of lines) {
      const item = insItem.run(billId, l.productId, l.code, l.name, l.price, l.qty, l.total, l.cost)
      if (l.unitId !== undefined)
        db.prepare(
          "UPDATE serial_units SET status = 'sold', bill_item_id = ?, sold_at = ? WHERE id = ?"
        ).run(Number(item.lastInsertRowid), createdAt, l.unitId)
      db.prepare('UPDATE products SET stock_qty = stock_qty - ?, updated_at = ? WHERE id = ?').run(
        l.qty,
        createdAt,
        l.productId
      )
      recordMovement(db, l.productId, -l.qty, 'sale', billNo)
    }
    return getBill(db, billId)!
  })
}

interface BillRow {
  id: number
  bill_no: string
  created_at: string
  subtotal_minor: number
  discount_minor: number
  tax_minor: number
  total_minor: number
  payment_method: string
  customer_name: string
  tendered_minor: number
  created_by: string
}

function hydrate(db: Db, r: BillRow): Bill {
  const items = (
    db
      .prepare(
        `SELECT bi.*, (SELECT serial FROM serial_units WHERE bill_item_id = bi.id) AS serial,
                (SELECT serial2 FROM serial_units WHERE bill_item_id = bi.id) AS serial2
         FROM bill_items bi WHERE bi.bill_id = ? ORDER BY bi.id`
      )
      .all(r.id) as unknown as {
      id: number
      product_id: number | null
      code: string
      name: string
      unit_price_minor: number
      qty: number
      line_total_minor: number
      serial: string | null
      serial2: string | null
    }[]
  ).map((i): BillItem => ({
    id: i.id,
    productId: i.product_id,
    code: i.code,
    name: i.name,
    unitPriceMinor: i.unit_price_minor,
    qty: i.qty,
    lineTotalMinor: i.line_total_minor,
    serial: i.serial,
    serial2: i.serial2
  }))
  return {
    id: r.id,
    billNo: r.bill_no,
    createdAt: r.created_at,
    subtotalMinor: r.subtotal_minor,
    discountMinor: r.discount_minor,
    taxMinor: r.tax_minor,
    totalMinor: r.total_minor,
    paymentMethod: r.payment_method,
    customerName: r.customer_name,
    tenderedMinor: r.tendered_minor,
    createdBy: r.created_by,
    items
  }
}

export function getBill(db: Db, id: number): Bill | null {
  const r = db.prepare('SELECT * FROM bills WHERE id = ?').get(id) as BillRow | undefined
  return r ? hydrate(db, r) : null
}

export function listBills(db: Db, search = '', limit = 200): Bill[] {
  const like = likePattern(search)
  const rows = db
    .prepare(
      `SELECT * FROM bills WHERE bill_no LIKE ? ESCAPE '\\' OR customer_name LIKE ? ESCAPE '\\'
         OR EXISTS (SELECT 1 FROM serial_units u JOIN bill_items bi ON bi.id = u.bill_item_id
                    WHERE bi.bill_id = bills.id AND (u.serial LIKE ? ESCAPE '\\' OR u.serial2 LIKE ? ESCAPE '\\'))
       ORDER BY id DESC LIMIT ?`
    )
    .all(like, like, like, like, limit) as unknown as BillRow[]
  return rows.map((r) => hydrate(db, r))
}

/**
 * Removes a bill as if it never happened: the items go back into stock (phones become in-stock again),
 * and the bill disappears from history, reports, the day book and the dashboard. Bill numbers are not reused.
 */
export function deleteBill(db: Db, id: number): void {
  if (!Number.isInteger(id)) throw new Error('Unknown bill')
  transaction(db, () => {
    const bill = getBill(db, id)
    if (!bill) throw new Error('Bill not found')
    const now = new Date().toISOString()
    for (const item of bill.items) {
      db.prepare(
        "UPDATE serial_units SET status = 'in_stock', bill_item_id = NULL, sold_at = NULL WHERE bill_item_id = ?"
      ).run(item.id)
      if (item.productId !== null)
        db.prepare(
          'UPDATE products SET stock_qty = stock_qty + ?, updated_at = ? WHERE id = ?'
        ).run(item.qty, now, item.productId)
    }
    db.prepare("DELETE FROM stock_movements WHERE ref = ? AND reason = 'sale'").run(bill.billNo)
    db.prepare('DELETE FROM bill_items WHERE bill_id = ?').run(id)
    db.prepare('DELETE FROM bills WHERE id = ?').run(id)
  })
}
