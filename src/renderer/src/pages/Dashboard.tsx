import { useEffect, useState } from 'react'
import type { Dashboard, PeriodRow } from '../../../shared/types'
import { useSettings } from '../lib/useSettings'
import { formatMoney } from '../lib/money'

type Frame = 'today' | 'week' | 'month' | 'year'
const FRAMES: { id: Frame; label: string }[] = [
  { id: 'today', label: 'Today' },
  { id: 'week', label: 'This week' },
  { id: 'month', label: 'This month' },
  { id: 'year', label: 'This year' }
]
const COLORS = ['#2457d6', '#1c7c3a', '#e08a00', '#c4302b', '#7a4fd1', '#0f9fb0']

const ymd = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

function rangeFor(f: Frame): { from: string; to: string } {
  const n = new Date()
  if (f === 'today') return { from: ymd(n), to: ymd(n) }
  if (f === 'week') {
    const start = new Date(n)
    start.setDate(n.getDate() - ((n.getDay() + 6) % 7)) // Monday
    return { from: ymd(start), to: ymd(n) }
  }
  if (f === 'month') return { from: ymd(new Date(n.getFullYear(), n.getMonth(), 1)), to: ymd(n) }
  return { from: ymd(new Date(n.getFullYear(), 0, 1)), to: ymd(n) }
}

/** Compact number for chart axes: 12500 -> 12.5k. Input is in major units. */
function short(n: number): string {
  const a = Math.abs(n)
  if (a >= 1_000_000) return `${+(n / 1_000_000).toFixed(1)}M`
  if (a >= 1_000) return `${+(n / 1_000).toFixed(1)}k`
  return String(Math.round(n))
}

function BarChart({ rows }: { rows: PeriodRow[] }): React.JSX.Element {
  const W = 700
  const H = 240
  const L = 46
  const B = 28
  const max = Math.max(1, ...rows.map((r) => Math.max(r.netSalesMinor, r.profitMinor))) / 100
  const slot = (W - L - 8) / Math.max(rows.length, 1)
  const bw = Math.min(26, slot / 2.6)
  const y = (v: number): number => H - B - (Math.max(v, 0) / max) * (H - B - 12)
  const every = Math.ceil(rows.length / 12)
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Sales and profit chart" width="100%">
      {[0, 0.5, 1].map((t) => (
        <g key={t}>
          <line x1={L} x2={W} y1={y(max * t)} y2={y(max * t)} stroke="#e1e4ea" />
          <text x={L - 6} y={y(max * t) + 4} fontSize="11" textAnchor="end" fill="#6b7385">
            {short(max * t)}
          </text>
        </g>
      ))}
      {rows.map((r, i) => {
        const x = L + i * slot + slot / 2
        return (
          <g key={r.period}>
            <rect
              x={x - bw}
              y={y(r.netSalesMinor / 100)}
              width={bw}
              height={H - B - y(r.netSalesMinor / 100)}
              fill={COLORS[0]}
            />
            <rect
              x={x}
              y={y(r.profitMinor / 100)}
              width={bw}
              height={H - B - y(r.profitMinor / 100)}
              fill={COLORS[1]}
            />
            {i % every === 0 && (
              <text x={x} y={H - 10} fontSize="11" textAnchor="middle" fill="#6b7385">
                {r.period.length > 7 ? r.period.slice(5) : r.period}
              </text>
            )}
          </g>
        )
      })}
    </svg>
  )
}

