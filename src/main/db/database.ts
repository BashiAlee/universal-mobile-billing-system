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
  `,
  `
  -- Parties (suppliers): who we buy from, what we owe them, and the payments we have made.
  -- Balance = opening + sum(purchase total - paid at purchase) - sum(later payments); positive means we owe them.
  CREATE TABLE parties (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE COLLATE NOCASE,
    phone TEXT NOT NULL DEFAULT '',
    address TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    opening_minor INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );
  CREATE TABLE party_payments (
    id INTEGER PRIMARY KEY,
    party_id INTEGER NOT NULL REFERENCES parties(id),
    amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
    day TEXT NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
  );
  CREATE INDEX idx_party_payments_party ON party_payments(party_id);
  ALTER TABLE purchases ADD COLUMN party_id INTEGER REFERENCES parties(id);
  ALTER TABLE purchases ADD COLUMN paid_minor INTEGER NOT NULL DEFAULT 0;
  CREATE INDEX idx_purchases_party ON purchases(party_id);
  -- Purchases made before parties existed were treated as fully paid, so every balance starts at zero.
  UPDATE purchases SET paid_minor = total_minor;
  INSERT INTO parties (name, created_at)
    SELECT supplier_name, MIN(created_at) FROM purchases GROUP BY supplier_name COLLATE NOCASE;
  UPDATE purchases SET party_id = (SELECT id FROM parties WHERE parties.name = purchases.supplier_name);
  `,
  `
  -- Product details (phones, covers, ...) and per-unit IMEI / serial tracking.
  ALTER TABLE products ADD COLUMN category TEXT NOT NULL DEFAULT '';
  ALTER TABLE products ADD COLUMN brand TEXT NOT NULL DEFAULT '';
  ALTER TABLE products ADD COLUMN model TEXT NOT NULL DEFAULT '';
  ALTER TABLE products ADD COLUMN storage TEXT NOT NULL DEFAULT '';
  ALTER TABLE products ADD COLUMN ram TEXT NOT NULL DEFAULT '';
  ALTER TABLE products ADD COLUMN color TEXT NOT NULL DEFAULT '';
  ALTER TABLE products ADD COLUMN compatible_with TEXT NOT NULL DEFAULT '';
  ALTER TABLE products ADD COLUMN track_serial INTEGER NOT NULL DEFAULT 0;
  -- One row per physical unit of a tracked product. products.stock_qty stays equal to the in-stock count.
  CREATE TABLE serial_units (
    id INTEGER PRIMARY KEY,
    product_id INTEGER NOT NULL REFERENCES products(id),
    serial TEXT NOT NULL UNIQUE,
    condition TEXT NOT NULL DEFAULT 'new' CHECK (condition IN ('new', 'used')),
    cost_minor INTEGER NOT NULL DEFAULT 0,
    purchase_id INTEGER REFERENCES purchases(id),
    status TEXT NOT NULL DEFAULT 'in_stock' CHECK (status IN ('in_stock', 'sold')),
    bill_item_id INTEGER REFERENCES bill_items(id),
    created_at TEXT NOT NULL,
    sold_at TEXT
  );
  CREATE INDEX idx_serial_units_product ON serial_units(product_id, status);
  `,
  `
  -- Dual-SIM phones have a second IMEI. It identifies the same unit and must be unique too.
  ALTER TABLE serial_units ADD COLUMN serial2 TEXT;
  CREATE UNIQUE INDEX idx_serial_units_serial2 ON serial_units(serial2) WHERE serial2 IS NOT NULL;
  `,
  `
  -- Logins: one row per person who may use the program. Passwords are stored only as salted scrypt hashes.
  CREATE TABLE users (
    id INTEGER PRIMARY KEY,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  -- Who made each bill (the username at the time; blank for bills made before logins existed).
  ALTER TABLE bills ADD COLUMN created_by TEXT NOT NULL DEFAULT '';
  `,
  `
  -- Customer returns and exchanges. A return refunds part or all of a bill without deleting it.
  -- Amounts are fixed when the return is made: net = value without tax, refund = what goes back to the customer.
  CREATE TABLE returns (
    id INTEGER PRIMARY KEY,
    return_no TEXT NOT NULL UNIQUE,
    bill_id INTEGER NOT NULL REFERENCES bills(id),
    created_at TEXT NOT NULL,
    net_minor INTEGER NOT NULL,
    tax_minor INTEGER NOT NULL,
    refund_minor INTEGER NOT NULL,
    refund_method TEXT NOT NULL CHECK (refund_method IN ('cash', 'card', 'mobile', 'credit', 'exchange')),
    restocked INTEGER NOT NULL,
    restocked_cost_minor INTEGER NOT NULL,
    reason TEXT NOT NULL DEFAULT '',
    created_by TEXT NOT NULL DEFAULT ''
  );
  CREATE INDEX idx_returns_bill ON returns(bill_id);
  CREATE INDEX idx_returns_created ON returns(created_at);
  CREATE TABLE return_items (
    id INTEGER PRIMARY KEY,
    return_id INTEGER NOT NULL REFERENCES returns(id),
    bill_item_id INTEGER NOT NULL REFERENCES bill_items(id),
    product_id INTEGER REFERENCES products(id),
    code TEXT NOT NULL,
    name TEXT NOT NULL,
    serial TEXT,
    serial2 TEXT,
    qty INTEGER NOT NULL CHECK (qty > 0),
    unit_price_minor INTEGER NOT NULL,
    net_minor INTEGER NOT NULL,
    tax_minor INTEGER NOT NULL,
    refund_minor INTEGER NOT NULL,
    unit_cost_minor INTEGER NOT NULL
  );
  CREATE INDEX idx_return_items_bill_item ON return_items(bill_item_id);
  `,
  `
  -- Discount given on one bill line (an amount for the whole line). line_total_minor is the price AFTER this discount,
  -- so every total built from lines (sales per product, day book, reports) is automatically net of it.
  ALTER TABLE bill_items ADD COLUMN discount_minor INTEGER NOT NULL DEFAULT 0;
  `
]

/** The schema version this program creates and understands. */
export const SCHEMA_VERSION = MIGRATIONS.length

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
