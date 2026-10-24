import { useEffect, useState } from 'react'
import type { PeriodRow, Report } from '../../../shared/types'
import { useSettings } from '../lib/useSettings'
import { formatMoney } from '../lib/money'
import { money, toCsv, type Cell } from '../lib/csv'

type View = 'summary' | 'daily' | 'monthly' | 'products'
const VIEWS: { id: View; label: string }[] = [
  { id: 'summary', label: 'Financial summary' },
  { id: 'daily', label: 'Daily sales' },
  { id: 'monthly', label: 'Monthly sales' },
  { id: 'products', label: 'By product' }
]

const ymd = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

function preset(kind: 'today' | 'month' | 'lastMonth' | 'year'): { from: string; to: string } {
  const n = new Date()
  if (kind === 'today') return { from: ymd(n), to: ymd(n) }
  if (kind === 'month') return { from: ymd(new Date(n.getFullYear(), n.getMonth(), 1)), to: ymd(n) }
  if (kind === 'lastMonth')
    return {
      from: ymd(new Date(n.getFullYear(), n.getMonth() - 1, 1)),
      to: ymd(new Date(n.getFullYear(), n.getMonth(), 0))
    }
  return { from: ymd(new Date(n.getFullYear(), 0, 1)), to: ymd(n) }
}

