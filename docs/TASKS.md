# Tasks

Last updated: 2026-10-23 (v0.3.0)

## Done

- [x] Project scaffold (Electron + React + TS), renamed to Universal Billing System
- [x] SQLite layer with versioned migrations
- [x] Shop settings / white-label branding (name, logo, address, phone, currency, tax, footer)
- [x] Products CRUD (soft delete), auto codes, stock adjustments, stock audit trail, low-stock flag
- [x] QR code per product (screen + printable label sheet)
- [x] Billing: scan or search, quantities, discount, tax, payment method, customer, stock check, atomic save
- [x] Receipt layout, bill history with search and reprint
- [x] Receipt layout matching the user's sample (RECEIPT title, dashed sections, item lines, TOTAL AMOUNT, CASH, CHANGE, THANK YOU, bill barcode)
- [x] Labels show logo, product name, barcode (or QR), code and price; barcode/QR option in Settings
- [x] Cash received / change on billing screen and receipt (schema v3)
- [x] Print layouts rendered to images with print CSS and visually checked (see TESTING)
- [x] Unit tests (27) and E2E tests (7), lint and typecheck clean
- [x] Renamed to Universal Billing System; product codes now `P-000123`
- [x] Purchases from suppliers (adds stock, sets cost, history)
- [x] Printer settings: receipt width 58/80 mm, label size, copies per label
- [x] Project documentation

- [x] QA audit and defect fixes (v0.3.1): see QA_REPORT.md.
- [x] Label designer: drag/edit items on a 38 x 25 mm label, save named designs, pick one when printing (v0.6.0)
- [x] Subscription control: license server + admin page + activation/suspension in the program (v0.11.0, code done; **server not deployed yet**)
- [x] Usernames/passwords per user, Users tab, logout, auto-logout after 5 hours without use (was 10 minutes until v0.11.4), recovery code, bills show who made them (v0.10.0)
- [x] Delete a bill (items and phones return to stock); discount shown in the Day book (v0.9.4)
- [x] Add phones directly (no purchase), delete a mistaken in-stock phone; supplier spend counts only money paid; Dashboard 'Money owed to parties' (v0.9.0)
- [x] Product details (brand, model, RAM, storage, color, cover compatibility) and per-unit IMEI tracking through purchase, sale, receipt and lookup (v0.8.0)
- [x] Parties (suppliers): balances, payments, ledger, part-payment on purchases, new products created from a purchase (v0.7.0)
- [x] Purchases: stock-free "Quick note" (supplier, what, cost, date) (v0.3.2)

## In progress

- none

## Pending: must verify before first customer

- [ ] **Run the app on a real Windows PC** and check layout, fonts and window behaviour (only run on macOS so far)
- [x] License server deployed on Render, address set in the program (v0.11.2)
- [ ] **Back up `license-keys/private.pem`** somewhere safe (not in git). Activate a real key on a Windows PC and test suspend / re-activate end to end
- [ ] **Run the Windows installer on a real Windows PC** (it is built, see CHANGELOG 0.9.3, but never run there). Not code-signed. App icon in `build/`/`resources/` is still the Electron template icon
- [ ] **Test with a real USB QR scanner**; only simulated keyboard input tested
- [ ] **Retest printing on the XP-420B with the v0.9.5 'choose printer' setting** (the Windows print window failed with 'Something went wrong'); check paper size, margins, barcode size. **Test real printing on the user's XPrinter**: confirm the model (receipt printer vs label/barcode printer), paper width, label size; check receipt and label layout, margins and QR size on actual output. Consider silent printing (no dialog) once the printer is known
- [ ] **Print a test label from the Label designer on the real label printer** (38 x 25 mm): check alignment, barcode size/scan, set the printer driver paper size to match. Add a print offset setting if the printer shifts the layout
- [ ] IMEI ideas not built: trade-in/return of a sold unit, per-unit selling price for used phones, IMEI check digit, print IMEI barcode on labels, warranty dates
- [ ] Parties ideas not built: print/export a party ledger, customers who owe you (udhar), supplier returns
- [ ] Label designer ideas not built: drag-resize handles, undo, copy a design between shops, images other than the logo
- [ ] Confirm generated barcodes/QR codes are decoded correctly by a real scanner (not tested; the barcode was only checked visually)
- [ ] Receipt font and dash style are close to the sample but not identical; adjust after seeing the real printout
- [ ] Decide whether to keep `node:sqlite` (experimental) or switch to `better-sqlite3` for release (D3)

## Pending: product features

- [ ] Purchases: edit/void a purchase, record amount paid / balance owed to supplier, create a new product inline from the purchase screen, supplier list with totals
- [ ] Returns / refunds (stock reason `return` exists, no UI)
- [x] Day book: daily sales lines, shop expenses, opening balance (carried or manual), remaining balance, notes (v0.5.0)
- [x] Reports: financial summary, daily, monthly, by product, profit, stock valuation (v0.4.0)
- [ ] Reports: export to Excel/CSV, print a report, expenses (rent, salaries) for true net profit, customer credit (udhar) tracking, returns/void bill
- [ ] Backup and restore of the database file
- [ ] Per-item discounts; multiple tax rates; decimal quantities (kg/litre) if shops need them
- [ ] Products that already carry a manufacturer EAN/UPC barcode: allow entering it as the product code
- [ ] Licence key system so copies can be sold per shop
- [ ] Auto-update (no update server configured)
- [ ] Urdu / other language support (not requested yet; only note)
- [ ] Accessibility audit (labels and roles added, but no formal audit)
- [ ] Git repository (folder is not under version control yet)

## Open questions for the user

1. XPrinter exact model number(s), receipt paper width (58 or 80 mm), label size in mm
2. Do you want to track amount paid / owed to suppliers?
3. Should the purchase screen be able to create new products inline?
4. Currency decimals and tax rules for target customers

## From the QA audit (decisions / recommendations)
- [ ] Confirm the new limits (10,000,000.00 per item, 1,000,000 units).
- [ ] Backup & restore (recommended before first customer).
- [ ] Void / return bill.
- [ ] Pagination or virtual list for products and bills.
- [ ] Measure real-disk write speed on the target Windows PC.
- [ ] Accessibility check with a tool (contrast, focus, screen reader).
