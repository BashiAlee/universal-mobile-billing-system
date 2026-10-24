import type { Db } from '../db/database'
import { transaction } from '../db/database'
import type { Product, SerialAddInput, SerialFilter, SerialUnit } from '../../shared/types'
import { getProduct, likePattern, MAX_PRICE_MINOR, recordMovement } from './products'

/** IMEIs and serials are stored trimmed and upper-case so a scan and a typed entry always match. */
export function normalizeSerial(raw: unknown): string {
  const s = typeof raw === 'string' ? raw.trim().toUpperCase() : ''
  if (!/^[A-Z0-9][A-Z0-9-]{3,39}$/.test(s))
    throw new Error(
      `"${String(raw ?? '').trim()}" is not a valid IMEI / serial (4-40 letters, digits or dashes)`
    )
  return s
}

/** Normalizes a list and rejects repeats inside it. */
export function normalizeSerials(list: unknown): string[] {
  if (!Array.isArray(list)) throw new Error('IMEI list is invalid')
  const out = list.map(normalizeSerial)
  const dup = out.find((s, i) => out.indexOf(s) !== i)
  if (dup) throw new Error(`IMEI ${dup} is entered more than once`)
  return out
}

/** Second IMEIs, same length as the units: '' / missing means the phone has only one. */
export function normalizeSerials2(list: unknown, count: number): (string | null)[] {
  if (list === undefined) return Array(count).fill(null)
  if (!Array.isArray(list) || list.length !== count)
    throw new Error('The second IMEI list must match the number of phones')
  return list.map((x) => (typeof x === 'string' && x.trim() === '' ? null : normalizeSerial(x)))
}

const SELECT = `
  SELECT u.*, p.name AS product_name,
         pu.purchase_no, pu.supplier_name,
         b.bill_no, b.customer_name
  FROM serial_units u
  JOIN products p ON p.id = u.product_id
  LEFT JOIN purchases pu ON pu.id = u.purchase_id
  LEFT JOIN bill_items bi ON bi.id = u.bill_item_id
  LEFT JOIN bills b ON b.id = bi.bill_id`

interface Row {
  id: number
  product_id: number
  product_name: string
  serial: string
  serial2: string | null
  condition: 'new' | 'used'
  cost_minor: number
  status: 'in_stock' | 'sold'
  purchase_no: string | null
  supplier_name: string | null
  created_at: string
  bill_no: string | null
  sold_at: string | null
  customer_name: string | null
}

function toUnit(r: Row): SerialUnit {
  return {
    id: r.id,
    productId: r.product_id,
    productName: r.product_name,
    serial: r.serial,
    serial2: r.serial2,
    condition: r.condition,
    costMinor: r.cost_minor,
    status: r.status,
    purchaseNo: r.purchase_no,
    supplierName: r.supplier_name,
    boughtAt: r.created_at,
    billNo: r.bill_no,
    soldAt: r.sold_at,
    customerName: r.customer_name
  }
}

export function getUnit(db: Db, serial: string): SerialUnit | null {
  const n = serial.trim().toUpperCase()
  const r = db.prepare(`${SELECT} WHERE u.serial = ? OR u.serial2 = ?`).get(n, n) as Row | undefined
  return r ? toUnit(r) : null
}

export function listUnits(db: Db, filter: SerialFilter = {}, limit = 200): SerialUnit[] {
  const where: string[] = []
  const args: (string | number)[] = []
  if (filter.productId !== undefined) {
    where.push('u.product_id = ?')
    args.push(filter.productId)
  }
  if (filter.status) {
    where.push('u.status = ?')
    args.push(filter.status)
  }
  if (filter.search?.trim()) {
    where.push("(u.serial LIKE ? ESCAPE '\\' OR u.serial2 LIKE ? ESCAPE '\\')")
    args.push(likePattern(filter.search), likePattern(filter.search))
  }
  const rows = db
    .prepare(
      `${SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY u.id DESC LIMIT ?`
    )
    .all(...args, limit) as unknown as Row[]
  return rows.map(toUnit)
}

