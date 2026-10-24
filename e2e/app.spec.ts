import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page
} from '@playwright/test'
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// 1x1 transparent PNG
const LOGO_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='

let app: ElectronApplication
let page: Page
let dataDir: string

test.beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'ubs-e2e-'))
  app = await electron.launch({
    args: ['.'],
    env: { ...process.env, UBS_DATA_DIR: dataDir, UBS_EXPORT_DIR: dataDir }
  })
  page = await app.firstWindow()
  // Printing opens a native dialog; replace it with a counter.
  await page.evaluate(() => {
    ;(window as unknown as { __prints: number }).__prints = 0
    window.print = () => {
      ;(window as unknown as { __prints: number }).__prints++
    }
  })
})

test.afterAll(async () => {
  await app.close()
  rmSync(dataDir, { recursive: true, force: true })
})

test('white-label: shop name and logo appear in the header after saving settings', async () => {
  await page.getByRole('button', { name: 'Settings' }).click()
  await page.getByLabel('Shop name').fill('Ali Traders')
  await page.locator('input[type=file]').setInputFiles({
    name: 'logo.png',
    mimeType: 'image/png',
    buffer: Buffer.from(LOGO_B64, 'base64')
  })
  await page.getByLabel('Tax rate (%)').fill('10')
  await page.getByLabel('Receipt paper width').selectOption('58')
  await page.getByLabel('Label width (mm)').fill('50')
  await page.getByRole('button', { name: 'Save settings' }).click()
  await expect(page.getByRole('status')).toHaveText('Saved')
  await expect(page.locator('.sidebar .brand strong')).toHaveText('Ali Traders')
  await expect(page.locator('.sidebar .brand img')).toHaveCount(1)
})

test('add a product and see its generated barcode label', async () => {
  await page.getByRole('button', { name: 'Products & stock' }).click()
  await page.getByRole('button', { name: '+ Add product' }).click()
  const dialog = page.getByRole('dialog', { name: 'Product form' })
  await dialog.getByLabel('Name', { exact: true }).fill('Green Tea')
  await dialog.getByLabel('Selling price').fill('100')
  await dialog.getByLabel('Opening stock').fill('5')
  await dialog.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByRole('cell', { name: 'P-000001' })).toBeVisible()
  await page.getByRole('button', { name: 'Label', exact: true }).click()
  await expect(page.getByRole('img', { name: 'Barcode P-000001' })).toBeVisible()
  // Regression: an invalid viewBox (e.g. "0 0 246px 60px") crops the barcode and removes its quiet zone.
  await expect(page.getByRole('img', { name: 'Barcode P-000001' })).toHaveAttribute(
    'viewBox',
    /^0 0 \d+(\.\d+)? \d+(\.\d+)?$/
  )
  await page.getByRole('button', { name: 'Close' }).click()
})

test('scan a code, build a bill, checkout reduces stock and prints a receipt', async () => {
  await page.getByRole('button', { name: 'New bill' }).click()
  const scan = page.getByLabel('Scan or search product')
  // A scanner types the code then presses Enter; scan twice for qty 2.
  await scan.fill('P-000001')
  await scan.press('Enter')
  await expect(page.getByRole('cell', { name: 'Green Tea', exact: true })).toBeVisible()
  await scan.fill('P-000001')
  await scan.press('Enter')
  await expect(page.locator('.qty')).toHaveText('2')
  // 2 x 100 = 200, +10% tax = 220
  await expect(page.locator('.summary .total')).toContainText('220.00')
  // Cash received below the total is refused; enough cash shows the change.
  await page.getByLabel('Cash received (optional)').fill('100')
  await page.getByRole('button', { name: 'Save & print bill' }).click()
  await expect(page.getByRole('status')).toHaveText('Cash received is less than the total')
  await page.getByLabel('Cash received (optional)').fill('250')
  await expect(page.getByTestId('change-due')).toContainText('30.00')
  await page.getByRole('button', { name: 'Save & print bill' }).click()
  await expect(page.getByRole('status')).toHaveText('Saved INV-000001')
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __prints: number }).__prints))
    .toBe(1)

  await page.getByRole('button', { name: 'Products & stock' }).click()
  await expect(page.getByRole('row', { name: /Green Tea/ })).toContainText('3')
  await page.getByRole('button', { name: 'Bill history' }).click()
  await expect(page.getByRole('cell', { name: 'INV-000001' })).toBeVisible()
})

