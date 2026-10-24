import type { Db } from '../db/database'
import { transaction } from '../db/database'
import type {
  LedgerEntry,
  Party,
  PartyInput,
  PartyLedger,
  PartyPaymentInput
} from '../../shared/types'
import { likePattern, MAX_PRICE_MINOR } from './products'

const MAX_MONEY = MAX_PRICE_MINOR * 1000

interface PartyRow {
  id: number
  name: string
  phone: string
  address: string
  notes: string
  opening_minor: number
  created_at: string
  purchased: number
  paid_on_purchases: number
  payments: number
  last_activity: string | null
}

// Totals are computed from the records every time, so a balance can never drift out of step with them.
const SELECT_PARTY = `
  SELECT p.*,
    COALESCE((SELECT SUM(total_minor) FROM purchases WHERE party_id = p.id), 0) AS purchased,
    COALESCE((SELECT SUM(paid_minor) FROM purchases WHERE party_id = p.id), 0) AS paid_on_purchases,
    COALESCE((SELECT SUM(amount_minor) FROM party_payments WHERE party_id = p.id), 0) AS payments,
    (SELECT MAX(d) FROM (
       SELECT MAX(created_at) AS d FROM purchases WHERE party_id = p.id
       UNION ALL SELECT MAX(created_at) FROM party_payments WHERE party_id = p.id)) AS last_activity
  FROM parties p`

function toParty(r: PartyRow): Party {
  return {
    id: r.id,
    name: r.name,
    phone: r.phone,
    address: r.address,
    notes: r.notes,
    openingMinor: r.opening_minor,
    createdAt: r.created_at,
    purchasedMinor: r.purchased,
    paidMinor: r.paid_on_purchases + r.payments,
    balanceMinor: r.opening_minor + r.purchased - r.paid_on_purchases - r.payments,
    lastActivity: r.last_activity
  }
}

export function getParty(db: Db, id: number): Party | null {
  const r = db.prepare(`${SELECT_PARTY} WHERE p.id = ?`).get(id) as PartyRow | undefined
  return r ? toParty(r) : null
}

export function listParties(db: Db, search = ''): Party[] {
  const like = likePattern(search)
  const rows = db
    .prepare(
      `${SELECT_PARTY} WHERE p.name LIKE ? ESCAPE '\\' OR p.phone LIKE ? ESCAPE '\\' ORDER BY p.name COLLATE NOCASE`
    )
    .all(like, like) as unknown as PartyRow[]
  return rows.map(toParty)
}

/** Finds a party by name (case-insensitive) or creates it. Used when a purchase just names its supplier. */
export function findOrCreateParty(db: Db, name: string): number {
  const n = name.trim()
  if (!n) throw new Error('Supplier name is required')
  const row = db.prepare('SELECT id FROM parties WHERE name = ?').get(n) as
    { id: number } | undefined
  if (row) return row.id
  const res = db
    .prepare('INSERT INTO parties (name, created_at) VALUES (?, ?)')
    .run(n, new Date().toISOString())
  return Number(res.lastInsertRowid)
}

function validate(input: PartyInput): void {
  const name = input.name?.trim()
  if (!name) throw new Error('Party name is required')
  if (name.length > 80) throw new Error('Party name is too long (maximum 80 characters)')
  for (const [label, v] of [
    ['Phone', input.phone],
    ['Address', input.address],
    ['Notes', input.notes]
  ] as const)
    if (v && v.length > 300) throw new Error(`${label} is too long (maximum 300 characters)`)
  const o = input.openingMinor ?? 0
  if (!Number.isInteger(o) || Math.abs(o) > MAX_MONEY)
    throw new Error('Enter a valid opening balance')
}

export function saveParty(db: Db, input: PartyInput): Party {
  validate(input)
  const name = input.name.trim()
  const vals = [
    name,
    input.phone?.trim() ?? '',
    input.address?.trim() ?? '',
    input.notes?.trim() ?? '',
    input.openingMinor ?? 0
  ] as const
  return transaction(db, () => {
    const dupe = db
      .prepare('SELECT id FROM parties WHERE name = ? AND id IS NOT ?')
      .get(name, input.id ?? null)
    if (dupe) throw new Error('A party with that name already exists')
    let id = input.id
    if (id === undefined) {
      id = Number(
        db
          .prepare(
            'INSERT INTO parties (name, phone, address, notes, opening_minor, created_at) VALUES (?, ?, ?, ?, ?, ?)'
          )
          .run(...vals, new Date().toISOString()).lastInsertRowid
      )
    } else {
      const res = db
        .prepare(
          'UPDATE parties SET name = ?, phone = ?, address = ?, notes = ?, opening_minor = ? WHERE id = ?'
        )
        .run(...vals, id)
      if (!res.changes) throw new Error('Party not found')
      // Purchases keep a copy of the name for the history list; keep it in step after a rename.
      db.prepare('UPDATE purchases SET supplier_name = ? WHERE party_id = ?').run(name, id)
    }
    return getParty(db, id)!
  })
}

