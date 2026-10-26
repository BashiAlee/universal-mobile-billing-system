# Changelog

Format: [Keep a Changelog](https://keepachangelog.com). Versions follow SemVer.

## [0.11.2] - 2026-10-26: Licensing switched on

- `LICENSE_SERVER_URL` is now `https://universal-mobile-billing-system.onrender.com` (the user's Render service). The installed program asks for a license key after the first account is created, and re-checks at start-up and every 6 hours. Checked against the live server: `/health` and `/admin` answer, a made-up key is refused with "Unknown license key", and the program shows that message on its Activate screen. A real key has not been activated through the installer yet.
- While developing (`npm run dev`) nothing is checked unless `UBS_ENFORCE_LICENSE=1` is set.

## [0.11.1] - 2026-10-26: One print at a time

### Fixed
- A slow printer let people click Print again and again, sending the same job several times. Now while a receipt or label job is being sent, every print button is disabled (Reprint shows "Printing…"; the labels Print, Print labels, Print label, Print test label, Print a test label, and Save & print bill) and any extra print request is ignored. The "Choose printer" window's Print button disables after the first click. The buttons come back when the printer has accepted the job (or the print window is closed).

## [0.11.0] - 2026-10-26: Subscription control (license server)

### Added
- **License server** (`license-server/`, plain Node + MongoDB, own README with setup steps) and an **admin page** (`/admin`): add a shop, set paid-until, suspend/activate, +30 days, reset computers, delete. It stores only the license list and never receives shop data.
- **In the program**: an **Activate the program** screen asks for the license key once (needs internet). The program then asks the server at start-up and every 6 hours, keeps the signed answer, and works offline for up to 7 days (server setting `GRACE_DAYS`). Answers are signed (ed25519), tied to the computer, and a clock set back does not stretch them.
- **When the subscription is inactive** (suspended, past the paid-until date, key deleted, or no check for more than the grace period): a notice appears with **Check again**, and the main process refuses everything that changes data (billing, products, purchases, settings...). Viewing, exporting CSV, reprinting and the Users list keep working.
- A key works on a limited number of computers (default 2); the admin can reset them.
- Switched off by default: until `LICENSE_SERVER_URL` in `src/main/license/config.ts` is set, nothing is checked, so existing builds and installers behave as before. In the installed program the address and public key cannot be overridden by environment variables (only while developing).
- Signing key pair created outside the project (`../license-keys/`, never committed; `*.pem` is git-ignored). Only the public key is in the program.

### Not done / limits
- The server has been tested here with an in-memory list, not against a real MongoDB Atlas database or a hosted server; that needs your account.
- A determined technical person can still tamper with a copy of the program.

## [0.10.0] - 2026-10-26: Usernames and passwords, logout and automatic logout

### Added
- **Sign-in**: nothing in the program is shown until someone signs in. On a fresh install, or the first start after this update, the first screen is **Create your account** (username, password of at least 6 characters). Each further person gets their own username and password from the new **Users** tab (add, set a new password, delete; you cannot delete yourself or the last user). Everyone can use every screen.
- **Log out** button in the sidebar (shows who is signed in) and **automatic logout after 10 minutes without mouse, keyboard or touch use**. Closing the program also signs everyone out.
- **Recovery code**: shown once when the first account is created (must be ticked "I have written it down"). **Forgot password?** on the sign-in screen lets you set a new password with the username and the code; the code is then replaced by a new one that is shown once.
- **Made by**: bills record the username of the person who made them (Bill history column; blank for older bills). Schema v10: `users`, `bills.created_by`.
- Protection against guessing: 5 wrong passwords lock that username for 30 seconds.
- Passwords are stored only as salted scrypt hashes, and the recovery code likewise.
- The rules are enforced in the main process: every data request (including printing and CSV export) is refused with "Please log in" when signed out or timed out, so a screen left open cannot be used.

### Known limits
- This stops people using the program, not people opening the database file: the file itself is not encrypted.
- Every user can add, change and delete other users (no admin/staff levels, as requested).
- Test hook: environment variable `UBS_IDLE_MS` shortens the idle time (used by the tests only).

## [0.9.6] - 2026-10-25: Windows "Ask me each time" asks for the printer in the app

Applied from the user's `PRINT_FIX_CHANGES.md` (written and tested on their Windows laptop).

### Fixed
- On Windows the system print window ignores the label size and uses the driver's paper (80 x 130 mm on the XP-420B), so labels printed nothing. With no printer saved, Windows now shows the app's own **Choose printer** window (printers from the PC, last choice remembered per labels/receipts) and prints straight to the picked printer with the exact label size. macOS still opens its normal print dialog.
- Settings wording updated ("Ask me each time"); e2e tests set `__systemPrint` so no real printer is used, plus a Windows-only test of the chooser (skipped on macOS). Changed files: `Print.tsx`, `Settings.tsx`, `e2e/app.spec.ts`, `e2e/qa.spec.ts`.
- On the Windows laptop: typecheck, 110 unit tests and 32 e2e tests pass, and a label sent to the Xprinter XP-420B was logged `size=38x25mm ... OK (job accepted)`. Here on the Mac: typecheck/lint clean, 110 unit, 31 e2e pass + 1 skipped.

## [0.9.5] - 2026-10-25: Print straight to the chosen printer (Windows print window fix)

### Fixed / Added
- On the user's Windows laptop the print window ("Universal Billing System - Print") showed "Something went wrong" and a disabled Print button for the Xprinter XP-420B. That window is the Windows system print dialog opened by `window.print()`; it fails with some printer drivers.
- **Settings > Printer: Receipt printer and Label printer.** Choose a printer and jobs go straight to it with no print window (`webContents.print({ silent: true, deviceName, ... })` in the main process, service `printing.ts`, IPC `print:printers` / `print:run`). Labels are sent with the label design's own paper size (mm); receipts use the printer's own paper setting. Leaving "Ask me each time" keeps the old behaviour (normal print window). If a printer rejects the job an alert says why.
- Settings keys `receiptPrinter`, `labelPrinter` (empty by default).
- Settings has **Print a test label**, which uses the saved printer settings and says which route it used. Every silent print attempt is noted in `print.log` in the data folder (printer, size, result) so a problem can be diagnosed from it.
- After the user's test label printed **blank** on the XP-420B (the app's own render of the same label checked fine as a 38 x 25 mm PDF: shop name, barcode, name, price), two label options were added in Settings: **Paper size sent to the label printer** (the label's own size, or the printer's own paper setting) and **Rotate the label 90°**, so the combination that suits the driver can be found. The log line also records rotation.
- Settings status message is now a banner pinned to the top of the page (it used to be at the very bottom, easy to miss), says which printers were saved, and the test-label message states the label size and paper mode. Found while checking why the user's saved printer did not seem to be used: with a saved printer the app does print through the silent route and writes `print.log` (verified here with a printer name that does not exist, so nothing printed). Note the test label uses the Standard layout at the size in Settings (default 40 x 30 mm), so the label width/height there must be set to the real label (38 x 25).
- **Not verified on real hardware**: tested only that the settings, printer list and the refusal of an empty printer name work; actual silent printing to the XP-420B has not been seen working.

## [0.9.4] - 2026-10-25: Delete a bill; discount in the Day book

### Added
- **Delete** button on each bill in Bill history (with a confirmation). The bill is removed as if it never happened: items go back into stock, phones sold on it become in-stock again, its stock-history lines are removed, and it disappears from reports, the Day book and the Dashboard. Bill numbers are not reused. Service `deleteBill`, IPC `bills:delete`.
- Day book shows **Discount given** (and exports it in the CSV). The Sale figure is already after discount, so the row is informational.
- The Day book sales table now ends with **Discount given on bills** and **Sale after discount** (also in the CSV), so the table adds up to the Sale figure below it. (The first version only showed a note, which was easy to miss.)
- The Day book sales table shows each bill's own discount in a row under that bill's items ("Discount on this bill"), as well as the total at the end; the CSV has the same rows.
- Bill details (View) now show subtotal, discount and tax when present.

### Fixed
- A screen that fails to draw now shows "Something went wrong on this screen" (with the error text) instead of a blank window; switching tab resets it. Found when the Day book went blank in the running dev app: the screen code was updated live but the main process still ran the old code (it only reloads on restart), so the new per-bill discount data was missing. The Day book also tolerates that now. Lesson: restart the dev app after changes to `src/main`.
- Scanning an unknown code or an already-sold IMEI now selects the text from an effect after it is back in the box (a timer could fire first), so the next scan always replaces it instead of being glued on. This also removed an intermittent e2e failure; that test now also starts from an empty cart.

## [0.9.3] - 2026-10-25: Windows installer built

### Added / Fixed
- First Windows installer built from the Mac with `npx electron-builder --win --x64` (NSIS, per-user, no admin; `dist/universal-billing-system-1.0.0-setup.exe`, about 107 MB). It is **not code-signed** (Windows SmartScreen shows "Run anyway") and has **not been run on a Windows machine yet**.
- Fixed: the first build packaged a stray `billing-export.db` found in the project folder into the installer. `electron-builder.yml` now excludes `*.db`, `*.db-*`, `*.tsbuildinfo`, `dist` and `playwright-report`, and the installer was rebuilt and checked (no database or private files inside).
- Data folder on Windows: `%APPDATA%\universal-billing-system` (package name, no productName). Delivery steps for a client are in `HOW_TO_INSTALL.txt` (kept outside the repo with the installer and database).

## [0.9.2] - 2026-10-25: Stock totals on Products

### Added
- Products page shows total products, total stock (pieces), and stock value at cost and at selling price. The totals follow the list on screen, so a search shows the totals of what it found.
- Products table has a **Cost price** column next to the selling price.
- 117 products imported from the user's `USD MOBILE.xlsx` into their own database (a one-off data load, not a feature of the app).

## [0.9.1] - 2026-10-24: Supplier money removed from Day book, Dashboard and Reports

### Changed
- On request ("day book is daily profit and sale, nothing from money I owe; parties is separate"): the "Paid to suppliers" line is gone from the **Day book**, the **Reports** screen and its CSV, and the **Dashboard** tile and cash-flow column. Money to and from parties now appears only on the **Parties** page and in the Dashboard's "Money owed to parties" section. Profit and the day book balance never used it. The figures still exist in the data layer (`supplierSpendMinor`, tested) but are not shown.

## [0.9.0] - 2026-10-24: Add phones directly; owed money kept out of spending

### Added
- **Add phones without a purchase**: saving a new IMEI-tracked product opens its IMEI window; the **IMEIs** button on a phone has an "Add phones you already have" form (IMEI, optional second IMEI for dual SIM, condition, optional cost). A phone entered by mistake can be deleted while in stock (stock goes down; sold phones cannot be deleted). IPC `serials:add/remove`.
- **Dashboard: "Money owed to parties"** at the end: each party with a balance, total bought, paid and remaining, and the total still to pay. It is as of today, not limited to the chosen dates, and is not part of profit.

### Changed
- **Day book, Reports and Dashboard now count only money actually paid to suppliers** (the paid part of a purchase plus later payments, on the day each was made). The unpaid balance is no longer shown as spending anywhere; it appears only on the Parties page and the Dashboard owed section. Labels now say "Paid to suppliers". Profit never included purchases and still does not.

## [0.8.1] - dual SIM, see 0.8.0 notes below
## [0.8.0] - 2026-10-24: Product details and IMEI tracking

### Added
- **Product details**: category, brand, model, RAM, storage, color and "compatible with" (for covers). Leave the name blank and it is built ("Samsung A15 6/128 Black"). The list shows the details under the name. Search now matches every word anywhere in the name, code, details or an IMEI ("a15 128").
- **Track IMEI** (per product, for phones): every unit is recorded by IMEI; stock is the number of units in stock. A purchase asks for the IMEI of each unit (scan/type + Enter) and a Used/New condition; each unit keeps its own cost. A new product typed on a purchase can be marked as tracked.
- **Selling**: scan a phone's IMEI at the till to put that exact phone on the bill, or scan/search the product and pick the IMEI (a single unit left is picked automatically). A tracked product is billed one line per unit, each line carries its IMEI and the cost of that unit (profit uses it). The IMEI is printed on the receipt and shown in bill history; bills can be searched by IMEI.
- **IMEI lookup** (Products page) and an **IMEIs** button per phone: status, supplier and purchase it came from, bill and customer it was sold to.
- Schema v8: product detail columns, `track_serial`, table `serial_units`. IPC `serials:list/get`. `services/serials.ts`.
- Rules: IMEIs are unique and stored upper-case; a sold or in-stock IMEI cannot be bought in again; tracked products cannot start with stock or have stock adjusted by hand; tracking can only be switched while stock is 0.

- **Dual-SIM phones**: a phone can have a second IMEI (tick "Dual SIM" on the purchase line). It is still one unit of stock; scanning either IMEI finds the same phone, both are unique, shown in lookup and on the receipt ("IMEI: A / B"), and the same phone cannot be on one bill twice via its two numbers. Schema v9: `serial_units.serial2`.
- Fixed: checkboxes inside forms were drawn centred above their text.

### Known limits
- A phone sold and later bought back from a customer with the same IMEI is refused (the IMEI already exists). Trade-in of a previously sold unit is not built.
- Phone price is the product price; no per-unit selling price for used phones yet. The New-product shortcut on a purchase only asks for name, price and IMEI tracking; edit the details afterwards in Products.
- IMEIs are checked for length/characters only, not the IMEI check digit.

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
