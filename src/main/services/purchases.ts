import type { Db } from '../db/database'
import { transaction } from '../db/database'
import type {
  NewProductInput,
  Purchase,
  PurchaseInput,
  PurchaseItem,
  SupplierNoteInput
} from '../../shared/types'
import {
  getProduct,
  insertProduct,
  recordMovement,
  likePattern,
  MAX_QTY,
  MAX_PRICE_MINOR
} from './products'
import { findOrCreateParty, getParty } from './parties'
import { insertUnits, normalizeSerials, normalizeSerials2 } from './serials'

/** Resolves the party a purchase belongs to: an existing id, or a name that is found or created. */
function resolveParty(
  db: Db,
  partyId?: number,
  supplierName?: string
): { id: number; name: string } {
  if (partyId !== undefined) {
    const p = getParty(db, partyId)
    if (!p) throw new Error('Party not found')
    return { id: p.id, name: p.name }
  }
  const id = findOrCreateParty(db, supplierName ?? '')
  return { id, name: getParty(db, id)!.name }
}

function checkPaid(paid: number | undefined, total: number): number {
  const v = paid ?? total
  if (!Number.isInteger(v) || v < 0) throw new Error('Amount paid must be 0 or more')
  if (v > total)
    throw new Error('Amount paid cannot be more than the total (record extra money as a payment)')
  return v
}

/**
 * Records goods bought from a supplier: adds the quantity to stock (audit reason 'purchase')
 * and updates each product's cost price to this purchase's per-unit cost (rounded to a whole minor unit).
 */
export function createPurchase(db: Db, input: PurchaseInput): Purchase {
  if (input.partyId === undefined && !input.supplierName?.trim())
    throw new Error('Supplier name is required')
  if (!Array.isArray(input.items) || !input.items.length)
    throw new Error('Add at least one item to the purchase')

  // Merge repeated lines for the same existing product; each new product is its own line.
  type Line = {
    productId?: number
    newProduct?: NewProductInput
    qty: number
    total: number
    serials?: string[]
    serials2?: (string | null)[]
    condition: 'new' | 'used'
  }
  const merged = new Map<number | object, Line>()
  for (const l of input.items) {
    if (!l || (l.productId === undefined) === (l.newProduct === undefined))
      throw new Error('Invalid item on the purchase')
    if (l.productId !== undefined && !Number.isInteger(l.productId))
      throw new Error('Invalid item on the purchase')
    if (!Number.isInteger(l.qty) || l.qty <= 0 || l.qty > MAX_QTY)
      throw new Error(
        `Quantity must be a whole number from 1 to ${MAX_QTY.toLocaleString('en-US')}`
      )
    if (!Number.isInteger(l.totalCostMinor) || l.totalCostMinor < 0)
      throw new Error('Cost must be a valid amount (0 or more)')
    if (l.totalCostMinor > MAX_PRICE_MINOR * 1000) throw new Error('Cost is too large')
    const condition = l.condition === 'used' ? 'used' : 'new'
    const serials = l.serials === undefined ? undefined : normalizeSerials(l.serials)
    if (serials && serials.length !== l.qty)
      throw new Error(
        `Quantity (${l.qty}) must match the number of IMEIs entered (${serials.length})`
      )
    // Tracked lines keep their own condition and IMEIs, so they are never merged.
    const serials2 = serials ? normalizeSerials2(l.serials2, serials.length) : undefined
    if (l.newProduct || serials) {
      merged.set(
        {},
        {
          productId: l.productId,
          newProduct: l.newProduct,
          qty: l.qty,
          total: l.totalCostMinor,
          serials,
          serials2,
          condition
        }
      )
      continue
    }
    const cur = merged.get(l.productId as number) ?? {
      productId: l.productId,
      qty: 0,
      total: 0,
      condition
    }
    merged.set(l.productId as number, {
      productId: l.productId,
      qty: cur.qty + l.qty,
      total: cur.total + l.totalCostMinor,
      condition
    })
  }
  const total = [...merged.values()].reduce((a, l) => a + l.total, 0)
  const paid = checkPaid(input.paidMinor, total)

  return transaction(db, () => {
    const createdAt = new Date().toISOString()
    const party = resolveParty(db, input.partyId, input.supplierName)
    const res = db
      .prepare(
        'INSERT INTO purchases (purchase_no, created_at, supplier_name, party_id, note, total_minor, paid_minor) VALUES (?, ?, ?, ?, ?, 0, ?)'
      )
      .run(
        `tmp-${crypto.randomUUID()}`,
        createdAt,
        party.name,
        party.id,
        input.note?.trim() ?? '',
        paid
      )
    const id = Number(res.lastInsertRowid)
    const purchaseNo = `PUR-${String(id).padStart(6, '0')}`
    let grand = 0

    const allSerials = [...merged.values()].flatMap((l) => [
      ...(l.serials ?? []),
      ...(l.serials2 ?? []).filter((x): x is string => !!x)
    ])
    const repeated = allSerials.find((x, i) => allSerials.indexOf(x) !== i)
    if (repeated) throw new Error(`IMEI ${repeated} is entered more than once`)
    for (const {
      productId: existingId,
      newProduct,
      qty,
      total,
      serials,
      serials2,
      condition
    } of merged.values()) {
      // A product typed in on the purchase is created here, inside the same transaction as the stock.
      const p = newProduct
        ? insertProduct(db, { ...newProduct, stockQty: 0 })
        : getProduct(db, existingId as number)
      if (!p || !p.active) throw new Error('A product on this purchase no longer exists')
      const productId = p.id
      if (p.trackSerial && !serials) throw new Error(`Enter the IMEI of every unit of ${p.name}`)
      if (!p.trackSerial && serials)
        throw new Error(
          `${p.name} is not tracked by IMEI: turn on "Track IMEI" on the product first`
        )
      const unit = Math.round(total / qty)
      db.prepare(
        `INSERT INTO purchase_items (purchase_id, product_id, code, name, qty, unit_cost_minor, line_total_minor)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run(id, productId, p.code, p.name, qty, unit, total)
      db.prepare(
        'UPDATE products SET stock_qty = stock_qty + ?, cost_minor = ?, updated_at = ? WHERE id = ?'
      ).run(qty, unit, createdAt, productId)
      recordMovement(db, productId, qty, 'purchase', purchaseNo)
      if (serials)
        insertUnits(db, productId, serials, serials2 ?? [], condition, unit, id, createdAt)
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
  if (input.partyId === undefined && !input.supplierName?.trim())
    throw new Error('Supplier name is required')
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
  const paid = checkPaid(input.paidMinor, input.amountMinor)
  return transaction(db, () => {
    const party = resolveParty(db, input.partyId, input.supplierName)
    const res = db
      .prepare(
        'INSERT INTO purchases (purchase_no, created_at, supplier_name, party_id, note, total_minor, paid_minor) VALUES (?, ?, ?, ?, ?, ?, ?)'
      )
      .run(
        `tmp-${crypto.randomUUID()}`,
        createdAt,
        party.name,
        party.id,
        description,
        input.amountMinor,
        paid
      )
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
  party_id: number | null
  note: string
  total_minor: number
  paid_minor: number
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
    partyId: r.party_id,
    supplierName: r.supplier_name,
    note: r.note,
    totalMinor: r.total_minor,
    paidMinor: r.paid_minor,
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

/** Names of all parties, for quick re-selection. */
export function listSuppliers(db: Db): string[] {
  return (
    db.prepare('SELECT name AS n FROM parties ORDER BY n COLLATE NOCASE').all() as unknown as {
      n: string
    }[]
  ).map((r) => r.n)
}
