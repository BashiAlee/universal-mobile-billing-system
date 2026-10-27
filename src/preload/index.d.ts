import type {
  AppUser,
  AuthStatus,
  BackupInfo,
  ReturnInput,
  ReturnQuote,
  ReturnRecord,
  BackupSummary,
  LicenseStatus,
  Result,
  Product,
  Bill,
  ShopSettings,
  ProductInput,
  BillInput,
  StockReason,
  Purchase,
  PurchaseInput,
  SupplierNoteInput,
  SerialAddInput,
  SerialFilter,
  SerialUnit,
  Party,
  PartyInput,
  PartyLedger,
  PartyPaymentInput,
  Report,
  ReportRange,
  Dashboard,
  DayBook,
  DayBookSave,
  Expense,
  ExpenseInput,
  LabelDesign,
  LabelDesignInput
} from '../shared/types'

interface TypedApi {
  auth: {
    status: () => Promise<Result<AuthStatus>>
    setup: (
      username: string,
      password: string
    ) => Promise<Result<{ username: string; recoveryCode: string }>>
    login: (username: string, password: string) => Promise<Result<AuthStatus>>
    logout: () => Promise<Result<void>>
    ping: () => Promise<Result<boolean>>
    recover: (
      username: string,
      code: string,
      newPassword: string
    ) => Promise<Result<{ recoveryCode: string }>>
  }
  returns: {
    quote: (input: ReturnInput) => Promise<Result<ReturnQuote>>
    create: (input: ReturnInput) => Promise<Result<ReturnRecord>>
    list: (search?: string) => Promise<Result<ReturnRecord[]>>
  }
  backup: {
    info: () => Promise<Result<BackupInfo>>
    chooseFolder: () => Promise<Result<BackupInfo>>
    now: () => Promise<Result<{ info: BackupInfo; path: string }>>
    pickRestore: () => Promise<Result<BackupSummary | null>>
    restoreNow: () => Promise<Result<void>>
  }
  license: {
    status: () => Promise<Result<LicenseStatus>>
    activate: (key: string) => Promise<Result<LicenseStatus>>
    check: () => Promise<Result<LicenseStatus>>
  }
  users: {
    list: () => Promise<Result<AppUser[]>>
    add: (username: string, password: string) => Promise<Result<AppUser>>
    setPassword: (id: number, password: string) => Promise<Result<void>>
    delete: (id: number) => Promise<Result<void>>
  }
  settings: {
    get: () => Promise<Result<ShopSettings>>
    save: (s: ShopSettings) => Promise<Result<ShopSettings>>
  }
  products: {
    list: (search?: string, includeInactive?: boolean) => Promise<Result<Product[]>>
    byCode: (code: string) => Promise<Result<Product | null>>
    create: (input: ProductInput) => Promise<Result<Product>>
    update: (id: number, input: Omit<ProductInput, 'stockQty'>) => Promise<Result<Product>>
    deactivate: (id: number) => Promise<Result<void>>
    adjustStock: (
      id: number,
      delta: number,
      reason: StockReason,
      ref?: string
    ) => Promise<Result<Product>>
    lowStock: () => Promise<Result<Product[]>>
  }
  labels: {
    list: () => Promise<Result<LabelDesign[]>>
    save: (input: LabelDesignInput) => Promise<Result<LabelDesign>>
    delete: (id: number) => Promise<Result<void>>
    setDefault: (id: number) => Promise<Result<void>>
  }
  reports: {
    get: (range: ReportRange) => Promise<Result<Report>>
  }
  print: {
    printers: () => Promise<Result<{ name: string; displayName: string; isDefault: boolean }[]>>
    run: (opts: {
      deviceName: string
      widthMm?: number
      heightMm?: number
      landscape?: boolean
    }) => Promise<Result<void>>
  }
  files: {
    /** Asks where to save; resolves to the saved path, or null when cancelled. */
    saveCsv: (name: string, content: string) => Promise<Result<string | null>>
  }
  dashboard: {
    get: (range: ReportRange) => Promise<Result<Dashboard>>
  }
  daybook: {
    get: (day: string) => Promise<Result<DayBook>>
    save: (input: DayBookSave) => Promise<Result<DayBook>>
    addExpense: (input: ExpenseInput) => Promise<Result<Expense>>
    deleteExpense: (id: number) => Promise<Result<void>>
  }
  purchases: {
    create: (input: PurchaseInput) => Promise<Result<Purchase>>
    note: (input: SupplierNoteInput) => Promise<Result<Purchase>>
    list: (search?: string) => Promise<Result<Purchase[]>>
    suppliers: () => Promise<Result<string[]>>
  }
  serials: {
    list: (filter?: SerialFilter) => Promise<Result<SerialUnit[]>>
    get: (serial: string) => Promise<Result<SerialUnit | null>>
    add: (input: SerialAddInput) => Promise<Result<Product>>
    remove: (id: number) => Promise<Result<void>>
  }
  parties: {
    list: (search?: string) => Promise<Result<Party[]>>
    save: (input: PartyInput) => Promise<Result<Party>>
    delete: (id: number) => Promise<Result<void>>
    ledger: (id: number) => Promise<Result<PartyLedger>>
    pay: (input: PartyPaymentInput) => Promise<Result<Party>>
    deletePayment: (id: number) => Promise<Result<void>>
  }
  bills: {
    create: (input: BillInput) => Promise<Result<Bill>>
    list: (search?: string) => Promise<Result<Bill[]>>
    get: (id: number) => Promise<Result<Bill | null>>
    delete: (id: number) => Promise<Result<void>>
  }
}

declare global {
  interface Window {
    api: TypedApi
  }
}