test('reports show the sale made above (today, this month) with its profit', async () => {
  await page.getByRole('button', { name: 'Reports' }).click()
  const sales = page.locator('.card .row', { hasText: 'Net sales' })
  await expect(sales).toContainText('200.00') // 2 x 100, tax excluded
  await expect(page.locator('.card .row.total')).toContainText('200.00') // cost price was 0
  await page.getByRole('button', { name: 'Daily sales' }).click()
  await expect(page.getByRole('row').nth(1)).toContainText('200.00')
  await page.getByRole('button', { name: 'Monthly sales' }).click()
  await expect(page.getByRole('row').nth(1)).toContainText('200.00')
  await page.getByRole('button', { name: 'By product' }).click()
  await expect(page.getByRole('row', { name: /Green Tea/ })).toContainText('200.00')
})

test('dashboard shows sale tile and charts for the sale made above', async () => {
  await page.getByRole('button', { name: 'Dashboard' }).click()
  await expect(page.locator('.kpi', { hasText: 'SALES' })).toContainText('200.00')
  await expect(page.locator('.kpi', { hasText: 'EXPENSE' })).toBeVisible()
  await expect(page.getByRole('img', { name: 'Cash flow chart' })).toBeVisible()
  await expect(page.getByRole('img', { name: 'Sales and profit chart' })).toBeVisible()
  await expect(page.locator('.hbar', { hasText: 'Green Tea' })).toContainText('200.00')
})

