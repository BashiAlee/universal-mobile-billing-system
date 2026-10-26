import { Fragment, useEffect, useState } from 'react'
import type { Bill } from '../../../shared/types'
import { useSettings } from '../lib/useSettings'
import { formatMoney } from '../lib/money'
import type { PrintJob } from '../components/Print'
import { usePrinting } from '../lib/usePrinting'

export default function BillsPage({
  onPrint
}: {
  onPrint: (j: PrintJob) => void
}): React.JSX.Element {
  const { settings } = useSettings()
  const { printing } = usePrinting()
  const sym = settings?.currencySymbol ?? ''
  const [bills, setBills] = useState<Bill[]>([])
  const [search, setSearch] = useState('')
  const [open, setOpen] = useState<number | null>(null)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [reload, setReload] = useState(0)

  useEffect(() => {
    void window.api.bills.list(search).then((r) => r.ok && setBills(r.data))
  }, [search, reload])

  async function remove(b: Bill): Promise<void> {
    if (
      !window.confirm(
        `Delete ${b.billNo}?\n\nIts items go back into stock, and it disappears from sales, profit and the day book. This cannot be undone.`
      )
    )
      return
    const r = await window.api.bills.delete(b.id)
    setMsg(
      r.ok
        ? { ok: true, text: `Deleted ${b.billNo}; items are back in stock` }
        : { ok: false, text: r.error }
    )
    setOpen(null)
    setReload((n) => n + 1)
  }

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
      {msg && (
        <p className={msg.ok ? 'ok' : 'err'} role="status">
          {msg.text}
        </p>
      )}
      <table className="grid">
        <thead>
          <tr>
            <th>Bill</th>
            <th>Date</th>
            <th>Customer</th>
            <th>Made by</th>
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
                <td>{b.createdBy}</td>
                <td>{b.paymentMethod}</td>
                <td className="num">{formatMoney(b.totalMinor, sym)}</td>
                <td className="actions">
                  <button onClick={() => setOpen(open === b.id ? null : b.id)}>
                    {open === b.id ? 'Hide' : 'View'}
                  </button>
                  <button disabled={printing} onClick={() => onPrint({ kind: 'receipt', bill: b })}>
                    {printing ? 'Printing…' : 'Reprint'}
                  </button>
                  <button
                    className="danger"
                    aria-label={`Delete ${b.billNo}`}
                    onClick={() => void remove(b)}
                  >
                    Delete
                  </button>
                </td>
              </tr>
              {open === b.id && (
                <tr>
                  <td colSpan={7}>
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
                    {(b.discountMinor > 0 || b.taxMinor > 0) && (
                      <p className="muted">
                        Subtotal {formatMoney(b.subtotalMinor, sym)}
                        {b.discountMinor > 0 && ` · Discount ${formatMoney(b.discountMinor, sym)}`}
                        {b.taxMinor > 0 && ` · Tax ${formatMoney(b.taxMinor, sym)}`}
                      </p>
                    )}
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
          {!bills.length && (
            <tr>
              <td colSpan={7} className="muted center">
                No bills yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}
