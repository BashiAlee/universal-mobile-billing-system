import { useCallback, useEffect, useState, type ReactNode } from 'react'
import type { LicenseStatus } from '../../../shared/types'

/**
 * Shown after sign-in. If the program is not activated, only the activation screen is shown. If the subscription
 * is switched off or expired, the program stays open for viewing and exporting, with a notice; the main process
 * refuses everything that would change data.
 */
export function LicenseGate({ children }: { children: ReactNode }): React.JSX.Element {
  const [st, setSt] = useState<LicenseStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')

  const refresh = useCallback(async () => {
    const r = await window.api.license.status()
    if (r.ok) setSt(r.data)
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh()
    const t = setInterval(() => void refresh(), 30_000)
    return () => clearInterval(t)
  }, [refresh])

  if (!st) return <p style={{ padding: 24 }}>Loading…</p>
  if (!st.enforced || st.state === 'active')
    return (
      <>
        {children}
        {st.state === 'active' && st.daysLeft !== null && st.daysLeft <= 7 && (
          <div className="license-banner warn" role="status">
            Your subscription ends on {st.paidUntil} ({st.daysLeft} day
            {st.daysLeft === 1 ? '' : 's'} left). Please renew to keep billing.
          </div>
        )}
      </>
    )

  if (st.state === 'unlicensed') return <Activate note={st.message} onDone={refresh} />

  async function checkAgain(): Promise<void> {
    setBusy(true)
    setNote('')
    const r = await window.api.license.check()
    setBusy(false)
    if (r.ok) {
      setSt(r.data)
      if (r.data.state !== 'active')
        setNote('Still inactive. Contact the developer if you have paid.')
    } else setNote(r.error)
  }
  return (
    <>
      {children}
      <div className="license-banner bad" role="alert">
        <strong>Subscription inactive.</strong> {st.message} Billing and changes are switched off.
        You can still view and export your data.
        <div>
          <button disabled={busy} onClick={() => void checkAgain()}>
            Check again
          </button>
          {note && <span> {note}</span>}
        </div>
      </div>
    </>
  )
}

function Activate({ note, onDone }: { note: string; onDone: () => void }): React.JSX.Element {
  const [key, setKey] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  async function submit(): Promise<void> {
    setBusy(true)
    setErr('')
    const r = await window.api.license.activate(key)
    setBusy(false)
    if (!r.ok) return setErr(r.error)
    onDone()
  }
  return (
    <div className="auth-screen">
      <form
        className="card auth-card form"
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        <h2>Activate the program</h2>
        <p className="muted">
          Enter the license key you were given. The computer needs an internet connection for this
          one step.
        </p>
        {note && <p className="muted">{note}</p>}
        <label>
          License key
          <input
            autoFocus
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="XXXX-XXXX-XXXX-XXXX"
            autoComplete="off"
          />
        </label>
        {err && (
          <p className="err" role="alert">
            {err}
          </p>
        )}
        <button type="submit" className="primary big" disabled={busy || !key.trim()}>
          {busy ? 'Checking…' : 'Activate'}
        </button>
      </form>
    </div>
  )
}
