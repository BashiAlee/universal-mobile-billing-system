import { useCallback, useEffect, useState } from 'react'
import type { LabelDesign, Product } from '../../../shared/types'
import { useSettings } from '../lib/useSettings'
import { formatMoney, minorToInput, parseMoney } from '../lib/money'
import { LabelPreview } from '../components/LabelView'
import { standardDesign } from '../lib/labelDesign'
import type { PrintJob } from '../components/Print'
import { usePrinting } from '../lib/usePrinting'
import { ImeiModal } from '../components/ImeiModal'

interface Form {
  id?: number
  name: string
  code: string
  price: string
  cost: string
  stock: string
  low: string
  category: string
  brand: string
  model: string
  storage: string
  ram: string
  color: string
  compatibleWith: string
  trackSerial: boolean
}
const EMPTY: Form = {
  name: '',
  code: '',
  price: '',
  cost: '',
  stock: '0',
  low: '0',
  category: '',
  brand: '',
  model: '',
  storage: '',
  ram: '',
  color: '',
  compatibleWith: '',
  trackSerial: false
}
const CATEGORIES = ['Phone', 'Cover', 'Charger', 'Earphones', 'Cable', 'Screen guard', 'Other']

/** Small grey line under a product name: category, memory, color, what a cover fits. */
const detailLine = (p: Product): string =>
  [
    p.category,
    [p.ram, p.storage].filter(Boolean).join('/'),
    p.color,
    p.compatibleWith && `fits ${p.compatibleWith}`
  ]
    .filter(Boolean)
    .join(' · ')

