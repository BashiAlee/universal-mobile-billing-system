import { useCallback, useEffect, useState } from 'react'
import type { AppUser } from '../../../shared/types'
import { useAuth } from '../lib/useAuth'

export default function UsersPage(): React.JSX.Element {
  const { username: me } = useAuth()
  const [users, setUsers] = useState<AppUser[]>([])
  const [u, setU] = useState('')
  const [p, setP] = useState('')
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [reset, setReset] = useState<{ user: AppUser; password: string } | null>(null)
  const [resetErr, setResetErr] = useState('')

  const load = useCallback(async () => {
    const r = await window.api.users.list()
    if (r.ok) setUsers(r.data)
  }, [])
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()
  }, [load])

  async function add(): Promise<void> {
    const r = await window.api.users.add(u, p)
    if (!r.ok) return setMsg({ ok: false, text: r.error })
    setMsg({ ok: true, text: `Added ${r.data.username}. Give them this username and password.` })
    setU('')
    setP('')
    void load()
  }

  async function remove(user: AppUser): Promise<void> {
    if (
      !window.confirm(
        `Delete the account "${user.username}"? They will no longer be able to sign in.`
      )
    )
      return
    const r = await window.api.users.delete(user.id)
    setMsg(r.ok ? { ok: true, text: `Deleted ${user.username}` } : { ok: false, text: r.error })
    void load()
  }

  async function savePassword(): Promise<void> {
    if (!reset) return
    const r = await window.api.users.setPassword(reset.user.id, reset.password)
    if (!r.ok) return setResetErr(r.error)
    setMsg({ ok: true, text: `New password set for ${reset.user.username}` })
    setReset(null)
    setResetErr('')
  }

  return (
    <div className="page">
      <h1>Users</h1>
      <p className="muted">
        Each person who uses the program has their own username and password. Everyone can use every
        screen. Bills show who made them.
      </p>
      {msg && (
        <p className={msg.ok ? 'ok' : 'err'} role="status">
          {msg.text}
        </p>
      )}
      <table className="grid">
        <thead>
          <tr>
            <th>Username</th>
            <th>Added</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {users.map((x) => (
            <tr key={x.id}>
              <td>
                {x.username}
                {x.username.toLowerCase() === me.toLowerCase() && (
                  <span className="muted"> (you)</span>
                )}
              </td>
              <td>{new Date(x.createdAt).toLocaleDateString()}</td>
              <td className="actions">
                <button
                  onClick={() => {
                    setReset({ user: x, password: '' })
                    setResetErr('')
                  }}
                >
                  Set new password
                </button>
                <button
                  className="danger"
                  aria-label={`Delete ${x.username}`}
                  disabled={x.username.toLowerCase() === me.toLowerCase()}
                  onClick={() => void remove(x)}
                >
                  Delete
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <form
        className="card form"
        style={{ marginTop: 16 }}
        onSubmit={(e) => {
          e.preventDefault()
          void add()
        }}
      >
        <h2>Add a user</h2>
        <label>
          Username
          <input value={u} onChange={(e) => setU(e.target.value)} autoComplete="off" />
        </label>
        <label>
          Password (at least 6 characters)
          <input
            type="password"
            value={p}
            onChange={(e) => setP(e.target.value)}
            autoComplete="new-password"
          />
        </label>
        <div>
          <button type="submit" className="primary">
            Add user
          </button>
        </div>
      </form>

      {reset && (
        <div className="modal" role="dialog" aria-modal="true" aria-label="New password">
          <form
            className="modal-card form"
            onSubmit={(e) => {
              e.preventDefault()
              void savePassword()
            }}
            onKeyDown={(e) => e.key === 'Escape' && setReset(null)}
          >
            <h2>New password for {reset.user.username}</h2>
            <label>
              New password (at least 6 characters)
              <input
                autoFocus
                type="password"
                value={reset.password}
                onChange={(e) => setReset({ ...reset, password: e.target.value })}
              />
            </label>
            {resetErr && (
              <p className="err" role="alert">
                {resetErr}
              </p>
            )}
            <div className="row-end">
              <button type="button" onClick={() => setReset(null)}>
                Cancel
              </button>
              <button type="submit" className="primary">
                Save password
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}
