import type { AppUser } from '../shared/types'

/** Signed out after this long with no mouse, keyboard or touch use: 5 hours. */
export const IDLE_MS = 5 * 60 * 60 * 1000
const MAX_FAILS = 5
const LOCK_MS = 30 * 1000

/** Who is signed in. Lives only in memory, so closing the program always signs everyone out. */
export class Session {
  private user: AppUser | null = null
  private last = 0
  private fails = new Map<string, { count: number; until: number }>()

  constructor(
    readonly idleMs: number = IDLE_MS,
    private now: () => number = Date.now
  ) {}

  login(user: AppUser): void {
    this.user = user
    this.last = this.now()
  }

  logout(): void {
    this.user = null
  }

  /** The signed-in user, or null (also when the idle time ran out, which signs them out). */
  current(): AppUser | null {
    if (this.user && this.now() - this.last > this.idleMs) this.user = null
    return this.user
  }

  /** Counts as activity (called on every request from a signed-in screen and on mouse/keyboard use). */
  touch(): void {
    if (this.current()) this.last = this.now()
  }

  /** Seconds a username must still wait after too many wrong passwords, or 0. */
  lockedFor(username: string): number {
    const f = this.fails.get(username.toLowerCase())
    return f && f.until > this.now() ? Math.ceil((f.until - this.now()) / 1000) : 0
  }

  recordFailure(username: string): void {
    const key = username.toLowerCase()
    const f = this.fails.get(key) ?? { count: 0, until: 0 }
    f.count += 1
    if (f.count >= MAX_FAILS) {
      f.until = this.now() + LOCK_MS
      f.count = 0
    }
    this.fails.set(key, f)
  }

  recordSuccess(username: string): void {
    this.fails.delete(username.toLowerCase())
  }
}
