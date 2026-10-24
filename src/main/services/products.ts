import type { Db } from '../db/database'
import { transaction } from '../db/database'
import type { Product, ProductInput, StockMovement, StockReason } from '../../shared/types'

interface ProductRow {
  id: number
  code: string
  name: string
  price_minor: number
  cost_minor: number
  stock_qty: number
  low_stock_threshold: number
  active: number
  created_at: string
  updated_at: string
  category: string
  brand: string
  model: string
  storage: string
  ram: string
  color: string
  compatible_with: string
  track_serial: number
}

export function toProduct(r: ProductRow): Product {
  return {
    id: r.id,
    code: r.code,
    name: r.name,
    priceMinor: r.price_minor,
    costMinor: r.cost_minor,
    stockQty: r.stock_qty,
    lowStockThreshold: r.low_stock_threshold,
    active: r.active === 1,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    category: r.category,
    brand: r.brand,
    model: r.model,
    storage: r.storage,
    ram: r.ram,
    color: r.color,
    compatibleWith: r.compatible_with,
    trackSerial: r.track_serial === 1
  }
}

const DETAIL_KEYS = [
  'category',
  'brand',
  'model',
  'storage',
  'ram',
  'color',
  'compatibleWith'
] as const

/** The name typed by the user, or (when left empty) one built from the details: "Samsung A15 6/128 Black". */
export function resolveName(input: ProductInput): string {
  const typed = input.name?.trim()
  if (typed) return typed
  const memory = [input.ram?.trim(), input.storage?.trim()].filter(Boolean).join('/')
  return [input.brand?.trim(), input.model?.trim(), memory, input.color?.trim()]
    .filter(Boolean)
    .join(' ')
}

function details(input: ProductInput): string[] {
  return DETAIL_KEYS.map((k) => input[k]?.trim() ?? '')
}

const now = (): string => new Date().toISOString()

/** Safety limits so amounts and quantities can never overflow JS safe integers when multiplied and summed. */
export const MAX_PRICE_MINOR = 1_000_000_000 // 10,000,000.00
export const MAX_QTY = 1_000_000

/** Builds a LIKE pattern that treats % and _ in the user's text literally (use with ESCAPE '\\'). */
export function likePattern(search: string): string {
  return `%${search.trim().replace(/[\\%_]/g, '\\$&')}%`
}

function assertInt(
  n: unknown,
  label: string,
  min = 0,
  max = Number.MAX_SAFE_INTEGER
): asserts n is number {
  if (typeof n !== 'number' || !Number.isInteger(n) || n < min)
    throw new Error(`${label} must be a whole number >= ${min}`)
  if (n > max) throw new Error(`${label} is too large (maximum ${max.toLocaleString('en-US')})`)
}

function validate(input: ProductInput): void {
  if (!resolveName(input)) throw new Error('Product name is required')
  for (const k of DETAIL_KEYS) {
    const v = input[k]
    if (v !== undefined && (typeof v !== 'string' || v.length > 60))
      throw new Error(`${k} is too long (maximum 60 characters)`)
  }
  assertInt(input.priceMinor, 'Price', 0, MAX_PRICE_MINOR)
  if (input.costMinor !== undefined) assertInt(input.costMinor, 'Cost', 0, MAX_PRICE_MINOR)
  if (input.stockQty !== undefined) assertInt(input.stockQty, 'Stock', 0, MAX_QTY)
  if (input.lowStockThreshold !== undefined)
    assertInt(input.lowStockThreshold, 'Low-stock threshold', 0, MAX_QTY)
}

function recordMovement(
  db: Db,
  productId: number,
  delta: number,
  reason: StockReason,
  ref = ''
): void {
  db.prepare(
    'INSERT INTO stock_movements (product_id, delta, reason, ref, created_at) VALUES (?, ?, ?, ?, ?)'
  ).run(productId, delta, reason, ref, now())
}

/** Exported so the billing service can reuse the same audit trail. */
export { recordMovement }

export function createProduct(db: Db, input: ProductInput): Product {
  return transaction(db, () => insertProduct(db, input))
}

