import { useEffect, useMemo, useRef, useState } from 'react'
import type { Product, SerialUnit } from '../../../shared/types'
import { useSettings } from '../lib/useSettings'
import { formatMoney, parseMoney } from '../lib/money'
import type { PrintJob } from '../components/Print'
import { usePrinting } from '../lib/usePrinting'

interface Line {
  product: Product
  qty: number
  /** Phones: the IMEI of each unit on the bill (qty equals how many). */
  serials: string[]
}

export default function BillingPage({
  onPrint
}: {
  onPrint: (j: PrintJob) => void
}): React.JSX.Element {
  const { settings } = useSettings()
  const { printing } = usePrinting()
  const sym = settings?.currencySymbol ?? ''
  const m = (n: number): string => formatMoney(n, sym)
  const [lines, setLines] = useState<Line[]>([])
  const [scan, setScan] = useState('')
  const [results, setResults] = useState<Product[]>([])
  const [picking, setPicking] = useState<{ product: Product; units: SerialUnit[] } | null>(null)
  const [discount, setDiscount] = useState('')
  const [payment, setPayment] = useState('cash')
  const [customer, setCustomer] = useState('')
  const [cashIn, setCashIn] = useState('')
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const savingRef = useRef(false) // blocks a second click/Enter while a save is in flight
  const [saving, setSaving] = useState(false)

  useEffect(() => inputRef.current?.focus(), [])
  const [selectTick, setSelectTick] = useState(0)
  useEffect(() => {
    if (selectTick) inputRef.current?.select()
  }, [selectTick])

  // Clicking −, + or × moves focus onto a button (and × removes that button), so the scan box lost focus
  // and the next scan went nowhere. If typing starts while nothing useful has focus, send it to the scan box.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.key.length !== 1) return
      const t = document.activeElement
      if (
        t instanceof HTMLInputElement ||
        t instanceof HTMLTextAreaElement ||
        t instanceof HTMLSelectElement
      )
        return
      if (document.querySelector('[role="dialog"]')) return
      inputRef.current?.focus()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Cart lives in a ref as well as state so rapid scanner input never reads a stale cart,
  // and so state updates stay free of side effects.
  const linesRef = useRef<Line[]>([])
  function updateLines(next: Line[]): void {
    linesRef.current = next
    setLines(next)
  }

  /** Puts one specific phone (by IMEI) on the bill. */
  function addSerial(p: Product, serial: string): void {
    const cur = linesRef.current
    if (cur.some((l) => l.serials.includes(serial))) {
      setMsg({ ok: false, text: `IMEI ${serial} is already on this bill` })
      return
    }
    setMsg(null)
    const found = cur.find((l) => l.product.id === p.id)
    updateLines(
      found
        ? cur.map((l) =>
            l.product.id === p.id ? { ...l, qty: l.qty + 1, serials: [...l.serials, serial] } : l
          )
        : [...cur, { product: p, qty: 1, serials: [serial] }]
    )
  }

  // A phone product: choose which unit (IMEI) is being sold. A single unit in stock is picked for you.
  async function pickUnit(p: Product): Promise<void> {
    const r = await window.api.serials.list({ productId: p.id, status: 'in_stock' })
    const units = r.ok
      ? r.data.filter((u) => !linesRef.current.some((l) => l.serials.includes(u.serial)))
      : []
    if (!units.length)
      return setMsg({ ok: false, text: `No ${p.name} left to add (none in stock)` })
    if (units.length === 1) return addSerial(p, units[0].serial)
    setMsg(null)
    setPicking({ product: p, units })
  }

  function add(p: Product): void {
    if (p.trackSerial) {
      void pickUnit(p)
      return
    }
    const cur = linesRef.current
    const found = cur.find((l) => l.product.id === p.id)
    if ((found?.qty ?? 0) + 1 > p.stockQty) {
      setMsg({ ok: false, text: `Only ${p.stockQty} of ${p.name} in stock` })
      return
    }
    setMsg(null)
    updateLines(
      found
        ? cur.map((l) => (l.product.id === p.id ? { ...l, qty: l.qty + 1 } : l))
        : [...cur, { product: p, qty: 1, serials: [] }]
    )
  }

  // A USB QR scanner types the code and presses Enter. Typed text that isn't an exact code falls back to name search.
  // The input is cleared synchronously, before any await, so the next scan can start while this lookup is in flight.
  async function lookup(text: string): Promise<void> {
    const r = await window.api.products.byCode(text)
    if (r.ok && r.data) {
      add(r.data)
      setResults([])
      return
    }
    // A scanned IMEI puts that exact phone on the bill.
    const u = await window.api.serials.get(text)
    if (u.ok && u.data) {
      if (u.data.status === 'sold') {
        setMsg({
          ok: false,
          text: `IMEI ${u.data.serial} was already sold on ${u.data.billNo}${
            u.data.customerName ? ` to ${u.data.customerName}` : ''
          }`
        })
        if (inputRef.current && !inputRef.current.value) setScan(text)
        setSelectTick((t) => t + 1)
        return
      }
      const owner = await window.api.products.list(u.data.serial)
      const p = owner.ok ? owner.data.find((x) => x.id === u.data?.productId) : undefined
      if (p) {
        addSerial(p, u.data.serial)
        setResults([])
        return
      }
    }
    const s = await window.api.products.list(text)
    if (s.ok && s.data.length === 1) {
      add(s.data[0])
      setResults([])
      return
    }
    // Ambiguous or unknown: give the text back so the cashier can refine it (unless a new scan already began).
    if (inputRef.current && !inputRef.current.value) setScan(text)
    if (s.ok && s.data.length > 1) setResults(s.data.slice(0, 8))
    else {
      setMsg({ ok: false, text: `No product found for “${text}”` })
      // Highlight the unknown code so the next scan replaces it instead of being glued onto the end.
      // This runs from an effect after the text is back in the box (a timer could fire before that).
      setSelectTick((t) => t + 1)
    }
  }

  function onScanKey(e: React.KeyboardEvent<HTMLInputElement>): void {
    if (e.key !== 'Enter') return
    const text = e.currentTarget.value.trim()
    if (!text) return
    setScan('')
    e.currentTarget.value = ''
    void lookup(text)
  }

  const subtotal = useMemo(
    () => lines.reduce((a, l) => a + l.product.priceMinor * l.qty, 0),
    [lines]
  )
  const discountMinor = discount ? parseMoney(discount) : 0
  const taxable = Math.max(0, subtotal - (discountMinor ?? 0))
  const tax = Math.floor((taxable * (settings?.taxRateBp ?? 0) + 5000) / 10000)
  const total = taxable + tax

  function setQty(id: number, qty: number): void {
    updateLines(
      linesRef.current.flatMap((l) =>
        l.product.id !== id
          ? [l]
          : qty <= 0
            ? []
            : [{ ...l, qty: Math.min(qty, l.product.stockQty) }]
      )
    )
  }

  function removeSerial(id: number, serial: string): void {
    updateLines(
      linesRef.current.flatMap((l) => {
        if (l.product.id !== id) return [l]
        const serials = l.serials.filter((x) => x !== serial)
        return serials.length ? [{ ...l, serials, qty: serials.length }] : []
      })
    )
  }

  const tenderedMinor = payment === 'cash' && cashIn.trim() ? parseMoney(cashIn) : 0
  const change = tenderedMinor !== null && tenderedMinor > 0 ? tenderedMinor - total : 0

  async function checkout(): Promise<void> {
    if (savingRef.current) return
    if (tenderedMinor === null) return setMsg({ ok: false, text: 'Enter a valid cash amount' })
    if (tenderedMinor > 0 && tenderedMinor < total)
      return setMsg({ ok: false, text: 'Cash received is less than the total' })
    if (discountMinor === null) return setMsg({ ok: false, text: 'Enter a valid discount amount' })
    savingRef.current = true
    setSaving(true)
    const r = await window.api.bills
      .create({
        items: linesRef.current.map((l) => ({
          productId: l.product.id,
          qty: l.qty,
          ...(l.product.trackSerial ? { serials: l.serials } : {})
        })),
        discountMinor,
        paymentMethod: payment,
        customerName: customer,
        tenderedMinor: tenderedMinor ?? 0
      })
      .finally(() => {
        savingRef.current = false
        setSaving(false)
      })
    if (!r.ok) return setMsg({ ok: false, text: r.error })
    updateLines([])
    setDiscount('')
    setCustomer('')
    setCashIn('')
    setMsg({ ok: true, text: `Saved ${r.data.billNo}` })
    onPrint({ kind: 'receipt', bill: r.data })
    inputRef.current?.focus()
  }

  return (
    <div className="page billing">
      <div>
        <h1>New bill</h1>
        <input
          ref={inputRef}
          className="scan"
          placeholder="Scan QR code or type product name / code, then press Enter"
          value={scan}
          onChange={(e) => setScan(e.target.value)}
          onKeyDown={onScanKey}
          aria-label="Scan or search product"
        />
        {results.length > 0 && (
          <ul className="results">
            {results.map((p) => (
              <li key={p.id}>
                <button
                  onClick={() => {
                    add(p)
                    setResults([])
                    setScan('')
                    inputRef.current?.focus()
                  }}
                >
                  {p.name} <code>{p.code}</code> — {m(p.priceMinor)} ({p.stockQty} in stock)
                </button>
              </li>
            ))}
          </ul>
        )}
        {picking && (
          <div className="card" role="group" aria-label="Choose IMEI">
            <strong>Which {picking.product.name}? Choose the IMEI:</strong>
            <div className="add-buttons">
              {picking.units.map((u) => (
                <button
                  key={u.id}
                  onClick={() => {
                    addSerial(picking.product, u.serial)
                    setPicking(null)
                    inputRef.current?.focus()
                  }}
                >
                  {u.serial}
                  {u.condition === 'used' ? ' (used)' : ''}
                </button>
              ))}
              <button className="link" onClick={() => setPicking(null)}>
                Cancel
              </button>
            </div>
          </div>
        )}
        {msg && (
          <p className={msg.ok ? 'ok' : 'err'} role="status">
            {msg.text}
          </p>
        )}
        <div className="tablewrap">
          <table className="grid">
            <thead>
              <tr>
                <th>Item</th>
                <th className="num">Price</th>
                <th className="num">Qty</th>
                <th className="num">Total</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.product.id}>
                  <td>
                    {l.product.name}
                    {l.serials.length > 0 && (
                      <div>
                        {l.serials.map((sn) => (
                          <span key={sn} className="chip">
                            <code>{sn}</code>
                            <button
                              aria-label={`Remove IMEI ${sn}`}
                              onClick={() => {
                                removeSerial(l.product.id, sn)
                                inputRef.current?.focus()
                              }}
                            >
                              ×
                            </button>
                          </span>
                        ))}
                      </div>
                    )}
                  </td>
                  <td className="num">{m(l.product.priceMinor)}</td>
                  <td className="num qtycell">
                    {l.product.trackSerial ? (
                      <span className="qty">{l.qty}</span>
                    ) : (
                      <>
                        <button
                          onClick={() => {
                            setQty(l.product.id, l.qty - 1)
                            inputRef.current?.focus()
                          }}
                          aria-label="Decrease"
                        >
                          −
                        </button>
                        <span className="qty">{l.qty}</span>
                        <button
                          onClick={() => {
                            setQty(l.product.id, l.qty + 1)
                            inputRef.current?.focus()
                          }}
                          aria-label="Increase"
                        >
                          +
                        </button>
                      </>
                    )}
                  </td>
                  <td className="num">{m(l.product.priceMinor * l.qty)}</td>
                  <td>
                    <button
                      className="danger"
                      onClick={() => {
                        setQty(l.product.id, 0)
                        inputRef.current?.focus()
                      }}
                      aria-label={`Remove ${l.product.name}`}
                    >
                      ×
                    </button>
                  </td>
                </tr>
              ))}
              {!lines.length && (
                <tr>
                  <td colSpan={5} className="muted center">
                    Scan a product to start the bill.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      <aside className="summary">
        <div className="row">
          <span>Subtotal</span>
          <span>{m(subtotal)}</span>
        </div>
        <label>
          Discount
          <input
            value={discount}
            inputMode="decimal"
            onChange={(e) => setDiscount(e.target.value)}
            placeholder="0.00"
          />
        </label>
        <div className="row">
          <span>Tax ({(settings?.taxRateBp ?? 0) / 100}%)</span>
          <span>{m(tax)}</span>
        </div>
        <div className="row total">
          <span>Total</span>
          <span>{m(total)}</span>
        </div>
        <label>
          Payment
          <select value={payment} onChange={(e) => setPayment(e.target.value)}>
            <option value="cash">Cash</option>
            <option value="card">Card</option>
            <option value="mobile">Mobile wallet</option>
            <option value="credit">Credit</option>
          </select>
        </label>
        {payment === 'cash' && (
          <>
            <label>
              Cash received (optional)
              <input
                value={cashIn}
                inputMode="decimal"
                placeholder="0.00"
                onChange={(e) => setCashIn(e.target.value)}
              />
            </label>
            {change > 0 && (
              <div className="row" data-testid="change-due">
                <span>Change</span>
                <span>{m(change)}</span>
              </div>
            )}
          </>
        )}
        <label>
          Customer (optional)
          <input value={customer} onChange={(e) => setCustomer(e.target.value)} />
        </label>
        <button
          className="primary big"
          disabled={!lines.length || saving || printing}
          onClick={checkout}
        >
          Save &amp; print bill
        </button>
        <button disabled={!lines.length} onClick={() => updateLines([])}>
          Clear
        </button>
      </aside>
    </div>
  )
}
