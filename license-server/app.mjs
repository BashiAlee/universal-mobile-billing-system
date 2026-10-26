import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import { timingSafeEqual } from 'node:crypto'
import { signToken } from './token.mjs'
import { evaluate, formatKey, newLicenseKey, normalizeKey } from './logic.mjs'

const ADMIN_HTML = readFileSync(new URL('./admin.html', import.meta.url), 'utf8')
const MAX_BODY = 20_000

function sameSecret(a, b) {
  const x = Buffer.from(String(a))
  const y = Buffer.from(String(b))
  return x.length === y.length && timingSafeEqual(x, y)
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (c) => {
      size += c.length
      if (size > MAX_BODY) {
        reject(new Error('Request too large'))
        req.destroy()
      } else chunks.push(c)
    })
    req.on('end', () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {})
      } catch {
        reject(new Error('Invalid JSON'))
      }
    })
    req.on('error', reject)
  })
}

const isDate = (s) =>
  typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s))

/**
 * Builds the request handler. `store` keeps the licenses, `privateKeyPem` signs the answers,
 * `adminToken` protects the admin page. `now` can be replaced in tests.
 */
export function createHandler({ store, privateKeyPem, adminToken, graceDays = 7, now = Date.now }) {
  const hits = new Map() // very small per-address limit on /check
  const limited = (ip) => {
    const t = now()
    const h = (hits.get(ip) ?? []).filter((x) => t - x < 60_000)
    h.push(t)
    hits.set(ip, h)
    return h.length > 60
  }

  async function check(body) {
    const key = formatKey(body.key)
    const machineId = String(body.machineId ?? '').slice(0, 100)
    if (!key || !machineId) return [400, { error: 'License key and computer ID are required' }]
    const lic = await store.find(key)
    if (!lic) return [404, { error: 'Unknown license key. Check it and try again.' }]
    const machines = Array.isArray(lic.machines) ? lic.machines : []
    if (!machines.includes(machineId)) {
      if (machines.length >= (lic.maxMachines ?? 2))
        return [
          403,
          {
            error: `This license is already used on ${machines.length} computers. Contact the developer.`
          }
        ]
      await store.update(key, { machines: [...machines, machineId] })
    }
    const t = now()
    const ev = evaluate(lic, t, graceDays)
    const payload = {
      key,
      machineId,
      shop: lic.shop,
      status: ev.status,
      paidUntil: lic.paidUntil,
      message: ev.message,
      issuedAt: t,
      validUntil: ev.validUntil
    }
    await store.update(key, { lastSeen: new Date(t).toISOString() })
    return [
      200,
      { token: signToken(payload, privateKeyPem), status: ev.status, message: ev.message }
    ]
  }

  async function admin(req, url, body) {
    if (!sameSecret(req.headers['x-admin-token'] ?? '', adminToken))
      return [401, { error: 'Wrong admin token' }]
    const parts = url.pathname.split('/').filter(Boolean) // admin api licenses [key] [action]
    const key = parts[3] ? formatKey(parts[3]) : ''
    if (req.method === 'GET' && parts.length === 3) return [200, { licenses: await store.list() }]
    if (req.method === 'POST' && parts.length === 3) {
      const shop = String(body.shop ?? '').trim()
      if (!shop || shop.length > 100) return [400, { error: 'Enter the shop name' }]
      if (!isDate(body.paidUntil))
        return [400, { error: 'Paid-until must be a date like 2026-12-31' }]
      const lic = {
        key: newLicenseKey(),
        shop,
        status: 'active',
        paidUntil: body.paidUntil,
        maxMachines: Math.min(20, Math.max(1, Number(body.maxMachines) || 2)),
        machines: [],
        createdAt: new Date(now()).toISOString(),
        note: String(body.note ?? '').slice(0, 300)
      }
      lic.key = formatKey(lic.key)
      await store.insert(lic)
      return [201, { license: lic }]
    }
    if (!key) return [404, { error: 'Not found' }]
    if (req.method === 'PATCH' && parts.length === 4) {
      const patch = {}
      if (body.status !== undefined) {
        if (body.status !== 'active' && body.status !== 'suspended')
          return [400, { error: 'Status must be active or suspended' }]
        patch.status = body.status
      }
      if (body.paidUntil !== undefined) {
        if (!isDate(body.paidUntil))
          return [400, { error: 'Paid-until must be a date like 2026-12-31' }]
        patch.paidUntil = body.paidUntil
      }
      if (body.shop !== undefined) patch.shop = String(body.shop).trim().slice(0, 100)
      if (body.note !== undefined) patch.note = String(body.note).slice(0, 300)
      if (body.maxMachines !== undefined)
        patch.maxMachines = Math.min(20, Math.max(1, Number(body.maxMachines) || 2))
      return (await store.update(key, patch))
        ? [200, { license: await store.find(key) }]
        : [404, { error: 'No such license' }]
    }
    if (req.method === 'POST' && parts[4] === 'reset-machines')
      return (await store.update(key, { machines: [] }))
        ? [200, { ok: true }]
        : [404, { error: 'No such license' }]
    if (req.method === 'DELETE' && parts.length === 4)
      return (await store.remove(key)) ? [200, { ok: true }] : [404, { error: 'No such license' }]
    return [404, { error: 'Not found' }]
  }

  return async function handler(req, res) {
    const send = (code, data, type = 'application/json') => {
      res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' })
      res.end(type === 'application/json' ? JSON.stringify(data) : data)
    }
    try {
      const url = new URL(req.url ?? '/', 'http://x')
      if (req.method === 'GET' && url.pathname === '/health') return send(200, { ok: true })
      if (req.method === 'GET' && (url.pathname === '/admin' || url.pathname === '/admin/'))
        return send(200, ADMIN_HTML, 'text/html; charset=utf-8')
      const body = req.method === 'GET' || req.method === 'DELETE' ? {} : await readJson(req)
      if (req.method === 'POST' && url.pathname === '/check') {
        if (limited(req.socket.remoteAddress ?? ''))
          return send(429, { error: 'Too many requests. Try again in a minute.' })
        const [code, data] = await check(body)
        return send(code, data)
      }
      if (url.pathname.startsWith('/admin/api/licenses')) {
        const [code, data] = await admin(req, url, body)
        return send(code, data)
      }
      return send(404, { error: 'Not found' })
    } catch (e) {
      return send(400, { error: e instanceof Error ? e.message : 'Bad request' })
    }
  }
}

export function listen(handler, port = 0) {
  const server = createServer(handler)
  return new Promise((resolve) => server.listen(port, () => resolve(server)))
}
