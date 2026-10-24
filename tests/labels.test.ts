import { describe, it, expect } from 'vitest'
import { memoryDb } from './helpers'
import {
  deleteDesign,
  listDesigns,
  saveDesign,
  setDefaultDesign
} from '../src/main/services/labels'
import { clampElement, newElement, standardDesign } from '../src/renderer/src/lib/labelDesign'
import type { LabelDesignInput, LabelElement } from '../src/shared/types'

const el = (o: Partial<LabelElement> = {}): LabelElement => ({
  id: 'a1',
  kind: 'price',
  x: 1,
  y: 1,
  w: 10,
  h: 5,
  fontPt: 8,
  bold: true,
  align: 'right',
  text: '',
  ...o
})
const design = (o: Partial<LabelDesignInput> = {}): LabelDesignInput => ({
  name: 'Small',
  widthMm: 38,
  heightMm: 25,
  codeType: 'barcode',
  elements: [el()],
  ...o
})

describe('label designs', () => {
  it('saves, lists and updates a design; the first one becomes the default', () => {
    const db = memoryDb()
    const a = saveDesign(db, design())
    expect(a.isDefault).toBe(true)
    expect(a.elements[0]).toMatchObject({ kind: 'price', w: 10, align: 'right' })
    const b = saveDesign(db, design({ name: 'Box', widthMm: 50, heightMm: 30 }))
    expect(b.isDefault).toBe(false)
    expect(listDesigns(db).map((d) => d.name)).toEqual(['Box', 'Small'])

    const upd = saveDesign(db, { ...design({ name: 'Small 2', codeType: 'qr' }), id: a.id })
    expect(upd).toMatchObject({ id: a.id, name: 'Small 2', codeType: 'qr', isDefault: true })
    expect(listDesigns(db)).toHaveLength(2)
  })

  it('keeps exactly one default and falls back when it is deleted', () => {
    const db = memoryDb()
    const a = saveDesign(db, design())
    const b = saveDesign(db, design({ name: 'Box' }))
    setDefaultDesign(db, b.id)
    expect(
      listDesigns(db)
        .filter((d) => d.isDefault)
        .map((d) => d.name)
    ).toEqual(['Box'])
    deleteDesign(db, b.id)
    expect(listDesigns(db).map((d) => d.id)).toEqual([a.id])
    expect(() => setDefaultDesign(db, 999)).toThrow(/not found/)
  })

  it('rejects duplicate names (any case), bad sizes and items outside the label', () => {
    const db = memoryDb()
    saveDesign(db, design())
    expect(() => saveDesign(db, design({ name: 'SMALL' }))).toThrow(/already exists/)
    expect(() => saveDesign(db, design({ name: ' ' }))).toThrow(/name/)
    expect(() => saveDesign(db, design({ name: 'x', widthMm: 5 }))).toThrow(/Label width/)
    expect(() => saveDesign(db, design({ name: 'x', elements: [el({ x: 30 })] }))).toThrow(
      /fit inside/
    )
    expect(() => saveDesign(db, design({ name: 'x', elements: [el({ fontPt: 1 })] }))).toThrow(
      /Font size/
    )
    expect(() =>
      saveDesign(db, design({ name: 'x', elements: [el({ kind: 'evil' as 'text' })] }))
    ).toThrow(/Unknown/)
    expect(() =>
      saveDesign(db, design({ name: 'x', elements: [el({ x: NaN as number })] }))
    ).toThrow(/numbers/)
    expect(() => saveDesign(db, design({ name: 'x', elements: [el(), el()] }))).toThrow(
      /Invalid label item/
    )
    expect(() => saveDesign(db, { ...design({ name: 'x' }), id: 999 })).toThrow(/not found/)
    expect(listDesigns(db)).toHaveLength(1)
  })

  it('drops unknown properties sent by the renderer', () => {
    const db = memoryDb()
    const d = saveDesign(
      db,
      design({ elements: [{ ...el(), evil: '<script>' } as unknown as LabelElement] })
    )
    expect(Object.keys(d.elements[0]).sort()).toEqual(
      ['align', 'bold', 'fontPt', 'h', 'id', 'kind', 'text', 'w', 'x', 'y'].sort()
    )
  })
})

describe('label layout helpers', () => {
  it('clamps an element inside the label', () => {
    const c = clampElement(el({ x: 40, y: -3, w: 100, h: 0 }), 38, 25)
    expect(c).toMatchObject({ x: 0, y: 0, w: 38, h: 1 })
  })

  it('builds the standard layout so every item fits the 38 x 25 mm label', () => {
    for (const logo of [true, false]) {
      const d = standardDesign(38, 25, 'barcode', logo)
      expect(d.elements.map((e) => e.kind)).toEqual(
        logo
          ? ['logo', 'shopName', 'code', 'productName', 'price']
          : ['shopName', 'code', 'productName', 'price']
      )
      const db = memoryDb()
      expect(() => saveDesign(db, { ...d, id: undefined, name: 'std' })).not.toThrow() // passes the same validation as saved designs
    }
  })

  it('creates a new item of every kind that is valid on a small label', () => {
    const db = memoryDb()
    const kinds = ['shopName', 'logo', 'code', 'codeText', 'productName', 'price', 'text'] as const
    const elements = kinds.map((k) => newElement(k, 38, 25))
    expect(() => saveDesign(db, design({ elements }))).not.toThrow()
    expect(new Set(elements.map((e) => e.id)).size).toBe(7)
  })
})
