import type { LabelDesign, LabelElement, Product } from '../../../shared/types'
import { formatMoney } from '../lib/money'
import { ProductCode } from './ProductCode'

export type LabelProduct = Pick<Product, 'id' | 'code' | 'name' | 'priceMinor'>

export interface LabelShop {
  shopName: string
  logoDataUrl: string
  currencySymbol: string
}

/** Pointer/keyboard hooks the designer uses to select and move items; printing passes none. */
export interface LabelInteraction {
  selectedId: string | null
  onPointerDown: (e: React.PointerEvent, el: LabelElement) => void
  onKeyDown: (e: React.KeyboardEvent, el: LabelElement) => void
}

const JUSTIFY = { left: 'flex-start', center: 'center', right: 'flex-end' } as const

/** One product label drawn from a design. Everything is positioned in mm, so it prints at true size. */
export function LabelView({
  design,
  product,
  shop,
  interaction
}: {
  design: LabelDesign
  product: LabelProduct
  shop: LabelShop
  interaction?: LabelInteraction
}): React.JSX.Element {
  return (
    <div
      className="label lbl"
      style={{ width: `${design.widthMm}mm`, height: `${design.heightMm}mm` }}
    >
      {design.elements.map((el) => {
        const content = renderContent(el, design, product, shop)
        if (content === null) return null
        const selected = interaction?.selectedId === el.id
        return (
          <div
            key={el.id}
            className={`lbl-el${interaction ? ' editable' : ''}${selected ? ' selected' : ''}`}
            data-kind={el.kind}
            style={{
              left: `${el.x}mm`,
              top: `${el.y}mm`,
              width: `${el.w}mm`,
              height: `${el.h}mm`,
              fontSize: `${el.fontPt}pt`,
              fontWeight: el.bold ? 700 : 400,
              textAlign: el.align,
              justifyContent: JUSTIFY[el.align]
            }}
            {...(interaction
              ? {
                  tabIndex: 0,
                  role: 'button',
                  'aria-label': `Label item: ${el.kind}`,
                  onPointerDown: (e: React.PointerEvent) => interaction.onPointerDown(e, el),
                  onKeyDown: (e: React.KeyboardEvent) => interaction.onKeyDown(e, el)
                }
              : {})}
          >
            {content}
          </div>
        )
      })}
    </div>
  )
}

function renderContent(
  el: LabelElement,
  design: LabelDesign,
  product: LabelProduct,
  shop: LabelShop
): React.ReactNode {
  switch (el.kind) {
    case 'shopName':
      return <span>{shop.shopName}</span>
    case 'logo':
      return shop.logoDataUrl ? <img src={shop.logoDataUrl} alt="" draggable={false} /> : null
    case 'code':
      return (
        <ProductCode
          value={product.code}
          type={design.codeType}
          width={`${el.w}mm`}
          height={`${el.h}mm`}
        />
      )
    case 'codeText':
      return <span>{product.code}</span>
    case 'productName':
      return <span>{product.name}</span>
    case 'price':
      return (
        <span className="lbl-price">{formatMoney(product.priceMinor, shop.currencySymbol)}</span>
      )
    case 'text':
      return <span>{el.text}</span>
  }
}

/** CSS pixels in one real millimetre. */
const MM_PX = 96 / 25.4

/** A label enlarged for the screen (about 320 px wide), drawn from the same markup that is printed. */
export function LabelPreview({
  design,
  product,
  shop
}: {
  design: LabelDesign
  product: LabelProduct
  shop: LabelShop
}): React.JSX.Element {
  const scale = Math.min(10, 320 / design.widthMm) // screen px per label mm
  return (
    <div className="stage-bg" style={{ padding: 16 }}>
      <div
        className="stage"
        style={{ width: design.widthMm * scale, height: design.heightMm * scale }}
        aria-label="Label preview"
      >
        <div style={{ transform: `scale(${scale / MM_PX})`, transformOrigin: '0 0' }}>
          <LabelView design={design} product={product} shop={shop} />
        </div>
      </div>
      <div className="muted" style={{ marginTop: 8 }}>
        Actual size {design.widthMm} × {design.heightMm} mm
      </div>
    </div>
  )
}
