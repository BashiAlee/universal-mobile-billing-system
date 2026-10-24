import { useState } from 'react'
import { useSettings } from '../lib/useSettings'
import type { ShopSettings } from '../../../shared/types'

const MAX_LOGO_BYTES = 1024 * 1024

export default function SettingsPage(): React.JSX.Element {
  const { settings, reload } = useSettings()
  const [form, setForm] = useState<ShopSettings | null>(settings)
  const [taxPct, setTaxPct] = useState(settings ? String(settings.taxRateBp / 100) : '0')
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  if (!form) return <p>Loading…</p>

  const set = <K extends keyof ShopSettings>(k: K, v: ShopSettings[K]): void =>
    setForm({ ...form, [k]: v })

  function onLogo(file: File | undefined): void {
    if (!file) return
    if (file.size > MAX_LOGO_BYTES) return setMsg({ ok: false, text: 'Logo must be under 1 MB' })
    const reader = new FileReader()
    reader.onload = () => set('logoDataUrl', String(reader.result))
    reader.readAsDataURL(file)
  }

  async function save(): Promise<void> {
    const pct = Number(taxPct)
    if (!Number.isFinite(pct) || pct < 0 || pct > 100)
      return setMsg({ ok: false, text: 'Tax % must be between 0 and 100' })
    const r = await window.api.settings.save({ ...form!, taxRateBp: Math.round(pct * 100) })
    if (r.ok) {
      await reload()
      setMsg({ ok: true, text: 'Saved' })
    } else setMsg({ ok: false, text: r.error })
  }

  return (
    <div className="page">
      <h1>Shop settings</h1>
      <p className="muted">
        These details appear on receipts, labels and the app header. Set them once for each
        customer.
      </p>
      <div className="form">
        <label>
          Shop name
          <input value={form.shopName} onChange={(e) => set('shopName', e.target.value)} />
        </label>
        <label>
          Address
          <input value={form.address} onChange={(e) => set('address', e.target.value)} />
        </label>
        <label>
          Phone
          <input value={form.phone} onChange={(e) => set('phone', e.target.value)} />
        </label>
        <label>
          Currency symbol
          <input
            value={form.currencySymbol}
            onChange={(e) => set('currencySymbol', e.target.value)}
          />
        </label>
        <label>
          Tax rate (%)
          <input value={taxPct} onChange={(e) => setTaxPct(e.target.value)} inputMode="decimal" />
        </label>
        <label>
          Receipt footer
          <input
            value={form.receiptFooter}
            onChange={(e) => set('receiptFooter', e.target.value)}
          />
        </label>
        <h2>Printer</h2>
        <label>
          Receipt paper width
          <select
            value={form.receiptWidthMm}
            onChange={(e) => set('receiptWidthMm', Number(e.target.value))}
          >
            <option value={80}>80 mm (most common)</option>
            <option value={58}>58 mm</option>
          </select>
        </label>
        <label>
          Code on product labels
          <select
            value={form.labelCodeType}
            onChange={(e) => set('labelCodeType', e.target.value as 'barcode' | 'qr')}
          >
            <option value="barcode">Barcode (Code 128)</option>
            <option value="qr">QR code</option>
          </select>
        </label>
        <p className="muted" style={{ margin: 0 }}>
          The label size and code below are used by the Standard layout. For your own layout, use
          the Label designer.
        </p>
        <label>
          Label width (mm)
          <input
            value={form.labelWidthMm}
            inputMode="numeric"
            onChange={(e) => set('labelWidthMm', Number(e.target.value) || 0)}
          />
        </label>
        <label>
          Label height (mm)
          <input
            value={form.labelHeightMm}
            inputMode="numeric"
            onChange={(e) => set('labelHeightMm', Number(e.target.value) || 0)}
          />
        </label>
        <div className="logo-row">
          <div>
            <div className="field-label">Shop logo (png, jpg, webp or svg, max 1 MB)</div>
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp,image/svg+xml"
              onChange={(e) => onLogo(e.target.files?.[0])}
            />
            {form.logoDataUrl && (
              <button className="link" onClick={() => set('logoDataUrl', '')}>
                Remove logo
              </button>
            )}
          </div>
          {form.logoDataUrl && (
            <img className="logo-preview" src={form.logoDataUrl} alt="Logo preview" />
          )}
        </div>
        <button className="primary" onClick={save}>
          Save settings
        </button>
        {msg && (
          <p className={msg.ok ? 'ok' : 'err'} role="status">
            {msg.text}
          </p>
        )}
      </div>
    </div>
  )
}
