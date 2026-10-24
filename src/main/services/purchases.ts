import type { Db } from '../db/database'
import { transaction } from '../db/database'
import type { Purchase, PurchaseInput, PurchaseItem, SupplierNoteInput } from '../../shared/types'
import { getProduct, recordMovement, likePattern, MAX_QTY, MAX_PRICE_MINOR } from './products'

/**
 * Records goods bought from a supplier: adds the quantity to stock (audit reason 'purchase')
 * and updates each product's cost price to this purchase's per-unit cost (rounded to a whole minor unit).
 */
export function createPurchase(db: Db, input: PurchaseInput): Purchase {
  const supplier = input.supplierName?.trim()
  if (!supplier) throw new Error('Supplier name is required')
  if (!Array.isArray(input.items) || !input.items.length)
    throw new Error('Add at least one item to the purchase')

  // Merge repeated lines for the same product.
  const merged = new Map<number, { qty: number; total: number }>()
  for (const l of input.items) {
    if (!l || !Number.isInteger(l.productId)) throw new Error('Invalid item on the purchase')
    if (!Number.isInteger(l.qty) || l.qty <= 0 || l.qty > MAX_QTY)
      throw new Error(
        `Quantity must be a whole number from 1 to ${MAX_QTY.toLocaleString('en-US')}`
      )
    if (!Number.isInteger(l.totalCostMinor) || l.totalCostMinor < 0)
      throw new Error('Cost must be a valid amount (0 or more)')
    if (l.totalCostMinor > MAX_PRICE_MINOR * 1000) throw new Error('Cost is too large')
    const cur = merged.get(l.productId) ?? { qty: 0, total: 0 }
    merged.set(l.productId, { qty: cur.qty + l.qty, total: cur.total + l.totalCostMinor })
  }

  return transaction(db, () => {
    const createdAt = new Date().toISOString()
    const res = db
      .prepare(
        'INSERT INTO purchases (purchase_no, created_at, supplier_name, note, total_minor) VALUES (?, ?, ?, ?, 0)'
      )
      .run(`tmp-${crypto.randomUUID()}`, createdAt, supplier, input.note?.trim() ?? '')
    const id = Number(res.lastInsertRowid)
    const purchaseNo = `PUR-${String(id).padStart(6, '0')}`
    let grand = 0

    for (const [productId, { qty, total }] of merged) {
      const p = getProduct(db, productId)
      if (!p || !p.active) throw new Error('A product on this purchase no longer exists')
      const unit = Math.round(total / qty)
      db.prepare(
        `INSERT INTO purchase_items (purchase_id, product_id, code, name, qty, unit_cost_minor, line_total_minor)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run(id, productId, p.code, p.name, qty, unit, total)
      db.prepare(
        'UPDATE products SET stock_qty = stock_qty + ?, cost_minor = ?, updated_at = ? WHERE id = ?'
      ).run(qty, unit, createdAt, productId)
      recordMovement(db, productId, qty, 'purchase', purchaseNo)
      grand += total
    }
    db.prepare('UPDATE purchases SET purchase_no = ?, total_minor = ? WHERE id = ?').run(
      purchaseNo,
      grand,
      id
    )
    return getPurchase(db, id)!
  })
}

/**
 * Info-only entry ("ABC Traders, 200 covers, 10,000"): remembers who supplied what and for how much.
 * It has no items and never touches stock or product costs.
 */
export function createSupplierNote(db: Db, input: SupplierNoteInput): Purchase {
  const supplier = input.supplierName?.trim()
  if (!supplier) throw new Error('Supplier name is required')
  const description = input.description?.trim()
  if (!description) throw new Error('Describe what you bought')
  if (!Number.isInteger(input.amountMinor) || input.amountMinor <= 0)
    throw new Error('Amount must be greater than 0')
  if (input.amountMinor > MAX_PRICE_MINOR * 1000) throw new Error('Amount is too large')
  let createdAt = new Date().toISOString()
  if (input.date) {
    const d = /^\d{4}-\d{2}-\d{2}$/.test(input.date) ? new Date(`${input.date}T12:00:00`) : null
    if (!d || Number.isNaN(d.getTime())) throw new Error('Enter a valid date')
    createdAt = d.toISOString()
  }
  return transaction(db, () => {
    const res = db
      .prepare(
        'INSERT INTO purchases (purchase_no, created_at, supplier_name, note, total_minor) VALUES (?, ?, ?, ?, ?)'
      )
      .run(`tmp-${crypto.randomUUID()}`, createdAt, supplier, description, input.amountMinor)
    const id = Number(res.lastInsertRowid)
    db.prepare('UPDATE purchases SET purchase_no = ? WHERE id = ?').run(
      `PUR-${String(id).padStart(6, '0')}`,
      id
    )
    return getPurchase(db, id)!
  })
}

interface PurchaseRow {
  id: number
  purchase_no: string
  created_at: string
  supplier_name: string
  note: string
  total_minor: number
}

function hydrate(db: Db, r: PurchaseRow): Purchase {
  const items = (
    db
      .prepare('SELECT * FROM purchase_items WHERE purchase_id = ? ORDER BY id')
      .all(r.id) as unknown as {
      id: number
      product_id: number | null
      code: string
      name: string
      qty: number
      unit_cost_minor: number
      line_total_minor: number
    }[]
  ).map((i): PurchaseItem => ({
    id: i.id,
    productId: i.product_id,
    code: i.code,
    name: i.name,
    qty: i.qty,
    unitCostMinor: i.unit_cost_minor,
    lineTotalMinor: i.line_total_minor
  }))
  return {
    id: r.id,
    purchaseNo: r.purchase_no,
    createdAt: r.created_at,
    supplierName: r.supplier_name,
    note: r.note,
    totalMinor: r.total_minor,
    items
  }
}

export function getPurchase(db: Db, id: number): Purchase | null {
  const r = db.prepare('SELECT * FROM purchases WHERE id = ?').get(id) as PurchaseRow | undefined
  return r ? hydrate(db, r) : null
}

export function listPurchases(db: Db, search = '', limit = 200): Purchase[] {
  const like = likePattern(search)
  const rows = db
    .prepare(
      "SELECT * FROM purchases WHERE purchase_no LIKE ? ESCAPE '\\' OR supplier_name LIKE ? ESCAPE '\\' OR note LIKE ? ESCAPE '\\' ORDER BY id DESC LIMIT ?"
    )
    .all(like, like, like, limit) as unknown as PurchaseRow[]
  return rows.map((r) => hydrate(db, r))
}

/** Distinct supplier names used before, for quick re-selection. */
export function listSuppliers(db: Db): string[] {
  return (
    db
      .prepare('SELECT DISTINCT supplier_name AS n FROM purchases ORDER BY n COLLATE NOCASE')
      .all() as unknown as { n: string }[]
  ).map((r) => r.n)
}
