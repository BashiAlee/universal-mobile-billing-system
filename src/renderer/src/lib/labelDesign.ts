import type { LabelDesign, LabelElement, LabelElementKind } from '../../../shared/types'

/** Size most shops start with: 38 x 25 mm (1.5 x 1 in) roll labels. */
export const DEFAULT_LABEL_W = 38
export const DEFAULT_LABEL_H = 25

export const KIND_NAMES: Record<LabelElementKind, string> = {
  shopName: 'Shop name',
  logo: 'Logo',
  code: 'Barcode / QR',
  codeText: 'Code number',
  productName: 'Product name',
  price: 'Price',
  text: 'Free text'
}

/** Kinds that show text, and so have a font size, bold and alignment. */
export const TEXT_KINDS: LabelElementKind[] = [
  'shopName',
  'codeText',
  'productName',
  'price',
  'text'
]

const round = (n: number): number => Math.round(n * 10) / 10

let counter = 0
export const newId = (): string => `e${Date.now().toString(36)}${(counter++).toString(36)}`

/** Keeps an element inside the label and at least 1 mm in size. */
export function clampElement(e: LabelElement, w: number, h: number): LabelElement {
  const ew = Math.min(Math.max(1, e.w), w)
  const eh = Math.min(Math.max(1, e.h), h)
  return {
    ...e,
    w: round(ew),
    h: round(eh),
    x: round(Math.min(Math.max(0, e.x), w - ew)),
    y: round(Math.min(Math.max(0, e.y), h - eh))
  }
}

/** A new element of `kind`, placed top-left with a sensible size for a label `w` x `h` mm. */
export function newElement(kind: LabelElementKind, w: number, h: number): LabelElement {
  const base = {
    id: newId(),
    kind,
    x: 1,
    y: 1,
    fontPt: 7,
    bold: false,
    align: 'left' as const,
    text: ''
  }
  const full = w - 2
  const sizes: Record<LabelElementKind, Partial<LabelElement> & { w: number; h: number }> = {
    shopName: { w: full, h: 4, fontPt: 6, bold: true, align: 'center' },
    logo: { w: 6, h: 6 },
    code: { w: full, h: Math.max(6, h * 0.4) },
    codeText: { w: full, h: 3, fontPt: 6, align: 'center' },
    productName: { w: full, h: 5, fontPt: 7, bold: true },
    price: { w: full / 2, h: 5, fontPt: 10, bold: true, align: 'right' },
    text: { w: full, h: 4, fontPt: 7, text: 'Your text' }
  }
  return clampElement({ ...base, ...sizes[kind] }, w, h)
}

/**
 * The built-in layout used when no design is chosen: logo + shop name on top, the code in the middle,
 * product name and price underneath. Mirrors the sizes the app has always printed.
 */
export function standardElements(w: number, h: number, hasLogo: boolean): LabelElement[] {
  const pad = 1.2
  const headH = round(h * 0.22)
  const footH = round(h * 0.2)
  const codeH = Math.max(6, round(h - 2 * pad - headH - footH - 1.2))
  const scale = h / 30
  const nameFont = Math.max(5.5, Math.min(7 * scale, 10))
  const priceFont = Math.max(7, Math.min(10 * scale, 14))
  const logoW = hasLogo ? round(Math.min(headH * 1.5, w * 0.28)) : 0
  const inner = round(w - 2 * pad)
  const els: LabelElement[] = []
  const mk = (
    kind: LabelElementKind,
    o: Partial<LabelElement> & { x: number; y: number; w: number; h: number }
  ): void => {
    els.push({ id: newId(), kind, fontPt: nameFont, bold: false, align: 'left', text: '', ...o })
  }
  if (hasLogo) mk('logo', { x: pad, y: pad, w: logoW, h: headH })
  mk('shopName', {
    x: round(pad + (hasLogo ? logoW + 1 : 0)),
    y: pad,
    w: round(inner - (hasLogo ? logoW + 1 : 0)),
    h: headH,
    bold: true,
    align: hasLogo ? 'left' : 'center'
  })
  mk('code', { x: pad, y: round(pad + headH + 0.6), w: inner, h: codeH })
  mk('productName', {
    x: pad,
    y: round(h - pad - footH),
    w: round(inner * 0.45),
    h: footH,
    bold: true
  })
  mk('price', {
    x: round(pad + inner * 0.45),
    y: round(h - pad - footH),
    w: round(inner * 0.55),
    h: footH,
    fontPt: round(Math.max(6, priceFont * 0.85)),
    bold: true,
    align: 'right'
  })
  return els.map((e) => clampElement(e, w, h))
}

export function standardDesign(
  w: number,
  h: number,
  codeType: 'barcode' | 'qr',
  hasLogo: boolean
): LabelDesign {
  return {
    id: 0,
    name: 'Standard',
    widthMm: w,
    heightMm: h,
    codeType,
    elements: standardElements(w, h, hasLogo),
    isDefault: false
  }
}
