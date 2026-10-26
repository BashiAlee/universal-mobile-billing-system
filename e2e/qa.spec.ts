import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page
} from '@playwright/test'
import { signIn } from './helpers'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// QA suite: runs against the real Electron app with real dialogs (window.prompt is NOT stubbed)
// and an isolated data folder. Only window.print is replaced (it opens a native dialog).

type W = {
  __prints: number
  __printed: { labels: number; receipts: number }[]
  __systemPrint: boolean
  __xss?: number
  api: {
    bills: {
      create(i: unknown): Promise<{ ok: boolean; error?: string }>
      list(): Promise<{ ok: boolean; data: unknown[] }>
    }
    settings: { save(s: unknown): Promise<{ ok: boolean; error?: string }> }
    products: { create(i: unknown): Promise<{ ok: boolean; error?: string }> }
  }
}

let app: ElectronApplication
let page: Page
let dataDir: string

async function launch(): Promise<void> {
  app = await electron.launch({ args: ['.'], env: { ...process.env, UBS_DATA_DIR: dataDir } })
  page = await app.firstWindow()
  await page.evaluate(() => {
    const w = window as unknown as W
    w.__prints = 0
    w.__printed = []
    w.__systemPrint = true
    window.print = () => {
      w.__prints++
      w.__printed.push({
        labels: document.querySelectorAll('.print-area .label').length,
        receipts: document.querySelectorAll('.print-area.receipt').length
      })
    }
  })
  await signIn(page)
}

const prints = (): Promise<number> => page.evaluate(() => (window as unknown as W).__prints)

async function addProduct(name: string, price: string, stock: string, code = ''): Promise<void> {
  await page.getByRole('button', { name: 'Products & stock' }).click()
  await page.getByRole('button', { name: '+ Add product' }).click()
  const d = page.getByRole('dialog', { name: 'Product form' })
  await d.getByLabel('Name', { exact: true }).fill(name)
  if (code) await d.getByLabel('Code (leave blank to auto-generate)').fill(code)
  await d.getByLabel('Selling price').fill(price)
  await d.getByLabel('Opening stock').fill(stock)
  await d.getByRole('button', { name: 'Save' }).click()
  await expect(d).toBeHidden()
}

test.beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'ubs-qa-'))
  await launch()
})
test.afterAll(async () => {
  await app.close()
  rmSync(dataDir, { recursive: true, force: true })
})

test('D1: "Stock" button opens an in-app dialog and changes stock (window.prompt is unsupported in Electron)', async () => {
  await addProduct('Notebook', '40', '5', 'NB-1')
  const row = page.getByRole('row', { name: /Notebook/ })
  await row.getByRole('button', { name: 'Stock' }).click()
  const d = page.getByRole('dialog', { name: 'Quantity' })
  await d.getByRole('textbox').fill('0')
  await d.getByRole('button', { name: 'Update stock' }).click()
  await expect(d.getByRole('alert')).toHaveText('Enter a non-zero whole number')
  await d.getByRole('textbox').fill('7')
  await d.getByRole('button', { name: 'Update stock' }).click()
  await expect(d).toBeHidden()
  await expect(row).toContainText('12')
  // removing more than we have is refused with a visible message, stock unchanged
  await row.getByRole('button', { name: 'Stock' }).click()
  await d.getByRole('textbox').fill('-100')
  await d.getByRole('button', { name: 'Update stock' }).click()
  await expect(d.getByRole('alert')).toContainText('Not enough stock')
  await page.keyboard.press('Escape')
  await expect(d).toBeHidden()
  await expect(row).toContainText('12')
})

