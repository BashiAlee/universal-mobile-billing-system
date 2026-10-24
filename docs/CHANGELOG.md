# Changelog

Format: [Keep a Changelog](https://keepachangelog.com). Versions follow SemVer.

## [0.7.0] - 2026-10-24: Parties (suppliers) and balances

### Added
- **Parties** tab: suppliers with phone/address/notes, an optional opening balance (what you owed before using the app, either direction), total bought, total paid and the **balance** (you owe / they owe you). Add, edit, delete (only when it has no history), search.
- **Pay**: record money paid to a party later (date, note); a **Ledger** shows every purchase and payment with a running balance; a wrong payment can be deleted.
- Purchases now have a **Paid now** amount (empty = paid in full); the unpaid part is added to that party's balance. History shows a Due column. Quick notes can also be part-paid.
- Purchases can **create a new product on the spot** ("Add '<name>' as a new product" + its selling price): it is created with the purchase, gets the quantity as stock and the unit cost, all in one transaction. Products can still be added by hand on Products & stock.
- Typing a supplier name that does not exist creates the party automatically.
- Schema v7: tables `parties`, `party_payments`; `purchases.party_id`, `purchases.paid_minor`. Upgrade turns existing supplier names into parties (case-insensitive) and treats old purchases as fully paid, so every balance starts at zero. IPC `parties:list/save/delete/ledger/pay/deletePayment`; `services/parties.ts`.

### Known limits
- Day book, reports and dashboard still count a purchase as supplier spend on the day it was bought (whole total), not on the day it was paid; later payments are not added again. Cash-basis reporting is not built.

## [0.6.0] - 2026-10-24: Label designer

### Added
- **Label designer** tab: the shopkeeper designs the product label. Default size 38 x 25 mm (1.5 x 1 in). Items: shop name, logo, barcode/QR, code number, product name, price, free text. Each item can be dragged in a live preview (snaps to 0.5 mm), nudged with the arrow keys, or typed in (X, Y, width, height in mm), with font size, bold and alignment; items are kept inside the label.
- Designs are saved by name (schema v6, table `label_designs`; IPC `labels:list/save/delete/setDefault`; `services/labels.ts`). The first saved design becomes the default; the **Print labels** dialog offers the saved designs (default pre-selected) next to the built-in Standard layout. "Print test label" prints one label with the design being edited.
- Label printing now draws every label from a design (`LabelView`), so the preview and the printed label use the same markup.

### Fixed
- The per-product **Label** preview on Products still showed the old fixed layout; it now shows the saved default design (with a design picker), and "Print label" keeps the design you picked.

### Changed
- The built-in Standard layout is now generated as a design (same proportions as before); its price box is wider so "Rs 1,500.00" is not clipped on small labels.
- Settings notes that label size/code there apply to the Standard layout.

## [0.5.3] - 2026-10-24: Export to CSV

### Added
- **Export CSV** button on the Day book (the whole day: sales lines, expenses, summary, notes) and on Reports (exports the view you are on: financial summary, daily sales, monthly sales or by product, for the chosen dates). Saved through a normal "Save as" window; the files open in Excel.
- Safeguards: text that starts with = + - @ is neutralised so Excel cannot run it as a formula; file names are cleaned; UTF-8 with BOM so non-English names display correctly.

### Fixed
- Caught before release: the app's input money formatter gave wrong text for negative amounts (a loss); exports use their own formatter, with a test.

## [0.5.2] - 2026-10-24: Dashboard redesign

### Changed
- Dashboard now has four KPI cards (Sales, Profit, Purchase, Expense) each with a trend line and % change against the previous period of the same length; a Cash flow chart (money in vs expenses vs purchases); an Expenses donut by heading; Notifications (low-stock count and products priced below cost, click to open Products) and a Sales status panel. New IPC `dashboard:get` (`services/dashboard.ts`). No schema change.

## [0.5.1] - 2026-10-24: Dashboard

### Added
- **Dashboard** tab (Today / This week / This month / This year): tiles for sale, profit, supplier purchases, credit due, bills and stock value; sales-and-profit bar chart; profit-margin and payment-method donuts; top products. Charts are plain SVG (no new dependency); data comes from the existing report query.

## [0.5.0] - 2026-10-24: Day book

### Added
- **Day book** tab (modelled on the shop's paper/Excel day sheet): pick a day (prev / next / today) and see every item sold with buy and sale, totals, profit, shop expenses, and the remaining balance.
- Shop expenses per day (what and how much; can be removed).
- Opening balance: carried forward automatically from the previous day's remaining balance, or typed in by hand for any day (with "carry forward instead" to undo).
- Free-text notes per day (e.g. "500 in drawer, 350 with Irfan Shah").
- Remaining balance = opening balance + money received from bills (credit bills excluded, tax included) − shop expenses. Supplier purchases are shown for information only and do not change the balance.

### Changed
- Database schema v5: new `expenses` and `day_book` tables (additive; existing data untouched).

## [0.4.0] - 2026-10-24: Reports

### Added
- **Reports** tab with a date range (Today / This month / Last month / This year / custom): financial summary (gross sales, discounts, net sales, cost of goods, profit and margin, tax shown separately, money received by payment method, credit not yet received, supplier spend, current stock value at cost and at selling price), daily sales, monthly sales, and sales/profit by product.
- Stock was already reduced automatically when a bill is saved/printed; now covered by a report test too.

### Changed
- Database schema v4: each bill line now stores the unit cost at the time of sale, so profit stays correct when cost prices change later. Bills created before this version were back-filled with the product's cost price at upgrade time (an approximation for old bills only).

### Tests
- Unit 51 (+6 in `tests/reports.test.ts`, including the v3 to v4 upgrade), E2E 18 (+1).

## [0.3.2] - 2026-10-24

### Added
- Purchases: "+ Quick note (no stock)". Records supplier, what was bought and the total cost (optional date) as an info-only entry: no products, no stock or cost change. The purchases list now has a "Covers" column and search also matches that text.

### Changed
- Product label layout: logo + shop name on top, barcode/QR in the middle, product name + price below. The "Label" preview dialog shows the same layout.

### Tests
- Unit 45 (+2 for quick notes), E2E 17 (+1). Label layout still has no automated assertion; check it by eye or on the printer.

## [0.3.1] - 2026-10-23: QA audit and defect fixes

Full details in [QA_REPORT.md](QA_REPORT.md).

### Fixed
- "Stock" and "Print labels" were broken in the real app (`window.prompt` is unsupported in Electron); replaced by an in-app dialog.
- Double-clicking Save could create two bills / purchases; saving is now guarded.
- Receipt: item names without spaces ran off the paper and hid the price. Label price no longer wraps.
- Layout: New bill summary panel was clipped at 960 px; products table code wrapping and row borders; qty buttons stacked.
- Security/integrity: external links limited to http(s) and the window cannot navigate away; settings save whitelists keys, validates types and is atomic; `%`/`_` in searches are literal; limits on price, quantity and bill size; payment method whitelist; stock adjust refused on removed products.

### Tests
- Added `tests/qa.test.ts` (15), `tests/perf.test.ts` (1), `e2e/qa.spec.ts` (9). Totals: 43 unit/integration, 16 E2E.

## [0.3.0] - 2026-10-23

### Added
- Receipt redesigned to the user's sample: shop logo/name, RECEIPT title, dashed sections, `Nx item ... price` lines, TOTAL AMOUNT, CASH, CHANGE, THANK YOU footer, barcode of the bill number.
- Cash received field on the billing screen with live change; stored per bill (`bills.tendered_minor`, schema v3). Receipt shows "PAID BY" when no cash amount is recorded.
- Product labels now show shop logo, product name, barcode (Code 128) or QR, code text and price. Setting `labelCodeType` (default barcode).
- 3 unit tests (plus updated schema-version test) and 1 E2E test; E2E also covers cash/change and the barcode viewBox.

### Dependencies added
- `jsbarcode` (runtime), `@types/jsbarcode` (dev).

### Changed
- "QR" button on products renamed "Label"; "Print QR labels" renamed "Print labels".

### Fixed
- Barcode was cropped (invalid SVG viewBox from a `px` size string) - found by visual inspection of the rendered label.

## [0.2.0] - 2026-10-23

### Added
- Purchases from suppliers: supplier, products, quantity and total cost per line; increases stock, updates cost price, keeps history (new tables `purchases`, `purchase_items`, schema v2).
- Printer settings: receipt width (58/80 mm), label width/height; receipt and label print layouts follow them; copies-per-label prompt; one label per page for roll label printers.
- 7 unit tests and 2 end-to-end tests.

### Changed
- App renamed to **Universal Billing System** (window title, installer name, app id `com.universalbilling.app`, package `universal-billing-system`, data file `billing.db`, env var `UBS_DATA_DIR`).
- Product codes now `P-000123` (was `SB-000123`); nothing had been shipped, so no data migration.
- Label printing no longer uses a multi-column sheet; each label is its own page.

## [0.1.0] - 2026-10-23

### Added
- Project scaffold: Electron + React + TypeScript + SQLite (`node:sqlite`).
- White-label shop settings: name, logo, address, phone, currency symbol, tax rate, receipt footer.
- Products with auto/custom codes, soft delete, stock adjustments with audit trail, low-stock flag.
- QR code per product; printable QR label sheet.
- Billing by scanning QR codes or searching; discount, tax, payment method, customer name; atomic save with stock check.
- Receipt printing, bill history, search, reprint.
- 17 unit tests, 4 end-to-end tests, lint and typecheck setup.
- Project documentation in `docs/` and `README.md`.

### Dependencies added
- `qrcode` (runtime); `vitest`, `@playwright/test`, `@types/qrcode` (dev).

### Changed
- `electron-builder.yml`: Universal Billing System identity, Windows NSIS target, placeholder auto-update URL removed.
- Main window hardened (sandbox, context isolation) and enlarged.

### Fixed (during development)
- Billing: rapid consecutive scans could be lost or hide the out-of-stock message (race + state-updater side effect).