test('day book shows the sale, takes an expense, opening balance and notes', async () => {
  await page.getByRole('button', { name: 'Day book' }).click()
  await expect(page.getByRole('row', { name: /Green Tea/ })).toContainText('200.00')
  await page.getByLabel('Opening balance').fill('1000')
  await page.getByRole('button', { name: 'Set opening balance' }).click()
  await page.getByLabel('Expense description').fill('Tea and lunch')
  await page.getByLabel('Expense amount').fill('50')
  await page.getByRole('button', { name: 'Add expense' }).click()
  await expect(page.getByRole('row', { name: /Tea and lunch/ })).toContainText('50.00')
  // 1000 opening + 220 cash received (200 sale + 10% tax) - 50 expense
  await expect(page.locator('.card .row.total')).toContainText('1,170.00')
  await page.getByLabel('Notes').fill('500 in drawer')
  await page.getByRole('button', { name: 'Save notes' }).click()
  await expect(page.getByText('Saved', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Previous day' }).click()
  await expect(page.getByText('No sales on this day.')).toBeVisible()
  await page.getByRole('button', { name: 'Today', exact: true }).click()
  await expect(page.getByLabel('Notes')).toHaveValue('500 in drawer')
})

test('scanning keeps working after removing an item from the bill', async () => {
  await page.getByRole('button', { name: 'New bill' }).click()
  const scan = page.getByLabel('Scan or search product')
  await scan.fill('P-000001')
  await scan.press('Enter')
  await expect(page.locator('.qty')).toHaveText('1')
  await page.getByRole('button', { name: 'Remove Green Tea' }).click()
  await expect(page.locator('.qty')).toHaveCount(0)
  await page.keyboard.type('P-000001')
  await page.keyboard.press('Enter')
  await expect(page.locator('.qty')).toHaveText('1')
})

test('scanning an unknown code then a real one adds the real one', async () => {
  await page.getByRole('button', { name: 'New bill' }).click()
  const scan = page.getByLabel('Scan or search product')
  await scan.fill('NOPE-123')
  await scan.press('Enter')
  await expect(page.getByRole('status')).toContainText('No product found')
  await page.keyboard.type('P-000001')
  await page.keyboard.press('Enter')
  await expect(page.locator('.qty')).toHaveText('1')
  await expect(scan).toHaveValue('')
})

test('export the day book and the daily report as CSV files', async () => {
  await page.getByRole('button', { name: 'Day book' }).click()
  await page.getByRole('button', { name: 'Export CSV' }).click()
  await expect(page.getByRole('status')).toContainText('Exported to')
  const day = readFileSync(
    join(dataDir, `daybook-${new Date().toLocaleDateString('sv')}.csv`),
    'utf8'
  )
  expect(day).toContain('Green Tea')
  expect(day).toContain('Remaining balance')
  await page.getByRole('button', { name: 'Reports' }).click()
  await page.getByRole('button', { name: 'Daily sales' }).click()
  await page.getByRole('button', { name: 'Export CSV' }).click()
  await expect(page.getByRole('status')).toContainText('Exported to')
  const files = readdirSync(dataDir).filter((f) => f.startsWith('daily-'))
  expect(files).toHaveLength(1)
  expect(readFileSync(join(dataDir, files[0]), 'utf8')).toContain('Sales')
})

test('cannot sell more than the stock on hand', async () => {
  await page.getByRole('button', { name: 'New bill' }).click()
  const scan = page.getByLabel('Scan or search product')
  for (let i = 0; i < 4; i++) {
    await scan.fill('P-000001')
    await scan.press('Enter')
  }
  await expect(page.locator('.qty')).toHaveText('3')
  await expect(page.getByRole('status')).toContainText('Only 3 of Green Tea in stock')
})

test('purchase: 200 covers from ABC Traders for 10000 adds stock and sets cost', async () => {
  // Create the product with no opening stock.
  await page.getByRole('button', { name: 'Products & stock' }).click()
  await page.getByRole('button', { name: '+ Add product' }).click()
  const dialog = page.getByRole('dialog', { name: 'Product form' })
  await dialog.getByLabel('Name', { exact: true }).fill('Phone cover')
  await dialog.getByLabel('Selling price').fill('120')
  await dialog.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByRole('cell', { name: 'Phone cover', exact: true })).toBeVisible()

  await page.getByRole('button', { name: 'Purchases' }).click()
  await page.getByRole('button', { name: '+ New purchase' }).click()
  await page.getByLabel('Supplier').fill('ABC Traders')
  await page.getByLabel('Find product to add').fill('cover')
  await page.getByRole('button', { name: /Phone cover/ }).click()
  await page.getByLabel('Quantity of Phone cover').fill('200')
  await page.getByLabel('Total cost of Phone cover').fill('10000')
  await expect(page.getByRole('cell', { name: 'Rs 50.00' })).toBeVisible() // cost each
  await page.getByRole('button', { name: 'Save purchase & add to stock' }).click()
  await expect(page.getByRole('status')).toContainText('Saved PUR-000001')
  await expect(page.getByRole('cell', { name: 'ABC Traders' })).toBeVisible()

  await page.getByRole('button', { name: 'Products & stock' }).click()
  await expect(page.getByRole('row', { name: /Phone cover/ })).toContainText('200')
})

test('quick note records a vendor, what and cost without changing stock', async () => {
  await page.getByRole('button', { name: 'Purchases' }).click()
  await page.getByRole('button', { name: '+ Quick note (no stock)' }).click()
  await page.getByLabel('Supplier').fill('XYZ Wholesale')
  await page.getByLabel('What did you buy?').fill('50 chargers')
  await page.getByLabel('Total cost').fill('4000')
  await page.getByRole('button', { name: 'Save note' }).click()
  await expect(page.getByRole('status')).toContainText('stock not changed')
  const row = page.getByRole('row', { name: /XYZ Wholesale/ })
  await expect(row).toContainText('50 chargers')
  await expect(row).toContainText('4,000.00')
})

test('purchase needs a supplier name', async () => {
  await page.getByRole('button', { name: 'Purchases' }).click()
  await page.getByRole('button', { name: '+ New purchase' }).click()
  await page.getByLabel('Find product to add').fill('cover')
  await page.getByRole('button', { name: /Phone cover/ }).click()
  await page.getByLabel('Quantity of Phone cover').fill('1')
  await page.getByLabel('Total cost of Phone cover').fill('50')
  await page.getByRole('button', { name: 'Save purchase & add to stock' }).click()
  await expect(page.getByRole('status')).toHaveText('Enter the supplier name')
})

test('label code can be switched to QR in settings', async () => {
  await page.getByRole('button', { name: 'Settings' }).click()
  await page.getByLabel('Code on product labels').selectOption('qr')
  await page.getByRole('button', { name: 'Save settings' }).click()
  await expect(page.getByRole('status')).toHaveText('Saved')
  await page.getByRole('button', { name: 'Products & stock' }).click()
  await page.getByRole('button', { name: 'Label', exact: true }).first().click()
  await expect(page.getByRole('img', { name: /^QR code P-/ })).toBeVisible()
})

test('label designer: edit a 38 x 25 mm label, save it, and print with that design', async () => {
  // The previous test leaves a product label preview open.
  await page
    .getByRole('dialog', { name: 'Product label' })
    .getByRole('button', { name: 'Close' })
    .click()
  await page.getByRole('button', { name: 'Label designer' }).click()
  await expect(page.getByLabel('Label width (mm)')).toHaveValue('38')
  await expect(page.getByLabel('Label height (mm)')).toHaveValue('25')
  await page.getByLabel('Design name').fill('Small sticker')

  // Remove the shop name and add free text.
  await page.getByRole('button', { name: 'Label item: shopName' }).click()
  await page.getByRole('button', { name: 'Remove this item' }).click()
  await expect(page.locator('.stage [data-kind="shopName"]')).toHaveCount(0)
  await page.getByRole('button', { name: '+ Free text' }).click()
  await page.getByLabel('Text', { exact: true }).fill('WARRANTY 1 YR')
  await expect(page.locator('.stage [data-kind="text"]')).toHaveText('WARRANTY 1 YR')

  // Dragging the price 16 px left (2 mm) snaps it half a millimetre at a time.
  const price = page.getByRole('button', { name: 'Label item: price' })
  const box = (await price.boundingBox())!
  const cx = box.x + box.width / 2
  const cy = box.y + box.height / 2
  await page.mouse.move(cx, cy)
  await page.mouse.down()
  await page.mouse.move(cx - 16, cy, { steps: 4 })
  await page.mouse.up()
  await expect(page.getByLabel('X (mm)')).toHaveValue('15')
  // Arrow keys nudge the selected item, and typed values are kept inside the label.
  await price.press('ArrowRight')
  await expect(page.getByLabel('X (mm)')).toHaveValue('15.5')
  await page.getByLabel('X (mm)').fill('500')
  await expect(page.getByLabel('X (mm)')).toHaveValue('18.4') // 38 - the item's 19.6 mm width

  await page.getByRole('button', { name: 'Save design' }).click()
  await expect(page.getByRole('status')).toHaveText('Saved "Small sticker"')
  await expect(page.getByRole('button', { name: /Small sticker/ })).toContainText('(default)')

  // The saved design is offered, and pre-selected, when printing labels.
  await page.evaluate(() => {
    const w = window as unknown as { __lab?: unknown }
    window.print = () => {
      const area = document.querySelector('.print-area')
      w.__lab = {
        labels: document.querySelectorAll('.print-area .label').length,
        text: area?.textContent ?? '',
        shopNames: document.querySelectorAll('.print-area [data-kind="shopName"]').length,
        pageRule: area?.querySelector('style')?.textContent ?? ''
      }
    }
  })
  await page.getByRole('button', { name: 'Products & stock' }).click()
  // The per-product "Label" preview shows the saved default design, not the old fixed layout.
  await page.getByRole('button', { name: 'Label', exact: true }).first().click()
  const pv = page.getByRole('dialog', { name: 'Product label' })
  await expect(pv.getByLabel('Label design')).toHaveValue(/[1-9]/)
  await expect(pv.locator('[data-kind="text"]')).toHaveText('WARRANTY 1 YR')
  await expect(pv.locator('[data-kind="shopName"]')).toHaveCount(0)
  await pv.getByRole('button', { name: 'Close' }).click()
  await page.getByRole('checkbox').first().check()
  await page.getByRole('button', { name: 'Print labels (1)' }).click()
  const d = page.getByRole('dialog', { name: 'Quantity' })
  await expect(d.getByLabel('Label design')).toHaveValue(/[1-9]/)
  await d.getByRole('textbox').fill('2')
  await d.getByRole('button', { name: 'Print', exact: true }).click()
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __lab?: unknown }).__lab))
    .toMatchObject({ labels: 2, shopNames: 0, pageRule: expect.stringContaining('38mm 25mm') })
  const lab = (await page.evaluate(() => (window as unknown as { __lab: { text: string } }).__lab))!
  expect(lab.text).toContain('WARRANTY 1 YR')
})

