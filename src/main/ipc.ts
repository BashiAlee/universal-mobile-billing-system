import { app, ipcMain } from 'electron'
import { appendFileSync } from 'node:fs'
import { join } from 'node:path'
import { saveCsv } from './services/exportFile'
import type { Db } from './db/database'
import type { AuthStatus, Result } from '../shared/types'
import { IDLE_MS, Session } from './session'
import * as auth from './services/auth'
import { licenseConfig } from './license/config'
import { activateLicense, blockMessage, checkLicense, licenseState } from './services/license'
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

// Nobody can read or change data until they sign in. This is enforced here in the main process,
// so a signed-out (or timed-out) screen cannot get anything even if its code were tampered with.
// UBS_IDLE_MS only exists so the automated tests do not have to wait ten minutes.
const session = new Session(Number(process.env['UBS_IDLE_MS']) || IDLE_MS)

function requireUser(): { id: number; username: string } {
  const u = session.current()
  if (!u) throw new Error('Please log in')
  session.touch()
  return u
}

// Set in registerIpc: refuses changes while the subscription is switched off (viewing and exporting stay possible).
let licenseGuard: (channel: string) => void = () => {}

/** Wraps a handler so errors become {ok:false,error} instead of rejected IPC promises. Needs a signed-in user unless `open`. */
function handle<A extends unknown[], T>(
  channel: string,
  fn: (...args: A) => T | Promise<T>,
  open = false
): void {
  ipcMain.handle(channel, async (_e, ...args): Promise<Result<T>> => {
    try {
      if (!open) {
        requireUser()
        licenseGuard(channel)
      }
      return { ok: true, data: await fn(...(args as A)) }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Unexpected error' }
    }
  })
}

// These only read data, so they keep working when the subscription is inactive.
const READ_ONLY_OK = new Set([
  'settings:get',
  'products:list',
  'products:byCode',
  'products:lowStock',
  'labels:list',
  'bills:list',
  'bills:get',
  'reports:get',
  'dashboard:get',
  'daybook:get',
  'purchases:list',
  'purchases:suppliers',
  'serials:list',
  'serials:get',
  'parties:list',
  'parties:ledger',
  'users:list'
])

export function registerIpc(db: Db): void {
  const licCfg = licenseConfig()
  licenseGuard = (channel) => {
    if (!licCfg.enforced || channel.startsWith('license:') || READ_ONLY_OK.has(channel)) return
    const st = licenseState(db, licCfg, Date.now())
    if (st.state !== 'active') throw new Error(blockMessage(st))
  }
  handle('license:status', () => licenseState(db, licCfg, Date.now()))
  handle('license:activate', (key: string) => activateLicense(db, licCfg, String(key), Date.now()))
  handle('license:check', () => checkLicense(db, licCfg, Date.now()))
  if (licCfg.enforced) {
    // Ask the server shortly after start-up and then every 10 minutes; no internet just means the saved answer is used.
    const ask = (): void => void checkLicense(db, licCfg, Date.now()).catch(() => {})
    setTimeout(ask, 3000)
    setInterval(ask, 10 * 60 * 1000).unref()
  }

  const status = (): AuthStatus => {
    const u = session.current()
    const s = settings.getSettings(db)
    return {
      hasUsers: auth.countUsers(db) > 0,
      loggedIn: !!u,
      username: u?.username ?? '',
      idleMs: session.idleMs,
      shopName: s.shopName,
      logoDataUrl: s.logoDataUrl
    }
  }
  handle('auth:status', status, true)
  handle(
    'auth:setup',
    (username: string, password: string) => {
      const r = auth.createFirstUser(db, username, password)
      session.login(r.user)
      return { username: r.user.username, recoveryCode: r.recoveryCode }
    },
    true
  )
  handle(
    'auth:login',
    (username: string, password: string) => {
      const wait = session.lockedFor(String(username))
      if (wait) throw new Error(`Too many wrong attempts. Try again in ${wait} seconds.`)
      const u = auth.authenticate(db, username, password)
      if (!u) {
        session.recordFailure(String(username))
        throw new Error('Wrong username or password')
      }
      session.recordSuccess(String(username))
      session.login(u)
      return status()
    },
    true
  )
  handle('auth:logout', () => session.logout(), true)
  handle('auth:ping', () => (session.touch(), !!session.current()), true)
  handle(
    'auth:recover',
    (username: string, code: string, newPassword: string) => {
      const wait = session.lockedFor('recovery')
      if (wait) throw new Error(`Too many wrong attempts. Try again in ${wait} seconds.`)
      try {
        const r = auth.recoverAccess(db, username, code, newPassword)
        session.recordSuccess('recovery')
        return r
      } catch (e) {
        session.recordFailure('recovery')
        throw e
      }
    },
    true
  )
  handle('users:list', () => auth.listUsers(db))
  handle('users:add', (username: string, password: string) =>
    auth.createUser(db, username, password)
  )
  handle('users:setPassword', (id: number, password: string) => auth.setPassword(db, id, password))
  handle('users:delete', (id: number) => auth.deleteUser(db, id, requireUser().id))

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
    bills.createBill(db, input, session.current()?.username ?? '')
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
      requireUser()
      return { ok: true, data: await printing.listPrinters(e.sender) }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Could not list printers' }
    }
  })
  ipcMain.handle('print:run', async (e, opts: printing.PrintOptions): Promise<Result<void>> => {
    try {
      requireUser()
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Please log in' }
    }
    // Every attempt is noted in print.log next to the database, so a printing problem can be diagnosed later.
    const note = (result: string): void => {
      try {
        appendFileSync(
          join(process.env['UBS_DATA_DIR'] ?? app.getPath('userData'), 'print.log'),
          `${new Date().toISOString()} printer=${JSON.stringify(opts?.deviceName)} size=${opts?.widthMm ?? '-'}x${opts?.heightMm ?? '-'}mm rotate=${opts?.landscape === true} ${result}\n`
        )
      } catch {
        /* the log is a convenience; never let it break printing */
      }
    }
    try {
      await printing.printSilently(e.sender, opts)
      note('OK (job accepted)')
      return { ok: true, data: undefined }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Printing failed'
      note(`FAILED: ${msg}`)
      return { ok: false, error: msg }
    }
  })

  ipcMain.handle('file:saveCsv', (_e, name: string, content: string) => {
    try {
      requireUser()
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Please log in' }
    }
    return saveCsv(name, content)
  })

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
