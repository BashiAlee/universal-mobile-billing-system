import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import type { AuthStatus } from '../../../shared/types'
import { AuthContext } from '../lib/useAuth'

type View = 'login' | 'recover' | 'code'

/**
 * Nothing in the program is shown until someone signs in. Signing out happens by button, or
 * automatically after the idle time (no mouse, keyboard or touch use). The main process enforces the same
 * rules, so a screen that stays open cannot read or change data once the session has ended.
 */
export function AuthGate({ children }: { children: ReactNode }): React.JSX.Element {
  const [status, setStatus] = useState<AuthStatus | null>(null)
  const [view, setView] = useState<View>('login')
  const [notice, setNotice] = useState('')
  // Shown after creating an account or recovering access: the one-time recovery code to write down.
  const [code, setCode] = useState<{ value: string; next: 'app' | 'login' } | null>(null)
  const wasIn = useRef(false)

  const refresh = useCallback(async () => {
    const r = await window.api.auth.status()
    if (r.ok) setStatus(r.data)
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh()
  }, [refresh])

  const loggedIn = !!status?.loggedIn && !code
  useEffect(() => {
    if (wasIn.current && !status?.loggedIn)
      setNotice('You were signed out because the program was not used for a while.')
    wasIn.current = !!status?.loggedIn
  }, [status?.loggedIn])

  const logout = useCallback(async () => {
    await window.api.auth.logout()
    setNotice('')
    setView('login')
    wasIn.current = false
    await refresh()
  }, [refresh])

  // Idle timer + keep the main process told that the person is still here.
  const idleMs = status?.idleMs ?? 0
  useEffect(() => {
    if (!loggedIn || !idleMs) return
    let last = Date.now()
    let lastPing = 0
    const onActivity = (): void => {
      last = Date.now()
      if (last - lastPing > Math.min(15_000, idleMs / 3)) {
        lastPing = last
        void window.api.auth.ping()
      }
    }
    const events = ['mousemove', 'mousedown', 'keydown', 'wheel', 'touchstart', 'scroll']
    events.forEach((e) => window.addEventListener(e, onActivity, { passive: true }))
    const tick = setInterval(
      () => {
        if (Date.now() - last > idleMs) void window.api.auth.logout().then(refresh)
        else void refresh() // notices a session that the main process has already ended
      },
      Math.max(500, Math.min(5000, idleMs / 4))
    )
    return () => {
      events.forEach((e) => window.removeEventListener(e, onActivity))
      clearInterval(tick)
    }
  }, [loggedIn, idleMs, refresh])

  if (!status) return <p style={{ padding: 24 }}>Loading…</p>

  if (code)
    return (
      <Screen status={status}>
        <h2>Write down your recovery code</h2>
        <p>
          If you ever forget your password, this code lets you set a new one. It is shown only now.
          Keep it somewhere safe, not on this computer.
        </p>
        <p className="recovery-code" aria-label="Recovery code">
          {code.value}
        </p>
        <label className="inline">
          <input type="checkbox" id="saved-code" /> I have written it down
        </label>
        <button
          className="primary big"
          onClick={() => {
            const box = document.getElementById('saved-code') as HTMLInputElement
            if (!box.checked) return
            const next = code.next
            setCode(null)
            if (next === 'login') setView('login')
            void refresh()
          }}
        >
          Continue
        </button>
      </Screen>
    )

  if (!status.loggedIn) {
    if (!status.hasUsers)
      return (
        <Screen status={status}>
          <SetupForm
            onDone={(c) => {
              setCode({ value: c, next: 'app' })
            }}
          />
        </Screen>
      )
    return (
      <Screen status={status}>
        {view === 'recover' ? (
          <RecoverForm
            onBack={() => setView('login')}
            onDone={(c) => {
              setNotice('Password changed. Sign in with the new password.')
              setCode({ value: c, next: 'login' })
            }}
          />
        ) : (
          <LoginForm
            notice={notice}
            onForgot={() => setView('recover')}
            onDone={() => {
              setNotice('')
              void refresh()
            }}
          />
        )}
      </Screen>
    )
  }

  return (
    <AuthContext.Provider value={{ username: status.username, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

function Screen({
  status,
  children
}: {
  status: AuthStatus
  children: ReactNode
}): React.JSX.Element {
  return (
    <div className="auth-screen">
      <div className="card auth-card">
        {status.logoDataUrl && <img src={status.logoDataUrl} alt="" className="auth-logo" />}
        <h1>{status.shopName}</h1>
        {children}
      </div>
    </div>
  )
}

function SetupForm({ onDone }: { onDone: (code: string) => void }): React.JSX.Element {
  const [u, setU] = useState('')
  const [p, setP] = useState('')
  const [p2, setP2] = useState('')
  const [err, setErr] = useState('')
  async function submit(): Promise<void> {
    if (p !== p2) return setErr('The two passwords are not the same')
    const r = await window.api.auth.setup(u, p)
    if (!r.ok) return setErr(r.error)
    onDone(r.data.recoveryCode)
  }
  return (
    <form
      className="form"
      onSubmit={(e) => {
        e.preventDefault()
        void submit()
      }}
    >
      <h2>Create your account</h2>
      <p className="muted">
        This is the first account. You can add an account for each person who uses the program
        later.
      </p>
      <label>
        Username
        <input autoFocus value={u} onChange={(e) => setU(e.target.value)} autoComplete="off" />
      </label>
      <label>
        Password (at least 6 characters)
        <input type="password" value={p} onChange={(e) => setP(e.target.value)} />
      </label>
      <label>
        Repeat password
        <input type="password" value={p2} onChange={(e) => setP2(e.target.value)} />
      </label>
      {err && (
        <p className="err" role="alert">
          {err}
        </p>
      )}
      <button type="submit" className="primary big">
        Create account
      </button>
    </form>
  )
}

function LoginForm({
  notice,
  onForgot,
  onDone
}: {
  notice: string
  onForgot: () => void
  onDone: () => void
}): React.JSX.Element {
  const [u, setU] = useState('')
  const [p, setP] = useState('')
  const [err, setErr] = useState('')
  async function submit(): Promise<void> {
    const r = await window.api.auth.login(u, p)
    if (!r.ok) {
      setP('')
      return setErr(r.error)
    }
    onDone()
  }
  return (
    <form
      className="form"
      onSubmit={(e) => {
        e.preventDefault()
        void submit()
      }}
    >
      <h2>Sign in</h2>
      {notice && <p className="muted">{notice}</p>}
      <label>
        Username
        <input autoFocus value={u} onChange={(e) => setU(e.target.value)} autoComplete="off" />
      </label>
      <label>
        Password
        <input type="password" value={p} onChange={(e) => setP(e.target.value)} />
      </label>
      {err && (
        <p className="err" role="alert">
          {err}
        </p>
      )}
      <button type="submit" className="primary big">
        Sign in
      </button>
      <button type="button" className="link" onClick={onForgot}>
        Forgot password?
      </button>
    </form>
  )
}

function RecoverForm({
  onBack,
  onDone
}: {
  onBack: () => void
  onDone: (code: string) => void
}): React.JSX.Element {
  const [u, setU] = useState('')
  const [code, setCode] = useState('')
  const [p, setP] = useState('')
  const [p2, setP2] = useState('')
  const [err, setErr] = useState('')
  async function submit(): Promise<void> {
    if (p !== p2) return setErr('The two passwords are not the same')
    const r = await window.api.auth.recover(u, code, p)
    if (!r.ok) return setErr(r.error)
    onDone(r.data.recoveryCode)
  }
  return (
    <form
      className="form"
      onSubmit={(e) => {
        e.preventDefault()
        void submit()
      }}
    >
      <h2>Set a new password</h2>
      <p className="muted">
        Enter the username, the recovery code you wrote down when the first account was created, and
        a new password.
      </p>
      <label>
        Username
        <input autoFocus value={u} onChange={(e) => setU(e.target.value)} autoComplete="off" />
      </label>
      <label>
        Recovery code
        <input value={code} onChange={(e) => setCode(e.target.value)} autoComplete="off" />
      </label>
      <label>
        New password (at least 6 characters)
        <input type="password" value={p} onChange={(e) => setP(e.target.value)} />
      </label>
      <label>
        Repeat new password
        <input type="password" value={p2} onChange={(e) => setP2(e.target.value)} />
      </label>
      {err && (
        <p className="err" role="alert">
          {err}
        </p>
      )}
      <button type="submit" className="primary big">
        Change password
      </button>
      <button type="button" className="link" onClick={onBack}>
        Back to sign in
      </button>
    </form>
  )
}
