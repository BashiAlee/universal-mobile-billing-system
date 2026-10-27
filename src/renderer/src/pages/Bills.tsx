import { Fragment, useEffect, useState } from 'react'
import type { Bill, RefundMethod, ReturnQuote, ReturnRecord } from '../../../shared/types'
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
  const [returns, setReturns] = useState<ReturnRecord[]>([])
  // The "Return items" window: how many of each line come back, and how the customer is repaid.
  const [ret, setRet] = useState<{
    bill: Bill
    qty: Record<number, number>
    method: RefundMethod
    reason: string
    restock: boolean
  } | null>(null)
  const [quote, setQuote] = useState<ReturnQuote | null>(null)
  const [retErr, setRetErr] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    void window.api.bills.list(search).then((r) => r.ok && setBills(r.data))
    void window.api.returns.list('').then((r) => r.ok && setReturns(r.data))
  }, [search, reload])

  // Ask the program what the chosen items are worth (it shares the bill's discount and tax between them).
  useEffect(() => {
    if (!ret) return
    const items = Object.entries(ret.qty)
      .filter(([, q]) => q > 0)
      .map(([id, q]) => ({ billItemId: Number(id), qty: q }))
    if (!items.length) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setQuote(null)
      return
    }
    void window.api.returns
      .quote({ billId: ret.bill.id, items, refundMethod: ret.method })
      .then((r) => {
        setQuote(r.ok ? r.data : null)
        setRetErr(r.ok ? '' : r.error)
      })
  }, [ret])

  const fullyReturned = (b: Bill): boolean => b.items.every((i) => i.returnedQty >= i.qty)

  function startReturn(b: Bill): void {
    const m = b.paymentMethod
    setRet({
      bill: b,
      qty: {},
      method: (['cash', 'card', 'mobile', 'credit'] as string[]).includes(m)
        ? (m as RefundMethod)
        : 'cash',
      reason: '',
      restock: true
    })
    setQuote(null)
    setRetErr('')
  }

  async function saveReturn(): Promise<void> {
    if (!ret || saving) return
    const items = Object.entries(ret.qty)
      .filter(([, q]) => q > 0)
      .map(([id, q]) => ({ billItemId: Number(id), qty: q }))
    setSaving(true)
    const r = await window.api.returns.create({
      billId: ret.bill.id,
      items,
      refundMethod: ret.method,
      reason: ret.reason,
      restock: ret.restock
    })
    setSaving(false)
    if (!r.ok) return setRetErr(r.error)
    const how =
      r.data.refundMethod === 'credit'
        ? 'no money handed back (the bill was on credit)'
        : r.data.refundMethod === 'exchange'
          ? 'counted as money given back; now make the new bill for the replacement, and the customer pays only the difference'
          : `refund ${formatMoney(r.data.refundMinor, sym)} by ${r.data.refundMethod}`
    setMsg({ ok: true, text: `Return ${r.data.returnNo} saved: ${how}.` })
    setRet(null)
    setOpen(null)
    setReload((n) => n + 1)
  }

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
                <td className="num">
                  {formatMoney(b.totalMinor, sym)}
                  {b.refundedMinor > 0 && (
                    <div className="muted">refunded {formatMoney(b.refundedMinor, sym)}</div>
                  )}
                </td>
                <td className="actions">
                  <button onClick={() => setOpen(open === b.id ? null : b.id)}>
                    {open === b.id ? 'Hide' : 'View'}
                  </button>
                  <button disabled={printing} onClick={() => onPrint({ kind: 'receipt', bill: b })}>
                    {printing ? 'Printing…' : 'Reprint'}
                  </button>
                  <button
                    aria-label={`Return items from ${b.billNo}`}
                    disabled={fullyReturned(b)}
                    onClick={() => startReturn(b)}
                  >
                    Return
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
                          {i.returnedQty > 0 && (
                            <span className="err"> (returned {i.returnedQty})</span>
                          )}
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

      <h2>Returns</h2>
      <table className="grid">
        <thead>
          <tr>
            <th>Return</th>
            <th>Date</th>
            <th>Bill</th>
            <th>Items</th>
            <th>Made by</th>
            <th className="num">Refund</th>
          </tr>
        </thead>
        <tbody>
          {returns.map((r) => (
            <tr key={r.id}>
              <td>{r.returnNo}</td>
              <td>{new Date(r.createdAt).toLocaleString()}</td>
              <td>{r.billNo}</td>
              <td>
                {r.items
                  .map((i) => `${i.qty} × ${i.name}${i.serial ? ` (IMEI ${i.serial})` : ''}`)
                  .join(', ')}
                <div className="muted">
                  {r.refundMethod}
                  {r.restocked ? ', back in stock' : ', not put back in stock'}
                  {r.reason ? ` · ${r.reason}` : ''}
                </div>
              </td>
              <td>{r.createdBy}</td>
              <td className="num">{formatMoney(r.refundMinor, sym)}</td>
            </tr>
          ))}
          {!returns.length && (
            <tr>
              <td colSpan={6} className="muted center">
                No returns yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {ret && (
        <div className="modal" role="dialog" aria-modal="true" aria-label="Return items">
          <form
            className="modal-card form"
            style={{ width: 620, maxWidth: '95vw' }}
            onSubmit={(e) => {
              e.preventDefault()
              void saveReturn()
            }}
            onKeyDown={(e) => e.key === 'Escape' && setRet(null)}
          >
            <h2>Return items from {ret.bill.billNo}</h2>
            <table className="grid">
              <thead>
                <tr>
                  <th>Item</th>
                  <th className="num">Sold</th>
                  <th className="num">Returned before</th>
                  <th className="num">Return now</th>
                </tr>
              </thead>
              <tbody>
                {ret.bill.items.map((i) => {
                  const left = i.qty - i.returnedQty
                  return (
                    <tr key={i.id}>
                      <td>
                        {i.name}
                        {i.serial && <div className="muted">IMEI {i.serial}</div>}
                      </td>
                      <td className="num">{i.qty}</td>
                      <td className="num">{i.returnedQty}</td>
                      <td className="num">
                        <input
                          style={{ width: 70 }}
                          type="number"
                          min={0}
                          max={left}
                          disabled={left === 0}
                          value={ret.qty[i.id] ?? 0}
                          aria-label={`Return quantity of ${i.name}`}
                          onChange={(e) =>
                            setRet({
                              ...ret,
                              qty: {
                                ...ret.qty,
                                [i.id]: Math.max(
                                  0,
                                  Math.min(left, Math.floor(Number(e.target.value) || 0))
                                )
                              }
                            })
                          }
                        />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            <label>
              Refund the customer by
              <select
                value={ret.method}
                onChange={(e) => setRet({ ...ret, method: e.target.value as RefundMethod })}
              >
                <option value="cash">Cash</option>
                <option value="card">Card</option>
                <option value="mobile">Mobile wallet</option>
                <option value="exchange">Exchange (customer takes another item)</option>
                <option value="credit">No money handed back (the bill was on credit)</option>
              </select>
            </label>
            <label className="inline">
              <input
                type="checkbox"
                checked={ret.restock}
                onChange={(e) => setRet({ ...ret, restock: e.target.checked })}
              />
              Put the items back in stock (untick for damaged goods that are thrown away)
            </label>
            <label>
              Reason (optional)
              <input
                value={ret.reason}
                onChange={(e) => setRet({ ...ret, reason: e.target.value })}
              />
            </label>
            <div className="row total">
              <span>Value of returned items</span>
              <span aria-label="Refund amount">{formatMoney(quote?.refundMinor ?? 0, sym)}</span>
            </div>
            {quote && quote.taxMinor > 0 && (
              <p className="muted" style={{ margin: 0 }}>
                includes tax {formatMoney(quote.taxMinor, sym)}; the bill’s discount is shared
                between the items
              </p>
            )}
            {retErr && (
              <p className="err" role="alert">
                {retErr}
              </p>
            )}
            <div className="row-end">
              <button type="button" onClick={() => setRet(null)}>
                Cancel
              </button>
              <button type="submit" className="primary" disabled={!quote || saving}>
                {saving ? 'Saving…' : 'Save return'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}
