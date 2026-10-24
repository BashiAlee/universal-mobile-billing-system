import type {
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
  bills: {
    create: (input: BillInput) => Promise<Result<Bill>>
    list: (search?: string) => Promise<Result<Bill[]>>
    get: (id: number) => Promise<Result<Bill | null>>
  }
}

declare global {
  interface Window {
    api: TypedApi
  }
}
