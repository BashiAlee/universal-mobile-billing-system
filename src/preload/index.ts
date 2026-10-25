import { contextBridge, ipcRenderer } from 'electron'
import type { Result } from '../shared/types'

const call = <T>(channel: string, ...args: unknown[]): Promise<Result<T>> =>
  ipcRenderer.invoke(channel, ...args)

// Narrow, explicit API surface. The renderer never gets raw ipcRenderer access.
const api = {
  settings: {
    get: () => call('settings:get'),
    save: (s: unknown) => call('settings:save', s)
  },
  products: {
    list: (search?: string, includeInactive?: boolean) =>
      call('products:list', search, includeInactive),
    byCode: (code: string) => call('products:byCode', code),
    create: (input: unknown) => call('products:create', input),
    update: (id: number, input: unknown) => call('products:update', id, input),
    deactivate: (id: number) => call('products:deactivate', id),
    adjustStock: (id: number, delta: number, reason: string, ref?: string) =>
      call('products:adjustStock', id, delta, reason, ref),
    lowStock: () => call('products:lowStock')
  },
  labels: {
    list: () => call('labels:list'),
    save: (input: unknown) => call('labels:save', input),
    delete: (id: number) => call('labels:delete', id),
    setDefault: (id: number) => call('labels:setDefault', id)
  },
  reports: {
    get: (range: unknown) => call('reports:get', range)
  },
  print: {
    printers: () => call('print:printers'),
    run: (opts: unknown) => call('print:run', opts)
  },
  files: {
    saveCsv: (name: string, content: string) => call('file:saveCsv', name, content)
  },
  dashboard: {
    get: (range: unknown) => call('dashboard:get', range)
  },
  daybook: {
    get: (day: string) => call('daybook:get', day),
    save: (input: unknown) => call('daybook:save', input),
    addExpense: (input: unknown) => call('daybook:addExpense', input),
    deleteExpense: (id: number) => call('daybook:deleteExpense', id)
  },
  purchases: {
    create: (input: unknown) => call('purchases:create', input),
    note: (input: unknown) => call('purchases:note', input),
    list: (search?: string) => call('purchases:list', search),
    suppliers: () => call('purchases:suppliers')
  },
  serials: {
    list: (filter?: unknown) => call('serials:list', filter),
    get: (serial: string) => call('serials:get', serial),
    add: (input: unknown) => call('serials:add', input),
    remove: (id: number) => call('serials:remove', id)
  },
  parties: {
    list: (search?: string) => call('parties:list', search),
    save: (input: unknown) => call('parties:save', input),
    delete: (id: number) => call('parties:delete', id),
    ledger: (id: number) => call('parties:ledger', id),
    pay: (input: unknown) => call('parties:pay', input),
    deletePayment: (id: number) => call('parties:deletePayment', id)
  },
  bills: {
    create: (input: unknown) => call('bills:create', input),
    list: (search?: string) => call('bills:list', search),
    get: (id: number) => call('bills:get', id),
    delete: (id: number) => call('bills:delete', id)
  }
}

export type Api = typeof api

contextBridge.exposeInMainWorld('api', api)
