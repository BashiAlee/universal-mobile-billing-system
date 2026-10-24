import type { Db } from '../db/database'
import type { PeriodRow, Report, ReportRange } from '../../shared/types'

/** Local-midnight start of a YYYY-MM-DD date as an ISO instant, or throws. */
function startOf(date: string): Date {
  const d = /^\d{4}-\d{2}-\d{2}$/.test(date) ? new Date(`${date}T00:00:00`) : null
  if (!d || Number.isNaN(d.getTime())) throw new Error('Enter valid dates')
  return d
}

// Bill totals and cost are grouped by the shop's local day/month (not UTC), so a 11pm sale lands on its own day.
const BILL_BASE = `
  FROM bills b
  LEFT JOIN (SELECT bill_id, SUM(qty * unit_cost_minor) AS cost FROM bill_items GROUP BY bill_id) c
    ON c.bill_id = b.id
  WHERE b.created_at >= ? AND b.created_at < ?`

interface Agg {
  bills: number
  gross: number
  discount: number
  tax: number
  total: number
  cost: number
}

function periodRows(db: Db, fmt: '%Y-%m-%d' | '%Y-%m', lo: string, hi: string): PeriodRow[] {
  const rows = db
    .prepare(
      `SELECT strftime('${fmt}', b.created_at, 'localtime') AS p, COUNT(*) AS bills,
              SUM(b.subtotal_minor - b.discount_minor) AS net, COALESCE(SUM(c.cost), 0) AS cost
       ${BILL_BASE} GROUP BY p ORDER BY p`
    )
    .all(lo, hi) as unknown as { p: string; bills: number; net: number; cost: number }[]
  return rows.map((r) => ({
    period: r.p,
    bills: r.bills,
    netSalesMinor: r.net,
    costMinor: r.cost,
    profitMinor: r.net - r.cost
  }))
}

/**
 * Sales, cost and profit for bills dated from..to (local days, inclusive).
 * Profit = net sales (after discount, before tax) minus the cost the goods had when they were sold.
 */
export function getReport(db: Db, range: ReportRange): Report {
  const start = startOf(range.from)
  const end = startOf(range.to)
  if (end < start) throw new Error('The end date is before the start date')
  const next = new Date(end)
  next.setDate(next.getDate() + 1)
  const lo = start.toISOString()
  const hi = next.toISOString()

  const a = db
    .prepare(
      `SELECT COUNT(*) AS bills, COALESCE(SUM(b.subtotal_minor), 0) AS gross,
              COALESCE(SUM(b.discount_minor), 0) AS discount, COALESCE(SUM(b.tax_minor), 0) AS tax,
              COALESCE(SUM(b.total_minor), 0) AS total, COALESCE(SUM(c.cost), 0) AS cost
       ${BILL_BASE}`
    )
    .get(lo, hi) as unknown as Agg

  const byPayment = (
    db
      .prepare(
        `SELECT payment_method AS method, COUNT(*) AS bills, SUM(total_minor) AS total
         FROM bills WHERE created_at >= ? AND created_at < ? GROUP BY payment_method ORDER BY total DESC`
      )
      .all(lo, hi) as unknown as { method: string; bills: number; total: number }[]
  ).map((r) => ({ method: r.method, bills: r.bills, totalMinor: r.total }))

  // Only money actually paid out counts; what is still owed to a party is not spending yet.
  const spend = {
    s:
      (
        db
          .prepare(
            'SELECT COALESCE(SUM(paid_minor), 0) AS s FROM purchases WHERE created_at >= ? AND created_at < ?'
          )
          .get(lo, hi) as unknown as { s: number }
      ).s +
      (
        db
          .prepare(
            'SELECT COALESCE(SUM(amount_minor), 0) AS s FROM party_payments WHERE created_at >= ? AND created_at < ?'
          )
          .get(lo, hi) as unknown as { s: number }
      ).s
  }

  const stock = db
    .prepare(
      `SELECT COALESCE(SUM(stock_qty * cost_minor), 0) AS cost, COALESCE(SUM(stock_qty * price_minor), 0) AS retail
       FROM products WHERE active = 1 AND stock_qty > 0`
    )
    .get() as unknown as { cost: number; retail: number }

  const products = (
    db
      .prepare(
        `SELECT i.name AS name, SUM(i.qty) AS qty, SUM(i.line_total_minor) AS sales,
                SUM(i.line_total_minor - i.qty * i.unit_cost_minor) AS profit
         FROM bill_items i JOIN bills b ON b.id = i.bill_id
         WHERE b.created_at >= ? AND b.created_at < ?
         GROUP BY COALESCE(i.product_id, -i.id), i.name ORDER BY profit DESC LIMIT 100`
      )
      .all(lo, hi) as unknown as { name: string; qty: number; sales: number; profit: number }[]
  ).map((r) => ({ name: r.name, qty: r.qty, salesMinor: r.sales, profitMinor: r.profit }))

  const net = a.gross - a.discount
  return {
    range,
    bills: a.bills,
    grossSalesMinor: a.gross,
    discountMinor: a.discount,
    netSalesMinor: net,
    taxMinor: a.tax,
    totalBilledMinor: a.total,
    costMinor: a.cost,
    profitMinor: net - a.cost,
    byPayment,
    supplierSpendMinor: spend.s,
    stockCostValueMinor: stock.cost,
    stockRetailValueMinor: stock.retail,
    daily: periodRows(db, '%Y-%m-%d', lo, hi),
    monthly: periodRows(db, '%Y-%m', lo, hi),
    products
  }
}
