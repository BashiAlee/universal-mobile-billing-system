import { Fragment, useCallback, useEffect, useState } from 'react'
import type { DayBook } from '../../../shared/types'
import { useSettings } from '../lib/useSettings'
import { formatMoney, minorToInput, parseMoney } from '../lib/money'
import { money, toCsv, type Cell } from '../lib/csv'

const ymd = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

function shift(day: string, by: number): string {
  const d = new Date(`${day}T00:00:00`)
  d.setDate(d.getDate() + by)
  return ymd(d)
}

export default function DayBookPage(): React.JSX.Element {
  const { settings } = useSettings()
  const m = (n: number): string => formatMoney(n, settings?.currencySymbol ?? '')
  const [day, setDay] = useState(ymd(new Date()))
  const [book, setBook] = useState<DayBook | null>(null)
  const [opening, setOpening] = useState('')
  const [notes, setNotes] = useState('')
  const [title, setTitle] = useState('')
  const [amount, setAmount] = useState('')
  const [err, setErr] = useState('')
  const [saved, setSaved] = useState('')

  const show = useCallback((b: DayBook): void => {
    setBook(b)
    setOpening(minorToInput(b.openingMinor))
    setNotes(b.notes)
  }, [])

  useEffect(() => {
    if (!day) return
    let stale = false
    void window.api.daybook
      .get(day)
      .then((r) => {
        if (stale) return
        if (r.ok) {
          show(r.data)
          setErr('')
          setSaved('')
        } else setErr(r.error)
      })
      .catch(() => setErr('Could not load the day book. Please close and reopen the app.'))
    return () => {
      stale = true
    }
  }, [day, show])

  async function save(openingMinor: number | null, noteText: string): Promise<void> {
    const r = await window.api.daybook.save({ day, openingMinor, notes: noteText })
    if (!r.ok) return setErr(r.error)
    show(r.data)
    setErr('')
    setSaved('Saved')
  }

  function saveOpening(): void {
    const v = parseMoney(opening)
    if (v === null) return setErr('Enter a valid opening balance, e.g. 70250')
    void save(v, notes)
  }

  async function addExpense(): Promise<void> {
    const v = parseMoney(amount)
    if (!title.trim()) return setErr('Say what the expense was for')
    if (v === null || v === 0) return setErr('Enter a valid expense amount')
    const r = await window.api.daybook.addExpense({ day, title, amountMinor: v })
    if (!r.ok) return setErr(r.error)
    setTitle('')
    setAmount('')
    setErr('')
    const b = await window.api.daybook.get(day)
    if (b.ok) {
      setBook(b.data)
      setOpening(minorToInput(b.data.openingMinor))
    }
  }

  async function removeExpense(id: number, name: string): Promise<void> {
    if (!window.confirm(`Remove the expense "${name}"?`)) return
    await window.api.daybook.deleteExpense(id)
    const b = await window.api.daybook.get(day)
    if (b.ok) {
      setBook(b.data)
      setOpening(minorToInput(b.data.openingMinor))
    }
  }

  async function exportCsv(): Promise<void> {
    if (!book) return
    const rows: Cell[][] = [
      [`${settings?.shopName ?? ''} - Day book`],
      ['Date', book.day],
      [],
      ['No', 'Bill', 'Product', 'Qty', 'Discount', 'Buy', 'Sale'],
      ...book.lines.flatMap((l, i): Cell[][] => {
        const row: Cell[] = [
          i + 1,
          l.billNo,
          l.name,
          l.qty,
          l.discountMinor > 0 ? `-${money(l.discountMinor)}` : '',
          money(l.costMinor),
          money(l.saleMinor)
        ]
        const disc =
          book.lines[i + 1]?.billNo !== l.billNo
            ? (book.billDiscounts ?? []).find((d) => d.billNo === l.billNo)
            : undefined
        return disc
          ? [
              row,
              [
                '',
                disc.billNo,
                'Discount on this bill',
                '',
                '',
                '',
                `-${money(disc.discountMinor)}`
              ]
            ]
          : [row]
      }),
      [
        'Total',
        '',
        '',
        '',
        book.itemDiscountsMinor > 0 ? `-${money(book.itemDiscountsMinor)}` : '',
        money(book.lines.reduce((s, l) => s + l.costMinor, 0)),
        money(book.lines.reduce((s, l) => s + l.saleMinor, 0))
      ],
      ...(book.discountMinor > 0
        ? [['Discount given on bills', '', '', '', '', '', `-${money(book.discountMinor)}`]]
        : []),
      ...book.returns.map((r): Cell[] => [
        '',
        r.returnNo,
        `Return from ${r.billNo} (${r.method})`,
        '',
        '',
        `-${money(r.restockedCostMinor)}`,
        `-${money(r.netMinor)}`
      ]),
      ...(book.discountMinor > 0 || book.returns.length
        ? [
            [
              book.returns.length ? 'Sale after discount and returns' : 'Sale after discount',
              '',
              '',
              '',
              '',
              money(book.costMinor),
              money(book.salesMinor)
            ]
          ]
        : []),
      [],
      ['Shop expense', 'Amount'],
      ...book.expenses.map((e) => [e.title, money(e.amountMinor)]),
      ['Total expenses', money(book.expensesMinor)],
      [],
      ['Opening balance', money(book.openingMinor)],
      ['Sale', money(book.salesMinor)],
      ['Discount given on bills', money(book.discountMinor)],
      ['Discount given on single items', money(book.itemDiscountsMinor)],
      ['Returned by customers (taken off the sale)', money(book.returnsMinor)],
      ['Refunded to customers', money(book.refundedMinor)],
      ['Profit', money(book.profitMinor)],
      ['Shop expense', money(book.expensesMinor)],
      ['Profit after expenses', money(book.netProfitMinor)],
      ['Money received from bills', money(book.receivedMinor)],
      ['On credit (not received)', money(book.creditMinor)],
      ['Remaining balance', money(book.closingMinor)],
      [],
      ['Notes', book.notes]
    ]
    const r = await window.api.files.saveCsv(`daybook-${book.day}`, toCsv(rows))
    if (!r.ok) setErr(r.error)
    else if (r.data) setSaved(`Exported to ${r.data}`)
  }

  const bold = (t: string): React.JSX.Element => <strong>{t}</strong>

  return (
    <div className="page">
      <div className="toolbar">
        <h1>Day book</h1>
        <button onClick={() => setDay(shift(day, -1))} aria-label="Previous day">
          ◀
        </button>
        <input
          type="date"
          style={{ width: 160 }}
          value={day}
          onChange={(e) => e.target.value && setDay(e.target.value)}
          aria-label="Day"
        />
        <button onClick={() => setDay(shift(day, 1))} aria-label="Next day">
          ▶
        </button>
        <button onClick={() => setDay(ymd(new Date()))}>Today</button>
        <button onClick={() => void exportCsv()} disabled={!book}>
          Export CSV
        </button>
      </div>
      {saved.startsWith('Exported') && (
        <p className="ok" role="status">
          {saved}
        </p>
      )}
      {err && (
        <p className="err" role="alert">
          {err}
        </p>
      )}

      {book && (
        <>
          <div className="card">
            <div className="row" style={{ alignItems: 'center', gap: 12 }}>
              <label className="inline">
                Opening balance
                <input
                  style={{ width: 160 }}
                  inputMode="decimal"
                  value={opening}
                  onChange={(e) => setOpening(e.target.value)}
                />
              </label>
              <span className="muted" style={{ flex: 1 }}>
                {book.openingManual
                  ? 'Typed in by you.'
                  : 'Carried forward from the previous day (its remaining balance).'}
              </span>
              <button onClick={saveOpening}>Set opening balance</button>
              {book.openingManual && (
                <button onClick={() => void save(null, notes)}>Carry forward instead</button>
              )}
            </div>
          </div>

          <h2>Sales</h2>
          <div className="tablewrap">
            <table className="grid">
              <thead>
                <tr>
                  <th>No</th>
                  <th>Bill</th>
                  <th>Product</th>
                  <th className="num">Qty</th>
                  <th className="num">Discount</th>
                  <th className="num">Buy</th>
                  <th className="num">Sale</th>
                </tr>
              </thead>
              <tbody>
                {book.lines.map((l, i) => {
                  // After the last item of a bill that had a discount, show that bill's discount.
                  const last = book.lines[i + 1]?.billNo !== l.billNo
                  const disc = last
                    ? (book.billDiscounts ?? []).find((d) => d.billNo === l.billNo)
                    : undefined
                  return (
                    <Fragment key={i}>
                      <tr>
                        <td>{i + 1}</td>
                        <td>
                          <code>{l.billNo}</code>
                        </td>
                        <td>{l.name}</td>
                        <td className="num">{l.qty}</td>
                        <td className="num err">
                          {l.discountMinor > 0 ? `-${m(l.discountMinor)}` : ''}
                        </td>
                        <td className="num">{m(l.costMinor)}</td>
                        <td className="num">{m(l.saleMinor)}</td>
                      </tr>
                      {disc && (
                        <tr>
                          <td></td>
                          <td>
                            <code>{disc.billNo}</code>
                          </td>
                          <td colSpan={4}>Discount on this bill</td>
                          <td className="num err">-{m(disc.discountMinor)}</td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
                {!book.lines.length && (
                  <tr>
                    <td colSpan={7} className="muted center">
                      No sales on this day.
                    </td>
                  </tr>
                )}
                {book.lines.length > 0 && (
                  <tr>
                    <td colSpan={4}>{bold('Total')}</td>
                    <td className="num err">
                      {book.itemDiscountsMinor > 0 ? bold(`-${m(book.itemDiscountsMinor)}`) : ''}
                    </td>
                    <td className="num">
                      {bold(m(book.lines.reduce((s, l) => s + l.costMinor, 0)))}
                    </td>
                    <td className="num">
                      {bold(m(book.lines.reduce((s, l) => s + l.saleMinor, 0)))}
                    </td>
                  </tr>
                )}
                {book.lines.length > 0 && book.discountMinor > 0 && (
                  <tr>
                    <td colSpan={6}>Discount given on bills</td>
                    <td className="num err">-{m(book.discountMinor)}</td>
                  </tr>
                )}
                {book.returns.map((r) => (
                  <tr key={r.returnNo}>
                    <td></td>
                    <td>
                      <code>{r.returnNo}</code>
                    </td>
                    <td>
                      Return from {r.billNo} <span className="muted">({r.method})</span>
                    </td>
                    <td></td>
                    <td></td>
                    <td className="num">
                      {r.restockedCostMinor > 0 ? `-${m(r.restockedCostMinor)}` : ''}
                    </td>
                    <td className="num err">-{m(r.netMinor)}</td>
                  </tr>
                ))}
                {(book.discountMinor > 0 || book.returns.length > 0) && (
                  <tr>
                    <td colSpan={5}>
                      {bold(
                        book.returns.length
                          ? 'Sale after discount and returns'
                          : 'Sale after discount'
                      )}
                    </td>
                    <td className="num">{bold(m(book.costMinor))}</td>
                    <td className="num">{bold(m(book.salesMinor))}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <h2>Shop expenses</h2>
          <table className="grid">
            <thead>
              <tr>
                <th>Expense</th>
                <th className="num">Amount</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {book.expenses.map((e) => (
                <tr key={e.id}>
                  <td>{e.title}</td>
                  <td className="num">{m(e.amountMinor)}</td>
                  <td className="actions">
                    <button className="danger" onClick={() => void removeExpense(e.id, e.title)}>
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
              {!book.expenses.length && (
                <tr>
                  <td colSpan={3} className="muted center">
                    No expenses on this day.
                  </td>
                </tr>
              )}
              <tr>
                <td>
                  <input
                    placeholder="e.g. Ali Noor Trading, tea, rent"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    aria-label="Expense description"
                  />
                </td>
                <td>
                  <input
                    placeholder="Amount"
                    inputMode="decimal"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    aria-label="Expense amount"
                  />
                </td>
                <td>
                  <button className="primary" onClick={() => void addExpense()}>
                    Add expense
                  </button>
                </td>
              </tr>
            </tbody>
          </table>

          <div className="card" style={{ marginTop: 16 }}>
            <div className="row">
              <span>Opening balance</span>
              <span>{m(book.openingMinor)}</span>
            </div>
            <div className="row">
              <span>Sale ({book.bills} bills)</span>
              <span>{m(book.salesMinor)}</span>
            </div>
            <div className="row">
              <span>Discount given (already taken off the sale)</span>
              <span>{m(book.discountMinor + book.itemDiscountsMinor)}</span>
            </div>
            <div className="row">
              <span>Profit</span>
              <span className={book.profitMinor < 0 ? 'err' : ''}>{m(book.profitMinor)}</span>
            </div>
            <div className="row">
              <span>Shop expense</span>
              <span>{m(book.expensesMinor)}</span>
            </div>
            <div className="row">
              <span>Profit after expenses</span>
              <span className={book.netProfitMinor < 0 ? 'err' : ''}>{m(book.netProfitMinor)}</span>
            </div>
            {book.returnsMinor > 0 && (
              <div className="row">
                <span>Returned by customers (already taken off the sale)</span>
                <span>-{m(book.returnsMinor)}</span>
              </div>
            )}
            <div className="row">
              <span>Money received from bills</span>
              <span>{m(book.receivedMinor)}</span>
            </div>
            {book.refundedMinor > 0 && (
              <div className="row">
                <span>Money handed back to customers</span>
                <span>-{m(book.refundedMinor)}</span>
              </div>
            )}
            {book.creditMinor > 0 && (
              <div className="row">
                <span>On credit (not yet received)</span>
                <span>{m(book.creditMinor)}</span>
              </div>
            )}
            <div className="row total">
              <span>Remaining balance</span>
              <span className={book.closingMinor < 0 ? 'err' : ''}>{m(book.closingMinor)}</span>
            </div>
            <p className="muted" style={{ margin: '6px 0 0' }}>
              Remaining balance = opening balance + money received from bills − money handed back to
              customers − shop expenses.
            </p>
          </div>

          <h2>Notes</h2>
          <textarea
            rows={4}
            value={notes}
            maxLength={5000}
            onChange={(e) => {
              setNotes(e.target.value)
              setSaved('')
            }}
            placeholder="e.g. 500 in drawer, 350 with Irfan Shah"
            aria-label="Notes"
            style={{
              width: '100%',
              font: 'inherit',
              padding: 8,
              border: '1px solid var(--line)',
              borderRadius: 6
            }}
          />
          <div className="row-end" style={{ alignItems: 'center' }}>
            {saved === 'Saved' && <span className="ok">{saved}</span>}
            <button
              className="primary"
              onClick={() => void save(book.openingManual ? book.openingMinor : null, notes)}
            >
              Save notes
            </button>
          </div>
        </>
      )}
    </div>
  )
}
