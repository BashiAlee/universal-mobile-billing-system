import { describe, it, expect } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { memoryDb } from './helpers'
import { migrate } from '../src/main/db/database'
import { createProduct, getProduct, listProducts } from '../src/main/services/products'
import { createPurchase, createSupplierNote, listPurchases } from '../src/main/services/purchases'
import {
  deleteParty,
  deletePayment,
  getLedger,
  getParty,
  listParties,
  recordPayment,
  saveParty
} from '../src/main/services/parties'

describe('parties (suppliers) and their balances', () => {
  it('a purchase from a new name creates the party; unpaid part becomes the balance', () => {
    const db = memoryDb()
    const p = createProduct(db, { name: 'Cover', priceMinor: 12000 })
    const pur = createPurchase(db, {
      supplierName: 'ABC Traders',
      paidMinor: 400_000,
      items: [{ productId: p.id, qty: 200, totalCostMinor: 1_000_000 }]
    })
    expect(pur).toMatchObject({ totalMinor: 1_000_000, paidMinor: 400_000 })
    const party = listParties(db)[0]
    expect(party).toMatchObject({
      name: 'ABC Traders',
      purchasedMinor: 1_000_000,
      paidMinor: 400_000,
      balanceMinor: 600_000
    })
    expect(pur.partyId).toBe(party.id)
  })

  it('paid defaults to the full total, so a plain purchase leaves no balance', () => {
    const db = memoryDb()
    const p = createProduct(db, { name: 'A', priceMinor: 1 })
    createPurchase(db, {
      supplierName: 'S',
      items: [{ productId: p.id, qty: 1, totalCostMinor: 500 }]
    })
    expect(listParties(db)[0].balanceMinor).toBe(0)
  })

  it('rejects paying more than the total, or a negative amount', () => {
    const db = memoryDb()
    const p = createProduct(db, { name: 'A', priceMinor: 1 })
    const items = [{ productId: p.id, qty: 1, totalCostMinor: 500 }]
    expect(() => createPurchase(db, { supplierName: 'S', paidMinor: 501, items })).toThrow(
      /more than/
    )
    expect(() => createPurchase(db, { supplierName: 'S', paidMinor: -1, items })).toThrow(
      /0 or more/
    )
    expect(listParties(db)).toHaveLength(0)
  })

  it('payments reduce the balance; deleting a payment restores it', () => {
    const db = memoryDb()
    const party = saveParty(db, { name: 'XYZ' })
    createSupplierNote(db, {
      partyId: party.id,
      description: 'goods',
      amountMinor: 1000,
      paidMinor: 0
    })
    expect(getParty(db, party.id)?.balanceMinor).toBe(1000)
    recordPayment(db, { partyId: party.id, amountMinor: 300, date: '2026-05-01', note: 'cash' })
    expect(getParty(db, party.id)).toMatchObject({ balanceMinor: 700, paidMinor: 300 })
    const pay = getLedger(db, party.id).entries.find((e) => e.kind === 'payment')!
    deletePayment(db, pay.id)
    expect(getParty(db, party.id)?.balanceMinor).toBe(1000)
  })

  it('an overpayment shows as a negative balance (they owe us)', () => {
    const db = memoryDb()
    const party = saveParty(db, { name: 'X' })
    recordPayment(db, { partyId: party.id, amountMinor: 250 })
    expect(getParty(db, party.id)?.balanceMinor).toBe(-250)
  })

  it('opening balance counts, and the ledger lists lines with a running balance', () => {
    const db = memoryDb()
    const party = saveParty(db, { name: 'Old supplier', openingMinor: 5000 })
    createSupplierNote(db, {
      partyId: party.id,
      description: 'cables',
      amountMinor: 2000,
      paidMinor: 500,
      date: '2026-01-02'
    })
    recordPayment(db, { partyId: party.id, amountMinor: 1000, date: '2026-01-03' })
    const { entries } = getLedger(db, party.id)
    expect(entries.map((e) => [e.kind, e.balanceAfterMinor])).toEqual([
      ['opening', 5000],
      ['purchase', 6500],
      ['payment', 5500]
    ])
  })

  it('a purchase can create a brand-new product automatically with stock and cost', () => {
    const db = memoryDb()
    const pur = createPurchase(db, {
      supplierName: 'ABC',
      items: [
        { newProduct: { name: 'Fast charger', priceMinor: 2500 }, qty: 10, totalCostMinor: 10_000 }
      ]
    })
    const made = listProducts(db).find((p) => p.name === 'Fast charger')!
    expect(made).toMatchObject({ stockQty: 10, costMinor: 1000, priceMinor: 2500 })
    expect(pur.items[0].productId).toBe(made.id)
  })

  it('a failed purchase leaves no new product, party or stock behind', () => {
    const db = memoryDb()
    const a = createProduct(db, { name: 'A', priceMinor: 1 })
    expect(() =>
      createPurchase(db, {
        supplierName: 'Ghost',
        items: [
          { newProduct: { name: 'New thing', priceMinor: 5 }, qty: 1, totalCostMinor: 5 },
          { productId: 9999, qty: 1, totalCostMinor: 5 }
        ]
      })
    ).toThrow(/no longer exists/)
    expect(listProducts(db).map((p) => p.name)).toEqual(['A'])
    expect(listParties(db)).toHaveLength(0)
    expect(getProduct(db, a.id)?.stockQty).toBe(0)
  })

  it('rejects an item that is both existing and new, or neither', () => {
    const db = memoryDb()
    const a = createProduct(db, { name: 'A', priceMinor: 1 })
    const np = { name: 'N', priceMinor: 1 }
    expect(() =>
      createPurchase(db, {
        supplierName: 'S',
        items: [{ productId: a.id, newProduct: np, qty: 1, totalCostMinor: 1 }]
      })
    ).toThrow(/Invalid item/)
    expect(() =>
      createPurchase(db, { supplierName: 'S', items: [{ qty: 1, totalCostMinor: 1 }] })
    ).toThrow(/Invalid item/)
  })

  it('party names are unique ignoring case; rename updates purchase history', () => {
    const db = memoryDb()
    const p = createProduct(db, { name: 'A', priceMinor: 1 })
    createPurchase(db, {
      supplierName: 'abc',
      items: [{ productId: p.id, qty: 1, totalCostMinor: 1 }]
    })
    createPurchase(db, {
      supplierName: 'ABC',
      items: [{ productId: p.id, qty: 1, totalCostMinor: 1 }]
    })
    expect(listParties(db)).toHaveLength(1)
    const id = listParties(db)[0].id
    saveParty(db, { id, name: 'ABC Traders' })
    expect(listPurchases(db).every((x) => x.supplierName === 'ABC Traders')).toBe(true)
    saveParty(db, { name: 'Other' })
    expect(() => saveParty(db, { name: 'other' })).toThrow(/already exists/)
    expect(() => saveParty(db, { id, name: 'OTHER' })).toThrow(/already exists/)
  })

  it('validates input and only deletes a party that has no history', () => {
    const db = memoryDb()
    expect(() => saveParty(db, { name: '  ' })).toThrow(/required/)
    const party = saveParty(db, { name: 'Empty' })
    expect(() => recordPayment(db, { partyId: party.id, amountMinor: 0 })).toThrow(/greater than 0/)
    expect(() =>
      recordPayment(db, { partyId: party.id, amountMinor: 5, date: '2026-13-45' })
    ).toThrow(/valid date/)
    expect(() => recordPayment(db, { partyId: 999, amountMinor: 5 })).toThrow(/not found/)
    recordPayment(db, { partyId: party.id, amountMinor: 5 })
    expect(() => deleteParty(db, party.id)).toThrow(/cannot be deleted/)
    const spare = saveParty(db, { name: 'Spare' })
    deleteParty(db, spare.id)
    expect(listParties(db).map((x) => x.name)).toEqual(['Empty'])
  })

  it('upgrading from v6 turns existing supplier names into parties with zero balance', () => {
    const db = new DatabaseSync(':memory:')
    db.exec('PRAGMA foreign_keys = ON;')
    migrate(db, 6)
    db.exec(`INSERT INTO purchases (purchase_no, created_at, supplier_name, note, total_minor) VALUES
      ('PUR-000001','2026-01-01T00:00:00Z','ABC Traders','',1000),
      ('PUR-000002','2026-01-02T00:00:00Z','abc traders','',500),
      ('PUR-000003','2026-01-03T00:00:00Z','XYZ','',200)`)
    migrate(db)
    const parties = listParties(db)
    expect(parties.map((p) => p.balanceMinor)).toEqual([0, 0])
    expect(parties).toHaveLength(2)
    expect(listPurchases(db).every((p) => p.partyId !== null && p.paidMinor === p.totalMinor)).toBe(
      true
    )
  })
})
