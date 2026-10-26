import { createHash, createPublicKey, verify } from 'node:crypto'
import { hostname, networkInterfaces, platform, arch } from 'node:os'
import type { Db } from '../db/database'
import type { LicenseStatus } from '../../shared/types'

export interface LicensePayload {
  key: string
  machineId: string
  shop: string
  status: 'active' | 'suspended'
  paidUntil: string
  message: string
  issuedAt: number
  validUntil: number
}

export interface LicenseCfg {
  enforced: boolean
  url: string
  publicKey: string
}

type Fetch = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>

const DAY = 24 * 60 * 60 * 1000

/** The token is base64url(payload JSON) + "." + base64url(ed25519 signature of the payload bytes). */
export function verifyToken(token: string, publicKeyPem: string): LicensePayload | null {
  try {
    const [body, sig] = String(token).split('.')
    if (!body || !sig) return null
    const bytes = Buffer.from(body, 'base64url')
    const ok = verify(null, bytes, createPublicKey(publicKeyPem), Buffer.from(sig, 'base64url'))
    return ok ? (JSON.parse(bytes.toString('utf8')) as LicensePayload) : null
  } catch {
    return null
  }
}

/** Identifies this computer (not stored): copying the database to another PC does not carry the license along. */
export function machineId(): string {
  const mac =
    Object.values(networkInterfaces())
      .flat()
      .find((n) => n && !n.internal && n.mac && n.mac !== '00:00:00:00:00:00')?.mac ?? ''
  return createHash('sha256')
    .update(`${hostname()}|${platform()}|${arch()}|${mac}`)
    .digest('hex')
    .slice(0, 32)
}

const get = (db: Db, key: string): string =>
  (db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined)
    ?.value ?? ''
const put = (db: Db, key: string, value: string): void => {
  db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(key, value)
}

const OFF: LicenseStatus = {
  enforced: false,
  state: 'off',
  shop: '',
  paidUntil: '',
  daysLeft: null,
  message: '',
  licenseKey: ''
}

/** What the shop may do right now, worked out from the saved answer alone (no internet needed). */
export function licenseState(
  db: Db,
  cfg: LicenseCfg,
  now: number,
  id = machineId()
): LicenseStatus {
  if (!cfg.enforced) return OFF
  const base = { ...OFF, enforced: true, licenseKey: get(db, 'licenseKey') }
  const token = get(db, 'licenseToken')
  if (!base.licenseKey || !token)
    return { ...base, state: 'unlicensed', message: get(db, 'licenseNote') }
  const p = verifyToken(token, cfg.publicKey)
  if (!p || p.machineId !== id || p.key.replace(/-/g, '') !== base.licenseKey.replace(/-/g, ''))
    return { ...base, state: 'unlicensed', message: 'Please activate the license again.' }

  const common = { ...base, shop: p.shop, paidUntil: p.paidUntil }
  // A clock set far back would stretch an old answer; remember the latest time we have seen.
  const lastSeen = Number(get(db, 'licenseLastSeen')) || 0
  if (now < lastSeen - DAY * 1.5)
    return {
      ...common,
      state: 'expired',
      message:
        'The computer clock looks wrong. Fix the date and time, then connect to the internet once.'
    }
  if (now > lastSeen + 60 * 60 * 1000) put(db, 'licenseLastSeen', String(now))

  if (p.status !== 'active') return { ...common, state: 'suspended', message: p.message }
  if (now > p.validUntil)
    return {
      ...common,
      state: 'expired',
      message:
        'The subscription could not be confirmed for several days. Connect to the internet once.'
    }
  const end = Date.parse(`${p.paidUntil}T23:59:59.999Z`)
  return { ...common, state: 'active', daysLeft: Math.max(0, Math.ceil((end - now) / DAY)) }
}

async function askServer(
  cfg: LicenseCfg,
  key: string,
  fetchFn: Fetch,
  id: string
): Promise<{ token?: string; error?: string; http: number }> {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), 10_000)
  try {
    const r = await fetchFn(`${cfg.url.replace(/\/+$/, '')}/check`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, machineId: id }),
      signal: ctl.signal
    })
    const data = (await r.json().catch(() => ({}))) as { token?: string; error?: string }
    return { ...data, http: r.status }
  } finally {
    clearTimeout(timer)
  }
}

function store(db: Db, cfg: LicenseCfg, token: string, id: string): void {
  const p = verifyToken(token, cfg.publicKey)
  if (!p || p.machineId !== id)
    throw new Error('The license server sent an answer that could not be trusted')
  put(db, 'licenseKey', p.key)
  put(db, 'licenseToken', token)
  put(db, 'licenseNote', '')
}

/** First use: ask the server about this key and, if it is known, remember the signed answer. */
export async function activateLicense(
  db: Db,
  cfg: LicenseCfg,
  key: string,
  now: number,
  fetchFn: Fetch = fetch as unknown as Fetch,
  id = machineId()
): Promise<LicenseStatus> {
  if (!cfg.enforced) return OFF
  let ans
  try {
    ans = await askServer(cfg, key, fetchFn, id)
  } catch {
    throw new Error(
      'Could not reach the license server. Check the internet connection and try again.'
    )
  }
  if (!ans.token) throw new Error(ans.error || 'The license could not be activated')
  store(db, cfg, ans.token, id)
  return licenseState(db, cfg, now, id)
}

/**
 * Asks the server again. With no internet the saved answer simply keeps being used until it runs out.
 * If the server no longer knows the key, or the computer limit is reached, the saved answer is removed.
 */
export async function checkLicense(
  db: Db,
  cfg: LicenseCfg,
  now: number,
  fetchFn: Fetch = fetch as unknown as Fetch,
  id = machineId()
): Promise<LicenseStatus> {
  if (!cfg.enforced) return OFF
  const key = get(db, 'licenseKey')
  if (!key) return licenseState(db, cfg, now, id)
  try {
    const ans = await askServer(cfg, key, fetchFn, id)
    if (ans.token) store(db, cfg, ans.token, id)
    else if (ans.http === 404 || ans.http === 403) {
      put(db, 'licenseToken', '')
      put(db, 'licenseNote', ans.error ?? '')
    }
  } catch {
    /* offline: keep using the saved answer */
  }
  return licenseState(db, cfg, now, id)
}

/** The message for a refused action. */
export function blockMessage(s: LicenseStatus): string {
  if (s.state === 'unlicensed')
    return 'This program is not activated yet. Enter the license key first.'
  return `Subscription inactive: ${s.message || 'please contact the developer'}. You can still view and export your data.`
}
