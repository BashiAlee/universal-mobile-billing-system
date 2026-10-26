import { describe, it, expect } from 'vitest'
import { memoryDb } from './helpers'
import {
  authenticate,
  countUsers,
  createFirstUser,
  createUser,
  deleteUser,
  hashPassword,
  listUsers,
  recoverAccess,
  setPassword,
  verifyPassword
} from '../src/main/services/auth'
import { Session } from '../src/main/session'
import { createBill } from '../src/main/services/bills'
import { createProduct } from '../src/main/services/products'

describe('passwords', () => {
  it('are stored only as salted hashes and verified correctly', () => {
    const h = hashPassword('secret1')
    expect(h).not.toContain('secret1')
    expect(h).not.toBe(hashPassword('secret1')) // random salt
    expect(verifyPassword('secret1', h)).toBe(true)
    expect(verifyPassword('secret2', h)).toBe(false)
    expect(verifyPassword('x', 'garbage')).toBe(false)
  })
})

describe('users', () => {
  it('the first account is created once, with a recovery code', () => {
    const db = memoryDb()
    expect(countUsers(db)).toBe(0)
    const { user, recoveryCode } = createFirstUser(db, 'owner', 'password1')
    expect(user.username).toBe('owner')
    expect(recoveryCode).toMatch(/^[A-Z2-9]{4}(-[A-Z2-9]{4}){3}$/)
    expect(() => createFirstUser(db, 'other', 'password1')).toThrow(/already exists/)
    // The stored password and recovery code are hashes.
    const raw = db.prepare('SELECT password_hash FROM users').get() as { password_hash: string }
    expect(raw.password_hash.startsWith('scrypt$')).toBe(true)
  })
  it('checks username and password rules; names are unique ignoring case', () => {
    const db = memoryDb()
    createUser(db, 'Ali', 'abcdef')
    expect(() => createUser(db, 'ali', 'abcdef')).toThrow(/already used/)
    expect(() => createUser(db, 'a', 'abcdef')).toThrow(/Username/)
    expect(() => createUser(db, 'bad name', 'abcdef')).toThrow(/Username/)
    expect(() => createUser(db, 'bob', '123')).toThrow(/at least 6/)
  })
  it('login accepts the right password (any letter case in the name) and refuses wrong ones', () => {
    const db = memoryDb()
    createUser(db, 'Ali', 'abcdef')
    expect(authenticate(db, 'ali', 'abcdef')?.username).toBe('Ali')
    expect(authenticate(db, 'Ali', 'abcdeX')).toBeNull()
    expect(authenticate(db, 'nobody', 'abcdef')).toBeNull()
  })
  it('each person has their own password; resetting one leaves the others alone', () => {
    const db = memoryDb()
    const a = createUser(db, 'ali', 'aaaaaa')
    createUser(db, 'sara', 'ssssss')
    setPassword(db, a.id, 'new-pass')
    expect(authenticate(db, 'ali', 'aaaaaa')).toBeNull()
    expect(authenticate(db, 'ali', 'new-pass')).not.toBeNull()
    expect(authenticate(db, 'sara', 'ssssss')).not.toBeNull()
    expect(() => setPassword(db, 999, 'abcdef')).toThrow(/not found/)
  })
  it('cannot delete yourself or the last user', () => {
    const db = memoryDb()
    const a = createUser(db, 'ali', 'aaaaaa')
    const b = createUser(db, 'sara', 'ssssss')
    expect(() => deleteUser(db, a.id, a.id)).toThrow(/signed in with/)
    deleteUser(db, b.id, a.id)
    expect(listUsers(db).map((u) => u.username)).toEqual(['ali'])
    const c = createUser(db, 'zed', 'zzzzzz')
    deleteUser(db, a.id, c.id)
    expect(() => deleteUser(db, c.id, 999)).toThrow(/last user/)
  })
})

describe('recovery code', () => {
  it('sets a new password and is replaced by a new code; wrong details are refused', () => {
    const db = memoryDb()
    const { recoveryCode } = createFirstUser(db, 'owner', 'password1')
    expect(() => recoverAccess(db, 'owner', 'AAAA-BBBB-CCCC-DDDD', 'newpass1')).toThrow(/not right/)
    expect(() => recoverAccess(db, 'nobody', recoveryCode, 'newpass1')).toThrow(/not right/)
    expect(() => recoverAccess(db, 'owner', recoveryCode, 'x')).toThrow(/at least 6/)
    const next = recoverAccess(
      db,
      'owner',
      recoveryCode.toLowerCase().replace(/-/g, ' '),
      'newpass1'
    )
    expect(authenticate(db, 'owner', 'newpass1')).not.toBeNull()
    expect(authenticate(db, 'owner', 'password1')).toBeNull()
    expect(next.recoveryCode).not.toBe(recoveryCode)
    expect(() => recoverAccess(db, 'owner', recoveryCode, 'again123')).toThrow(/not right/)
  })
})

describe('session', () => {
  const user = { id: 1, username: 'ali', createdAt: '' }
  it('signs out after the idle time and activity keeps it alive', () => {
    let t = 1000
    const s = new Session(600, () => t)
    expect(s.current()).toBeNull()
    s.login(user)
    t += 500
    s.touch()
    t += 500
    expect(s.current()?.username).toBe('ali') // 500 ms since the last activity
    t += 700
    expect(s.current()).toBeNull() // idle for too long
    s.touch() // a signed-out session cannot be revived by activity
    expect(s.current()).toBeNull()
  })
  it('locks a username for 30 seconds after 5 wrong passwords', () => {
    let t = 0
    const s = new Session(600, () => t)
    for (let i = 0; i < 4; i++) s.recordFailure('Ali')
    expect(s.lockedFor('ali')).toBe(0)
    s.recordFailure('ali')
    expect(s.lockedFor('ALI')).toBe(30)
    t += 31_000
    expect(s.lockedFor('ali')).toBe(0)
    s.recordFailure('ali')
    s.recordSuccess('ali')
    expect(s.lockedFor('ali')).toBe(0)
  })
})

describe('bills remember who made them', () => {
  it('stores the username, blank when none is given', () => {
    const db = memoryDb()
    const p = createProduct(db, { name: 'A', priceMinor: 100, stockQty: 5 })
    const items = [{ productId: p.id, qty: 1 }]
    expect(createBill(db, { items }, 'sara').createdBy).toBe('sara')
    expect(createBill(db, { items }).createdBy).toBe('')
  })
})
