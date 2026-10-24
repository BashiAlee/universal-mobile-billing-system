import { Fragment, useCallback, useEffect, useRef, useState } from 'react'
import type { Product, Purchase } from '../../../shared/types'
import { useSettings } from '../lib/useSettings'
import { formatMoney, minorToInput, parseMoney } from '../lib/money'

interface Line {
  key: string
  /** An existing product; a line without one creates a new product from `newName`. */
  product?: Product
  newName?: string
  /** Selling price of a new product. */
  price: string
  qty: string
  total: string
}
const lineName = (l: Line): string => l.product?.name ?? l.newName ?? ''

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
  const [nPaid, setNPaid] = useState('')
  const [paid, setPaid] = useState('')
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
      cur.some((l) => l.product?.id === p.id)
        ? cur
        : [...cur, { key: `p${p.id}`, product: p, price: '', qty: '', total: '' }]
    )
    setPick('')
    setOptions([])
    pickRef.current?.focus()
  }

  // A product that doesn't exist yet is created together with the purchase.
  function addNew(): void {
    const name = pick.trim()
    if (!name) return
    setLines((cur) => [
      ...cur,
      { key: `n${Date.now()}-${cur.length}`, newName: name, price: '', qty: '', total: '' }
    ])
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

  const setLine = (key: string, patch: Partial<Line>): void =>
    setLines((cur) => cur.map((l) => (l.key === key ? { ...l, ...patch } : l)))

  const parsed = lines.map((l) => ({
    qty: Number(l.qty),
    total: parseMoney(l.total),
    price: parseMoney(l.price)
  }))
  const grand = parsed.reduce((a, p) => a + (p.total ?? 0), 0)
  const paidNow = paid.trim() ? parseMoney(paid) : grand

  function reset(): void {
    setCreating(false)
    setSupplier('')
    setNote('')
    setPaid('')
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
    setNPaid('')
  }

  async function saveNote(): Promise<void> {
    if (savingRef.current) return
    const amount = parseMoney(nAmount)
    if (!nSupplier.trim()) return setMsg({ ok: false, text: 'Enter the supplier name' })
    if (!nWhat.trim()) return setMsg({ ok: false, text: 'Describe what you bought' })
    if (amount === null || amount <= 0)
      return setMsg({ ok: false, text: 'Enter the amount, e.g. 10000' })
    const nPaidMinor = nPaid.trim() ? parseMoney(nPaid) : amount
    if (nPaidMinor === null || nPaidMinor > amount)
      return setMsg({ ok: false, text: 'Paid now must be a valid amount, not more than the total' })
    savingRef.current = true
    setSaving(true)
    const r = await window.api.purchases
      .note({
        supplierName: nSupplier,
        description: nWhat,
        amountMinor: amount,
        paidMinor: nPaidMinor,
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
        return setMsg({ ok: false, text: `Enter a whole quantity for ${lineName(lines[i])}` })
      if (total === null)
        return setMsg({ ok: false, text: `Enter the total cost for ${lineName(lines[i])}` })
      if (!lines[i].product && parsed[i].price === null)
        return setMsg({
          ok: false,
          text: `Enter the selling price for the new product ${lineName(lines[i])}`
        })
    }
    if (paidNow === null || paidNow > grand)
      return setMsg({ ok: false, text: 'Paid now must be a valid amount, not more than the total' })
    savingRef.current = true
    setSaving(true)
    const r = await window.api.purchases
      .create({
        supplierName: supplier,
        note,
        paidMinor: paidNow,
        items: lines.map((l, i) => ({
          ...(l.product
            ? { productId: l.product.id }
            : { newProduct: { name: l.newName as string, priceMinor: parsed[i].price as number } }),
          qty: parsed[i].qty,
          totalCostMinor: parsed[i].total as number
        }))
      })
      .finally(() => {
        savingRef.current = false
        setSaving(false)
      })
    if (!r.ok) return setMsg({ ok: false, text: r.error })
    setMsg({
      ok: true,
      text: `Saved ${r.data.purchaseNo}: stock updated${
        r.data.totalMinor > r.data.paidMinor
          ? `, ${m(r.data.totalMinor - r.data.paidMinor)} still due`
          : ''
      }`
    })
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
            Paid now (leave empty if paid in full)
            <input
              value={nPaid}
              inputMode="decimal"
              onChange={(e) => setNPaid(e.target.value)}
              placeholder="e.g. 4000"
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
          {pick.trim() && (
            <p className="muted">
              {options.length === 0 && 'No product matches. '}
              <button className="link" onClick={addNew}>
                Add “{pick.trim()}” as a new product
              </button>{' '}
              (it is created automatically with this purchase).
            </p>
          )}
          <table className="grid">
            <thead>
              <tr>
                <th>Product</th>
                <th>Selling price (new products)</th>
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
                  <tr key={l.key}>
                    <td>
                      {lineName(l)}
                      {!l.product && <span className="muted"> (new)</span>}
                    </td>
                    <td>
                      {l.product ? (
                        <span className="muted">{m(l.product.priceMinor)}</span>
                      ) : (
                        <input
                          value={l.price}
                          inputMode="decimal"
                          aria-label={`Selling price of ${lineName(l)}`}
                          placeholder="e.g. 250"
                          onChange={(e) => setLine(l.key, { price: e.target.value })}
                        />
                      )}
                    </td>
                    <td>
                      <input
                        value={l.qty}
                        inputMode="numeric"
                        aria-label={`Quantity of ${lineName(l)}`}
                        onChange={(e) => setLine(l.key, { qty: e.target.value })}
                      />
                    </td>
                    <td>
                      <input
                        value={l.total}
                        inputMode="decimal"
                        aria-label={`Total cost of ${lineName(l)}`}
                        placeholder="e.g. 10000"
                        onChange={(e) => setLine(l.key, { total: e.target.value })}
                      />
                    </td>
                    <td className="num">{each === null ? '-' : m(each)}</td>
                    <td>
                      <button
                        className="danger"
                        aria-label={`Remove ${lineName(l)}`}
                        onClick={() => setLines((cur) => cur.filter((x) => x.key !== l.key))}
                      >
                        ×
                      </button>
                    </td>
                  </tr>
                )
              })}
              {!lines.length && (
                <tr>
                  <td colSpan={6} className="muted center">
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
          <label>
            Paid now (leave empty if paid in full)
            <input
              value={paid}
              inputMode="decimal"
              placeholder={minorToInput(grand)}
              aria-label="Paid now"
              onChange={(e) => setPaid(e.target.value)}
            />
          </label>
          <div className="row total">
            <span>Total</span>
            <span>{m(grand)}</span>
          </div>
          <div className="row">
            <span>Still due to supplier</span>
            <span>{paidNow === null || paidNow > grand ? '-' : m(grand - paidNow)}</span>
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
            <th className="num">Due</th>
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
                <td className={`num ${p.totalMinor > p.paidMinor ? 'err' : ''}`}>
                  {p.totalMinor > p.paidMinor ? m(p.totalMinor - p.paidMinor) : '-'}
                </td>
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
                  <td colSpan={7}>
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
              <td colSpan={7} className="muted center">
                No purchases recorded yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}
