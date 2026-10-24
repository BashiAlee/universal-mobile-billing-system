import { useCallback, useEffect, useState } from 'react'
import type { Party, PartyLedger } from '../../../shared/types'
import { useSettings } from '../lib/useSettings'
import { formatMoney, minorToInput, parseMoney } from '../lib/money'

interface Form {
  id?: number
  name: string
  phone: string
  address: string
  notes: string
  opening: string
  /** Whether the opening balance is money we owe them (default) or money they owe us. */
  openingDir: 'owe' | 'owed'
}
const EMPTY: Form = {
  name: '',
  phone: '',
  address: '',
  notes: '',
  opening: '',
  openingDir: 'owe'
}

export default function PartiesPage(): React.JSX.Element {
  const { settings } = useSettings()
  const sym = settings?.currencySymbol ?? ''
  const m = (n: number): string => formatMoney(n, sym)
  const [parties, setParties] = useState<Party[]>([])
  const [search, setSearch] = useState('')
  const [form, setForm] = useState<Form | null>(null)
  const [pay, setPay] = useState<{
    party: Party
    amount: string
    date: string
    note: string
  } | null>(null)
  const [ledger, setLedger] = useState<PartyLedger | null>(null)
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')

  const load = useCallback(async () => {
    const r = await window.api.parties.list(search)
    if (r.ok) setParties(r.data)
  }, [search])
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()
  }, [load])

  async function openLedger(id: number): Promise<void> {
    const r = await window.api.parties.ledger(id)
    if (r.ok) setLedger(r.data)
  }

  async function save(): Promise<void> {
    if (!form) return
    const opening = form.opening.trim() ? parseMoney(form.opening) : 0
    if (!form.name.trim()) return setErr('Name is required')
    if (opening === null) return setErr('Enter a valid opening balance, e.g. 5000')
    const r = await window.api.parties.save({
      id: form.id,
      name: form.name,
      phone: form.phone,
      address: form.address,
      notes: form.notes,
      openingMinor: form.openingDir === 'owe' ? opening : -opening
    })
    if (!r.ok) return setErr(r.error)
    setForm(null)
    setErr('')
    void load()
    if (ledger?.party.id === r.data.id) void openLedger(r.data.id)
  }

  async function submitPay(): Promise<void> {
    if (!pay) return
    const amount = parseMoney(pay.amount)
    if (amount === null || amount <= 0) return setErr('Enter the amount paid, e.g. 2000')
    const r = await window.api.parties.pay({
      partyId: pay.party.id,
      amountMinor: amount,
      date: pay.date || undefined,
      note: pay.note
    })
    if (!r.ok) return setErr(r.error)
    setMsg(`Recorded ${m(amount)} paid to ${pay.party.name}`)
    setPay(null)
    setErr('')
    void load()
    if (ledger?.party.id === pay.party.id) void openLedger(pay.party.id)
  }

  async function removePayment(id: number): Promise<void> {
    if (!window.confirm('Delete this payment? The balance will go back up.')) return
    const r = await window.api.parties.deletePayment(id)
    if (!r.ok) return setMsg(r.error)
    void load()
    if (ledger) void openLedger(ledger.party.id)
  }

  async function removeParty(p: Party): Promise<void> {
    if (!window.confirm(`Delete "${p.name}"?`)) return
    const r = await window.api.parties.delete(p.id)
    setMsg(r.ok ? `Deleted ${p.name}` : r.error)
    void load()
  }

  const owe = parties.reduce((a, p) => a + Math.max(p.balanceMinor, 0), 0)
  const owed = parties.reduce((a, p) => a + Math.max(-p.balanceMinor, 0), 0)
  const today = new Date().toLocaleDateString('en-CA')

  const balanceText = (n: number): string =>
    n > 0 ? `You owe ${m(n)}` : n < 0 ? `They owe you ${m(-n)}` : 'Settled'

  return (
    <div className="page">
      <div className="toolbar">
        <h1>Parties (suppliers)</h1>
        <input
          placeholder="Search name or phone"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search parties"
        />
        <button
          className="primary"
          onClick={() => {
            setForm(EMPTY)
            setErr('')
          }}
        >
          + Add party
        </button>
      </div>
      <div className="kpis">
        <div className="kpi">
          <div className="kpi-label">TOTAL YOU OWE</div>
          <div className="kpi-row">
            <strong>{m(owe)}</strong>
          </div>
        </div>
        <div className="kpi">
          <div className="kpi-label">TOTAL OWED TO YOU (ADVANCES)</div>
          <div className="kpi-row">
            <strong>{m(owed)}</strong>
          </div>
        </div>
      </div>
      {msg && (
        <p className="ok" role="status">
          {msg}
        </p>
      )}

      <table className="grid">
        <thead>
          <tr>
            <th>Party</th>
            <th>Phone</th>
            <th className="num">Total bought</th>
            <th className="num">Total paid</th>
            <th className="num">Balance</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {parties.map((p) => (
            <tr key={p.id}>
              <td>{p.name}</td>
              <td>{p.phone}</td>
              <td className="num">{m(p.purchasedMinor)}</td>
              <td className="num">{m(p.paidMinor)}</td>
              <td className={`num ${p.balanceMinor > 0 ? 'err' : ''}`}>
                {balanceText(p.balanceMinor)}
              </td>
              <td className="actions">
                <button
                  onClick={() => {
                    setPay({ party: p, amount: '', date: '', note: '' })
                    setErr('')
                  }}
                >
                  Pay
                </button>
                <button onClick={() => void openLedger(p.id)}>Ledger</button>
                <button
                  onClick={() => {
                    setForm({
                      id: p.id,
                      name: p.name,
                      phone: p.phone,
                      address: p.address,
                      notes: p.notes,
                      opening: p.openingMinor ? minorToInput(Math.abs(p.openingMinor)) : '',
                      openingDir: p.openingMinor < 0 ? 'owed' : 'owe'
                    })
                    setErr('')
                  }}
                >
                  Edit
                </button>
                <button className="danger" onClick={() => void removeParty(p)}>
                  Delete
                </button>
              </td>
            </tr>
          ))}
          {!parties.length && (
            <tr>
              <td colSpan={6} className="muted center">
                No parties yet. Click “Add party”, or just type a supplier name on a purchase.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {ledger && (
        <div className="card" role="region" aria-label="Party ledger">
          <div className="toolbar">
            <h2 style={{ flex: 1, margin: 0 }}>
              {ledger.party.name}: {balanceText(ledger.party.balanceMinor)}
            </h2>
            <button onClick={() => setLedger(null)}>Close ledger</button>
          </div>
          {(ledger.party.phone || ledger.party.address || ledger.party.notes) && (
            <p className="muted">
              {[ledger.party.phone, ledger.party.address, ledger.party.notes]
                .filter(Boolean)
                .join(' · ')}
            </p>
          )}
          <table className="grid">
            <thead>
              <tr>
                <th>Date</th>
                <th>Entry</th>
                <th>Details</th>
                <th className="num">Bought</th>
                <th className="num">Paid</th>
                <th className="num">Balance</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {ledger.entries.map((e) => (
                <tr key={`${e.kind}-${e.id}`}>
                  <td>{new Date(e.date).toLocaleDateString()}</td>
                  <td>{e.ref}</td>
                  <td>{e.description}</td>
                  <td className="num">{e.boughtMinor ? m(e.boughtMinor) : ''}</td>
                  <td className="num">{e.paidMinor ? m(e.paidMinor) : ''}</td>
                  <td className="num">{m(e.balanceAfterMinor)}</td>
                  <td>
                    {e.kind === 'payment' && (
                      <button
                        className="danger"
                        aria-label="Delete payment"
                        onClick={() => void removePayment(e.id)}
                      >
                        ×
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {!ledger.entries.length && (
                <tr>
                  <td colSpan={7} className="muted center">
                    Nothing recorded for this party yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {form && (
        <div className="modal" role="dialog" aria-modal="true" aria-label="Party form">
          <form
            className="modal-card form"
            onSubmit={(e) => {
              e.preventDefault()
              void save()
            }}
          >
            <h2>{form.id ? 'Edit party' : 'Add party'}</h2>
            <label>
              Name
              <input
                autoFocus
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </label>
            <label>
              Phone
              <input
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
              />
            </label>
            <label>
              Address
              <input
                value={form.address}
                onChange={(e) => setForm({ ...form, address: e.target.value })}
              />
            </label>
            <label>
              Notes
              <input
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
              />
            </label>
            <label>
              Balance from before using this app (optional)
              <input
                value={form.opening}
                inputMode="decimal"
                placeholder="e.g. 5000"
                onChange={(e) => setForm({ ...form, opening: e.target.value })}
              />
            </label>
            <label>
              That balance means
              <select
                value={form.openingDir}
                onChange={(e) =>
                  setForm({ ...form, openingDir: e.target.value as Form['openingDir'] })
                }
              >
                <option value="owe">I owe them</option>
                <option value="owed">They owe me</option>
              </select>
            </label>
            {err && (
              <p className="err" role="alert">
                {err}
              </p>
            )}
            <div className="row-end">
              <button type="button" onClick={() => setForm(null)}>
                Cancel
              </button>
              <button type="submit" className="primary">
                Save
              </button>
            </div>
          </form>
        </div>
      )}

      {pay && (
        <div className="modal" role="dialog" aria-modal="true" aria-label="Pay party">
          <form
            className="modal-card form"
            onSubmit={(e) => {
              e.preventDefault()
              void submitPay()
            }}
            onKeyDown={(e) => e.key === 'Escape' && setPay(null)}
          >
            <h2>Pay {pay.party.name}</h2>
            <p className="muted">Currently: {balanceText(pay.party.balanceMinor)}</p>
            <label>
              Amount paid
              <input
                autoFocus
                value={pay.amount}
                inputMode="decimal"
                placeholder="e.g. 2000"
                onChange={(e) => setPay({ ...pay, amount: e.target.value })}
              />
            </label>
            <label>
              Date (optional, today if empty)
              <input
                type="date"
                max={today}
                value={pay.date}
                onChange={(e) => setPay({ ...pay, date: e.target.value })}
              />
            </label>
            <label>
              Note (optional)
              <input value={pay.note} onChange={(e) => setPay({ ...pay, note: e.target.value })} />
            </label>
            {err && (
              <p className="err" role="alert">
                {err}
              </p>
            )}
            <div className="row-end">
              <button type="button" onClick={() => setPay(null)}>
                Cancel
              </button>
              <button type="submit" className="primary">
                Record payment
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}
