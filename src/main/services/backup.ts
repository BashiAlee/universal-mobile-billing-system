import { DatabaseSync } from 'node:sqlite'
import { copyFileSync, existsSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { Db } from '../db/database'
import { SCHEMA_VERSION } from '../db/database'
import type { BackupSummary } from '../../shared/types'

const pad = (n: number): string => String(n).padStart(2, '0')

/** billing-backup-2026-10-27_1130.db (local time), so backups sort by date. */
export function backupFileName(d = new Date()): string {
  return `billing-backup-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}.db`
}

/**
 * Writes a complete, consistent copy of the live database to `dest` (works while the program is running).
 * Never overwrites: if the name exists, a number is added.
 */
export function createBackup(db: Db, dest: string): { path: string; bytes: number } {
  mkdirSync(dirname(dest), { recursive: true })
  let path = dest
  for (let i = 2; existsSync(path); i++) path = dest.replace(/(\.db)?$/, `-${i}$1`)
  db.exec(`VACUUM INTO '${path.replace(/'/g, "''")}'`)
  return { path, bytes: statSync(path).size }
}

/** Opens a chosen file read-only and checks it really is a backup this program version can use. */
export function inspectBackup(path: string): BackupSummary {
  if (!existsSync(path)) throw new Error('That file does not exist')
  let src: DatabaseSync | null = null
  try {
    src = new DatabaseSync(path, { readOnly: true })
    const ok = src.prepare('PRAGMA integrity_check').get() as { integrity_check: string }
    if (ok.integrity_check !== 'ok') throw new Error('That backup file is damaged')
    const tables = (
      src.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]
    ).map((t) => t.name)
    if (!['products', 'bills', 'settings'].every((t) => tables.includes(t)))
      throw new Error('That file is not a backup of this program')
    const version = (src.prepare('PRAGMA user_version').get() as { user_version: number })
      .user_version
    if (version > SCHEMA_VERSION)
      throw new Error(
        'That backup was made by a newer version of the program. Update the program first.'
      )
    const count = (t: string): number =>
      tables.includes(t)
        ? (src!.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n
        : 0
    const shop = src.prepare("SELECT value FROM settings WHERE key = 'shopName'").get() as
      { value: string } | undefined
    const last = tables.includes('bills')
      ? (src.prepare('SELECT MAX(created_at) AS d FROM bills').get() as { d: string | null }).d
      : null
    return {
      file: path,
      shopName: shop?.value ?? '',
      products: count('products'),
      bills: count('bills'),
      users: count('users'),
      lastBillAt: last,
      savedAt: statSync(path).mtime.toISOString()
    }
  } catch (e) {
    if (e instanceof Error && /file is not a database|malformed|encrypted/i.test(e.message))
      throw new Error('That file is not a backup of this program', { cause: e })
    throw e
  } finally {
    src?.close()
  }
}

/** Replaces the database file with the backup. The live database must already be closed. */
export function restoreFile(livePath: string, srcPath: string): void {
  const tmp = `${livePath}.restoring`
  copyFileSync(srcPath, tmp)
  for (const ext of ['-wal', '-shm']) rmSync(`${livePath}${ext}`, { force: true })
  renameSync(tmp, livePath)
}

export const safetyCopyPath = (userDataDir: string, d = new Date()): string =>
  join(userDataDir, 'backups', backupFileName(d).replace('billing-backup-', 'before-restore-'))
