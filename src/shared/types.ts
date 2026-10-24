/** Types shared by main, preload and renderer. Money is always integer minor units (e.g. paisa/cents). */

export interface Product {
  id: number
  code: string
  name: string
  priceMinor: number
  costMinor: number
  stockQty: number
  lowStockThreshold: number
  active: boolean
  createdAt: string
  updatedAt: string
}

export interface ProductInput {
  code?: string
  name: string
  priceMinor: number
  costMinor?: number
  stockQty?: number
  lowStockThreshold?: number
}

export interface BillLineInput {
  productId: number
  qty: number
}

export interface BillInput {
  items: BillLineInput[]
  discountMinor?: number
  paymentMethod?: string
  customerName?: string
  /** Cash handed over by the customer (cash payments only). 0/omitted = not recorded. */
  tenderedMinor?: number
}

export interface BillItem {
  id: number
  productId: number | null
  code: string
  name: string
  unitPriceMinor: number
  qty: number
  lineTotalMinor: number
}

export interface Bill {
  id: number
  billNo: string
  createdAt: string
  subtotalMinor: number
  discountMinor: number
  taxMinor: number
  totalMinor: number
  paymentMethod: string
  customerName: string
  /** Cash received, or 0 if not recorded. Change = tenderedMinor - totalMinor. */
  tenderedMinor: number
  items: BillItem[]
}

export interface ShopSettings {
  shopName: string
  address: string
  phone: string
  currencySymbol: string
  /** Tax rate in basis points (1800 = 18%). */
  taxRateBp: number
  /** Logo as a data URL (png/jpeg/webp/svg), or empty string. */
  logoDataUrl: string
  receiptFooter: string
  /** Receipt paper width in mm: 58 or 80 (thermal receipt printers). */
  receiptWidthMm: number
  /** Product label size in mm (roll label printers print one label per page). */
  labelWidthMm: number
  labelHeightMm: number
  /** Code printed on product labels. Both are scannable by a normal USB scanner. */
  labelCodeType: 'barcode' | 'qr'
}

export type StockReason = 'initial' | 'purchase' | 'adjustment' | 'sale' | 'return'

export interface StockMovement {
  id: number
  productId: number
  delta: number
  reason: StockReason
  ref: string
  createdAt: string
}

/** A brand-new product created by the purchase itself (it starts at 0 stock, then the purchase adds the quantity). */
export interface NewProductInput {
  name: string
  /** Selling price. */
  priceMinor: number
  code?: string
}

export interface PurchaseLineInput {
  /** An existing product, or leave out and give `newProduct` to create it from this purchase. */
  productId?: number
  newProduct?: NewProductInput
  qty: number
  /** Total paid for this whole line (e.g. 200 covers for 10000), not the per-unit price. */
  totalCostMinor: number
}

export interface PurchaseInput {
  /** Existing party, or give `supplierName` (a party with that name is found or created). */
  partyId?: number
  supplierName?: string
  /** Paid at the time of purchase; the rest stays owed. Defaults to the full total. */
  paidMinor?: number
  note?: string
  items: PurchaseLineInput[]
}

/** A stock-free record of money spent with a vendor: no products, no stock change. */
export interface SupplierNoteInput {
  partyId?: number
  supplierName?: string
  paidMinor?: number
  /** What it covered, e.g. "200 phone covers". */
  description: string
  amountMinor: number
  /** Optional YYYY-MM-DD; defaults to now. */
  date?: string
}

export interface PurchaseItem {
  id: number
  productId: number | null
  code: string
  name: string
  qty: number
  unitCostMinor: number
  lineTotalMinor: number
}

export interface Purchase {
  id: number
  purchaseNo: string
  createdAt: string
  partyId: number | null
  supplierName: string
  note: string
  totalMinor: number
  paidMinor: number
  items: PurchaseItem[]
}

export interface PartyInput {
  id?: number
  name: string
  phone?: string
  address?: string
  notes?: string
  /** What we already owed them before using the app (negative if they owe us). */
  openingMinor?: number
}

export interface Party {
  id: number
  name: string
  phone: string
  address: string
  notes: string
  openingMinor: number
  createdAt: string
  /** Total of all purchases from this party. */
  purchasedMinor: number
  /** Everything paid: at purchase time plus separate payments. */
  paidMinor: number
  /** Positive = we owe them; negative = they owe us (advance paid). */
  balanceMinor: number
  lastActivity: string | null
}

export interface PartyPaymentInput {
  partyId: number
  amountMinor: number
  /** YYYY-MM-DD, defaults to today. */
  date?: string
  note?: string
}

