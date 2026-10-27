import { useEffect, useState } from 'react'
import type { BackupInfo, BackupSummary } from '../../../shared/types'

const when = (iso: string): string => (iso ? new Date(iso).toLocaleString() : '')

/** Choose a backup file, see what is in it, and replace all current data with it. */
export function RestorePanel(): React.JSX.Element {
  const [summary, setSummary] = useState<BackupSummary | null>(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)

  async function pick(): Promise<void> {
    setErr('')
    const r = await window.api.backup.pickRestore()
    if (!r.ok) return setErr(r.error)
    setSummary(r.data)
  }
  async function restore(): Promise<void> {
    setBusy(true)
    const r = await window.api.backup.restoreNow()
    setBusy(false)
    if (!r.ok) return setErr(r.error)
    setDone(true) // the program closes and opens again by itself
  }

  if (done) return <p role="status">Restored. The program is restarting…</p>
  return (
    <div>
      <button type="button" onClick={() => void pick()} disabled={busy}>
        Restore from a backup…
      </button>
      {err && (
        <p className="err" role="alert">
          {err}
        </p>
      )}
      {summary && (
        <div
          className="card"
          role="group"
          aria-label="Restore confirmation"
          style={{ marginTop: 10 }}
        >
          <strong>This backup</strong>
          <p style={{ margin: '4px 0' }}>
            {summary.shopName || 'Shop'}: {summary.products} products, {summary.bills} bills,{' '}
            {summary.users} user account{summary.users === 1 ? '' : 's'}. File saved{' '}
            {when(summary.savedAt)}
            {summary.lastBillAt ? `, last bill ${when(summary.lastBillAt)}` : ''}.
          </p>
          <p className="err" style={{ margin: '4px 0' }}>
            Restoring <strong>replaces everything</strong> in the program with this backup. A safety
            copy of the current data is saved first. The program restarts, and you sign in with the
            accounts from the backup.
          </p>
          <div className="row-end">
            <button type="button" onClick={() => setSummary(null)} disabled={busy}>
              Cancel
            </button>
            <button type="button" className="danger" onClick={() => void restore()} disabled={busy}>
              {busy ? 'Restoring…' : 'Replace everything with this backup'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

/** The Settings card: back up in one click to a remembered folder (such as a USB drive), and restore. */
export function BackupCard(): React.JSX.Element {
  const [info, setInfo] = useState<BackupInfo | null>(null)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void window.api.backup.info().then((r) => r.ok && setInfo(r.data))
  }, [])

  async function backupNow(): Promise<void> {
    setBusy(true)
    setMsg(null)
    const r = await window.api.backup.now()
    setBusy(false)
    if (!r.ok) return setMsg({ ok: false, text: `Backup failed: ${r.error}` })
    setInfo(r.data.info)
    if (r.data.path) setMsg({ ok: true, text: `Backup saved: ${r.data.path}` })
  }
  async function chooseFolder(): Promise<void> {
    const r = await window.api.backup.chooseFolder()
    if (r.ok) setInfo(r.data)
  }

  return (
    <div className="card" role="region" aria-label="Backup and restore">
      <h2 style={{ marginTop: 0 }}>Backup and restore</h2>
      <p className="muted" style={{ marginTop: 0 }}>
        A backup is one file with all your products, bills, accounts and settings. Keep copies on a
        USB drive that you take away from the shop. Keep backup files private: they contain
        everything.
      </p>
      <p>
        Backup folder: <strong>{info?.folder || 'not chosen yet'}</strong>
        <br />
        Last backup:{' '}
        <strong>{info?.lastAt ? when(info.lastAt) : 'never. Please make one now.'}</strong>
      </p>
      <div className="add-buttons">
        <button type="button" className="primary" disabled={busy} onClick={() => void backupNow()}>
          {busy ? 'Backing up…' : 'Back up now'}
        </button>
        <button type="button" disabled={busy} onClick={() => void chooseFolder()}>
          Choose backup folder…
        </button>
      </div>
      {msg && (
        <p className={msg.ok ? 'ok' : 'err'} role="status">
          {msg.text}
        </p>
      )}
      <hr style={{ border: 0, borderTop: '1px solid var(--line)', margin: '12px 0' }} />
      <RestorePanel />
    </div>
  )
}
