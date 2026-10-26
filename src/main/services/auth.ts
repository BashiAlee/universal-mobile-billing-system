import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import type { Db } from '../db/database'
import { transaction } from '../db/database'
import type { AppUser } from '../../shared/types'

const MIN_PASSWORD = 6
const MAX_PASSWORD = 200

/** Salted scrypt hash, stored as "scrypt$<salt>$<hash>" (base64). The password itself is never stored. */
export function hashPassword(password: string): string {
  const salt = randomBytes(16)
  const hash = scryptSync(password, salt, 64)
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`
}

export function verifyPassword(password: string, stored: string): boolean {
  const [kind, salt, hash] = stored.split('$')
  if (kind !== 'scrypt' || !salt || !hash) return false
  const expected = Buffer.from(hash, 'base64')
  const actual = scryptSync(password, Buffer.from(salt, 'base64'), expected.length)
  return timingSafeEqual(actual, expected)
}

export function validateUsername(username: unknown): string {
  const u = typeof username === 'string' ? username.trim() : ''
  if (!/^[A-Za-z0-9._-]{3,30}$/.test(u))
    throw new Error('Username must be 3-30 letters, digits, dots, dashes or underscores')
  return u
}

export function validatePassword(password: unknown): string {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD)
    throw new Error(`Password must be at least ${MIN_PASSWORD} characters`)
  if (password.length > MAX_PASSWORD) throw new Error('Password is too long')
  return password
}

interface UserRow {
  id: number
  username: string
  password_hash: string
  created_at: string
}

const toUser = (r: UserRow): AppUser => ({
  id: r.id,
  username: r.username,
  createdAt: r.created_at
})

export function countUsers(db: Db): number {
  return (db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n
}

export function listUsers(db: Db): AppUser[] {
  return (
    db.prepare('SELECT * FROM users ORDER BY username COLLATE NOCASE').all() as unknown as UserRow[]
  ).map(toUser)
}

export function createUser(db: Db, username: string, password: string): AppUser {
  const name = validateUsername(username)
  validatePassword(password)
  if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(name))
    throw new Error('That username is already used')
  const res = db
    .prepare('INSERT INTO users (username, password_hash, created_at) VALUES (?, ?, ?)')
    .run(name, hashPassword(password), new Date().toISOString())
  return toUser(
    db
      .prepare('SELECT * FROM users WHERE id = ?')
      .get(Number(res.lastInsertRowid)) as unknown as UserRow
  )
}

/** Returns the user when the username and password match, otherwise null (never says which one was wrong). */
export function authenticate(db: Db, username: string, password: string): AppUser | null {
  const r = db.prepare('SELECT * FROM users WHERE username = ?').get(String(username).trim()) as
    UserRow | undefined
  // Hash even for an unknown name so the answer takes about as long either way.
  const ok = verifyPassword(
    String(password),
    r?.password_hash ?? 'scrypt$AAAAAAAAAAAAAAAAAAAAAA==$AAAA'
  )
  return r && ok ? toUser(r) : null
}

export function setPassword(db: Db, userId: number, password: string): void {
  validatePassword(password)
  const res = db
    .prepare('UPDATE users SET password_hash = ? WHERE id = ?')
    .run(hashPassword(password), userId)
  if (!res.changes) throw new Error('User not found')
}

/** Removes a login. You cannot delete yourself or the last remaining user (that would lock everyone out). */
export function deleteUser(db: Db, id: number, actingUserId: number): void {
  if (id === actingUserId) throw new Error('You cannot delete the account you are signed in with')
  if (countUsers(db) <= 1) throw new Error('The last user cannot be deleted')
  const res = db.prepare('DELETE FROM users WHERE id = ?').run(id)
  if (!res.changes) throw new Error('User not found')
}

// ---- Recovery code: lets the owner set a new password if every password is forgotten. ----

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // no 0/O/1/I to avoid misreading

function newRecoveryCode(): string {
  const bytes = randomBytes(16)
  const chars = Array.from(bytes, (b) => CODE_CHARS[b % CODE_CHARS.length]).join('')
  return chars.match(/.{4}/g)!.join('-')
}

const normalizeCode = (code: string): string =>
  String(code)
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')

function storeRecoveryCode(db: Db): string {
  const code = newRecoveryCode()
  db.prepare(
    "INSERT INTO settings (key, value) VALUES ('recoveryHash', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  ).run(hashPassword(normalizeCode(code)))
  return code
}

/** Creates the very first account and its one-time recovery code. Only allowed while there are no users. */
export function createFirstUser(
  db: Db,
  username: string,
  password: string
): { user: AppUser; recoveryCode: string } {
  return transaction(db, () => {
    if (countUsers(db) > 0) throw new Error('An account already exists')
    const user = createUser(db, username, password)
    return { user, recoveryCode: storeRecoveryCode(db) }
  })
}

/** Sets a new password for `username` when the recovery code is right. The code is replaced by a new one. */
export function recoverAccess(
  db: Db,
  username: string,
  code: string,
  newPassword: string
): { recoveryCode: string } {
  validatePassword(newPassword)
  const stored = db.prepare("SELECT value FROM settings WHERE key = 'recoveryHash'").get() as
    { value: string } | undefined
  const user = db
    .prepare('SELECT id FROM users WHERE username = ?')
    .get(String(username).trim()) as { id: number } | undefined
  const ok = verifyPassword(
    normalizeCode(code),
    stored?.value ?? 'scrypt$AAAAAAAAAAAAAAAAAAAAAA==$AAAA'
  )
  if (!stored || !user || !ok) throw new Error('That username or recovery code is not right')
  return transaction(db, () => {
    setPassword(db, user.id, newPassword)
    return { recoveryCode: storeRecoveryCode(db) }
  })
}
