import { Fragment, useCallback, useEffect, useRef, useState } from 'react'
import type { Product, Purchase } from '../../../shared/types'
import { useSettings } from '../lib/useSettings'
import { formatMoney, parseMoney } from '../lib/money'

interface Line {
  product: Product
  qty: string
  total: string
}

export default function PurchasesPage(): React.JSX.Element {
  const { settings } = useSettings()
  const sym = settings?.currencySymbol ?? ''
  const m = (n: number): string => formatMoney(n, sym)
  const [history, setHistory] = useState<Purchase[]>([])
  const [suppliers, setSuppliers] = useState<string[]>([])
  const [open, setOpen] = useState<number | null>(null)
  const savingRef = useRef(false) // blocks a second click while a save is in flight
  const [saving, setSaving] = useState(false)
  const [search, setSearch] = useState('')

  const [creating, setCreating] = useState(false)
  // Stock-free "who I bought from, what, how much" entry.
  const [noting, setNoting] = useState(false)
  const [nSupplier, setNSupplier] = useState('')
  const [nWhat, setNWhat] = useState('')
  const [nAmount, setNAmount] = useState('')
  const [nDate, setNDate] = useState('')
  const [supplier, setSupplier] = useState('')
  const [note, setNote] = useState('')
  const [lines, setLines] = useState<Line[]>([])
  const [pick, setPick] = useState('')
  const [options, setOptions] = useState<Product[]>([])
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const pickRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    const [h, s] = await Promise.all([
      window.api.purchases.list(search),
      window.api.purchases.suppliers()
    ])
    if (h.ok) setHistory(h.data)
    if (s.ok) setSuppliers(s.data)
  }, [search])
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()
  }, [load])

  async function search_(text: string): Promise<void> {
    setPick(text)
    if (!text.trim()) return setOptions([])
    const r = await window.api.products.list(text)
    if (r.ok) setOptions(r.data.slice(0, 8))
  }

  function addProduct(p: Product): void {
    setLines((cur) =>
      cur.some((l) => l.product.id === p.id) ? cur : [...cur, { product: p, qty: '', total: '' }]
    )
    setPick('')
    setOptions([])
    pickRef.current?.focus()
  }

  // Scanning a product label here also works (exact code match).
  async function onPickEnter(): Promise<void> {
    const text = pick.trim()
    if (!text) return
    const r = await window.api.products.byCode(text)
    if (r.ok && r.data) return addProduct(r.data)
    if (options.length === 1) addProduct(options[0])
  }

  const setLine = (id: number, patch: Partial<Line>): void =>
    setLines((cur) => cur.map((l) => (l.product.id === id ? { ...l, ...patch } : l)))

  const parsed = lines.map((l) => ({ qty: Number(l.qty), total: parseMoney(l.total) }))
  const grand = parsed.reduce((a, p) => a + (p.total ?? 0), 0)

  function reset(): void {
    setCreating(false)
    setSupplier('')
    setNote('')
    setLines([])
    setPick('')
    setOptions([])
  }

  function resetNote(): void {
    setNoting(false)
    setNSupplier('')
    setNWhat('')
    setNAmount('')
    setNDate('')
  }

  async function saveNote(): Promise<void> {
    if (savingRef.current) return
    const amount = parseMoney(nAmount)
    if (!nSupplier.trim()) return setMsg({ ok: false, text: 'Enter the supplier name' })
    if (!nWhat.trim()) return setMsg({ ok: false, text: 'Describe what you bought' })
    if (amount === null || amount <= 0)
      return setMsg({ ok: false, text: 'Enter the amount, e.g. 10000' })
    savingRef.current = true
    setSaving(true)
    const r = await window.api.purchases
      .note({
        supplierName: nSupplier,
        description: nWhat,
        amountMinor: amount,
        date: nDate || undefined
      })
      .finally(() => {
        savingRef.current = false
        setSaving(false)
      })
    if (!r.ok) return setMsg({ ok: false, text: r.error })
    setMsg({ ok: true, text: `Saved ${r.data.purchaseNo} (stock not changed)` })
    resetNote()
    void load()
  }

  async function save(): Promise<void> {
    if (savingRef.current) return
    if (!supplier.trim()) return setMsg({ ok: false, text: 'Enter the supplier name' })
    for (let i = 0; i < lines.length; i++) {
      const { qty, total } = parsed[i]
      if (!Number.isInteger(qty) || qty <= 0)
        return setMsg({ ok: false, text: `Enter a whole quantity for ${lines[i].product.name}` })
      if (total === null)
        return setMsg({ ok: false, text: `Enter the total cost for ${lines[i].product.name}` })
    }
    savingRef.current = true
    setSaving(true)
    const r = await window.api.purchases
      .create({
        supplierName: supplier,
        note,
        items: lines.map((l, i) => ({
          productId: l.product.id,
          qty: parsed[i].qty,
          totalCostMinor: parsed[i].total as number
        }))
      })
      .finally(() => {
        savingRef.current = false
        setSaving(false)
      })
    if (!r.ok) return setMsg({ ok: false, text: r.error })
    setMsg({ ok: true, text: `Saved ${r.data.purchaseNo}: stock updated` })
    reset()
    void load()
  }

  return (
    <div className="page">
      <div className="toolbar">
        <h1>Purchases from suppliers</h1>
        {!creating && !noting && (
          <>
            <input
              placeholder="Search purchase no. or supplier"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search purchases"
            />
            <button
              className="primary"
              onClick={() => {
                setCreating(true)
                setMsg(null)
              }}
            >
              + New purchase
            </button>
            <button
              onClick={() => {
                setNoting(true)
                setMsg(null)
              }}
            >
              + Quick note (no stock)
            </button>
          </>
        )}
      </div>
      {msg && (
        <p className={msg.ok ? 'ok' : 'err'} role="status">
          {msg.text}
        </p>
      )}

      {noting && (
        <form
          className="card form wide"
          onSubmit={(e) => {
            e.preventDefault()
            void saveNote()
          }}
        >
          <h2>Quick note</h2>
          <p className="muted">
            Just remember who you bought from and how much it cost. This does not change your stock.
          </p>
          <label>
            Supplier
            <input
              list="suppliers"
              value={nSupplier}
              onChange={(e) => setNSupplier(e.target.value)}
              placeholder="e.g. ABC Traders"
              autoFocus
            />
            <datalist id="suppliers">
              {suppliers.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
          </label>
          <label>
            What did you buy?
            <input
              value={nWhat}
              onChange={(e) => setNWhat(e.target.value)}
              placeholder="e.g. 200 phone covers"
            />
          </label>
          <label>
            Total cost
            <input
              value={nAmount}
              inputMode="decimal"
              onChange={(e) => setNAmount(e.target.value)}
              placeholder="e.g. 10000"
            />
          </label>
          <label>
            Date (optional, today if empty)
            <input type="date" value={nDate} onChange={(e) => setNDate(e.target.value)} />
          </label>
          <div className="row-end">
            <button type="button" onClick={resetNote}>
              Cancel
            </button>
            <button type="submit" className="primary" disabled={saving}>
              Save note
            </button>
          </div>
        </form>
      )}

      {creating && (
        <div className="card form wide">
          <h2>New purchase</h2>
          <label>
            Supplier
            <input
              list="suppliers"
              value={supplier}
              onChange={(e) => setSupplier(e.target.value)}
              placeholder="e.g. ABC Traders"
            />
            <datalist id="suppliers">
              {suppliers.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
          </label>
          <label>
            Add product (type name or scan its label, then Enter)
            <input
              ref={pickRef}
              value={pick}
              onChange={(e) => void search_(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void onPickEnter()}
              aria-label="Find product to add"
            />
          </label>
          {options.length > 0 && (
            <ul className="results">
              {options.map((p) => (
                <li key={p.id}>
                  <button onClick={() => addProduct(p)}>
                    {p.name} <code>{p.code}</code> ({p.stockQty} in stock)
                  </button>
                </li>
              ))}
            </ul>
          )}
          {pick.trim() && options.length === 0 && (
            <p className="muted">
              No product matches. Add it first in “Products &amp; stock” (with 0 opening stock),
              then come back.
            </p>
          )}
          <table className="grid">
            <thead>
              <tr>
                <th>Product</th>
                <th>Quantity bought</th>
                <th>Total cost for this quantity</th>
                <th className="num">Cost each</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => {
                const each =
                  parsed[i].total !== null && parsed[i].qty > 0
                    ? Math.round((parsed[i].total as number) / parsed[i].qty)
                    : null
                return (
                  <tr key={l.product.id}>
                    <td>{l.product.name}</td>
                    <td>
                      <input
                        value={l.qty}
                        inputMode="numeric"
                        aria-label={`Quantity of ${l.product.name}`}
                        onChange={(e) => setLine(l.product.id, { qty: e.target.value })}
                      />
                    </td>
                    <td>
                      <input
                        value={l.total}
                        inputMode="decimal"
                        aria-label={`Total cost of ${l.product.name}`}
                        placeholder="e.g. 10000"
                        onChange={(e) => setLine(l.product.id, { total: e.target.value })}
                      />
                    </td>
                    <td className="num">{each === null ? '-' : m(each)}</td>
                    <td>
                      <button
                        className="danger"
                        aria-label={`Remove ${l.product.name}`}
                        onClick={() =>
                          setLines((cur) => cur.filter((x) => x.product.id !== l.product.id))
                        }
                      >
                        ×
                      </button>
                    </td>
                  </tr>
                )
              })}
              {!lines.length && (
                <tr>
                  <td colSpan={5} className="muted center">
                    Add the products you bought.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          <label>
            Note (optional)
            <input value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
          <div className="row total">
            <span>Total</span>
            <span>{m(grand)}</span>
          </div>
          <div className="row-end">
            <button onClick={reset}>Cancel</button>
            <button className="primary" disabled={!lines.length || saving} onClick={save}>
              Save purchase &amp; add to stock
            </button>
          </div>
        </div>
      )}

      <table className="grid">
        <thead>
          <tr>
            <th>Purchase</th>
            <th>Date</th>
            <th>Supplier</th>
            <th>Covers</th>
            <th className="num">Total</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {history.map((p) => (
            <Fragment key={p.id}>
              <tr>
                <td>{p.purchaseNo}</td>
                <td>{new Date(p.createdAt).toLocaleString()}</td>
                <td>{p.supplierName}</td>
                <td>
                  {p.items.length ? p.items.map((i) => `${i.qty} ${i.name}`).join(', ') : p.note}
                </td>
                <td className="num">{m(p.totalMinor)}</td>
                <td>
                  {p.items.length > 0 && (
                    <button onClick={() => setOpen(open === p.id ? null : p.id)}>
                      {open === p.id ? 'Hide' : 'View'}
                    </button>
                  )}
                </td>
              </tr>
              {open === p.id && (
                <tr>
                  <td colSpan={6}>
                    <ul className="detail">
                      {p.items.map((i) => (
                        <li key={i.id}>
                          {i.name}: {i.qty} for {m(i.lineTotalMinor)} ({m(i.unitCostMinor)} each)
                        </li>
                      ))}
                      {p.note && <li className="muted">Note: {p.note}</li>}
                    </ul>
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
          {!history.length && (
            <tr>
              <td colSpan={6} className="muted center">
                No purchases recorded yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}
