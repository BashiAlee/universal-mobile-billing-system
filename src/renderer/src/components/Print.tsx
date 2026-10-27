import { useEffect, useState } from 'react'
import type { Bill, LabelDesign, ShopSettings } from '../../../shared/types'
import { formatMoney } from '../lib/money'
import { BarcodeSVG } from './BarcodeSVG'
import { LabelView, type LabelProduct } from './LabelView'
import { standardDesign } from '../lib/labelDesign'

export type PrintJob =
  | { kind: 'receipt'; bill: Bill }
  | { kind: 'labels'; products: LabelProduct[]; copies: number; design?: LabelDesign }

/**
 * The Windows print window ignores the label size and uses the driver's paper, so label printers print nothing.
 * On Windows "Ask me each time" therefore asks for the printer in-app and prints straight to it.
 */
const isWindows = navigator.userAgent.includes('Windows')

const savedPrinter = (job: PrintJob, settings: ShopSettings): string =>
  job.kind === 'labels' ? settings.labelPrinter : settings.receiptPrinter

/** Last printer picked in the in-app chooser, per job kind; a convenience only. */
const lastPickedKey = (job: PrintJob): string => `ubs.lastPrinter.${job.kind}`

/**
 * With a printer chosen in Settings (or in the in-app chooser) the job goes straight to it, with no print window.
 * Without one (macOS only), the normal print window is shown, as before.
 */
async function printNow(job: PrintJob, settings: ShopSettings, picked?: string): Promise<void> {
  const deviceName = picked || savedPrinter(job, settings)
  if (!deviceName) {
    // Blocks until the print window closes (tests replace it with a function that waits).
    await (window.print() as unknown)
    return
  }
  const design =
    job.kind === 'labels'
      ? (job.design ??
        standardDesign(
          settings.labelWidthMm,
          settings.labelHeightMm,
          settings.labelCodeType,
          !!settings.logoDataUrl
        ))
      : null
  const r = await window.api.print.run({
    deviceName,
    // Labels: either the label's own size, or nothing so the printer's own paper setting applies.
    ...(design && settings.labelPaper === 'label'
      ? { widthMm: design.widthMm, heightMm: design.heightMm }
      : {}),
    ...(design && settings.labelRotate ? { landscape: true } : {})
  })
  if (!r.ok) window.alert(`Could not print: ${r.error}\n\nCheck the printer in Settings.`)
}

/** In-app replacement for the Windows print window: pick a printer, then print straight to it. */
function ChoosePrinter({
  job,
  onPrint,
  onCancel
}: {
  job: PrintJob
  onPrint: (deviceName: string) => void
  onCancel: () => void
}): React.JSX.Element {
  const [printers, setPrinters] = useState<{ name: string; displayName: string }[] | null>(null)
  const [chosen, setChosen] = useState('')
  const [err, setErr] = useState('')
  const [sending, setSending] = useState(false)
  useEffect(() => {
    void window.api.print.printers().then((r) => {
      if (!r.ok) return setErr(r.error)
      setPrinters(r.data)
      let last = ''
      try {
        last = localStorage.getItem(lastPickedKey(job)) ?? ''
      } catch {
        /* storage may be unavailable; just pick the default */
      }
      const pick =
        r.data.find((p) => p.name === last) ?? r.data.find((p) => p.isDefault) ?? r.data[0]
      setChosen(pick?.name ?? '')
    })
  }, [job])

  return (
    <div className="modal no-print" role="dialog" aria-modal="true" aria-label="Choose printer">
      <form
        className="modal-card form"
        onSubmit={(e) => {
          e.preventDefault()
          if (!chosen || sending) return
          setSending(true)
          try {
            localStorage.setItem(lastPickedKey(job), chosen)
          } catch {
            /* remembering the choice is optional */
          }
          onPrint(chosen)
        }}
        onKeyDown={(e) => e.key === 'Escape' && onCancel()}
      >
        <h2>{job.kind === 'labels' ? 'Print labels' : 'Print receipt'}</h2>
        <label>
          Printer
          <select
            autoFocus
            value={chosen}
            onChange={(e) => setChosen(e.target.value)}
            disabled={!printers?.length}
          >
            {printers?.map((p) => (
              <option key={p.name} value={p.name}>
                {p.displayName}
              </option>
            ))}
          </select>
        </label>
        {printers && !printers.length && (
          <p className="err" role="alert">
            No printers were found on this computer.
          </p>
        )}
        {err && (
          <p className="err" role="alert">
            {err}
          </p>
        )}
        <div className="row-end">
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={!chosen || sending}>
            {sending ? 'Printing…' : 'Print'}
          </button>
        </div>
      </form>
    </div>
  )
}