test('parties: a purchase creates the supplier and the new product, the part not paid stays owed', async () => {
  await page.getByRole('button', { name: 'Purchases' }).click()
  await page.getByRole('button', { name: '+ New purchase' }).click()
  await page.getByLabel('Supplier').fill('Gadget Hub')
  await page.getByLabel('Find product to add').fill('Screen guard')
  await page.getByRole('button', { name: /Add “Screen guard” as a new product/ }).click()
  await page.getByLabel('Selling price of Screen guard').fill('250')
  await page.getByLabel('Quantity of Screen guard').fill('10')
  await page.getByLabel('Total cost of Screen guard').fill('5000')
  await page.getByLabel('Paid now').fill('2000')
  await page.getByRole('button', { name: 'Save purchase & add to stock' }).click()
  await expect(page.getByRole('status')).toContainText('3,000.00 still due')

  await page.getByRole('button', { name: 'Products & stock' }).click()
  const prod = page.getByRole('row', { name: /Screen guard/ })
  await expect(prod).toContainText('250.00')
  await expect(prod).toContainText('10')

  await page.getByRole('button', { name: 'Parties', exact: true }).click()
  const row = page.getByRole('row', { name: /Gadget Hub/ })
  await expect(row).toContainText('You owe Rs 3,000.00')

  await row.getByRole('button', { name: 'Pay' }).click()
  const dlg = page.getByRole('dialog', { name: 'Pay party' })
  await dlg.getByLabel('Amount paid').fill('1000')
  await dlg.getByRole('button', { name: 'Record payment' }).click()
  await expect(page.getByRole('status')).toContainText('1,000.00 paid to Gadget Hub')
  await expect(row).toContainText('You owe Rs 2,000.00')

  await row.getByRole('button', { name: 'Ledger' }).click()
  const led = page.getByRole('region', { name: 'Party ledger' })
  await expect(led).toContainText('10 Screen guard')
  await expect(led.getByRole('row', { name: /Payment/ })).toContainText('2,000.00')
})