function Donut({
  parts,
  centre
}: {
  parts: { label: string; value: number }[]
  centre: string
}): React.JSX.Element {
  const total = parts.reduce((s, p) => s + p.value, 0)
  const R = 54
  const C = 2 * Math.PI * R
  let offset = 0
  return (
    <svg viewBox="0 0 150 150" width="150" height="150" role="img" aria-label="Donut chart">
      <circle cx="75" cy="75" r={R} fill="none" stroke="#e1e4ea" strokeWidth="22" />
      {total > 0 &&
        parts.map((p, i) => {
          const len = (p.value / total) * C
          const el = (
            <circle
              key={p.label}
              cx="75"
              cy="75"
              r={R}
              fill="none"
              stroke={COLORS[i % COLORS.length]}
              strokeWidth="22"
              strokeDasharray={`${len} ${C - len}`}
              strokeDashoffset={-offset}
              transform="rotate(-90 75 75)"
            />
          )
          offset += len
          return el
        })}
      <text x="75" y="80" textAnchor="middle" fontSize="16" fontWeight="700" fill="#1c2230">
        {centre}
      </text>
    </svg>
  )
}

function Sparkline({ values, color }: { values: number[]; color: string }): React.JSX.Element {
  const W = 120
  const H = 44
  const max = Math.max(1, ...values)
  const min = Math.min(0, ...values)
  const step = values.length > 1 ? W / (values.length - 1) : 0
  const pts = values.map(
    (v, i) =>
      `${(i * step).toFixed(1)},${(H - 4 - ((v - min) / (max - min || 1)) * (H - 8)).toFixed(1)}`
  )
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="120" height="44" aria-hidden="true">
      {values.length > 1 ? (
        <polyline points={pts.join(' ')} fill="none" stroke={color} strokeWidth="2" />
      ) : (
        <circle cx={W / 2} cy={H / 2} r="3" fill={color} />
      )}
    </svg>
  )
}

function Kpi({
  label,
  value,
  now,
  before,
  series,
  upIsGood,
  color
}: {
  label: string
  value: string
  now: number
  before: number
  series: number[]
  upIsGood: boolean
  color: string
}): React.JSX.Element {
  let trend = 'no earlier data'
  let cls = 'muted'
  if (before > 0) {
    const pct = ((now - before) / before) * 100
    trend = `${pct >= 0 ? '▲' : '▼'} ${Math.abs(pct).toFixed(1)}% vs previous period`
    if (Math.abs(pct) >= 0.05) cls = pct >= 0 === upIsGood ? 'ok' : 'err'
  } else if (now > 0) {
    trend = '▲ new (nothing in the previous period)'
  }
  return (
    <div className="kpi">
      <div className="kpi-label">{label}</div>
      <div className="kpi-row">
        <strong>{value}</strong>
        <Sparkline values={series} color={color} />
      </div>
      <div className={`kpi-trend ${cls}`}>{trend}</div>
    </div>
  )
}

function Columns({
  items
}: {
  items: { label: string; value: number; color: string }[]
}): React.JSX.Element {
  const W = 360
  const H = 220
  const B = 30
  const max = Math.max(1, ...items.map((i) => i.value))
  const slot = W / items.length
  const bw = Math.min(70, slot * 0.6)
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Cash flow chart" width="100%">
      <line x1="0" x2={W} y1={H - B} y2={H - B} stroke="#e1e4ea" />
      {items.map((it, i) => {
        const h = (it.value / max) * (H - B - 26)
        const x = i * slot + slot / 2
        return (
          <g key={it.label}>
            <rect x={x - bw / 2} y={H - B - h} width={bw} height={h} fill={it.color} rx="3" />
            <text x={x} y={H - B - h - 6} fontSize="11" textAnchor="middle" fill="#1c2230">
              {short(it.value / 100)}
            </text>
            <text x={x} y={H - 10} fontSize="12" textAnchor="middle" fill="#6b7385">
              {it.label}
            </text>
          </g>
        )
      })}
    </svg>
  )
}