/** Rendered off-screen; shown only by @media print. Prints once mounted (after a printer is picked, if asked). */
export function PrintArea({
  job,
  settings,
  onDone
}: {
  job: PrintJob
  settings: ShopSettings
  onDone: () => void
}): React.JSX.Element {
  // The e2e tests replace window.print with a counter and set __systemPrint so no real printer is used.
  const systemPrint = (window as unknown as { __systemPrint?: boolean }).__systemPrint === true
  const ask = isWindows && !systemPrint && !savedPrinter(job, settings)
  useEffect(() => {
    if (ask) return
    const t = setTimeout(() => {
      void printNow(job, settings).finally(onDone)
    }, 150)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job, onDone])

  const chooser = ask && (
    <ChoosePrinter
      job={job}
      onPrint={(deviceName) => void printNow(job, settings, deviceName).finally(onDone)}
      onCancel={onDone}
    />
  )

  return (
    <>
      {chooser}
      <PrintContent job={job} settings={settings} />
    </>
  )
}

function PrintContent({
  job,
  settings
}: {
  job: PrintJob
  settings: ShopSettings
}): React.JSX.Element {
  const m = (n: number): string => formatMoney(n, settings.currencySymbol)

  if (job.kind === 'labels') return <Labels job={job} settings={settings} />

  const b = job.bill
  const narrow = settings.receiptWidthMm === 58
  const cash = b.paymentMethod === 'cash' && b.tenderedMinor > 0
  return (
    <div
      className="print-area receipt"
      style={{ width: `${settings.receiptWidthMm - 8}mm`, fontSize: narrow ? 10 : 12 }}
    >
      <style>{`@page { size: ${settings.receiptWidthMm}mm auto; margin: 4mm }`}</style>
      <div className="r-head">
        {settings.logoDataUrl && <img src={settings.logoDataUrl} alt="" className="receipt-logo" />}
        <div className="r-shop">{settings.shopName}</div>
        {settings.address && <div>{settings.address}</div>}
        {settings.phone && <div>Tel: {settings.phone}</div>}
      </div>
      <div className="dash" />
      <div className="r-title">RECEIPT</div>
      <div className="dash" />
      <div className="r-meta">
        <span>{b.billNo}</span>
        <span>{new Date(b.createdAt).toLocaleString()}</span>
      </div>
      {b.customerName && <div className="r-meta">Customer: {b.customerName}</div>}
      <div className="r-items">
        {b.items.map((i) => (
          <div className="r-item" key={i.id}>
            <span className="r-item-name">
              {i.qty}x {i.name}
              {i.serial && (
                <span className="r-imei">
                  IMEI: {i.serial}
                  {i.serial2 ? ` / ${i.serial2}` : ''}
                </span>
              )}
              {i.discountMinor > 0 && (
                <span className="r-imei">Discount -{m(i.discountMinor)}</span>
              )}
            </span>
            <span className="r-item-price">{m(i.lineTotalMinor)}</span>
          </div>
        ))}
      </div>
      <div className="dash" />
      {(b.discountMinor > 0 || b.taxMinor > 0) && (
        <>
          <div className="r-line">
            <span>Subtotal</span>
            <span>{m(b.subtotalMinor)}</span>
          </div>
          {b.discountMinor > 0 && (
            <div className="r-line">
              <span>Discount</span>
              <span>-{m(b.discountMinor)}</span>
            </div>
          )}
          {b.taxMinor > 0 && (
            <div className="r-line">
              <span>Tax</span>
              <span>{m(b.taxMinor)}</span>
            </div>
          )}
        </>
      )}
      <div className="r-line r-bold">
        <span>TOTAL AMOUNT</span>
        <span>{m(b.totalMinor)}</span>
      </div>
      <div className="dash" />
      {cash ? (
        <>
          <div className="r-line r-bold">
            <span>CASH</span>
            <span>{m(b.tenderedMinor)}</span>
          </div>
          <div className="r-line r-bold">
            <span>CHANGE</span>
            <span>{m(b.tenderedMinor - b.totalMinor)}</span>
          </div>
        </>
      ) : (
        <div className="r-line r-bold">
          <span>PAID BY</span>
          <span>{b.paymentMethod.toUpperCase()}</span>
        </div>
      )}
      <div className="dash" />
      <div className="r-thanks">{settings.receiptFooter}</div>
      <div className="dash" />
      <div className="r-barcode">
        <BarcodeSVG value={b.billNo} width="100%" height="12mm" />
        <div className="r-barcode-text">{b.billNo}</div>
      </div>
    </div>
  )
}

/** One label per page, drawn from the chosen design (or the built-in standard layout) at the label roll's size. */
function Labels({
  job,
  settings
}: {
  job: Extract<PrintJob, { kind: 'labels' }>
  settings: ShopSettings
}): React.JSX.Element {
  const design =
    job.design ??
    standardDesign(
      settings.labelWidthMm,
      settings.labelHeightMm,
      settings.labelCodeType,
      !!settings.logoDataUrl
    )
  const labels = job.products.flatMap((p) =>
    Array.from({ length: job.copies }, (_, i) => ({ p, i }))
  )
  return (
    <div className="print-area labels">
      <style>{`@page { size: ${design.widthMm}mm ${design.heightMm}mm; margin: 0 }`}</style>
      {labels.map(({ p, i }) => (
        <LabelView key={`${p.id}-${i}`} design={design} product={p} shop={settings} />
      ))}
    </div>
  )
}