test('D1: "Print labels" asks for copies in-app and prints one label per copy', async () => {
  await addProduct('Pen', '10', '50', 'PEN-1')
  await page.getByLabel('Select Notebook').check()
  await page.getByLabel('Select Pen').check()
  await page.getByRole('button', { name: 'Print labels (2)' }).click()
  const d = page.getByRole('dialog', { name: 'Quantity' })
  await d.getByRole('textbox').fill('501')
  await d.getByRole('button', { name: 'Print', exact: true }).click()
  await expect(d.getByRole('alert')).toHaveText('Enter a number from 1 to 500')
  await d.getByRole('textbox').fill('3')
  const before = await prints()
  await d.getByRole('button', { name: 'Print', exact: true }).click()
  await expect.poll(prints).toBe(before + 1)
  const last = await page.evaluate(() => {
    const w = window as unknown as W
    return w.__printed[w.__printed.length - 1]
  })
  expect(last.labels).toBe(6) // 2 products x 3 copies
})

test('Windows, "Ask me each time": an in-app window asks for the printer instead of the Windows print window', async () => {
  test.skip(process.platform !== 'win32', 'the in-app printer chooser is Windows-only')
  await page.evaluate(() => ((window as unknown as W).__systemPrint = false))
  try {
    await page.getByRole('button', { name: 'Products & stock' }).click()
    await page
      .getByRole('row', { name: /Notebook/ })
      .getByRole('button', { name: 'Label', exact: true })
      .click()
    await page
      .getByRole('dialog', { name: 'Product label' })
      .getByRole('button', { name: 'Print label' })
      .click()
    const before = await prints()
    await page
      .getByRole('dialog', { name: 'Quantity' })
      .getByRole('button', { name: 'Print', exact: true })
      .click()
    const d = page.getByRole('dialog', { name: 'Choose printer' })
    await expect(d).toBeVisible()
    await expect(d.getByLabel('Printer')).not.toHaveValue('')
    // Cancel closes it without printing (choosing a printer would print for real).
    await d.getByRole('button', { name: 'Cancel' }).click()
    await expect(d).toBeHidden()
    expect(await prints()).toBe(before)
  } finally {
    await page.evaluate(() => ((window as unknown as W).__systemPrint = true))
  }
})

test('D2: double-clicking "Save & print bill" creates exactly one bill and deducts stock once', async () => {
  await page.getByRole('button', { name: 'New bill' }).click()
  const scan = page.getByLabel('Scan or search product')
  await scan.fill('PEN-1')
  await scan.press('Enter')
  await expect(page.locator('.qty')).toHaveText('1')
  await page.getByRole('button', { name: 'Save & print bill' }).dblclick()
  await expect(page.getByRole('status')).toContainText('Saved INV-')
  const n = await page.evaluate(
    async () => (await (window as unknown as W).api.bills.list()).data.length
  )
  expect(n).toBe(1)
  await page.getByRole('button', { name: 'Products & stock' }).click()
  await expect(page.getByRole('row', { name: /Pen/ })).toContainText('49')
})

test('XSS: hostile text in names/customer/shop name is shown as text, never executed', async () => {
  const evil = '<img src=x onerror="window.__xss=1">'
  await page.evaluate(() => ((window as unknown as W).__xss = 0))
  await addProduct(evil, '5', '3', 'XSS-1')
  await page.getByRole('button', { name: 'Settings' }).click()
  await page.getByLabel('Shop name').fill(evil)
  await page.getByLabel('Address').fill('<script>window.__xss=2</script>')
  await page.getByRole('button', { name: 'Save settings' }).click()
  await expect(page.getByRole('status')).toContainText('Saved')
  await page.getByRole('button', { name: 'New bill' }).click()
  const scan = page.getByLabel('Scan or search product')
  await scan.fill('XSS-1')
  await scan.press('Enter')
  await page.getByLabel('Customer (optional)').fill(evil)
  await page.getByRole('button', { name: 'Save & print bill' }).click()
  await expect(page.getByRole('status')).toContainText('Saved INV-')
  await page.getByRole('button', { name: 'Bill history' }).click()
  await expect(page.getByText(evil, { exact: true }).first()).toBeVisible()
  expect(await page.evaluate(() => (window as unknown as W).__xss)).toBe(0)
  expect(await page.locator('.sidebar .brand strong').textContent()).toBe(evil)
  // restore a sane shop name for later tests
  await page.getByRole('button', { name: 'Settings' }).click()
  await page.getByLabel('Shop name').fill('QA Shop')
  await page.getByLabel('Address').fill('')
  await page.getByRole('button', { name: 'Save settings' }).click()
  await expect(page.getByRole('status')).toContainText('Saved')
})

