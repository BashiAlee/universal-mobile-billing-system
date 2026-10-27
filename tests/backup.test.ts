import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDatabase, SCHEMA_VERSION } from '../src/main/db/database'
import { createProduct, listProducts } from '../src/main/services/products'
import { createBill } from '../src/main/services/bills'
import {
  backupFileName,
  createBackup,
  inspectBackup,
  restoreFile
} from '../src/main/services/backup'

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ubs-backup-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('backup and restore', () => {
  it('names files by local date and time', () => {
    expect(backupFileName(new Date(2026, 9, 27, 9, 5))).toBe('billing-backup-2026-10-27_0905.db')
  })

  it('a backup holds the data, can be inspected, and restoring brings back the old state', () => {
    const live = join(dir, 'billing.db')
    let db = openDatabase(live)
    const p = createProduct(db, { name: 'Pen', priceMinor: 1000, stockQty: 5 })
    createBill(db, { items: [{ productId: p.id, qty: 1 }] })
    const b = createBackup(db, join(dir, 'usb', backupFileName()))
    expect(b.bytes).toBeGreaterThan(0)

    const s = inspectBackup(b.path)
    expect(s).toMatchObject({ products: 1, bills: 1 })

    // Carry on working, then go back to the backup.
    createProduct(db, { name: 'Extra', priceMinor: 1, stockQty: 1 })
    createBill(db, { items: [{ productId: p.id, qty: 2 }] })
    expect(listProducts(db)).toHaveLength(2)
    db.close()
    restoreFile(live, b.path)
    db = openDatabase(live)
    expect(listProducts(db).map((x) => [x.name, x.stockQty])).toEqual([['Pen', 4]])
    expect(existsSync(`${live}.restoring`)).toBe(false)
    db.close()
  })

  it('never overwrites an existing backup', () => {
    const db = openDatabase(join(dir, 'billing.db'))
    const first = createBackup(db, join(dir, 'same.db'))
    const second = createBackup(db, join(dir, 'same.db'))
    expect(second.path).not.toBe(first.path)
    expect(existsSync(first.path) && existsSync(second.path)).toBe(true)
    db.close()
  })

  it('refuses files that are not usable backups, with a clear message', () => {
    expect(() => inspectBackup(join(dir, 'missing.db'))).toThrow(/does not exist/)
    const junk = join(dir, 'junk.db')
    writeFileSync(junk, 'this is not a database at all, just some text '.repeat(50))
    expect(() => inspectBackup(junk)).toThrow(/not a backup of this program/)
    const other = join(dir, 'other.db')
    const o = new DatabaseSync(other)
    o.exec('CREATE TABLE notes (id INTEGER)')
    o.close()
    expect(() => inspectBackup(other)).toThrow(/not a backup of this program/)
  })

  it('refuses a backup made by a newer version of the program', () => {
    const f = join(dir, 'new.db')
    const db = openDatabase(f)
    db.exec(`PRAGMA user_version = ${SCHEMA_VERSION + 1}`)
    db.close()
    expect(() => inspectBackup(f)).toThrow(/newer version/)
  })

  it('an older backup is accepted (the program upgrades it when it opens)', () => {
    const f = join(dir, 'old.db')
    const db = openDatabase(f)
    db.close()
    // Pretend it was made by an older version: the schema is behind and gets upgraded on open.
    const raw = new DatabaseSync(f)
    raw.exec('PRAGMA user_version = 5')
    raw.close()
    expect(inspectBackup(f).products).toBe(0)
  })
})