export interface LedgerEntry {
  /** 'payment' ids are party_payments ids (deletable); 'purchase' ids are purchases ids. */
  kind: 'opening' | 'purchase' | 'payment'
  id: number
  date: string
  ref: string
  description: string
  /** Value of goods bought (adds to what we owe). */
  boughtMinor: number
  /** Money paid out (reduces what we owe). */
  paidMinor: number
  balanceAfterMinor: number
}

export interface PartyLedger {
  party: Party
  entries: LedgerEntry[]
}

export interface ReportRange {
  /** Local dates, YYYY-MM-DD, inclusive. */
  from: string
  to: string
}

/** One row of the daily / monthly tables. Net sales = sales before tax, after discount. */
export interface PeriodRow {
  period: string
  bills: number
  netSalesMinor: number
  costMinor: number
  profitMinor: number
}

export interface ProductSalesRow {
  name: string
  qty: number
  salesMinor: number
  profitMinor: number
}

export interface Report {
  range: ReportRange
  bills: number
  grossSalesMinor: number
  discountMinor: number
  netSalesMinor: number
  taxMinor: number
  totalBilledMinor: number
  costMinor: number
  profitMinor: number
  /** Billed totals by payment method (tax included). */
  byPayment: { method: string; bills: number; totalMinor: number }[]
  /** Money paid to suppliers in the range (purchases + quick notes). */
  supplierSpendMinor: number
  /** Current stock, valued at cost and at selling price (not range-dependent). */
  stockCostValueMinor: number
  stockRetailValueMinor: number
  daily: PeriodRow[]
  monthly: PeriodRow[]
  products: ProductSalesRow[]
}

export interface Expense {
  id: number
  day: string
  title: string
  amountMinor: number
}

export interface DayBookLine {
  billNo: string
  name: string
  qty: number
  costMinor: number
  saleMinor: number
}

/** One local day of the shop, like the paper day book: sales lines, expenses, balance and notes. */
export interface DayBook {
  day: string
  lines: DayBookLine[]
  bills: number
  /** Sales after bill discounts, before tax. */
  salesMinor: number
  discountMinor: number
  costMinor: number
  profitMinor: number
  expenses: Expense[]
  expensesMinor: number
  /** Profit minus shop expenses. */
  netProfitMinor: number
  /** Money actually received for the day's bills (all but credit), tax included. */
  receivedMinor: number
  creditMinor: number
  /** Paid to suppliers on this day. Shown for information; not part of the balance. */
  supplierSpendMinor: number
  openingMinor: number
  /** True when the opening balance was typed in, false when carried from the previous day. */
  openingManual: boolean
  closingMinor: number
  notes: string
}

export interface DayBookSave {
  day: string
  /** null = carry the opening balance forward from the previous day. */
  openingMinor: number | null
  notes: string
}

export interface ExpenseInput {
  day: string
  title: string
  amountMinor: number
}

/** Everything the Dashboard shows for a date range, plus the same totals for the period just before it. */
export interface Dashboard {
  report: Report
  previous: {
    salesMinor: number
    profitMinor: number
    purchasesMinor: number
    expensesMinor: number
  }
  expensesMinor: number
  expensesByTitle: { title: string; totalMinor: number }[]
  /** Money actually received from bills (credit excluded), tax included. */
  receivedMinor: number
  /** One value per day of the range, oldest first, for the small trend lines. */
  series: { sales: number[]; profit: number[]; purchases: number[]; expenses: number[] }
  /** Products at or below their low-stock level. */
  lowStockCount: number
  /** Products whose selling price is below their cost price. */
  sellInLossCount: number
}

/** Result envelope used by every IPC call so the UI never sees thrown errors. */
export type Result<T> = { ok: true; data: T } | { ok: false; error: string }

/** What a label element shows. `text` is free text typed by the shopkeeper; the rest come from the product/shop. */
export type LabelElementKind =
  'shopName' | 'logo' | 'code' | 'codeText' | 'productName' | 'price' | 'text'

/** One item on a label. Position and size are in millimetres from the label's top-left corner. */
export interface LabelElement {
  id: string
  kind: LabelElementKind
  x: number
  y: number
  w: number
  h: number
  fontPt: number
  bold: boolean
  align: 'left' | 'center' | 'right'
  /** Only used by kind 'text'. */
  text: string
}

export interface LabelDesign {
  id: number
  name: string
  widthMm: number
  heightMm: number
  codeType: 'barcode' | 'qr'
  elements: LabelElement[]
  /** The design pre-selected when printing labels. */
  isDefault: boolean
}

/** What the designer sends to save: no id yet for a new design. */
export type LabelDesignInput = Omit<LabelDesign, 'id' | 'isDefault'> & { id?: number }