test('reprint from bill history prints the stored bill', async () => {
  await page.getByRole('button', { name: 'Bill history' }).click()
  const before = await prints()
  await page.getByRole('button', { name: 'Reprint' }).first().click()
  await expect.poll(prints).toBe(before + 1)
})

test('print layout: an unbroken 70-character item name never pushes its price off the receipt', async () => {
  await addProduct('A'.repeat(70), '19.99', '5', 'LONG-1')
  await page.getByRole('button', { name: 'New bill' }).click()
  const scan = page.getByLabel('Scan or search product')
  await scan.fill('LONG-1')
  await scan.press('Enter')
  // Capture the receipt markup at print time (the app itself is hidden under print media).
  await page.evaluate(() => {
    window.print = () => {
      ;(window as unknown as { __html: string }).__html =
        document.querySelector('.print-area')!.outerHTML
    }
  })
  await page.getByRole('button', { name: 'Save & print bill' }).click()
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __html?: string }).__html))
    .toBeTruthy()
  const html = await page.evaluate(() => (window as unknown as { __html: string }).__html)
  await page.emulateMedia({ media: 'print' })
  const fit = await page.evaluate((h) => {
    const host = document.createElement('div')
    host.innerHTML = h
    document.body.appendChild(host)
    const r = (sel: string): DOMRect => host.querySelector(sel)!.getBoundingClientRect()
    const out = {
      area: r('.print-area.receipt').right,
      price: r('.r-item-price').right,
      name: r('.r-item-name').right,
      textOverflow:
        host.querySelector('.r-item-name')!.scrollWidth -
        host.querySelector('.r-item-name')!.clientWidth
    }
    host.remove()
    return out
  }, html)
  await page.emulateMedia({ media: 'screen' })
  expect(fit.price).toBeLessThanOrEqual(fit.area + 0.5)
  expect(fit.name).toBeLessThanOrEqual(fit.area + 0.5)
  expect(fit.textOverflow).toBeLessThanOrEqual(0) // the name text itself must wrap inside its box
})

test('API abuse: invalid payloads sent straight to the bridge are rejected with a message', async () => {
  const r = await page.evaluate(async () => {
    const api = (window as unknown as W).api
    return {
      negQty: await api.bills.create({ items: [{ productId: 1, qty: -1 }] }),
      strId: await api.bills.create({ items: [{ productId: 'a', qty: 1 }] }),
      nullItems: await api.bills.create({ items: null }),
      badPay: await api.bills.create({ items: [{ productId: 1, qty: 1 }], paymentMethod: 'x' }),
      badSettings: await api.settings.save({ shopName: '' }),
      hugePrice: await api.products.create({ name: 'Z', priceMinor: 1e300 })
    }
  })
  for (const v of Object.values(r)) {
    expect(v.ok).toBe(false)
    expect(typeof v.error).toBe('string')
  }
})

test('D3: the app window cannot be navigated away to another page', async () => {
  const other = join(dataDir, 'other.html')
  writeFileSync(other, '<h1>elsewhere</h1>')
  const before = page.url()
  await page.evaluate((u) => {
    location.href = u
  }, pathToFileURL(other).href)
  await page.waitForTimeout(700)
  // Read the DOM directly: Playwright's locators would wait on the (cancelled) navigation.
  const state = await page.evaluate(() => ({
    href: location.href,
    app: !!document.querySelector('.sidebar')
  }))
  expect(state.href).toBe(before)
  expect(state.app).toBe(true)
})

test('data and settings persist after closing and reopening the app', async () => {
  await app.close()
  await launch()
  await expect(page.locator('.sidebar .brand strong')).toHaveText('QA Shop')
  await page.getByRole('button', { name: 'Bill history' }).click()
  await expect(page.getByRole('cell', { name: 'INV-000001', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Products & stock' }).click()
  await expect(page.getByRole('row', { name: /Notebook/ })).toContainText('12')
})
