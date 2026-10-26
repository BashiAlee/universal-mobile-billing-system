import { describe, it, expect } from 'vitest'
import { generateKeyPairSync } from 'node:crypto'
import type { AddressInfo } from 'node:net'
import { memoryDb } from './helpers'
import { createHandler, listen } from '../license-server/app.mjs'
import { memoryStore } from '../license-server/store.mjs'
import { signToken } from '../license-server/token.mjs'
import {
  activateLicense,
  checkLicense,
  licenseState,
  machineId,
  verifyToken,
  blockMessage
} from '../src/main/services/license'

// Answers of the admin API, which the tests read freely.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any

const DAY = 24 * 60 * 60 * 1000
const keys = generateKeyPairSync('ed25519')
const priv = keys.privateKey.export({ type: 'pkcs8', format: 'pem' }) as string
const pub = keys.publicKey.export({ type: 'spki', format: 'pem' }) as string
const ymd = (t: number): string => new Date(t).toISOString().slice(0, 10)

/** A real license server on a free port with an in-memory list, and the app-side config pointing at it. */
async function setup(now = Date.now()): Promise<{
  url: string
  cfg: { enforced: boolean; url: string; publicKey: string }
  store: ReturnType<typeof memoryStore>
  clock: { t: number }
  close: () => void
  admin: (method: string, path: string, body?: unknown) => Promise<{ status: number; data: Any }>
}> {
  const clock = { t: now }
  const store = memoryStore()
  const handler = createHandler({
    store,
    privateKeyPem: priv,
    adminToken: 'adm',
    graceDays: 7,
    now: () => clock.t
  })
  const server = await listen(handler, 0)
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const admin = async (
    method: string,
    path: string,
    body?: unknown
  ): Promise<{ status: number; data: Any }> => {
    const r = await fetch(`${url}/admin/api/licenses${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', 'x-admin-token': 'adm' },
      body: body ? JSON.stringify(body) : undefined
    })
    return { status: r.status, data: await r.json() }
  }
  return {
    url,
    cfg: { enforced: true, url, publicKey: pub },
    store,
    clock,
    close: () => server.close(),
    admin
  }
}

describe('license server', () => {
  it('admin adds a shop, the shop activates, and suspending turns it off at the next check', async () => {
    const s = await setup()
    try {
      const db = memoryDb()
      const created = await s.admin('POST', '', {
        shop: 'Apex',
        paidUntil: ymd(s.clock.t + 30 * DAY)
      })
      expect(created.status).toBe(201)
      const key = created.data.license.key as string
      expect(key).toMatch(/^[A-Z2-9]{4}(-[A-Z2-9]{4}){3}$/)

      expect(licenseState(db, s.cfg, s.clock.t).state).toBe('unlicensed')
      const st = await activateLicense(db, s.cfg, key.toLowerCase(), s.clock.t)
      expect(st).toMatchObject({ state: 'active', shop: 'Apex' })
      expect(st.daysLeft).toBeGreaterThanOrEqual(30)

      await s.admin('PATCH', `/${key}`, { status: 'suspended' })
      // Nothing changes until the program asks again.
      expect(licenseState(db, s.cfg, s.clock.t).state).toBe('active')
      expect((await checkLicense(db, s.cfg, s.clock.t)).state).toBe('suspended')
      expect(blockMessage(licenseState(db, s.cfg, s.clock.t))).toMatch(/view and export/)

      await s.admin('PATCH', `/${key}`, { status: 'active' })
      expect((await checkLicense(db, s.cfg, s.clock.t)).state).toBe('active')
    } finally {
      s.close()
    }
  })

  it('an unknown key is refused; the admin API needs the admin token', async () => {
    const s = await setup()
    try {
      const db = memoryDb()
      await expect(activateLicense(db, s.cfg, 'AAAA-BBBB-CCCC-DDDD', s.clock.t)).rejects.toThrow(
        /Unknown license key/
      )
      const r = await fetch(`${s.url}/admin/api/licenses`, {
        headers: { 'x-admin-token': 'wrong' }
      })
      expect(r.status).toBe(401)
      const bad = await s.admin('POST', '', { shop: '', paidUntil: '2030-01-01' })
      expect(bad.status).toBe(400)
      const bad2 = await s.admin('POST', '', { shop: 'X', paidUntil: 'soon' })
      expect(bad2.status).toBe(400)
    } finally {
      s.close()
    }
  })

  it('works offline for the grace period, then asks for an internet check; the paid-until date also ends it', async () => {
    const s = await setup()
    try {
      const db = memoryDb()
      const { data } = await s.admin('POST', '', {
        shop: 'Apex',
        paidUntil: ymd(s.clock.t + 60 * DAY)
      })
      await activateLicense(db, s.cfg, data.license.key, s.clock.t)
      expect(licenseState(db, s.cfg, s.clock.t + 6 * DAY).state).toBe('active')
      expect(licenseState(db, s.cfg, s.clock.t + 8 * DAY).state).toBe('expired')

      // A shop whose paid-until date is tomorrow is only allowed until then.
      const near = await s.admin('POST', '', { shop: 'Near', paidUntil: ymd(s.clock.t + DAY) })
      const db2 = memoryDb()
      await activateLicense(db2, s.cfg, near.data.license.key, s.clock.t)
      expect(licenseState(db2, s.cfg, s.clock.t).daysLeft).toBeLessThanOrEqual(2)
      s.clock.t += 3 * DAY
      expect((await checkLicense(db2, s.cfg, s.clock.t)).state).toBe('suspended')
    } finally {
      s.close()
    }
  })

  it('no internet: the saved answer keeps being used and nothing breaks', async () => {
    const s = await setup()
    const db = memoryDb()
    const { data } = await s.admin('POST', '', {
      shop: 'Apex',
      paidUntil: ymd(s.clock.t + 60 * DAY)
    })
    await activateLicense(db, s.cfg, data.license.key, s.clock.t)
    s.close() // the server disappears
    const offline = { ...s.cfg }
    expect((await checkLicense(db, offline, s.clock.t + DAY)).state).toBe('active')
    await expect(activateLicense(memoryDb(), offline, data.license.key, s.clock.t)).rejects.toThrow(
      /Could not reach/
    )
  })

  it('a key works on a limited number of computers; the admin can reset them', async () => {
    const s = await setup()
    try {
      const { data } = await s.admin('POST', '', {
        shop: 'Apex',
        paidUntil: ymd(s.clock.t + 60 * DAY),
        maxMachines: 1
      })
      const key = data.license.key as string
      await activateLicense(memoryDb(), s.cfg, key, s.clock.t, undefined, 'machine-A')
      await expect(
        activateLicense(memoryDb(), s.cfg, key, s.clock.t, undefined, 'machine-B')
      ).rejects.toThrow(/already used on 1 computers/)
      await s.admin('POST', `/${key}/reset-machines`)
      const st = await activateLicense(memoryDb(), s.cfg, key, s.clock.t, undefined, 'machine-B')
      expect(st.state).toBe('active')
    } finally {
      s.close()
    }
  })

  it('deleting a license removes the shop at its next check', async () => {
    const s = await setup()
    try {
      const db = memoryDb()
      const { data } = await s.admin('POST', '', {
        shop: 'Apex',
        paidUntil: ymd(s.clock.t + 60 * DAY)
      })
      await activateLicense(db, s.cfg, data.license.key, s.clock.t)
      await s.admin('DELETE', `/${data.license.key}`)
      expect((await checkLicense(db, s.cfg, s.clock.t)).state).toBe('unlicensed')
    } finally {
      s.close()
    }
  })
})

describe('trusting answers', () => {
  it('rejects answers signed with another key, edited answers, and a token moved to another computer', async () => {
    const other = generateKeyPairSync('ed25519').privateKey.export({
      type: 'pkcs8',
      format: 'pem'
    }) as string
    const payload = {
      key: 'AAAA-BBBB-CCCC-DDDD',
      machineId: machineId(),
      shop: 'X',
      status: 'active',
      paidUntil: '2099-01-01',
      message: '',
      issuedAt: 1,
      validUntil: 9e15
    }
    expect(verifyToken(signToken(payload, priv), pub)?.shop).toBe('X')
    expect(verifyToken(signToken(payload, other), pub)).toBeNull()
    const t = signToken(payload, priv)
    const tampered =
      Buffer.from(JSON.stringify({ ...payload, paidUntil: '2999-01-01' })).toString('base64url') +
      '.' +
      t.split('.')[1]
    expect(verifyToken(tampered, pub)).toBeNull()
    expect(verifyToken('garbage', pub)).toBeNull()

    // A saved answer for another computer is not accepted.
    const db = memoryDb()
    db.prepare(
      "INSERT INTO settings (key, value) VALUES ('licenseKey', 'AAAA-BBBB-CCCC-DDDD'), ('licenseToken', ?)"
    ).run(signToken({ ...payload, machineId: 'someone-else' }, priv))
    expect(licenseState(db, { enforced: true, url: 'x', publicKey: pub }, Date.now()).state).toBe(
      'unlicensed'
    )
  })

  it('does nothing while no license server is configured', () => {
    const db = memoryDb()
    expect(licenseState(db, { enforced: false, url: '', publicKey: pub }, Date.now()).state).toBe(
      'off'
    )
  })

  it('a clock set far back does not stretch an old answer', async () => {
    const s = await setup()
    try {
      const db = memoryDb()
      const { data } = await s.admin('POST', '', {
        shop: 'Apex',
        paidUntil: ymd(s.clock.t + 60 * DAY)
      })
      await activateLicense(db, s.cfg, data.license.key, s.clock.t)
      expect(licenseState(db, s.cfg, s.clock.t + 3 * DAY).state).toBe('active') // remembers it was used on day 3
      expect(licenseState(db, s.cfg, s.clock.t).state).toBe('expired') // clock moved back 3 days
    } finally {
      s.close()
    }
  })
})
