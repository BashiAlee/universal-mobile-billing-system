import type { Db } from '../db/database'
import { transaction } from '../db/database'
import type { LabelDesign, LabelDesignInput, LabelElement } from '../../shared/types'

const KINDS = ['shopName', 'logo', 'code', 'codeText', 'productName', 'price', 'text']
const ALIGNS = ['left', 'center', 'right']
const MAX_ELEMENTS = 30

interface Row {
  id: number
  name: string
  width_mm: number
  height_mm: number
  code_type: string
  elements: string
  is_default: number
}

function toDesign(r: Row): LabelDesign {
  let elements: LabelElement[] = []
  try {
    const parsed: unknown = JSON.parse(r.elements)
    if (Array.isArray(parsed)) elements = parsed as LabelElement[]
  } catch {
    // A damaged design opens empty instead of breaking the whole list.
  }
  return {
    id: r.id,
    name: r.name,
    widthMm: r.width_mm,
    heightMm: r.height_mm,
    codeType: r.code_type === 'qr' ? 'qr' : 'barcode',
    elements,
    isDefault: r.is_default === 1
  }
}

export function listDesigns(db: Db): LabelDesign[] {
  const rows = db.prepare('SELECT * FROM label_designs ORDER BY name').all() as unknown as Row[]
  return rows.map(toDesign)
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

export function validateDesign(d: LabelDesignInput): void {
  if (typeof d.name !== 'string' || !d.name.trim()) throw new Error('Give the design a name')
  if (d.name.trim().length > 60) throw new Error('Design name is too long (max 60)')
  for (const [label, v] of [
    ['Label width', d.widthMm],
    ['Label height', d.heightMm]
  ] as const)
    if (!finite(v) || v < 15 || v > 200) throw new Error(`${label} must be between 15 and 200 mm`)
  if (d.codeType !== 'barcode' && d.codeType !== 'qr') throw new Error('Code must be barcode or QR')
  if (!Array.isArray(d.elements)) throw new Error('Invalid label items')
  if (d.elements.length > MAX_ELEMENTS)
    throw new Error(`A label can have at most ${MAX_ELEMENTS} items`)
  const ids = new Set<string>()
  for (const e of d.elements) {
    if (typeof e.id !== 'string' || !e.id || e.id.length > 40 || ids.has(e.id))
      throw new Error('Invalid label item')
    ids.add(e.id)
    if (!KINDS.includes(e.kind)) throw new Error('Unknown label item type')
    if (!ALIGNS.includes(e.align)) throw new Error('Invalid text alignment')
    if (!finite(e.x) || !finite(e.y) || !finite(e.w) || !finite(e.h))
      throw new Error('Label item position must be numbers')
    if (e.w < 1 || e.h < 1) throw new Error('Label items must be at least 1 mm wide and tall')
    if (e.x < 0 || e.y < 0 || e.x + e.w > d.widthMm + 0.01 || e.y + e.h > d.heightMm + 0.01)
      throw new Error('Every item must fit inside the label')
    if (!finite(e.fontPt) || e.fontPt < 3 || e.fontPt > 60)
      throw new Error('Font size must be between 3 and 60 pt')
    if (typeof e.bold !== 'boolean') throw new Error('Invalid bold setting')
    if (typeof e.text !== 'string' || e.text.length > 80)
      throw new Error('Label text is too long (max 80)')
  }
}

/** Creates a design, or updates it when `input.id` is given. The first design ever saved becomes the default. */
export function saveDesign(db: Db, input: LabelDesignInput): LabelDesign {
  validateDesign(input)
  const name = input.name.trim()
  // Only known properties are stored, so extra fields from the renderer are dropped.
  const elements = JSON.stringify(
    input.elements.map((e) => ({
      id: e.id,
      kind: e.kind,
      x: e.x,
      y: e.y,
      w: e.w,
      h: e.h,
      fontPt: e.fontPt,
      bold: e.bold,
      align: e.align,
      text: e.text
    }))
  )
  const dup = db
    .prepare('SELECT id FROM label_designs WHERE name = ? AND id IS NOT ?')
    .get(name, input.id ?? null)
  if (dup) throw new Error('A design with that name already exists')
  let id: number
  transaction(db, () => {
    if (input.id !== undefined) {
      const r = db
        .prepare(
          'UPDATE label_designs SET name=?, width_mm=?, height_mm=?, code_type=?, elements=? WHERE id=?'
        )
        .run(name, input.widthMm, input.heightMm, input.codeType, elements, input.id)
      if (Number(r.changes) === 0) throw new Error('Design not found')
      id = input.id
    } else {
      const anyDefault = db.prepare('SELECT 1 FROM label_designs WHERE is_default = 1').get()
      const r = db
        .prepare(
          'INSERT INTO label_designs (name, width_mm, height_mm, code_type, elements, is_default, created_at) VALUES (?,?,?,?,?,?,?)'
        )
        .run(
          name,
          input.widthMm,
          input.heightMm,
          input.codeType,
          elements,
          anyDefault ? 0 : 1,
          new Date().toISOString()
        )
      id = Number(r.lastInsertRowid)
    }
  })
  return toDesign(db.prepare('SELECT * FROM label_designs WHERE id = ?').get(id!) as unknown as Row)
}

export function deleteDesign(db: Db, id: number): void {
  db.prepare('DELETE FROM label_designs WHERE id = ?').run(id)
}

export function setDefaultDesign(db: Db, id: number): void {
  transaction(db, () => {
    if (!db.prepare('SELECT 1 FROM label_designs WHERE id = ?').get(id))
      throw new Error('Design not found')
    db.prepare('UPDATE label_designs SET is_default = 0').run()
    db.prepare('UPDATE label_designs SET is_default = 1 WHERE id = ?').run(id)
  })
}