/** Only a party with no purchases and no payments can be removed; otherwise its history must stay. */
export function deleteParty(db: Db, id: number): void {
  const used =
    (db.prepare('SELECT COUNT(*) AS n FROM purchases WHERE party_id = ?').get(id) as { n: number })
      .n +
    (
      db.prepare('SELECT COUNT(*) AS n FROM party_payments WHERE party_id = ?').get(id) as {
        n: number
      }
    ).n
  if (used) throw new Error('This party has purchases or payments, so it cannot be deleted')
  db.prepare('DELETE FROM parties WHERE id = ?').run(id)
}

function localDay(d = new Date()): string {
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** Money paid to a party after the purchase (settling what we owe). */
export function recordPayment(db: Db, input: PartyPaymentInput): Party {
  if (!getParty(db, input.partyId)) throw new Error('Party not found')
  if (!Number.isInteger(input.amountMinor) || input.amountMinor <= 0)
    throw new Error('Amount must be greater than 0')
  if (input.amountMinor > MAX_MONEY) throw new Error('Amount is too large')
  let day = localDay()
  let createdAt = new Date().toISOString()
  if (input.date) {
    const d = /^\d{4}-\d{2}-\d{2}$/.test(input.date) ? new Date(`${input.date}T12:00:00`) : null
    if (!d || Number.isNaN(d.getTime())) throw new Error('Enter a valid date')
    day = localDay(d)
    createdAt = d.toISOString()
  }
  const note = input.note?.trim() ?? ''
  if (note.length > 300) throw new Error('Note is too long (maximum 300 characters)')
  db.prepare(
    'INSERT INTO party_payments (party_id, amount_minor, day, note, created_at) VALUES (?, ?, ?, ?, ?)'
  ).run(input.partyId, input.amountMinor, day, note, createdAt)
  return getParty(db, input.partyId)!
}

export function deletePayment(db: Db, id: number): void {
  const res = db.prepare('DELETE FROM party_payments WHERE id = ?').run(id)
  if (!res.changes) throw new Error('Payment not found')
}

/** Every purchase and payment of a party in date order, with the running balance after each line. */
export function getLedger(db: Db, partyId: number): PartyLedger {
  const party = getParty(db, partyId)
  if (!party) throw new Error('Party not found')
  const raw: Omit<LedgerEntry, 'balanceAfterMinor'>[] = []
  for (const r of db
    .prepare('SELECT * FROM purchases WHERE party_id = ?')
    .all(partyId) as unknown as {
    id: number
    purchase_no: string
    created_at: string
    note: string
    total_minor: number
    paid_minor: number
  }[]) {
    const items = db
      .prepare('SELECT qty, name FROM purchase_items WHERE purchase_id = ? ORDER BY id')
      .all(r.id) as unknown as { qty: number; name: string }[]
    raw.push({
      kind: 'purchase',
      id: r.id,
      date: r.created_at,
      ref: r.purchase_no,
      description: items.length ? items.map((i) => `${i.qty} ${i.name}`).join(', ') : r.note,
      boughtMinor: r.total_minor,
      paidMinor: r.paid_minor
    })
  }
  for (const r of db
    .prepare('SELECT * FROM party_payments WHERE party_id = ?')
    .all(partyId) as unknown as {
    id: number
    created_at: string
    note: string
    amount_minor: number
  }[])
    raw.push({
      kind: 'payment',
      id: r.id,
      date: r.created_at,
      ref: 'Payment',
      description: r.note,
      boughtMinor: 0,
      paidMinor: r.amount_minor
    })
  raw.sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id)
  let bal = party.openingMinor
  const entries: LedgerEntry[] = []
  if (party.openingMinor !== 0)
    entries.push({
      kind: 'opening',
      id: 0,
      date: party.createdAt,
      ref: 'Opening',
      description: 'Balance before using the app',
      boughtMinor: 0,
      paidMinor: 0,
      balanceAfterMinor: bal
    })
  for (const e of raw) {
    bal += e.boughtMinor - e.paidMinor
    entries.push({ ...e, balanceAfterMinor: bal })
  }
  return { party, entries }
}
