import type { Db } from '../db/database'
import type { DayBook, DayBookSave, Expense, ExpenseInput } from '../../shared/types'

const MAX_MINOR = 1_000_000_000_000
const LOCAL_DAY = `strftime('%Y-%m-%d', created_at, 'localtime')`

function checkDay(day: string): string {
  const ok = /^\d{4}-\d{2}-\d{2}$/.test(day) && !Number.isNaN(new Date(`${day}T00:00:00`).getTime())
  if (!ok) throw new Error('Enter a valid date')
  return day
}

function checkAmount(n: unknown, what: string): number {
  if (typeof n !== 'number' || !Number.isInteger(n) || n < 0 || n > MAX_MINOR)
    throw new Error(`${what} must be a valid amount`)
  return n
}

type Sums = { day: string; v: number }[]

/** Balance carried into `day`: the latest typed-in opening balance plus every day's takings minus expenses since. */
function carriedIn(db: Db, day: string): number {
  const received = db
    .prepare(
      `SELECT ${LOCAL_DAY} AS day, SUM(total_minor) AS v FROM bills
       WHERE payment_method != 'credit' GROUP BY day HAVING day < ?`
    )
    .all(day) as unknown as Sums
  const spent = db
    .prepare('SELECT day, SUM(amount_minor) AS v FROM expenses WHERE day < ? GROUP BY day')
    .all(day) as unknown as Sums
  const manual = db
    .prepare(
      'SELECT day, opening_minor AS v FROM day_book WHERE opening_minor IS NOT NULL AND day < ?'
    )
    .all(day) as unknown as Sums

  const days = new Map<string, { recv: number; exp: number; open: number | null }>()
  const at = (d: string): { recv: number; exp: number; open: number | null } => {
    let e = days.get(d)
    if (!e) days.set(d, (e = { recv: 0, exp: 0, open: null }))
    return e
  }
  for (const r of received) at(r.day).recv = r.v
  for (const r of spent) at(r.day).exp = r.v
  for (const r of manual) at(r.day).open = r.v
  let running = 0
  for (const d of [...days.keys()].sort()) {
    const e = days.get(d)!
    if (e.open !== null) running = e.open
    running += e.recv - e.exp
  }
  return running
}

export function getDayBook(db: Db, day: string): DayBook {
  checkDay(day)
  const lines = (
    db
      .prepare(
        `SELECT b.bill_no AS billNo, i.name AS name, i.qty AS qty,
                i.qty * i.unit_cost_minor AS costMinor, i.line_total_minor AS saleMinor
         FROM bill_items i JOIN bills b ON b.id = i.bill_id
         WHERE strftime('%Y-%m-%d', b.created_at, 'localtime') = ?
         ORDER BY b.created_at, i.id`
      )
      .all(day) as unknown as DayBook['lines']
  ).map((r) => ({ ...r }))

  const a = db
    .prepare(
      `SELECT COUNT(*) AS bills, COALESCE(SUM(subtotal_minor - discount_minor), 0) AS sales,
              COALESCE(SUM(discount_minor), 0) AS discount,
              COALESCE(SUM(CASE WHEN payment_method = 'credit' THEN 0 ELSE total_minor END), 0) AS received,
              COALESCE(SUM(CASE WHEN payment_method = 'credit' THEN total_minor ELSE 0 END), 0) AS credit
       FROM bills WHERE ${LOCAL_DAY} = ?`
    )
    .get(day) as unknown as {
    bills: number
    sales: number
    discount: number
    received: number
    credit: number
  }

  const expenses = (
    db
      .prepare(
        'SELECT id, day, title, amount_minor AS amountMinor FROM expenses WHERE day = ? ORDER BY id'
      )
      .all(day) as unknown as Expense[]
  ).map((r) => ({ ...r }))
  const expensesMinor = expenses.reduce((s, e) => s + e.amountMinor, 0)

  // Money actually paid to suppliers that day (part-paid purchases count only the paid part, plus later payments).
  const supplier = {
    s:
      (
        db
          .prepare(`SELECT COALESCE(SUM(paid_minor), 0) AS s FROM purchases WHERE ${LOCAL_DAY} = ?`)
          .get(day) as unknown as { s: number }
      ).s +
      (
        db
          .prepare(
            `SELECT COALESCE(SUM(amount_minor), 0) AS s FROM party_payments WHERE ${LOCAL_DAY} = ?`
          )
          .get(day) as unknown as { s: number }
      ).s
  }

  const row = db
    .prepare('SELECT opening_minor, notes FROM day_book WHERE day = ?')
    .get(day) as unknown as { opening_minor: number | null; notes: string } | undefined
  const openingManual = row?.opening_minor != null
  const openingMinor = openingManual ? (row!.opening_minor as number) : carriedIn(db, day)

  const costMinor = lines.reduce((s, l) => s + l.costMinor, 0)
  const profitMinor = a.sales - costMinor
  return {
    day,
    lines,
    bills: a.bills,
    salesMinor: a.sales,
    discountMinor: a.discount,
    costMinor,
    profitMinor,
    expenses,
    expensesMinor,
    netProfitMinor: profitMinor - expensesMinor,
    receivedMinor: a.received,
    creditMinor: a.credit,
    supplierSpendMinor: supplier.s,
    openingMinor,
    openingManual,
    closingMinor: openingMinor + a.received - expensesMinor,
    notes: row?.notes ?? ''
  }
}

export function saveDayBook(db: Db, input: DayBookSave): DayBook {
  const day = checkDay(input.day)
  const opening =
    input.openingMinor === null ? null : checkAmount(input.openingMinor, 'Opening balance')
  const notes = typeof input.notes === 'string' ? input.notes : ''
  if (notes.length > 5000) throw new Error('Notes are too long (5000 characters at most)')
  db.prepare(
    `INSERT INTO day_book (day, opening_minor, notes) VALUES (?, ?, ?)
     ON CONFLICT(day) DO UPDATE SET opening_minor = excluded.opening_minor, notes = excluded.notes`
  ).run(day, opening, notes)
  return getDayBook(db, day)
}

export function addExpense(db: Db, input: ExpenseInput): Expense {
  const day = checkDay(input.day)
  const title = typeof input.title === 'string' ? input.title.trim() : ''
  if (!title) throw new Error('Say what the expense was for')
  if (title.length > 200) throw new Error('The expense description is too long')
  const amount = checkAmount(input.amountMinor, 'Expense')
  if (amount <= 0) throw new Error('Expense must be more than zero')
  const r = db
    .prepare('INSERT INTO expenses (day, title, amount_minor, created_at) VALUES (?, ?, ?, ?)')
    .run(day, title, amount, new Date().toISOString())
  return { id: Number(r.lastInsertRowid), day, title, amountMinor: amount }
}

export function deleteExpense(db: Db, id: number): void {
  if (!Number.isInteger(id)) throw new Error('Unknown expense')
  db.prepare('DELETE FROM expenses WHERE id = ?').run(id)
}
