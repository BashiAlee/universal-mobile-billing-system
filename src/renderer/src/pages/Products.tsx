import { useCallback, useEffect, useState } from 'react'
import type { LabelDesign, Product } from '../../../shared/types'
import { useSettings } from '../lib/useSettings'
import { formatMoney, minorToInput, parseMoney } from '../lib/money'
import { LabelPreview } from '../components/LabelView'
import { standardDesign } from '../lib/labelDesign'
import type { PrintJob } from '../components/Print'

interface Form {
  id?: number
  name: string
  code: string
  price: string
  cost: string
  stock: string
  low: string
}
const EMPTY: Form = { name: '', code: '', price: '', cost: '', stock: '0', low: '0' }

export default function ProductsPage({
  onPrint
}: {
  onPrint: (j: PrintJob) => void
}): React.JSX.Element {
  const { settings } = useSettings()
  const sym = settings?.currencySymbol ?? ''
  const [items, setItems] = useState<Product[]>([])
  const [search, setSearch] = useState('')
  const [form, setForm] = useState<Form | null>(null)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [qrFor, setQrFor] = useState<Product | null>(null)
  const [err, setErr] = useState('')
  // window.prompt() is unsupported in Electron, so stock changes and label copies use an in-app dialog.
  const [ask, setAsk] = useState<
    { kind: 'stock'; product: Product } | { kind: 'labels'; products: Product[] } | null
  >(null)
  const [askVal, setAskVal] = useState('')
  const [askErr, setAskErr] = useState('')
  const [designs, setDesigns] = useState<LabelDesign[]>([])
  const [designId, setDesignId] = useState(0)

  const load = useCallback(async () => {
    const r = await window.api.products.list(search)
    if (r.ok) setItems(r.data)
  }, [search])
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()
  }, [load])

  async function save(): Promise<void> {
    if (!form) return
    const price = parseMoney(form.price)
    const cost = form.cost ? parseMoney(form.cost) : 0
    const stock = Number(form.stock)
    const low = Number(form.low)
    if (!form.name.trim()) return setErr('Name is required')
    if (price === null) return setErr('Enter a valid price, e.g. 120 or 120.50')
    if (cost === null) return setErr('Enter a valid cost price')
    if (!Number.isInteger(stock) || stock < 0 || !Number.isInteger(low) || low < 0)
      return setErr('Stock and low-stock level must be whole numbers')
    const base = {
      name: form.name,
      code: form.code || undefined,
      priceMinor: price,
      costMinor: cost,
      lowStockThreshold: low
    }
    const r = form.id
      ? await window.api.products.update(form.id, base)
      : await window.api.products.create({ ...base, stockQty: stock })
    if (!r.ok)
      return setErr(
        r.error.includes('UNIQUE') ? 'That code is already used by another product' : r.error
      )
    setForm(null)
    setErr('')
    void load()
  }

  function restock(p: Product): void {
    setAsk({ kind: 'stock', product: p })
    setAskVal('1')
    setAskErr('')
  }

  async function remove(p: Product): Promise<void> {
    if (!window.confirm(`Remove "${p.name}"? Past bills keep their history.`)) return
    await window.api.products.deactivate(p.id)
    void load()
  }

  /** Loads the saved label designs; the default one (or `preset`) is pre-selected. */
  function loadDesigns(preset?: number): void {
    void window.api.labels.list().then((r) => {
      if (!r.ok) return
      setDesigns(r.data)
      setDesignId(preset ?? r.data.find((d) => d.isDefault)?.id ?? 0)
    })
  }

  function printLabels(products: Product[], preset?: number): void {
    loadDesigns(preset)
    setAsk({ kind: 'labels', products })
    setAskVal('1')
    setAskErr('')
  }

  async function submitAsk(): Promise<void> {
    if (!ask) return
    const n = Number(askVal)
    if (ask.kind === 'stock') {
      if (!Number.isInteger(n) || n === 0) return setAskErr('Enter a non-zero whole number')
      const r = await window.api.products.adjustStock(
        ask.product.id,
        n,
        n > 0 ? 'purchase' : 'adjustment'
      )
      if (!r.ok) return setAskErr(r.error)
      setAsk(null)
      void load()
    } else {
      if (!Number.isInteger(n) || n < 1 || n > 500) return setAskErr('Enter a number from 1 to 500')
      onPrint({
        kind: 'labels',
        products: ask.products,
        copies: n,
        design: designs.find((d) => d.id === designId)
      })
      setAsk(null)
    }
  }

  const toggle = (id: number): void => {
    const s = new Set(selected)
    if (s.has(id)) s.delete(id)
    else s.add(id)
    setSelected(s)
  }

  return (
    <div className="page">
      <div className="toolbar">
        <h1>Products &amp; stock</h1>
        <input
          placeholder="Search name or code"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search products"
        />
        <button
          className="primary"
          onClick={() => {
            setForm(EMPTY)
            setErr('')
          }}
        >
          + Add product
        </button>
        <button
          disabled={!selected.size}
          onClick={() => printLabels(items.filter((p) => selected.has(p.id)))}
        >
          Print labels ({selected.size})
        </button>
      </div>

      <table className="grid">
        <thead>
          <tr>
            <th></th>
            <th>Name</th>
            <th>Code</th>
            <th className="num">Price</th>
            <th className="num">Stock</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {items.map((p) => (
            <tr key={p.id} className={p.stockQty <= p.lowStockThreshold ? 'low' : ''}>
              <td>
                <input
                  type="checkbox"
                  checked={selected.has(p.id)}
                  onChange={() => toggle(p.id)}
                  aria-label={`Select ${p.name}`}
                />
              </td>
              <td>{p.name}</td>
              <td>
                <code>{p.code}</code>
              </td>
              <td className="num">{formatMoney(p.priceMinor, sym)}</td>
              <td className="num">
                {p.stockQty}
                {p.stockQty <= p.lowStockThreshold && <span className="badge"> low</span>}
              </td>
              <td className="actions">
                <button onClick={() => restock(p)}>Stock</button>
                <button
                  onClick={() => {
                    loadDesigns()
                    setQrFor(p)
                  }}
                >
                  Label
                </button>
                <button
                  onClick={() => {
                    setForm({
                      id: p.id,
                      name: p.name,
                      code: p.code,
                      price: minorToInput(p.priceMinor),
                      cost: minorToInput(p.costMinor),
                      stock: String(p.stockQty),
                      low: String(p.lowStockThreshold)
                    })
                    setErr('')
                  }}
                >
                  Edit
                </button>
                <button className="danger" onClick={() => remove(p)}>
                  Remove
                </button>
              </td>
            </tr>
          ))}
          {!items.length && (
            <tr>
              <td colSpan={6} className="muted center">
                No products yet. Click “Add product”.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {form && (
        <div className="modal" role="dialog" aria-modal="true" aria-label="Product form">
          <div className="modal-card form">
            <h2>{form.id ? 'Edit product' : 'Add product'}</h2>
            <label>
              Name
              <input
                autoFocus
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </label>
            <label>
              Code (leave blank to auto-generate)
              <input
                value={form.code}
                onChange={(e) => setForm({ ...form, code: e.target.value })}
              />
            </label>
            <label>
              Selling price
              <input
                value={form.price}
                inputMode="decimal"
                onChange={(e) => setForm({ ...form, price: e.target.value })}
              />
            </label>
            <label>
              Cost price (optional)
              <input
                value={form.cost}
                inputMode="decimal"
                onChange={(e) => setForm({ ...form, cost: e.target.value })}
              />
            </label>
            {!form.id && (
              <label>
                Opening stock
                <input
                  value={form.stock}
                  inputMode="numeric"
                  onChange={(e) => setForm({ ...form, stock: e.target.value })}
                />
              </label>
            )}
            <label>
              Low-stock alert at
              <input
                value={form.low}
                inputMode="numeric"
                onChange={(e) => setForm({ ...form, low: e.target.value })}
              />
            </label>
            {err && (
              <p className="err" role="alert">
                {err}
              </p>
            )}
            <div className="row-end">
              <button onClick={() => setForm(null)}>Cancel</button>
              <button className="primary" onClick={save}>
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {ask && (
        <div className="modal" role="dialog" aria-modal="true" aria-label="Quantity">
          <form
            className="modal-card form"
            onSubmit={(e) => {
              e.preventDefault()
              void submitAsk()
            }}
            onKeyDown={(e) => e.key === 'Escape' && setAsk(null)}
          >
            <h2>{ask.kind === 'stock' ? `Change stock: ${ask.product.name}` : 'Print labels'}</h2>
            <label>
              {ask.kind === 'stock'
                ? `Quantity to add (use a negative number to remove). Current: ${ask.product.stockQty}`
                : 'How many labels per product?'}
              <input
                autoFocus
                value={askVal}
                inputMode="numeric"
                onChange={(e) => setAskVal(e.target.value)}
              />
            </label>
            {ask.kind === 'labels' && designs.length > 0 && (
              <label>
                Label design
                <select value={designId} onChange={(e) => setDesignId(Number(e.target.value))}>
                  <option value={0}>Standard layout</option>
                  {designs.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name} ({d.widthMm}×{d.heightMm} mm)
                    </option>
                  ))}
                </select>
              </label>
            )}
            {askErr && (
              <p className="err" role="alert">
                {askErr}
              </p>
            )}
            <div className="row-end">
              <button type="button" onClick={() => setAsk(null)}>
                Cancel
              </button>
              <button type="submit" className="primary">
                {ask.kind === 'stock' ? 'Update stock' : 'Print'}
              </button>
            </div>
          </form>
        </div>
      )}

      {qrFor && settings && (
        <div className="modal" role="dialog" aria-modal="true" aria-label="Product label">
          <div className="modal-card center">
            {designs.length > 0 && (
              <label className="form" style={{ textAlign: 'left', marginBottom: 8 }}>
                Label design
                <select value={designId} onChange={(e) => setDesignId(Number(e.target.value))}>
                  <option value={0}>Standard layout</option>
                  {designs.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name} ({d.widthMm}×{d.heightMm} mm)
                    </option>
                  ))}
                </select>
              </label>
            )}
            <LabelPreview
              design={
                designs.find((d) => d.id === designId) ??
                standardDesign(
                  settings.labelWidthMm,
                  settings.labelHeightMm,
                  settings.labelCodeType,
                  !!settings.logoDataUrl
                )
              }
              product={qrFor}
              shop={settings}
            />
            <div className="row-end">
              <button onClick={() => setQrFor(null)}>Close</button>
              <button
                className="primary"
                onClick={() => {
                  printLabels([qrFor], designId)
                  setQrFor(null)
                }}
              >
                Print label
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