export default function ProductsPage({
  onPrint
}: {
  onPrint: (j: PrintJob) => void
}): React.JSX.Element {
  const { settings } = useSettings()
  const { printing } = usePrinting()
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
  const [imei, setImei] = useState<{ productId?: number; title: string } | null>(null)

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
    const hasDetails = [form.brand, form.model].some((v) => v.trim())
    if (!form.name.trim() && !hasDetails)
      return setErr('Enter a name, or at least the brand and model')
    if (price === null) return setErr('Enter a valid price, e.g. 120 or 120.50')
    if (cost === null) return setErr('Enter a valid cost price')
    if (!Number.isInteger(stock) || stock < 0 || !Number.isInteger(low) || low < 0)
      return setErr('Stock and low-stock level must be whole numbers')
    const base = {
      name: form.name,
      category: form.category,
      brand: form.brand,
      model: form.model,
      storage: form.storage,
      ram: form.ram,
      color: form.color,
      compatibleWith: form.compatibleWith,
      trackSerial: form.trackSerial,
      code: form.code || undefined,
      priceMinor: price,
      costMinor: cost,
      lowStockThreshold: low
    }
    const r = form.id
      ? await window.api.products.update(form.id, base)
      : await window.api.products.create({ ...base, stockQty: form.trackSerial ? 0 : stock })
    if (!r.ok)
      return setErr(
        r.error.includes('UNIQUE') ? 'That code is already used by another product' : r.error
      )
    setForm(null)
    setErr('')
    void load()
    // A new phone has no stock yet: go straight to adding its IMEIs.
    if (!form.id && form.trackSerial)
      setImei({ productId: r.data.id, title: `Add IMEIs: ${r.data.name}` })
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

  // Totals follow the list on screen, so a search shows the totals of what it found.
  const totalStock = items.reduce((n, p) => n + p.stockQty, 0)
  const stockCost = items.reduce((n, p) => n + p.stockQty * p.costMinor, 0)
  const stockRetail = items.reduce((n, p) => n + p.stockQty * p.priceMinor, 0)

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
        <button onClick={() => setImei({ title: 'Find a phone by IMEI' })}>IMEI lookup</button>
        <button
          disabled={!selected.size || printing}
          onClick={() => printLabels(items.filter((p) => selected.has(p.id)))}
        >
          Print labels ({selected.size})
        </button>
      </div>

      <div className="kpis" role="group" aria-label="Stock totals">
        {[
          ['PRODUCTS', String(items.length)],
          ['TOTAL STOCK (PIECES)', totalStock.toLocaleString('en-US')],
          ['STOCK VALUE (COST)', formatMoney(stockCost, sym)],
          ['STOCK VALUE (SELLING)', formatMoney(stockRetail, sym)]
        ].map(([label, value]) => (
          <div className="kpi" key={label}>
            <div className="kpi-label">{label}</div>
            <div className="kpi-row">
              <strong>{value}</strong>
            </div>
          </div>
        ))}
      </div>
      {search.trim() && (
        <p className="muted">Totals are for the products matching “{search.trim()}”.</p>
      )}

      <div className="tablewrap">
        <table className="grid">
          <thead>
            <tr>
              <th></th>
              <th>Name</th>
              <th>Code</th>
              <th className="num">Cost</th>
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
                <td>
                  {p.name}
                  {detailLine(p) && <div className="muted">{detailLine(p)}</div>}
                </td>
                <td>
                  <code>{p.code}</code>
                </td>
                <td className="num">{formatMoney(p.costMinor, sym)}</td>
                <td className="num">{formatMoney(p.priceMinor, sym)}</td>
                <td className="num">
                  {p.stockQty}
                  {p.stockQty <= p.lowStockThreshold && <span className="badge"> low</span>}
                </td>
                <td className="actions">
                  {p.trackSerial ? (
                    <button onClick={() => setImei({ productId: p.id, title: `IMEIs: ${p.name}` })}>
                      IMEIs
                    </button>
                  ) : (
                    <button onClick={() => restock(p)}>Stock</button>
                  )}
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
                        low: String(p.lowStockThreshold),
                        category: p.category,
                        brand: p.brand,
                        model: p.model,
                        storage: p.storage,
                        ram: p.ram,
                        color: p.color,
                        compatibleWith: p.compatibleWith,
                        trackSerial: p.trackSerial
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
                <td colSpan={7} className="muted center">
                  No products yet. Click “Add product”.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {form && (
        <div className="modal" role="dialog" aria-modal="true" aria-label="Product form">
          <div className="modal-card form">
            <h2>{form.id ? 'Edit product' : 'Add product'}</h2>
            <label>
              Category
              <input
                list="categories"
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
                placeholder="e.g. Phone, Cover"
              />
              <datalist id="categories">
                {CATEGORIES.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </label>
            <label>
              Name
              <input
                autoFocus
                placeholder="Or leave blank: built from brand, model, memory, color"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </label>
            <div className="prop-grid">
              <label>
                Brand
                <input
                  value={form.brand}
                  onChange={(e) => setForm({ ...form, brand: e.target.value })}
                />
              </label>
              <label>
                Model
                <input
                  value={form.model}
                  onChange={(e) => setForm({ ...form, model: e.target.value })}
                />
              </label>
              <label>
                RAM (GB)
                <input
                  value={form.ram}
                  onChange={(e) => setForm({ ...form, ram: e.target.value })}
                />
              </label>
              <label>
                Storage (GB)
                <input
                  value={form.storage}
                  onChange={(e) => setForm({ ...form, storage: e.target.value })}
                />
              </label>
              <label>
                Color
                <input
                  value={form.color}
                  onChange={(e) => setForm({ ...form, color: e.target.value })}
                />
              </label>
              <label>
                Compatible with (for covers)
                <input
                  value={form.compatibleWith}
                  onChange={(e) => setForm({ ...form, compatibleWith: e.target.value })}
                />
              </label>
            </div>
            <label className="inline">
              <input
                type="checkbox"
                checked={form.trackSerial}
                disabled={!!form.id && Number(form.stock) > 0}
                onChange={(e) => setForm({ ...form, trackSerial: e.target.checked })}
              />
              Track IMEI (every unit is recorded by its IMEI, for phones)
            </label>
            {!!form.id && Number(form.stock) > 0 && (
              <p className="muted">IMEI tracking can only be changed while stock is 0.</p>
            )}
            {form.trackSerial && !form.id && (
              <p className="muted">After you save, you can add the IMEIs of the phones you have.</p>
            )}
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
            {!form.id && !form.trackSerial && (
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
              <button
                type="submit"
                className="primary"
                disabled={ask.kind === 'labels' && printing}
              >
                {ask.kind === 'stock' ? 'Update stock' : 'Print'}
              </button>
            </div>
          </form>
        </div>
      )}

      {imei && (
        <ImeiModal
          productId={imei.productId}
          title={imei.title}
          onClose={() => setImei(null)}
          onChanged={() => void load()}
        />
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
                disabled={printing}
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
