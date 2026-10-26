import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page
} from '@playwright/test'
import { generateKeyPairSync } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'
import { signIn } from './helpers'
import { pathToFileURL } from 'node:url'

// The real license server, with its list kept in memory for the test. It is a plain ES module, so it is loaded
// with a real dynamic import (the test file itself is compiled to CommonJS).
const dynamicImport = new Function('p', 'return import(p)') as (p: string) => Promise<any> // eslint-disable-line @typescript-eslint/no-explicit-any
const here = (f: string): string => pathToFileURL(join(process.cwd(), 'license-server', f)).href

let app: ElectronApplication
let page: Page
let dir: string
let server: { address(): unknown; close(): void }
let store: { insert(l: unknown): Promise<void>; update(k: string, p: unknown): Promise<boolean> }
const KEY = 'TEST-AAAA-BBBB-CCCC'

test.beforeAll(async () => {
  const keys = generateKeyPairSync('ed25519')
  const priv = keys.privateKey.export({ type: 'pkcs8', format: 'pem' }) as string
  const pub = keys.publicKey.export({ type: 'spki', format: 'pem' }) as string
  const { createHandler, listen } = await dynamicImport(here('app.mjs'))
  const { memoryStore } = await dynamicImport(here('store.mjs'))
  store = memoryStore()
  server = await listen(
    createHandler({ store, privateKeyPem: priv, adminToken: 'adm', graceDays: 7 }),
    0
  )
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  dir = mkdtempSync(join(tmpdir(), 'ubs-lic-'))
  app = await electron.launch({
    args: ['.'],
    env: {
      ...process.env,
      UBS_DATA_DIR: dir,
      UBS_EXPORT_DIR: dir,
      UBS_ENFORCE_LICENSE: '1',
      UBS_LICENSE_URL: url,
      UBS_LICENSE_PUBKEY_BASE64: Buffer.from(pub).toString('base64')
    }
  })
  page = await app.firstWindow()
})
test.afterAll(async () => {
  await app.close()
  server.close()
  rmSync(dir, { recursive: true, force: true })
})

const nextYear = `${new Date().getFullYear() + 1}-12-31`

test('not activated: only the activation screen shows, a wrong key is refused, a good key opens the program', async () => {
  await signIn(page, 'owner', 'owner-pass-1', false)
  await expect(page.getByRole('heading', { name: 'Activate the program' })).toBeVisible()
  await expect(page.getByText('Signed in as')).toHaveCount(0)
  // Nothing can be changed while it is not activated.
  const blocked = await page.evaluate(() =>
    window.api.products.create({ name: 'X', priceMinor: 1 })
  )
  expect(blocked).toMatchObject({ ok: false })

  await page.getByLabel('License key').fill('NOPE-NOPE-NOPE-NOPE')
  await page.getByRole('button', { name: 'Activate' }).click()
  await expect(page.getByRole('alert')).toContainText('Unknown license key')

  await store.insert({
    key: KEY,
    shop: 'Apex',
    status: 'active',
    paidUntil: nextYear,
    maxMachines: 2,
    machines: []
  })
  await page.getByLabel('License key').fill(KEY.toLowerCase())
  await page.getByRole('button', { name: 'Activate' }).click()
  await expect(page.getByText('Signed in as')).toBeVisible()
  const ok = await page.evaluate(() =>
    window.api.products.create({ name: 'Pen', priceMinor: 1000, stockQty: 5 })
  )
  expect(ok.ok).toBe(true)
})

test('switching the shop off: a notice appears, changes are refused, viewing and exporting still work', async () => {
  await store.update(KEY, { status: 'suspended' })
  const st = await page.evaluate(() => window.api.license.check())
  expect(st).toMatchObject({ ok: true, data: { state: 'suspended' } })
  await page.reload() // the sign-in is kept by the main process
  await expect(page.getByRole('alert').filter({ hasText: 'Subscription inactive' })).toBeVisible()
  await expect(page.getByText('Signed in as')).toBeVisible()

  const write = await page.evaluate(async () => {
    const p = await window.api.products.list('')
    const id = p.ok ? (p.data as { id: number }[])[0].id : 0
    return window.api.bills.create({ items: [{ productId: id, qty: 1 }] })
  })
  expect(write).toMatchObject({ ok: false })
  expect((write as { error: string }).error).toContain('Subscription inactive')
  const read = await page.evaluate(() => window.api.products.list(''))
  expect(read.ok).toBe(true)
  const exp = await page.evaluate(() => window.api.files.saveCsv('test-export', 'a,b\n1,2'))
  expect(exp.ok).toBe(true)
})

test('switching it back on: "Check again" restores everything', async () => {
  await store.update(KEY, { status: 'active' })
  await page.getByRole('button', { name: 'Check again' }).click()
  await expect(page.getByRole('alert').filter({ hasText: 'Subscription inactive' })).toHaveCount(0)
  const r = await page.evaluate(async () => {
    const p = await window.api.products.list('')
    const id = p.ok ? (p.data as { id: number }[])[0].id : 0
    return window.api.bills.create({ items: [{ productId: id, qty: 1 }] })
  })
  expect(r.ok).toBe(true)
})
