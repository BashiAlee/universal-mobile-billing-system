import { DatabaseSync } from 'node:sqlite'

export type Db = DatabaseSync

/** Each entry upgrades the schema by one version. Never edit a shipped migration; append a new one. */
const MIGRATIONS: string[] = [
  `
  CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  CREATE TABLE products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    price_minor INTEGER NOT NULL CHECK (price_minor >= 0),
    cost_minor INTEGER NOT NULL DEFAULT 0 CHECK (cost_minor >= 0),
    stock_qty INTEGER NOT NULL DEFAULT 0,
    low_stock_threshold INTEGER NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE stock_movements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL REFERENCES products(id),
    delta INTEGER NOT NULL,
    reason TEXT NOT NULL,
    ref TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
  );
  CREATE INDEX idx_stock_movements_product ON stock_movements(product_id);
  CREATE TABLE bills (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    bill_no TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL,
    subtotal_minor INTEGER NOT NULL,
    discount_minor INTEGER NOT NULL,
    tax_minor INTEGER NOT NULL,
    total_minor INTEGER NOT NULL,
    payment_method TEXT NOT NULL,
    customer_name TEXT NOT NULL DEFAULT ''
  );
  CREATE TABLE bill_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    bill_id INTEGER NOT NULL REFERENCES bills(id),
    product_id INTEGER REFERENCES products(id),
    code TEXT NOT NULL,
    name TEXT NOT NULL,
    unit_price_minor INTEGER NOT NULL,
    qty INTEGER NOT NULL CHECK (qty > 0),
    line_total_minor INTEGER NOT NULL
  );
  CREATE INDEX idx_bill_items_bill ON bill_items(bill_id);
  `,
  `
  CREATE TABLE purchases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    purchase_no TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL,
    supplier_name TEXT NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    total_minor INTEGER NOT NULL
  );
  CREATE TABLE purchase_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    purchase_id INTEGER NOT NULL REFERENCES purchases(id),
    product_id INTEGER REFERENCES products(id),
    code TEXT NOT NULL,
    name TEXT NOT NULL,
    qty INTEGER NOT NULL CHECK (qty > 0),
    unit_cost_minor INTEGER NOT NULL,
    line_total_minor INTEGER NOT NULL CHECK (line_total_minor >= 0)
  );
  CREATE INDEX idx_purchase_items_purchase ON purchase_items(purchase_id);
  `,
  `
  ALTER TABLE bills ADD COLUMN tendered_minor INTEGER NOT NULL DEFAULT 0;
  `,
  `
  -- Cost of each unit at the moment of sale, so profit stays correct when cost prices change later.
  -- Bills made before this version are backfilled with the product's current cost (an approximation).
  ALTER TABLE bill_items ADD COLUMN unit_cost_minor INTEGER NOT NULL DEFAULT 0;
  UPDATE bill_items SET unit_cost_minor =
    COALESCE((SELECT cost_minor FROM products WHERE products.id = bill_items.product_id), 0);
  CREATE INDEX idx_bills_created ON bills(created_at);
  `,
  `
  -- Day book: shop expenses per local day, plus a manual opening balance and free-text notes per day.
  CREATE TABLE expenses (
    id INTEGER PRIMARY KEY,
    day TEXT NOT NULL,
    title TEXT NOT NULL,
    amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
    created_at TEXT NOT NULL
  );
  CREATE INDEX idx_expenses_day ON expenses(day);
  CREATE TABLE day_book (
    day TEXT PRIMARY KEY,
    opening_minor INTEGER,
    notes TEXT NOT NULL DEFAULT ''
  );
  `,
  `
  -- Label designer: named product-label layouts. Elements are a JSON list of boxes positioned in millimetres.
  CREATE TABLE label_designs (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE COLLATE NOCASE,
    width_mm REAL NOT NULL,
    height_mm REAL NOT NULL,
    code_type TEXT NOT NULL,
    elements TEXT NOT NULL,
    is_default INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );
  `
]

export function openDatabase(path: string): Db {
  const db = new DatabaseSync(path)
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;')
  migrate(db)
  return db
}

/** Upgrades to the latest schema (or to `target`, which lets tests exercise an upgrade from an older version). */
export function migrate(db: Db, target = MIGRATIONS.length): void {
  const row = db.prepare('PRAGMA user_version').get() as { user_version: number }
  for (let v = row.user_version; v < target; v++) {
    db.exec('BEGIN')
    try {
      db.exec(MIGRATIONS[v])
      db.exec(`PRAGMA user_version = ${v + 1}`)
      db.exec('COMMIT')
    } catch (e) {
      db.exec('ROLLBACK')
      throw e
    }
  }
}

/** Runs fn inside a transaction; rolls back and rethrows on error. */
export function transaction<T>(db: Db, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE')
  try {
    const out = fn()
    db.exec('COMMIT')
    return out
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }
}