test('parties: add a party with an opening balance', async () => {
  await page.getByRole('button', { name: 'Parties', exact: true }).click()
  await page.getByRole('button', { name: '+ Add party' }).click()
  const f = page.getByRole('dialog', { name: 'Party form' })
  await f.getByLabel('Name', { exact: true }).fill('Old Supplier')
  await f.getByLabel('Balance from before using this app (optional)').fill('7500')
  await f.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByRole('row', { name: /Old Supplier/ })).toContainText('You owe Rs 7,500.00')
})

test('phones: details build the name, IMEIs are bought, sold on a bill, and can be looked up', async () => {
  const IMEI1 = '356938035643809'
  const IMEI2 = '356938035643817'
  const IMEI1B = '356938035643900' // second SIM of phone 1: same phone, not a second phone
  await page.getByRole('button', { name: 'Products & stock' }).click()
  await page.getByRole('button', { name: '+ Add product' }).click()
  const f = page.getByRole('dialog', { name: 'Product form' })
  await f.getByLabel('Category').fill('Phone')
  await f.getByLabel('Brand').fill('Samsung')
  await f.getByLabel('Model').fill('A15')
  await f.getByLabel('RAM (GB)').fill('6')
  await f.getByLabel('Storage (GB)').fill('128')
  await f.getByLabel('Color').fill('Black')
  await f.getByLabel('Selling price').fill('45000')
  await f.getByLabel(/Track IMEI/).check()
  await f.getByRole('button', { name: 'Save' }).click()
  // A new tracked phone opens the IMEI window straight away; this phone's IMEIs come from a purchase instead.
  await page
    .getByRole('dialog', { name: 'IMEI lookup' })
    .getByRole('button', { name: 'Close' })
    .click()
  const row = page.getByRole('row', { name: /Samsung A15 6\/128 Black/ })
  await expect(row).toBeVisible()
  await expect(row).toContainText('Phone')

  // Search matches words anywhere in the details.
  await page.getByLabel('Search products').fill('a15 128')
  await expect(row).toBeVisible()
  await page.getByLabel('Search products').fill('')

  await page.getByRole('button', { name: 'Purchases' }).click()
  await page.getByRole('button', { name: '+ New purchase' }).click()
  await page.getByLabel('Supplier').fill('Mobile Wholesale')
  await page.getByLabel('Find product to add').fill('A15')
  await page.getByRole('button', { name: /Samsung A15 6\/128 Black/ }).click()
  const imeiBox = page.getByLabel('IMEI of Samsung A15 6/128 Black')
  await page.getByLabel(/Dual SIM/).check()
  const imei2Box = page.getByLabel('IMEI 2 of Samsung A15 6/128 Black')
  await imeiBox.fill(IMEI1)
  await imeiBox.press('Enter')
  await imei2Box.fill(IMEI1B)
  await imei2Box.press('Enter')
  await imeiBox.fill(IMEI2) // a single-SIM phone: leave the second IMEI empty
  await imeiBox.press('Enter')
  await imei2Box.press('Enter')
  await expect(page.getByLabel('Quantity of Samsung A15 6/128 Black')).toHaveText('2')
  await page.getByLabel('Total cost of Samsung A15 6/128 Black').fill('80000')
  await page.getByRole('button', { name: 'Save purchase & add to stock' }).click()
  await expect(page.getByRole('status')).toContainText('stock updated')

  await page.getByRole('button', { name: 'Products & stock' }).click()
  await expect(page.getByRole('row', { name: /Samsung A15 6\/128 Black/ })).toContainText('2')

  // Scanning the IMEI at the till puts exactly that phone on the bill.
  await page.getByRole('button', { name: 'New bill' }).click()
  const scan = page.getByLabel('Scan or search product')
  await scan.fill(IMEI1B)
  await scan.press('Enter')
  await expect(page.getByRole('row', { name: /Samsung A15/ })).toContainText(IMEI1)
  await page.getByRole('button', { name: 'Save & print bill' }).click()
  await expect(page.getByRole('status')).toContainText('Saved INV-')

  // The same phone cannot be sold twice.
  await scan.fill(IMEI1)
  await scan.press('Enter')
  await expect(page.getByRole('status')).toContainText('already sold on INV-')

  // The other phone: scanning the product asks nothing when only one unit is left.
  await scan.fill('A15')
  await scan.press('Enter')
  await expect(page.getByRole('row', { name: /Samsung A15/ })).toContainText(IMEI2)

  await page.getByRole('button', { name: 'Products & stock' }).click()
  await page.getByRole('button', { name: 'IMEI lookup' }).click()
  const dlg = page.getByRole('dialog', { name: 'IMEI lookup' })
  await dlg.getByLabel('Search IMEI').fill('643900')
  const hit = dlg.getByRole('row', { name: new RegExp(IMEI1B) })
  await expect(hit).toContainText('Sold')
  await expect(hit).toContainText('Mobile Wholesale')
  await expect(hit).toContainText('INV-')
})

