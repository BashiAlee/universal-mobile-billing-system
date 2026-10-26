import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page
} from '@playwright/test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { signIn, USER, PASSWORD } from './helpers'

// Accounts, sign-in, sign-out and the automatic sign-out. The idle time is shortened for the test.
let app: ElectronApplication
let page: Page
let dir: string
let recoveryCode = ''

async function launch(): Promise<void> {
  app = await electron.launch({
    args: ['.'],
    env: { ...process.env, UBS_DATA_DIR: dir, UBS_IDLE_MS: '4000' }
  })
  page = await app.firstWindow()
}

test.beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'ubs-auth-'))
  await launch()
})
test.afterAll(async () => {
  await app.close()
  rmSync(dir, { recursive: true, force: true })
})

test('first start: create the first account, note the recovery code, then the app opens', async () => {
  await expect(page.getByRole('heading', { name: 'Create your account' })).toBeVisible()
  await expect(page.getByText('Signed in as')).toHaveCount(0) // nothing is shown before signing in
  await page.getByLabel('Username').fill(USER)
  await page.getByLabel('Password (at least 6 characters)').fill('abc')
  await page.getByLabel('Repeat password').fill('abc')
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page.getByRole('alert')).toContainText('at least 6')
  await page.getByLabel('Password (at least 6 characters)').fill(PASSWORD)
  await page.getByLabel('Repeat password').fill('different')
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page.getByRole('alert')).toContainText('not the same')
  await page.getByLabel('Repeat password').fill(PASSWORD)
  await page.getByRole('button', { name: 'Create account' }).click()

  recoveryCode = (await page.getByLabel('Recovery code').innerText()).trim()
  expect(recoveryCode).toMatch(/^[A-Z2-9]{4}(-[A-Z2-9]{4}){3}$/)
  // You cannot carry on until you confirm you wrote it down.
  await page.getByRole('button', { name: 'Continue' }).click()
  await expect(page.getByText('Signed in as')).toHaveCount(0)
  await page.getByLabel('I have written it down').check()
  await page.getByRole('button', { name: 'Continue' }).click()
  await expect(page.getByText('Signed in as')).toBeVisible()
  await expect(page.locator('.sidebar-user')).toContainText(USER)
})

test('log out shows the sign-in screen, and the main process refuses data while signed out', async () => {
  await page.getByRole('button', { name: 'Log out' }).click()
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()
  const r = await page.evaluate(() => window.api.products.list(''))
  expect(r).toMatchObject({ ok: false, error: 'Please log in' })
  const s = await page.evaluate(() => window.api.settings.save({}))
  expect(s).toMatchObject({ ok: false, error: 'Please log in' })
})

test('wrong password is refused; the right one (any letter case in the name) signs in', async () => {
  await page.getByLabel('Username').fill(USER)
  await page.getByLabel('Password', { exact: true }).fill('nope-nope')
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('Wrong username or password')
  await signIn(page, USER.toUpperCase(), PASSWORD)
})

test('add a second user; bills made by them show their name', async () => {
  await page.getByRole('button', { name: 'Users', exact: true }).click()
  await page.getByLabel('Username').fill('sara')
  await page.getByLabel('Password (at least 6 characters)').fill('sara-pass-1')
  await page.getByRole('button', { name: 'Add user' }).click()
  await expect(page.getByRole('status')).toContainText('Added sara')
  // Cannot add the same name again, and cannot delete yourself.
  await page.getByLabel('Username').fill('SARA')
  await page.getByLabel('Password (at least 6 characters)').fill('another-1')
  await page.getByRole('button', { name: 'Add user' }).click()
  await expect(page.getByRole('status')).toContainText('already used')
  await expect(page.getByRole('button', { name: `Delete ${USER}` })).toBeDisabled()

  await page.getByRole('button', { name: 'Log out' }).click()
  await signIn(page, 'sara', 'sara-pass-1')
  await expect(page.locator('.sidebar-user')).toContainText('sara')
  // A bill made while signed in as sara.
  await page.evaluate(async () => {
    const p = await window.api.products.create({ name: 'Pen', priceMinor: 1000, stockQty: 5 })
    if (!p.ok) throw new Error(p.error)
    const b = await window.api.bills.create({
      items: [{ productId: (p.data as { id: number }).id, qty: 1 }]
    })
    if (!b.ok) throw new Error(b.error)
  })
  await page.getByRole('button', { name: 'Bill history' }).click()
  await expect(page.getByRole('row', { name: /INV-000001/ })).toContainText('sara')
})

test('signed out automatically after the idle time; activity keeps you signed in', async () => {
  // Keep moving the mouse for longer than the idle time: still signed in.
  for (let i = 0; i < 7; i++) {
    await page.mouse.move(100 + i * 20, 200)
    await page.waitForTimeout(1000)
  }
  await expect(page.getByText('Signed in as')).toBeVisible()
  // Now do nothing.
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText('signed out because the program was not used')).toBeVisible()
  const r = await page.evaluate(() => window.api.products.list(''))
  expect(r).toMatchObject({ ok: false, error: 'Please log in' })
})

test('forgot password: the recovery code sets a new one (and the old code stops working)', async () => {
  await page.getByRole('button', { name: 'Forgot password?' }).click()
  await page.getByLabel('Username').fill(USER)
  await page.getByLabel('Recovery code').fill('AAAA-BBBB-CCCC-DDDD')
  await page.getByLabel('New password (at least 6 characters)').fill('brand-new-1')
  await page.getByLabel('Repeat new password').fill('brand-new-1')
  await page.getByRole('button', { name: 'Change password' }).click()
  await expect(page.getByRole('alert')).toContainText('not right')

  await page.getByLabel('Recovery code').fill(recoveryCode)
  await page.getByRole('button', { name: 'Change password' }).click()
  const newCode = (await page.getByLabel('Recovery code').innerText()).trim()
  expect(newCode).not.toBe(recoveryCode)
  await page.getByLabel('I have written it down').check()
  await page.getByRole('button', { name: 'Continue' }).click()
  await signIn(page, USER, 'brand-new-1')
})

test('too many wrong passwords lock that username for a short time', async () => {
  await page.getByRole('button', { name: 'Log out' }).click()
  for (let i = 0; i < 5; i++) {
    await page.getByLabel('Username').fill('sara')
    await page.getByLabel('Password', { exact: true }).fill('wrong-wrong')
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()
    await expect(page.getByRole('alert')).toBeVisible()
  }
  await page.getByLabel('Password', { exact: true }).fill('sara-pass-1')
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('Too many wrong attempts')
})

test('accounts survive closing and reopening the program', async () => {
  await app.close()
  await launch()
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()
  await signIn(page, USER, 'brand-new-1')
})
