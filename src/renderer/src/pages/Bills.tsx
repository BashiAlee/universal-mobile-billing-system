import { Fragment, useEffect, useState } from 'react'
import type { Bill } from '../../../shared/types'
import { useSettings } from '../lib/useSettings'
import { formatMoney } from '../lib/money'
import type { PrintJob } from '../components/Print'

export default function BillsPage({
  onPrint
}: {
  onPrint: (j: PrintJob) => void
}): React.JSX.Element {
  const { settings } = useSettings()
  const sym = settings?.currencySymbol ?? ''
  const [bills, setBills] = useState<Bill[]>([])
  const [search, setSearch] = useState('')
  const [open, setOpen] = useState<number | null>(null)

  useEffect(() => {
    void window.api.bills.list(search).then((r) => r.ok && setBills(r.data))
  }, [search])

  return (
    <div className="page">
      <div className="toolbar">
        <h1>Bill history</h1>
        <input
          placeholder="Search bill no., customer or IMEI"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search bills"
        />
      </div>
      <table className="grid">
        <thead>
          <tr>
            <th>Bill</th>
            <th>Date</th>
            <th>Customer</th>
            <th>Payment</th>
            <th className="num">Total</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {bills.map((b) => (
            <Fragment key={b.id}>
              <tr>
                <td>{b.billNo}</td>
                <td>{new Date(b.createdAt).toLocaleString()}</td>
                <td>{b.customerName}</td>
                <td>{b.paymentMethod}</td>
                <td className="num">{formatMoney(b.totalMinor, sym)}</td>
                <td className="actions">
                  <button onClick={() => setOpen(open === b.id ? null : b.id)}>
                    {open === b.id ? 'Hide' : 'View'}
                  </button>
                  <button onClick={() => onPrint({ kind: 'receipt', bill: b })}>Reprint</button>
                </td>
              </tr>
              {open === b.id && (
                <tr>
                  <td colSpan={6}>
                    <ul className="detail">
                      {b.items.map((i) => (
                        <li key={i.id}>
                          {i.name}
                          {i.serial
                            ? ` (IMEI ${i.serial}${i.serial2 ? ` / ${i.serial2}` : ''})`
                            : ''}{' '}
                          — {i.qty} × {formatMoney(i.unitPriceMinor, sym)} ={' '}
                          {formatMoney(i.lineTotalMinor, sym)}
                        </li>
                      ))}
                    </ul>
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
          {!bills.length && (
            <tr>
              <td colSpan={6} className="muted center">
                No bills yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}
