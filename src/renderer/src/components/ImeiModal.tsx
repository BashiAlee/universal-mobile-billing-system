import { useEffect, useState } from 'react'
import type { SerialUnit } from '../../../shared/types'
import { useSettings } from '../lib/useSettings'
import { formatMoney, parseMoney } from '../lib/money'

/** Look up phones by IMEI, or list the units of one product: where each came from and where it went. */
export function ImeiModal({
  productId,
  title,
  onClose,
  onChanged
}: {
  productId?: number
  title: string
  onClose: () => void
  /** Called after phones are added or deleted, so the product list can refresh its stock. */
  onChanged?: () => void
}): React.JSX.Element {
  const { settings } = useSettings()
  const m = (n: number): string => formatMoney(n, settings?.currencySymbol ?? '')
  const [search, setSearch] = useState('')
  const [units, setUnits] = useState<SerialUnit[]>([])
  const [loaded, setLoaded] = useState(false)
  const [reload, setReload] = useState(0)
  // Adding phones (only when this window is for one product).
  const [imei1, setImei1] = useState('')
  const [imei2, setImei2] = useState('')
  const [dual, setDual] = useState(false)
  const [cond, setCond] = useState<'new' | 'used'>('new')
  const [cost, setCost] = useState('')
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  async function add(): Promise<void> {
    const serial = imei1.trim()
    if (!serial || productId === undefined) return
    const c = cost.trim() ? parseMoney(cost) : undefined
    if (c === null) return setMsg({ ok: false, text: 'Enter a valid cost, e.g. 40000' })
    const r = await window.api.serials.add({
      productId,
      units: [{ serial, serial2: dual ? imei2.trim() : '', condition: cond, costMinor: c }]
    })
    if (!r.ok) return setMsg({ ok: false, text: r.error })
    setMsg({ ok: true, text: `Added ${serial.toUpperCase()}. In stock now: ${r.data.stockQty}` })
    setImei1('')
    setImei2('')
    setReload((n) => n + 1)
    onChanged?.()
    document.getElementById('imei-add-1')?.focus()
  }

  async function remove(u: SerialUnit): Promise<void> {
    if (!window.confirm(`Delete ${u.serial}? Use this only for a phone entered by mistake.`)) return
    const r = await window.api.serials.remove(u.id)
    if (!r.ok) return setMsg({ ok: false, text: r.error })
    setMsg({ ok: true, text: `Deleted ${u.serial}` })
    setReload((n) => n + 1)
    onChanged?.()
  }

  useEffect(() => {
    // A shop-wide lookup waits for something to be typed; a product's own list shows right away.
    if (productId === undefined && !search.trim()) return
    void window.api.serials.list({ search, productId }).then((r) => {
      if (r.ok) setUnits(r.data)
      setLoaded(true)
    })
  }, [search, productId, reload])
  const shown = productId === undefined && !search.trim() ? [] : units

  return (
    <div
      className="modal"
      role="dialog"
      aria-modal="true"
      aria-label="IMEI lookup"
      onKeyDown={(e) => e.key === 'Escape' && onClose()}
    >
      <div className="modal-card" style={{ width: 880, maxWidth: '95vw' }}>
        <h2>{title}</h2>
        {productId !== undefined && (
          <div className="card form wide" role="group" aria-label="Add phones">
            <strong>Add phones you already have (no purchase)</strong>
            <label className="inline">
              <input type="checkbox" checked={dual} onChange={(e) => setDual(e.target.checked)} />
              Dual SIM: this phone has two IMEIs (still one phone)
            </label>
            <div
              className="prop-grid"
              style={{ gridTemplateColumns: dual ? '1fr 1fr 110px 130px' : '1fr 110px 130px' }}
            >
              <label>
                {dual ? 'IMEI 1' : 'IMEI'} (scan or type, then Enter)
                <input
                  id="imei-add-1"
                  autoFocus
                  value={imei1}
                  aria-label="IMEI to add"
                  onChange={(e) => setImei1(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key !== 'Enter') return
                    e.preventDefault()
                    if (dual) document.getElementById('imei-add-2')?.focus()
                    else void add()
                  }}
                />
              </label>
              {dual && (
                <label>
                  IMEI 2 (then Enter)
                  <input
                    id="imei-add-2"
                    value={imei2}
                    aria-label="Second IMEI to add"
                    onChange={(e) => setImei2(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key !== 'Enter') return
                      e.preventDefault()
                      void add()
                    }}
                  />
                </label>
              )}
              <label>
                Condition
                <select
                  value={cond}
                  aria-label="Condition"
                  onChange={(e) => setCond(e.target.value as 'new' | 'used')}
                >
                  <option value="new">New</option>
                  <option value="used">Used</option>
                </select>
              </label>
              <label>
                Cost (optional)
                <input
                  value={cost}
                  inputMode="decimal"
                  aria-label="Cost of this phone"
                  onChange={(e) => setCost(e.target.value)}
                />
              </label>
            </div>
            <div>
              <button className="primary" onClick={() => void add()}>
                Add phone
              </button>
            </div>
          </div>
        )}
        {msg && (
          <p className={msg.ok ? 'ok' : 'err'} role="status">
            {msg.text}
          </p>
        )}
        <input
          autoFocus={productId === undefined}
          placeholder="Search IMEI (scan or type part of it)"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search IMEI"
        />
        <table className="grid" style={{ marginTop: 10 }}>
          <thead>
            <tr>
              <th>IMEI</th>
              <th>Phone</th>
              <th>Status</th>
              <th>Bought from</th>
              <th>Sold to</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {shown.map((u) => (
              <tr key={u.id}>
                <td>
                  <code>{u.serial}</code>
                  {u.serial2 && (
                    <div>
                      <code>{u.serial2}</code>
                    </div>
                  )}
                </td>
                <td>
                  {u.productName}
                  {u.condition === 'used' && <span className="muted"> (used)</span>}
                </td>
                <td>{u.status === 'sold' ? 'Sold' : 'In stock'}</td>
                <td>
                  {u.supplierName ?? '-'}
                  <div className="muted">
                    {u.purchaseNo} · {new Date(u.boughtAt).toLocaleDateString()} · {m(u.costMinor)}
                  </div>
                </td>
                <td>
                  {u.billNo ? (
                    <>
                      {u.billNo}
                      {u.customerName ? ` · ${u.customerName}` : ''}
                      <div className="muted">
                        {u.soldAt ? new Date(u.soldAt).toLocaleDateString() : ''}
                      </div>
                    </>
                  ) : (
                    '-'
                  )}
                </td>
                <td>
                  {u.status === 'in_stock' && (
                    <button
                      className="danger"
                      aria-label={`Delete IMEI ${u.serial}`}
                      onClick={() => void remove(u)}
                    >
                      ×
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {!shown.length && (
              <tr>
                <td colSpan={6} className="muted center">
                  {productId === undefined && !search.trim()
                    ? 'Type an IMEI to find the phone.'
                    : loaded
                      ? 'No matching IMEI.'
                      : ''}
                </td>
              </tr>
            )}
          </tbody>
        </table>
        <div className="row-end">
          <button onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  )
}