/** Adds bought units to stock. Fails (rolling back the caller's transaction) if any IMEI already exists. */
export function insertUnits(
  db: Db,
  productId: number,
  serials: string[],
  serials2: (string | null)[],
  condition: 'new' | 'used',
  costMinor: number,
  purchaseId: number | null,
  createdAt: string
): void {
  const find = db.prepare(
    `SELECT u.status, b.bill_no FROM serial_units u
     LEFT JOIN bill_items bi ON bi.id = u.bill_item_id LEFT JOIN bills b ON b.id = bi.bill_id
     WHERE u.serial = ? OR u.serial2 = ?`
  )
  const ins = db.prepare(
    `INSERT INTO serial_units (product_id, serial, serial2, condition, cost_minor, purchase_id, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'in_stock', ?)`
  )
  serials.forEach((s, i) => {
    const s2 = serials2[i]
    for (const n of s2 ? [s, s2] : [s]) {
      const ex = find.get(n, n) as { status: string; bill_no: string | null } | undefined
      if (ex)
        throw new Error(
          `IMEI ${n} is already in the system${ex.status === 'sold' ? ` (sold on ${ex.bill_no})` : ' (in stock)'}`
        )
    }
    ins.run(productId, s, s2, condition, costMinor, purchaseId, createdAt)
  })
}

/** Adds phones to a tracked product without a purchase (opening stock, or phones bought outside the app). */
export function addUnits(db: Db, input: SerialAddInput): Product {
  if (!Array.isArray(input.units) || !input.units.length) throw new Error('Enter at least one IMEI')
  if (input.units.length > 500) throw new Error('Add at most 500 phones at a time')
  const serials = normalizeSerials(input.units.map((u) => u.serial))
  const serials2 = normalizeSerials2(
    input.units.map((u) => u.serial2 ?? ''),
    serials.length
  )
  const all = [...serials, ...serials2.filter((x): x is string => !!x)]
  const dup = all.find((x, i) => all.indexOf(x) !== i)
  if (dup) throw new Error(`IMEI ${dup} is entered more than once`)
  return transaction(db, () => {
    const p = getProduct(db, input.productId)
    if (!p || !p.active) throw new Error('Product not found')
    if (!p.trackSerial) throw new Error(`${p.name} is not tracked by IMEI`)
    const createdAt = new Date().toISOString()
    input.units.forEach((u, i) => {
      const cost = u.costMinor ?? p.costMinor
      if (!Number.isInteger(cost) || cost < 0 || cost > MAX_PRICE_MINOR)
        throw new Error('Cost must be a valid amount')
      insertUnits(
        db,
        p.id,
        [serials[i]],
        [serials2[i]],
        u.condition === 'used' ? 'used' : 'new',
        cost,
        null,
        createdAt
      )
    })
    db.prepare('UPDATE products SET stock_qty = stock_qty + ?, updated_at = ? WHERE id = ?').run(
      serials.length,
      createdAt,
      p.id
    )
    recordMovement(db, p.id, serials.length, 'initial', 'IMEI added')
    return getProduct(db, p.id)!
  })
}

/** Deletes a phone that was entered by mistake. Only possible while it is still in stock. */
export function removeUnit(db: Db, id: number): void {
  transaction(db, () => {
    const u = db
      .prepare('SELECT product_id, status, serial FROM serial_units WHERE id = ?')
      .get(id) as { product_id: number; status: string; serial: string } | undefined
    if (!u) throw new Error('IMEI not found')
    if (u.status !== 'in_stock')
      throw new Error('This phone is already sold, so it cannot be deleted')
    db.prepare('DELETE FROM serial_units WHERE id = ?').run(id)
    db.prepare('UPDATE products SET stock_qty = stock_qty - 1, updated_at = ? WHERE id = ?').run(
      new Date().toISOString(),
      u.product_id
    )
    recordMovement(db, u.product_id, -1, 'adjustment', `IMEI ${u.serial} removed`)
  })
}
