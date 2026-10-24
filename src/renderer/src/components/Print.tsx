import { useEffect } from 'react'
import type { Bill, LabelDesign, ShopSettings } from '../../../shared/types'
import { formatMoney } from '../lib/money'
import { BarcodeSVG } from './BarcodeSVG'
import { LabelView, type LabelProduct } from './LabelView'
import { standardDesign } from '../lib/labelDesign'

export type PrintJob =
  | { kind: 'receipt'; bill: Bill }
  | { kind: 'labels'; products: LabelProduct[]; copies: number; design?: LabelDesign }

/** Rendered off-screen; shown only by @media print. Calls window.print() once mounted. */
export function PrintArea({
  job,
  settings,
  onDone
}: {
  job: PrintJob
  settings: ShopSettings
  onDone: () => void
}): React.JSX.Element {
  useEffect(() => {
    const t = setTimeout(() => {
      window.print()
      onDone()
    }, 150)
    return () => clearTimeout(t)
  }, [job, onDone])

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
