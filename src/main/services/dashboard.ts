import type { Db } from '../db/database'
import type { Dashboard, ReportRange } from '../../shared/types'
import { getReport } from './reports'

const ymd = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

function parse(date: string): Date {
  const d = /^\d{4}-\d{2}-\d{2}$/.test(date) ? new Date(`${date}T00:00:00`) : null
  if (!d || Number.isNaN(d.getTime())) throw new Error('Enter valid dates')
  return d
}

function addDays(d: Date, n: number): Date {
  const x = new Date(d)
  x.setDate(x.getDate() + n)
  return x
}

function expensesIn(db: Db, from: string, to: string): number {
  const r = db
    .prepare('SELECT COALESCE(SUM(amount_minor), 0) AS s FROM expenses WHERE day >= ? AND day <= ?')
    .get(from, to) as unknown as { s: number }
  return r.s
}

function byDay(db: Db, sql: string, ...args: string[]): Map<string, number> {
  const rows = db.prepare(sql).all(...args) as unknown as { d: string; v: number }[]
  return new Map(rows.map((r) => [r.d, r.v]))
}

/** Dashboard numbers for from..to (local days) and for the equally long period right before it. */
export function getDashboard(db: Db, range: ReportRange): Dashboard {
  const start = parse(range.from)
  const end = parse(range.to)
  if (end < start) throw new Error('The end date is before the start date')
  const days: string[] = []
  for (let d = start; d <= end; d = addDays(d, 1)) days.push(ymd(d))
  if (days.length > 400) throw new Error('Choose a range of at most about a year')

  const report = getReport(db, range)
  const prevTo = addDays(start, -1)
  const prevFrom = addDays(prevTo, -(days.length - 1))
  const prev = getReport(db, { from: ymd(prevFrom), to: ymd(prevTo) })

  const lo = start.toISOString()
  const hi = addDays(end, 1).toISOString()
  const purchaseByDay = byDay(
    db,
    `SELECT strftime('%Y-%m-%d', created_at, 'localtime') AS d, SUM(total_minor) AS v
     FROM purchases WHERE created_at >= ? AND created_at < ? GROUP BY d`,
    lo,
    hi
  )
  const expenseByDay = byDay(
    db,
    'SELECT day AS d, SUM(amount_minor) AS v FROM expenses WHERE day >= ? AND day <= ? GROUP BY day',
    range.from,
    range.to
  )
  const daily = new Map(report.daily.map((r) => [r.period, r]))

  const expensesByTitle = (
    db
      .prepare(
        `SELECT title, SUM(amount_minor) AS total FROM expenses WHERE day >= ? AND day <= ?
         GROUP BY title COLLATE NOCASE ORDER BY total DESC LIMIT 20`
      )
      .all(range.from, range.to) as unknown as { title: string; total: number }[]
  ).map((r) => ({ title: r.title, totalMinor: r.total }))

  const count = (sql: string): number => (db.prepare(sql).get() as unknown as { n: number }).n

  return {
    report,
    previous: {
      salesMinor: prev.netSalesMinor,
      profitMinor: prev.profitMinor,
      purchasesMinor: prev.supplierSpendMinor,
      expensesMinor: expensesIn(db, ymd(prevFrom), ymd(prevTo))
    },
    expensesMinor: expensesIn(db, range.from, range.to),
    expensesByTitle,
    receivedMinor: report.byPayment
      .filter((p) => p.method !== 'credit')
      .reduce((s, p) => s + p.totalMinor, 0),
    series: {
      sales: days.map((d) => daily.get(d)?.netSalesMinor ?? 0),
      profit: days.map((d) => daily.get(d)?.profitMinor ?? 0),
      purchases: days.map((d) => purchaseByDay.get(d) ?? 0),
      expenses: days.map((d) => expenseByDay.get(d) ?? 0)
    },
    lowStockCount: count(
      'SELECT COUNT(*) AS n FROM products WHERE active = 1 AND stock_qty <= low_stock_threshold'
    ),
    sellInLossCount: count(
      'SELECT COUNT(*) AS n FROM products WHERE active = 1 AND cost_minor > 0 AND price_minor < cost_minor'
    )
  }
}
