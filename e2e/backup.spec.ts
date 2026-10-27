import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page
} from '@playwright/test'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { signIn } from './helpers'

let root: string
let data: string
let usb: string
let restoreFile: string
let app: ElectronApplication
let page: Page

async function launch(dir: string): Promise<void> {
  app = await electron.launch({
    args: ['.'],
    env: {
      ...process.env,
      UBS_DATA_DIR: dir,
      UBS_BACKUP_DIR: usb,
      UBS_RESTORE_FILE: restoreFile,
      UBS_NO_RELAUNCH: '1' // the test reopens the program itself
    }
  })
  page = await app.firstWindow()
}
const closeQuietly = async (): Promise<void> => {
  await app.close().catch(() => {})
}

test.beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'ubs-bk-'))
  data = join(root, 'data')
  usb = join(root, 'usb')
  restoreFile = join(root, 'chosen-backup.db')
  mkdirSync(data)
  mkdirSync(usb)
})
test.afterAll(() => rmSync(root, { recursive: true, force: true }))

const names = (): Promise<string[]> =>
  page.evaluate(async () => {
    const r = await window.api.products.list('')
    return r.ok ? (r.data as { name: string }[]).map((p) => p.name).sort() : []
  })

test('back up in one click, keep working, then restore: the data goes back to the backup', async () => {
  await launch(data)
  await signIn(page)
  await page.evaluate(() =>
    window.api.products.create({ name: 'Pen', priceMinor: 1000, stockQty: 5 })
  )
  await page.getByRole('button', { name: 'Settings' }).click()
  const card = page.getByRole('region', { name: 'Backup and restore' })
  await expect(card).toContainText('never')
  await card.getByRole('button', { name: 'Back up now' }).click()
  await expect(card.getByRole('status')).toContainText('Backup saved')
  const files = readdirSync(usb)
  expect(files).toHaveLength(1)
  expect(files[0]).toMatch(/^billing-backup-\d{4}-\d{2}-\d{2}_\d{4}\.db$/)
  await expect(card).not.toContainText('never')
  copyFileSync(join(usb, files[0]), restoreFile)

  // Work done after the backup is lost by restoring, so it must be asked about clearly.
  await page.evaluate(() =>
    window.api.products.create({ name: 'Extra', priceMinor: 1, stockQty: 1 })
  )
  expect(await names()).toEqual(['Extra', 'Pen'])
  await card.getByRole('button', { name: 'Restore from a backup…' }).click()
  const confirm = page.getByRole('group', { name: 'Restore confirmation' })
  await expect(confirm).toContainText('1 products')
  await expect(confirm).toContainText('replaces everything')
  await confirm.getByRole('button', { name: 'Cancel' }).click()
  expect(await names()).toEqual(['Extra', 'Pen']) // cancelling changes nothing

  await card.getByRole('button', { name: 'Restore from a backup…' }).click()
  await confirm.getByRole('button', { name: 'Replace everything with this backup' }).click()
  await closeQuietly()

  expect(existsSync(join(data, 'backups'))).toBe(true) // the safety copy of the data before restoring
  expect(readdirSync(join(data, 'backups'))[0]).toMatch(/^before-restore-/)
  await launch(data)
  await signIn(page)
  expect(await names()).toEqual(['Pen'])
  await closeQuietly()
})

test('a bad file is refused with a clear message and nothing is changed', async () => {
  const bad = join(root, 'chosen-backup.db')
  writeFileSync(bad, 'not a database '.repeat(100))
  await launch(data)
  await signIn(page)
  await page.getByRole('button', { name: 'Settings' }).click()
  await page.getByRole('button', { name: 'Restore from a backup…' }).click()
  await expect(page.getByRole('alert').filter({ hasText: 'not a backup' })).toBeVisible()
  expect(await names()).toEqual(['Pen'])
  await closeQuietly()
})

test('moving to a new computer: restore from the first screen, then sign in with the old account', async () => {
  copyFileSync(
    join(usb, readdirSync(usb).filter((f) => f.startsWith('billing-backup'))[0]),
    restoreFile
  )
  const fresh = join(root, 'fresh')
  mkdirSync(fresh)
  await launch(fresh)
  await expect(page.getByRole('heading', { name: 'Create your account' })).toBeVisible()
  await page.getByRole('button', { name: 'Restore from a backup…' }).click()
  await page.getByRole('button', { name: 'Replace everything with this backup' }).click()
  await closeQuietly()

  await launch(fresh)
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible() // the old account exists
  await signIn(page)
  expect(await names()).toEqual(['Pen'])
  await closeQuietly()
})