/** Same as createProduct but without its own transaction, so a caller (e.g. a purchase) can include it in theirs. */
export function insertProduct(db: Db, input: ProductInput): Product {
  validate(input)
  const code = input.code?.trim()
  if (input.trackSerial && (input.stockQty ?? 0) > 0)
    throw new Error('IMEI-tracked products start with 0 stock; add the units by IMEI in a purchase')
  {
    const t = now()
    // Temporary unique code is replaced by the generated P-000123 style code when none was supplied.
    const res = db
      .prepare(
        `INSERT INTO products (code, name, price_minor, cost_minor, stock_qty, low_stock_threshold, active, created_at, updated_at,
           category, brand, model, storage, ram, color, compatible_with, track_serial)
         VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        code || `tmp-${crypto.randomUUID()}`,
        resolveName(input),
        input.priceMinor,
        input.costMinor ?? 0,
        input.stockQty ?? 0,
        input.lowStockThreshold ?? 0,
        t,
        t,
        ...details(input),
        input.trackSerial ? 1 : 0
      )
    const id = Number(res.lastInsertRowid)
    if (!code)
      db.prepare('UPDATE products SET code = ? WHERE id = ?').run(
        `P-${String(id).padStart(6, '0')}`,
        id
      )
    if ((input.stockQty ?? 0) > 0) recordMovement(db, id, input.stockQty ?? 0, 'initial')
    return getProduct(db, id)!
  }
}

export function getProduct(db: Db, id: number): Product | null {
  const r = db.prepare('SELECT * FROM products WHERE id = ?').get(id) as ProductRow | undefined
  return r ? toProduct(r) : null
}

export function getProductByCode(db: Db, code: string): Product | null {
  const r = db.prepare('SELECT * FROM products WHERE code = ? AND active = 1').get(code.trim()) as
    ProductRow | undefined
  return r ? toProduct(r) : null
}

const SEARCH_COLUMNS = [
  'name',
  'code',
  'category',
  'brand',
  'model',
  'storage',
  'ram',
  'color',
  'compatible_with'
]

/** Every word typed must match somewhere (name, code, details or an IMEI), so "A15 128" finds Samsung A15 6/128. */
export function listProducts(db: Db, search = '', includeInactive = false): Product[] {
  const words = search.trim().split(/\s+/).filter(Boolean)
  const where: string[] = includeInactive ? [] : ['active = 1']
  const args: string[] = []
  for (const w of words.length ? words : ['']) {
    const like = likePattern(w)
    where.push(
      `(${SEARCH_COLUMNS.map((c) => `${c} LIKE ? ESCAPE '\\'`).join(' OR ')}
        OR EXISTS (SELECT 1 FROM serial_units u WHERE u.product_id = products.id AND (u.serial LIKE ? ESCAPE '\\' OR u.serial2 LIKE ? ESCAPE '\\')))`
    )
    args.push(...SEARCH_COLUMNS.map(() => like), like, like)
  }
  const rows = db
    .prepare(`SELECT * FROM products WHERE ${where.join(' AND ')} ORDER BY name COLLATE NOCASE`)
    .all(...args) as unknown as ProductRow[]
  return rows.map(toProduct)
}

export function updateProduct(db: Db, id: number, input: Omit<ProductInput, 'stockQty'>): Product {
  validate(input)
  const existing = getProduct(db, id)
  if (!existing) throw new Error('Product not found')
  const track = input.trackSerial ?? existing.trackSerial
  // Switching IMEI tracking on or off is only safe while there is no stock to account for.
  if (track !== existing.trackSerial && existing.stockQty > 0)
    throw new Error('Change IMEI tracking only when the product has 0 stock')
  db.prepare(
    `UPDATE products SET code = ?, name = ?, price_minor = ?, cost_minor = ?, low_stock_threshold = ?, updated_at = ?,
       category = ?, brand = ?, model = ?, storage = ?, ram = ?, color = ?, compatible_with = ?, track_serial = ? WHERE id = ?`
  ).run(
    input.code?.trim() || existing.code,
    resolveName(input),
    input.priceMinor,
    input.costMinor ?? existing.costMinor,
    input.lowStockThreshold ?? existing.lowStockThreshold,
    now(),
    ...details(input),
    track ? 1 : 0,
    id
  )
  return getProduct(db, id)!
}

/** Soft-delete: keeps history of past bills intact. */
export function deactivateProduct(db: Db, id: number): void {
  db.prepare('UPDATE products SET active = 0, updated_at = ? WHERE id = ?').run(now(), id)
}

export function adjustStock(
  db: Db,
  id: number,
  delta: number,
  reason: StockReason,
  ref = ''
): Product {
  if (!Number.isInteger(delta) || delta === 0 || Math.abs(delta) > MAX_QTY)
    throw new Error(
      `Stock change must be a non-zero whole number up to ${MAX_QTY.toLocaleString('en-US')}`
    )
  return transaction(db, () => {
    const p = getProduct(db, id)
    if (!p || !p.active) throw new Error('Product not found')
    if (p.trackSerial)
      throw new Error(
        `${p.name} is tracked by IMEI: add units in a purchase and sell them on a bill`
      )
    if (p.stockQty + delta > MAX_QTY) throw new Error('Resulting stock is too large')
    if (p.stockQty + delta < 0)
      throw new Error(`Not enough stock for ${p.name} (have ${p.stockQty})`)
    db.prepare('UPDATE products SET stock_qty = stock_qty + ?, updated_at = ? WHERE id = ?').run(
      delta,
      now(),
      id
    )
    recordMovement(db, id, delta, reason, ref)
    return getProduct(db, id)!
  })
}

export function lowStockProducts(db: Db): Product[] {
  const rows = db
    .prepare(
      'SELECT * FROM products WHERE active = 1 AND stock_qty <= low_stock_threshold ORDER BY stock_qty'
    )
    .all() as unknown as ProductRow[]
  return rows.map(toProduct)
}

export function listMovements(db: Db, productId: number): StockMovement[] {
  const rows = db
    .prepare('SELECT * FROM stock_movements WHERE product_id = ? ORDER BY id DESC')
    .all(productId) as unknown as {
    id: number
    product_id: number
    delta: number
    reason: StockReason
    ref: string
    created_at: string
  }[]
  return rows.map((r) => ({
    id: r.id,
    productId: r.product_id,
    delta: r.delta,
    reason: r.reason,
    ref: r.ref,
    createdAt: r.created_at
  }))
}
