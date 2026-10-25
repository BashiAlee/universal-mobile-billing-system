import { ipcMain } from 'electron'
import { saveCsv } from './services/exportFile'
import type { Db } from './db/database'
import type { Result } from '../shared/types'
import * as products from './services/products'
import * as bills from './services/bills'
import * as purchases from './services/purchases'
import * as parties from './services/parties'
import * as serials from './services/serials'
import * as daybook from './services/daybook'
import * as dashboard from './services/dashboard'
import * as reports from './services/reports'
import * as settings from './services/settings'
import * as labels from './services/labels'
import * as printing from './services/printing'

/** Wraps a handler so errors become {ok:false,error} instead of rejected IPC promises. */
function handle<A extends unknown[], T>(channel: string, fn: (...args: A) => T): void {
  ipcMain.handle(channel, (_e, ...args): Result<T> => {
    try {
      return { ok: true, data: fn(...(args as A)) }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Unexpected error' }
    }
  })
}

export function registerIpc(db: Db): void {
  handle('settings:get', () => settings.getSettings(db))
  handle('settings:save', (s: Parameters<typeof settings.saveSettings>[1]) =>
    settings.saveSettings(db, s)
  )

  handle('products:list', (search?: string, includeInactive?: boolean) =>
    products.listProducts(db, search, includeInactive)
  )
  handle('products:byCode', (code: string) => products.getProductByCode(db, code))
  handle('products:create', (input: Parameters<typeof products.createProduct>[1]) =>
    products.createProduct(db, input)
  )
  handle('products:update', (id: number, input: Parameters<typeof products.updateProduct>[2]) =>
    products.updateProduct(db, id, input)
  )
  handle('products:deactivate', (id: number) => products.deactivateProduct(db, id))
  handle(
    'products:adjustStock',
    (id: number, delta: number, reason: Parameters<typeof products.adjustStock>[3], ref?: string) =>
      products.adjustStock(db, id, delta, reason, ref)
  )
  handle('products:lowStock', () => products.lowStockProducts(db))

  handle('labels:list', () => labels.listDesigns(db))
  handle('labels:save', (input: Parameters<typeof labels.saveDesign>[1]) =>
    labels.saveDesign(db, input)
  )
  handle('labels:delete', (id: number) => labels.deleteDesign(db, id))
  handle('labels:setDefault', (id: number) => labels.setDefaultDesign(db, id))

  handle('bills:create', (input: Parameters<typeof bills.createBill>[1]) =>
    bills.createBill(db, input)
  )
  handle('bills:list', (search?: string) => bills.listBills(db, search))
  handle('bills:delete', (id: number) => bills.deleteBill(db, id))
  handle('bills:get', (id: number) => bills.getBill(db, id))

  handle('reports:get', (range: Parameters<typeof reports.getReport>[1]) =>
    reports.getReport(db, range)
  )

  // Printing needs the window that asked, so these two use the IPC event directly.
  ipcMain.handle('print:printers', async (e): Promise<Result<printing.PrinterOption[]>> => {
    try {
      return { ok: true, data: await printing.listPrinters(e.sender) }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Could not list printers' }
    }
  })
  ipcMain.handle('print:run', async (e, opts: printing.PrintOptions): Promise<Result<void>> => {
    try {
      await printing.printSilently(e.sender, opts)
      return { ok: true, data: undefined }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Printing failed' }
    }
  })

  ipcMain.handle('file:saveCsv', (_e, name: string, content: string) => saveCsv(name, content))

  handle('dashboard:get', (range: Parameters<typeof dashboard.getDashboard>[1]) =>
    dashboard.getDashboard(db, range)
  )
  handle('daybook:get', (day: string) => daybook.getDayBook(db, day))
  handle('daybook:save', (input: Parameters<typeof daybook.saveDayBook>[1]) =>
    daybook.saveDayBook(db, input)
  )
  handle('daybook:addExpense', (input: Parameters<typeof daybook.addExpense>[1]) =>
    daybook.addExpense(db, input)
  )
  handle('daybook:deleteExpense', (id: number) => daybook.deleteExpense(db, id))

  handle('purchases:create', (input: Parameters<typeof purchases.createPurchase>[1]) =>
    purchases.createPurchase(db, input)
  )
  handle('purchases:note', (input: Parameters<typeof purchases.createSupplierNote>[1]) =>
    purchases.createSupplierNote(db, input)
  )
  handle('purchases:list', (search?: string) => purchases.listPurchases(db, search))
  handle('purchases:suppliers', () => purchases.listSuppliers(db))

  handle('serials:list', (filter?: Parameters<typeof serials.listUnits>[1]) =>
    serials.listUnits(db, filter)
  )
  handle('serials:add', (input: Parameters<typeof serials.addUnits>[1]) =>
    serials.addUnits(db, input)
  )
  handle('serials:remove', (id: number) => serials.removeUnit(db, id))
  handle('serials:get', (serial: string) => serials.getUnit(db, serial))

  handle('parties:list', (search?: string) => parties.listParties(db, search))
  handle('parties:save', (input: Parameters<typeof parties.saveParty>[1]) =>
    parties.saveParty(db, input)
  )
  handle('parties:delete', (id: number) => parties.deleteParty(db, id))
  handle('parties:ledger', (id: number) => parties.getLedger(db, id))
  handle('parties:pay', (input: Parameters<typeof parties.recordPayment>[1]) =>
    parties.recordPayment(db, input)
  )
  handle('parties:deletePayment', (id: number) => parties.deletePayment(db, id))
}