export default function DashboardPage({
  onGo
}: {
  onGo: (tab: 'products') => void
}): React.JSX.Element {
  const { settings } = useSettings()
  const m = (n: number): string => formatMoney(n, settings?.currencySymbol ?? '')
  const [frame, setFrame] = useState<Frame>('month')
  const [data, setData] = useState<Dashboard | null>(null)
  const [err, setErr] = useState('')

  useEffect(() => {
    let stale = false
    window.api.dashboard
      .get(rangeFor(frame))
      .then((r) => {
        if (stale) return
        if (r.ok) {
          setData(r.data)
          setErr('')
        } else setErr(r.error)
      })
      .catch(() => setErr('Could not load the dashboard. Please close and reopen the app.'))
    return () => {
      stale = true
    }
  }, [frame])

  const report = data?.report ?? null
  const credit = report?.byPayment.find((p) => p.method === 'credit')?.totalMinor ?? 0
  const margin =
    report && report.netSalesMinor > 0
      ? Math.round((report.profitMinor / report.netSalesMinor) * 100)
      : 0
  const rows = report ? (frame === 'year' ? report.monthly : report.daily) : []
  const top = report
    ? [...report.products].sort((a, b) => b.salesMinor - a.salesMinor).slice(0, 8)
    : []
  const topMax = Math.max(1, ...top.map((p) => p.salesMinor))

  // Biggest five expense headings, the rest grouped as "Other".
  const expParts = (data?.expensesByTitle ?? []).slice(0, 5).map((e) => ({
    label: e.title,
    value: e.totalMinor
  }))
  const rest = (data?.expensesByTitle ?? []).slice(5).reduce((s, e) => s + e.totalMinor, 0)
  if (rest > 0) expParts.push({ label: 'Other', value: rest })

  return (
    <div className="page">
      <div className="toolbar">
        <h1>Dashboard</h1>
        {FRAMES.map((f) => (
          <button
            key={f.id}
            className={frame === f.id ? 'primary' : ''}
            onClick={() => setFrame(f.id)}
          >
            {f.label}
          </button>
        ))}
      </div>
      {err && (
        <p className="err" role="alert">
          {err}
        </p>
      )}
      {data && report && (
        <>
          <div className="kpis">
            <Kpi
              label="SALES"
              value={m(report.netSalesMinor)}
              now={report.netSalesMinor}
              before={data.previous.salesMinor}
              series={data.series.sales}
              upIsGood
              color="#2457d6"
            />
            <Kpi
              label="PROFIT"
              value={m(report.profitMinor)}
              now={report.profitMinor}
              before={data.previous.profitMinor}
              series={data.series.profit}
              upIsGood
              color="#1c7c3a"
            />
            <Kpi
              label="PAID TO SUPPLIERS"
              value={m(report.supplierSpendMinor)}
              now={report.supplierSpendMinor}
              before={data.previous.purchasesMinor}
              series={data.series.purchases}
              upIsGood={false}
              color="#e08a00"
            />
            <Kpi
              label="EXPENSE"
              value={m(data.expensesMinor)}
              now={data.expensesMinor}
              before={data.previous.expensesMinor}
              series={data.series.expenses}
              upIsGood={false}
              color="#c4302b"
            />
          </div>

          <div className="charts three">
            <div className="card">
              <h2>Cash flow</h2>
              <Columns
                items={[
                  { label: 'Money in', value: data.receivedMinor, color: '#1c7c3a' },
                  { label: 'Expenses', value: data.expensesMinor, color: '#c4302b' },
                  { label: 'Paid to suppliers', value: report.supplierSpendMinor, color: '#e08a00' }
                ]}
              />
            </div>

            <div className="card">
              <h2>Expenses</h2>
              {expParts.length ? (
                <div className="center">
                  <Donut parts={expParts} centre={short(data.expensesMinor / 100)} />
                  <div className="legend">
                    {expParts.map((p, i) => (
                      <div key={p.label}>
                        <span style={{ color: COLORS[i % COLORS.length] }}>■</span> {p.label}:{' '}
                        {m(p.value)}
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <p className="muted">No expenses in this period. Add them in the Day book.</p>
              )}
            </div>

            <div className="card">
              <h2>Notifications</h2>
              <button className="notice" onClick={() => onGo('products')}>
                <span className="badge-dot" style={{ background: '#c4302b' }}>
                  {data.lowStockCount}
                </span>
                Low stock alerts ({data.lowStockCount})
              </button>
              <button className="notice" onClick={() => onGo('products')}>
                <span className="badge-dot" style={{ background: '#c13584' }}>
                  {data.sellInLossCount}
                </span>
                Priced below cost ({data.sellInLossCount})
              </button>
              <h2 style={{ marginTop: 16 }}>Sales status</h2>
              <div className="row">
                <span>Number of bills</span>
                <strong>{report.bills}</strong>
              </div>
              <div className="row">
                <span>Due (credit bills)</span>
                <strong>{m(credit)}</strong>
              </div>
              <div className="row">
                <span>Stock value (cost)</span>
                <strong>{m(report.stockCostValueMinor)}</strong>
              </div>
              <div className="row">
                <span>Stock value (selling)</span>
                <strong>{m(report.stockRetailValueMinor)}</strong>
              </div>
            </div>
          </div>

          <div className="charts">
            <div className="card wide">
              <h2>Sales and profit</h2>
              {rows.length ? (
                <>
                  <BarChart rows={rows} />
                  <div className="muted legend">
                    <span style={{ color: COLORS[0] }}>■</span> Sales &nbsp;
                    <span style={{ color: COLORS[1] }}>■</span> Profit
                  </div>
                </>
              ) : (
                <p className="muted">No sales in this period.</p>
              )}
            </div>

            <div className="card">
              <h2>Profit margin</h2>
              <div className="center">
                <Donut
                  parts={[
                    { label: 'Profit', value: Math.max(margin, 0) },
                    { label: 'Cost', value: Math.max(100 - margin, 0) }
                  ]}
                  centre={`${margin}%`}
                />
              </div>
            </div>

            <div className="card">
              <h2>Payment methods</h2>
              {report.byPayment.length ? (
                <div className="center">
                  <Donut
                    parts={report.byPayment.map((p) => ({ label: p.method, value: p.totalMinor }))}
                    centre={String(report.bills)}
                  />
                  <div className="legend">
                    {report.byPayment.map((p, i) => (
                      <div key={p.method}>
                        <span style={{ color: COLORS[i % COLORS.length] }}>■</span> {p.method}:{' '}
                        {m(p.totalMinor)}
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <p className="muted">No sales in this period.</p>
              )}
            </div>

            <div className="card wide">
              <h2>Top products by sales</h2>
              {top.length ? (
                top.map((p) => (
                  <div key={p.name} className="hbar">
                    <span className="hbar-name">{p.name}</span>
                    <span className="hbar-track">
                      <span style={{ width: `${(p.salesMinor / topMax) * 100}%` }} />
                    </span>
                    <span className="hbar-val">{m(p.salesMinor)}</span>
                  </div>
                ))
              ) : (
                <p className="muted">No sales in this period.</p>
              )}
            </div>
          </div>

          <div className="card" role="region" aria-label="Money owed to parties">
            <h2>Money owed to parties</h2>
            {data.owed.parties.length ? (
              <>
                <table className="grid">
                  <thead>
                    <tr>
                      <th>Party</th>
                      <th className="num">Total bought</th>
                      <th className="num">Paid</th>
                      <th className="num">Remaining</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.owed.parties.map((p) => (
                      <tr key={p.id}>
                        <td>{p.name}</td>
                        <td className="num">{m(p.purchasedMinor)}</td>
                        <td className="num">{m(p.paidMinor)}</td>
                        <td className="num err">{m(p.balanceMinor)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="row total" style={{ marginTop: 8 }}>
                  <span>Total still to pay</span>
                  <span>{m(data.owed.totalMinor)}</span>
                </div>
              </>
            ) : (
              <p className="muted">You don’t owe any party anything right now.</p>
            )}
            <p className="muted">
              This is separate from profit and from the figures above. It is as of today, whatever
              dates are chosen.
            </p>
          </div>
        </>
      )}
    </div>
  )
}