export default function ReportsPage(): React.JSX.Element {
  const { settings } = useSettings()
  const m = (n: number): string => formatMoney(n, settings?.currencySymbol ?? '')
  const [range, setRange] = useState(preset('month'))
  const [view, setView] = useState<View>('summary')
  const [report, setReport] = useState<Report | null>(null)
  const [err, setErr] = useState('')

  useEffect(() => {
    if (!range.from || !range.to) return
    let stale = false
    void window.api.reports
      .get(range)
      .then((r) => {
        if (stale) return
        if (r.ok) {
          setReport(r.data)
          setErr('')
        } else setErr(r.error)
      })
      .catch(() => setErr('Could not load the report. Please close and reopen the app.'))
    return () => {
      stale = true
    }
  }, [range])

  const margin = (profit: number, net: number): string =>
    net > 0 ? `${((profit / net) * 100).toFixed(1)}%` : '-'
  const [exported, setExported] = useState('')
  async function exportCsv(): Promise<void> {
    if (!report) return
    const pct = (p: number, n: number): string => (n > 0 ? ((p / n) * 100).toFixed(1) : '')
    const head: Cell[][] = [
      [`${settings?.shopName ?? ''} - ${VIEWS.find((v) => v.id === view)?.label}`],
      ['From', report.range.from, 'To', report.range.to],
      []
    ]
    let body: Cell[][]
    if (view === 'summary')
      body = [
        ['Bills', report.bills],
        ['Gross sales', money(report.grossSalesMinor)],
        ['Discounts given', money(report.discountMinor)],
        ['Net sales', money(report.netSalesMinor)],
        ['Cost of goods sold', money(report.costMinor)],
        ['Profit', money(report.profitMinor)],
        ['Margin %', pct(report.profitMinor, report.netSalesMinor)],
        ['Tax collected (not income)', money(report.taxMinor)],
        ['Total billed', money(report.totalBilledMinor)],
        [],
        ['Payment method', 'Bills', 'Amount'],
        ...report.byPayment.map((p) => [p.method, p.bills, money(p.totalMinor)]),
        [],
        ['Paid to suppliers', money(report.supplierSpendMinor)],
        ['Stock value at cost (now)', money(report.stockCostValueMinor)],
        ['Stock value at selling price (now)', money(report.stockRetailValueMinor)]
      ]
    else if (view === 'products')
      body = [
        ['Product', 'Qty sold', 'Sales', 'Profit'],
        ...report.products.map((p) => [p.name, p.qty, money(p.salesMinor), money(p.profitMinor)])
      ]
    else {
      const rows = view === 'daily' ? report.daily : report.monthly
      body = [
        [
          view === 'daily' ? 'Day' : 'Month',
          'Bills',
          'Sales',
          'Cost of goods',
          'Profit',
          'Margin %'
        ],
        ...rows.map((r) => [
          r.period,
          r.bills,
          money(r.netSalesMinor),
          money(r.costMinor),
          money(r.profitMinor),
          pct(r.profitMinor, r.netSalesMinor)
        ]),
        [
          'Total',
          report.bills,
          money(report.netSalesMinor),
          money(report.costMinor),
          money(report.profitMinor),
          pct(report.profitMinor, report.netSalesMinor)
        ]
      ]
    }
    const r = await window.api.files.saveCsv(
      `${view}-${report.range.from}-to-${report.range.to}`,
      toCsv([...head, ...body])
    )
    if (!r.ok) setErr(r.error)
    else if (r.data) setExported(`Exported to ${r.data}`)
  }

  const profitClass = (n: number): string => (n < 0 ? 'err' : '')

  const periodTable = (rows: PeriodRow[], label: string): React.JSX.Element => (
    <table className="grid">
      <thead>
        <tr>
          <th>{label}</th>
          <th className="num">Bills</th>
          <th className="num">Sales</th>
          <th className="num">Cost of goods</th>
          <th className="num">Profit</th>
          <th className="num">Margin</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.period}>
            <td>{r.period}</td>
            <td className="num">{r.bills}</td>
            <td className="num">{m(r.netSalesMinor)}</td>
            <td className="num">{m(r.costMinor)}</td>
            <td className={`num ${profitClass(r.profitMinor)}`}>{m(r.profitMinor)}</td>
            <td className="num">{margin(r.profitMinor, r.netSalesMinor)}</td>
          </tr>
        ))}
        {rows.length > 0 && report && (
          <tr>
            <td>
              <strong>Total</strong>
            </td>
            <td className="num">
              <strong>{report.bills}</strong>
            </td>
            <td className="num">
              <strong>{m(report.netSalesMinor)}</strong>
            </td>
            <td className="num">
              <strong>{m(report.costMinor)}</strong>
            </td>
            <td className={`num ${profitClass(report.profitMinor)}`}>
              <strong>{m(report.profitMinor)}</strong>
            </td>
            <td className="num">
              <strong>{margin(report.profitMinor, report.netSalesMinor)}</strong>
            </td>
          </tr>
        )}
        {!rows.length && (
          <tr>
            <td colSpan={6} className="muted center">
              No sales in this period.
            </td>
          </tr>
        )}
      </tbody>
    </table>
  )

  return (
    <div className="page">
      <div className="toolbar">
        <h1>Reports</h1>
        <button onClick={() => setRange(preset('today'))}>Today</button>
        <button onClick={() => setRange(preset('month'))}>This month</button>
        <button onClick={() => setRange(preset('lastMonth'))}>Last month</button>
        <button onClick={() => setRange(preset('year'))}>This year</button>
      </div>
      <div className="toolbar">
        <label className="inline">
          From
          <input
            type="date"
            value={range.from}
            onChange={(e) => setRange({ ...range, from: e.target.value })}
          />
        </label>
        <label className="inline">
          To
          <input
            type="date"
            value={range.to}
            onChange={(e) => setRange({ ...range, to: e.target.value })}
          />
        </label>
        <span style={{ flex: 1 }} />
        <button onClick={() => void exportCsv()} disabled={!report}>
          Export CSV
        </button>
        {VIEWS.map((v) => (
          <button
            key={v.id}
            className={view === v.id ? 'primary' : ''}
            onClick={() => setView(v.id)}
            aria-pressed={view === v.id}
          >
            {v.label}
          </button>
        ))}
      </div>
      {exported && (
        <p className="ok" role="status">
          {exported}
        </p>
      )}
      {err && (
        <p className="err" role="alert">
          {err}
        </p>
      )}

      {report && view === 'summary' && (
        <>
          <div className="card">
            <h2>Sales and profit</h2>
            <div className="row">
              <span>Bills</span>
              <span>{report.bills}</span>
            </div>
            <div className="row">
              <span>Gross sales</span>
              <span>{m(report.grossSalesMinor)}</span>
            </div>
            <div className="row">
              <span>Discounts given</span>
              <span>-{m(report.discountMinor)}</span>
            </div>
            <div className="row">
              <strong>Net sales</strong>
              <strong>{m(report.netSalesMinor)}</strong>
            </div>
            <div className="row">
              <span>Cost of goods sold</span>
              <span>-{m(report.costMinor)}</span>
            </div>
            <div className="row total">
              <span>Profit</span>
              <span className={profitClass(report.profitMinor)}>
                {m(report.profitMinor)} ({margin(report.profitMinor, report.netSalesMinor)})
              </span>
            </div>
            <p className="muted">
              Profit = net sales minus what the goods cost when they were sold. Tax (
              {m(report.taxMinor)}) is not counted as income.
            </p>
          </div>
          <div className="card">
            <h2>Money in and out</h2>
            {report.byPayment.map((p) => (
              <div className="row" key={p.method}>
                <span>
                  {p.method === 'credit'
                    ? 'On credit (not received yet)'
                    : `Received by ${p.method}`}{' '}
                  <span className="muted">({p.bills} bills)</span>
                </span>
                <span>{m(p.totalMinor)}</span>
              </div>
            ))}
            {!report.byPayment.length && <p className="muted">No bills in this period.</p>}
            <div className="row">
              <span>Total billed (including tax)</span>
              <span>{m(report.totalBilledMinor)}</span>
            </div>
            <div className="row">
              <span>Spent on suppliers in this period</span>
              <span>-{m(report.supplierSpendMinor)}</span>
            </div>
          </div>
          <div className="card">
            <h2>Stock right now</h2>
            <div className="row">
              <span>Value at cost price</span>
              <span>{m(report.stockCostValueMinor)}</span>
            </div>
            <div className="row">
              <span>Value at selling price</span>
              <span>{m(report.stockRetailValueMinor)}</span>
            </div>
          </div>
        </>
      )}

      {report && view === 'daily' && periodTable(report.daily, 'Day')}
      {report && view === 'monthly' && periodTable(report.monthly, 'Month')}

      {report && view === 'products' && (
        <table className="grid">
          <thead>
            <tr>
              <th>Product</th>
              <th className="num">Qty sold</th>
              <th className="num">Sales</th>
              <th className="num">Profit</th>
            </tr>
          </thead>
          <tbody>
            {report.products.map((p, i) => (
              <tr key={`${p.name}-${i}`}>
                <td>{p.name}</td>
                <td className="num">{p.qty}</td>
                <td className="num">{m(p.salesMinor)}</td>
                <td className={`num ${profitClass(p.profitMinor)}`}>{m(p.profitMinor)}</td>
              </tr>
            ))}
            {!report.products.length && (
              <tr>
                <td colSpan={4} className="muted center">
                  No sales in this period.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}
      {report && view === 'products' && (
        <p className="muted">Product profit is before bill-level discounts.</p>
      )}
    </div>
  )
}