test('phones: a new tracked phone opens the IMEI window so its phones can be added and deleted', async () => {
  // The previous test leaves its IMEI lookup window open.
  const leftover = page.getByRole('dialog', { name: 'IMEI lookup' })
  if (await leftover.isVisible()) await leftover.getByRole('button', { name: 'Close' }).click()
  await page.getByRole('button', { name: 'Products & stock' }).click()
  await page.getByRole('button', { name: '+ Add product' }).click()
  const f = page.getByRole('dialog', { name: 'Product form' })
  await f.getByLabel('Brand').fill('Tecno')
  await f.getByLabel('Model').fill('Spark 20')
  await f.getByLabel('Selling price').fill('30000')
  await f.getByLabel(/Track IMEI/).check()
  await f.getByRole('button', { name: 'Save' }).click()

  const dlg = page.getByRole('dialog', { name: 'IMEI lookup' })
  await expect(dlg.getByRole('group', { name: 'Add phones' })).toBeVisible()
  await dlg.getByLabel('IMEI to add', { exact: true }).fill('860000000000011')
  await dlg.getByLabel('IMEI to add', { exact: true }).press('Enter')
  await expect(dlg.getByRole('status')).toContainText('In stock now: 1')
  await dlg.getByLabel(/Dual SIM/).check()
  await dlg.getByLabel('IMEI to add', { exact: true }).fill('860000000000029')
  await dlg.getByLabel('IMEI to add', { exact: true }).press('Enter')
  await dlg.getByLabel('Second IMEI to add').fill('860000000000037')
  await dlg.getByLabel('Second IMEI to add').press('Enter')
  await expect(dlg.getByRole('status')).toContainText('In stock now: 2')
  await expect(dlg.getByRole('row', { name: /860000000000029/ })).toContainText('860000000000037')

  // A phone entered by mistake can be deleted while it is in stock.
  page.once('dialog', (d) => void d.accept())
  await dlg.getByRole('button', { name: 'Delete IMEI 860000000000011' }).click()
  await expect(dlg.getByRole('status')).toContainText('Deleted')
  await dlg.getByRole('button', { name: 'Close' }).click()
  await expect(page.getByRole('row', { name: /Tecno Spark 20/ })).toContainText('1')
})

test('dashboard ends with the money still owed to parties; unpaid balances are not spending', async () => {
  await page.getByRole('button', { name: 'Dashboard' }).click()
  const owed = page.getByRole('region', { name: 'Money owed to parties' })
  await expect(owed).toBeVisible()
  await expect(owed.getByRole('row', { name: /Gadget Hub/ })).toContainText('2,000.00')
  await expect(owed.getByRole('row', { name: /Old Supplier/ })).toContainText('7,500.00')
  await expect(owed).toContainText('9,500.00')
})
