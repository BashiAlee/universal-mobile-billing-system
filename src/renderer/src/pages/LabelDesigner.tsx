import { useCallback, useEffect, useRef, useState } from 'react'
import type { LabelDesign, LabelElement, LabelElementKind, Product } from '../../../shared/types'
import { useSettings } from '../lib/useSettings'
import { LabelView, type LabelProduct } from '../components/LabelView'
import type { PrintJob } from '../components/Print'
import { usePrinting } from '../lib/usePrinting'
import {
  DEFAULT_LABEL_H,
  DEFAULT_LABEL_W,
  KIND_NAMES,
  TEXT_KINDS,
  clampElement,
  newElement,
  standardDesign
} from '../lib/labelDesign'

/** Screen pixels per label millimetre in the editor. */
const SCALE = 8
/** CSS pixels in one real millimetre. */
const MM_PX = 96 / 25.4
const SAMPLE: LabelProduct = { id: 0, code: 'P-000001', name: 'Sample product', priceMinor: 150000 }
const KINDS = Object.keys(KIND_NAMES) as LabelElementKind[]

type Draft = Omit<LabelDesign, 'id' | 'isDefault'> & { id?: number; isDefault?: boolean }

export default function LabelDesignerPage({
  onPrint
}: {
  onPrint: (j: PrintJob) => void
}): React.JSX.Element {
  const { settings } = useSettings()
  const { printing } = usePrinting()
  const [designs, setDesigns] = useState<LabelDesign[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [draft, setDraft] = useState<Draft | null>(null)
  const [selId, setSelId] = useState<string | null>(null)
  const [previewId, setPreviewId] = useState(0)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [dirty, setDirty] = useState(false)
  const drag = useRef<{ id: string; px: number; py: number; x: number; y: number } | null>(null)

  const loadDesigns = useCallback(async (): Promise<LabelDesign[]> => {
    const r = await window.api.labels.list()
    if (!r.ok) {
      setMsg({ ok: false, text: r.error })
      return []
    }
    setDesigns(r.data)
    return r.data
  }, [])

  useEffect(() => {
    void (async () => {
      const list = await loadDesigns()
      const p = await window.api.products.list('')
      if (p.ok) setProducts(p.data)
      const first = list.find((d) => d.isDefault) ?? list[0]
      setDraft(
        first
          ? structuredClone(first)
          : {
              name: 'My label',
              widthMm: DEFAULT_LABEL_W,
              heightMm: DEFAULT_LABEL_H,
              codeType: 'barcode',
              elements: standardDesign(DEFAULT_LABEL_W, DEFAULT_LABEL_H, 'barcode', false).elements
            }
      )
    })().catch((e) => setMsg({ ok: false, text: String(e) }))
  }, [loadDesigns])

  if (!settings || !draft) return <p style={{ padding: 24 }}>Loading…</p>

  const w = draft.widthMm
  const h = draft.heightMm
  const sel = draft.elements.find((e) => e.id === selId) ?? null
  const product: LabelProduct = products.find((p) => p.id === previewId) ?? products[0] ?? SAMPLE
  const view: LabelDesign = { id: draft.id ?? 0, isDefault: false, ...draft }

  const edit = (next: Draft): void => {
    setDraft(next)
    setDirty(true)
    setMsg(null)
  }
  const patchEl = (id: string, patch: Partial<LabelElement>): void =>
    edit({
      ...draft,
      elements: draft.elements.map((e) =>
        e.id === id ? clampElement({ ...e, ...patch }, w, h) : e
      )
    })
  const setSize = (nw: number, nh: number): void => {
    if (!Number.isFinite(nw) || !Number.isFinite(nh)) return
    // Items are pulled back inside the label whenever it gets smaller.
    edit({
      ...draft,
      widthMm: nw,
      heightMm: nh,
      elements: draft.elements.map((e) => clampElement(e, Math.max(nw, 1), Math.max(nh, 1)))
    })
  }

  function open(d: LabelDesign): void {
    setDraft(structuredClone(d))
    setSelId(null)
    setDirty(false)
    setMsg(null)
  }
  function startNew(): void {
    setDraft({
      name: '',
      widthMm: DEFAULT_LABEL_W,
      heightMm: DEFAULT_LABEL_H,
      codeType: 'barcode',
      elements: standardDesign(DEFAULT_LABEL_W, DEFAULT_LABEL_H, 'barcode', false).elements
    })
    setSelId(null)
    setDirty(true)
    setMsg(null)
  }
  async function save(): Promise<void> {
    const r = await window.api.labels.save(draft!)
    if (!r.ok) return setMsg({ ok: false, text: r.error })
    await loadDesigns()
    setDraft(structuredClone(r.data))
    setDirty(false)
    setMsg({ ok: true, text: `Saved "${r.data.name}"` })
  }
  async function remove(): Promise<void> {
    if (draft!.id === undefined) return startNew()
    if (!window.confirm(`Delete the design "${draft!.name}"?`)) return
    const r = await window.api.labels.delete(draft!.id)
    if (!r.ok) return setMsg({ ok: false, text: r.error })
    const list = await loadDesigns()
    if (list[0]) open(list[0])
    else startNew()
    setDirty(false)
  }
  async function makeDefault(): Promise<void> {
    if (draft!.id === undefined) return
    const r = await window.api.labels.setDefault(draft!.id)
    if (!r.ok) return setMsg({ ok: false, text: r.error })
    await loadDesigns()
    setDraft({ ...draft!, isDefault: true })
    setMsg({ ok: true, text: 'This design is now the default for printing labels' })
  }
  function add(kind: LabelElementKind): void {
    const el = newElement(kind, w, h)
    edit({ ...draft!, elements: [...draft!.elements, el] })
    setSelId(el.id)
  }
  function removeEl(id: string): void {
    edit({ ...draft!, elements: draft!.elements.filter((e) => e.id !== id) })
    setSelId(null)
  }

  const interaction = {
    selectedId: selId,
    onPointerDown: (e: React.PointerEvent, el: LabelElement): void => {
      setSelId(el.id)
      drag.current = { id: el.id, px: e.clientX, py: e.clientY, x: el.x, y: el.y }
      const move = (ev: PointerEvent): void => {
        const d = drag.current
        if (!d) return
        // Moves snap to half a millimetre.
        const snap = (v: number): number => Math.round(v * 2) / 2
        const nx = snap(d.x + (ev.clientX - d.px) / SCALE)
        const ny = snap(d.y + (ev.clientY - d.py) / SCALE)
        setDraft((cur) =>
          cur
            ? {
                ...cur,
                elements: cur.elements.map((x) =>
                  x.id === d.id
                    ? clampElement({ ...x, x: nx, y: ny }, cur.widthMm, cur.heightMm)
                    : x
                )
              }
            : cur
        )
        setDirty(true)
      }
      const up = (): void => {
        drag.current = null
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', up)
      }
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', up)
    },
    onKeyDown: (e: React.KeyboardEvent, el: LabelElement): void => {
      const step = e.shiftKey ? 2 : 0.5
      const d: Record<string, [number, number]> = {
        ArrowLeft: [-step, 0],
        ArrowRight: [step, 0],
        ArrowUp: [0, -step],
        ArrowDown: [0, step]
      }
      if (d[e.key]) {
        e.preventDefault()
        patchEl(el.id, { x: el.x + d[e.key][0], y: el.y + d[e.key][1] })
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault()
        removeEl(el.id)
      }
    }
  }

  const num = (v: string): number => (v.trim() === '' ? NaN : Number(v))

  return (
    <div className="page">
      <div className="toolbar">
        <h1>Label designer</h1>
        <button
          disabled={printing}
          onClick={() => onPrint({ kind: 'labels', products: [product], copies: 1, design: view })}
        >
          {printing ? 'Printing…' : 'Print test label'}
        </button>
        <button className="primary" onClick={save}>
          Save design
        </button>
      </div>
      <p className="muted">
        Design how your product labels look. Click an item to select it, then drag it, use the arrow
        keys, or type its position. Save the design and choose it when you print labels.
      </p>
      {msg && (
        <p className={msg.ok ? 'ok' : 'err'} role="status">
          {msg.text}
        </p>
      )}

      <div className="designer">
        <div className="card">
          <h2>Designs</h2>
          <ul className="designer-list">
            {designs.map((d) => (
              <li key={d.id}>
                <button className={draft.id === d.id ? 'active' : ''} onClick={() => open(d)}>
                  {d.name}
                  {d.isDefault && <span className="muted"> (default)</span>}
                </button>
              </li>
            ))}
            {!designs.length && <li className="muted">No saved designs yet.</li>}
          </ul>
          <button onClick={startNew}>+ New design</button>
          <div className="add-buttons">
            <button onClick={makeDefault} disabled={draft.id === undefined || !!draft.isDefault}>
              Make default
            </button>
            <button className="danger" onClick={remove}>
              Delete
            </button>
          </div>
        </div>

        <div className="card">
          <div className="prop-grid" style={{ marginBottom: 10 }}>
            <label style={{ gridColumn: '1 / -1' }}>
              Design name
              <input
                value={draft.name}
                onChange={(e) => edit({ ...draft, name: e.target.value })}
                placeholder="e.g. Small sticker"
              />
            </label>
            <label>
              Label width (mm)
              <input
                inputMode="decimal"
                value={w}
                onChange={(e) => setSize(num(e.target.value), h)}
              />
            </label>
            <label>
              Label height (mm)
              <input
                inputMode="decimal"
                value={h}
                onChange={(e) => setSize(w, num(e.target.value))}
              />
            </label>
            <label>
              Code type
              <select
                value={draft.codeType}
                onChange={(e) => edit({ ...draft, codeType: e.target.value as 'barcode' | 'qr' })}
              >
                <option value="barcode">Barcode (Code 128)</option>
                <option value="qr">QR code</option>
              </select>
            </label>
            <label>
              Preview with product
              <select value={product.id} onChange={(e) => setPreviewId(Number(e.target.value))}>
                {!products.length && <option value={0}>Sample product</option>}
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div
            className="stage-bg"
            onPointerDown={(e) => e.target === e.currentTarget && setSelId(null)}
          >
            <div
              className="stage"
              style={{ width: w * SCALE, height: h * SCALE }}
              aria-label="Label preview"
            >
              <div
                style={{
                  width: `${w}mm`,
                  height: `${h}mm`,
                  transform: `scale(${SCALE / MM_PX})`,
                  transformOrigin: '0 0'
                }}
              >
                <LabelView
                  design={view}
                  product={product}
                  shop={settings}
                  interaction={interaction}
                />
              </div>
            </div>
          </div>
          <p className="muted" style={{ marginBottom: 0 }}>
            Actual size {w} × {h} mm{dirty ? ' · unsaved changes' : ''}. The preview is enlarged.
          </p>
          <div className="add-buttons">
            <span className="muted">Add:</span>
            {KINDS.map((k) => (
              <button key={k} onClick={() => add(k)}>
                + {KIND_NAMES[k]}
              </button>
            ))}
          </div>
        </div>

        <div className="card">
          <h2>{sel ? KIND_NAMES[sel.kind] : 'Item settings'}</h2>
          {!sel && <p className="muted">Select an item on the label to change it.</p>}
          {sel && (
            <div className="form">
              <div className="prop-grid">
                {(
                  [
                    ['X (mm)', 'x'],
                    ['Y (mm)', 'y'],
                    ['Width (mm)', 'w'],
                    ['Height (mm)', 'h']
                  ] as const
                ).map(([label, key]) => (
                  <label key={key}>
                    {label}
                    <input
                      inputMode="decimal"
                      value={sel[key]}
                      onChange={(e) => {
                        const v = num(e.target.value)
                        if (Number.isFinite(v)) patchEl(sel.id, { [key]: v })
                      }}
                    />
                  </label>
                ))}
                {TEXT_KINDS.includes(sel.kind) && (
                  <>
                    <label>
                      Font size (pt)
                      <input
                        inputMode="decimal"
                        value={sel.fontPt}
                        onChange={(e) => {
                          const v = num(e.target.value)
                          if (Number.isFinite(v) && v >= 3 && v <= 60)
                            patchEl(sel.id, { fontPt: v })
                        }}
                      />
                    </label>
                    <label>
                      Align
                      <select
                        value={sel.align}
                        onChange={(e) =>
                          patchEl(sel.id, { align: e.target.value as LabelElement['align'] })
                        }
                      >
                        <option value="left">Left</option>
                        <option value="center">Centre</option>
                        <option value="right">Right</option>
                      </select>
                    </label>
                  </>
                )}
              </div>
              {TEXT_KINDS.includes(sel.kind) && (
                <label className="inline">
                  <input
                    type="checkbox"
                    checked={sel.bold}
                    onChange={(e) => patchEl(sel.id, { bold: e.target.checked })}
                  />
                  Bold
                </label>
              )}
              {sel.kind === 'text' && (
                <label>
                  Text
                  <input
                    value={sel.text}
                    maxLength={80}
                    onChange={(e) => patchEl(sel.id, { text: e.target.value })}
                  />
                </label>
              )}
              {sel.kind === 'logo' && !settings.logoDataUrl && (
                <p className="muted">No logo yet. Add one in Settings and it will appear here.</p>
              )}
              <button className="danger" onClick={() => removeEl(sel.id)}>
                Remove this item
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
