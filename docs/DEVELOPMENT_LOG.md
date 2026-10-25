# Development Log

## 2026-10-23

**Requirements captured from the user**
- Desktop app to add bills, stock; generate bills by scanning QR; generate QR codes to attach to products.
- Must be universal and sellable to any shop; per-customer shop name and logo.
- Windows only for now. Local-only data; stack Electron + React + SQLite (user chose).
- Not yet answered: app name, purchase bills, printer type. Working name "Universal Billing System" assumed (flagged in TASKS).

**Steps**
1. Created `Universal Billing System/` as a separate project folder next to the existing, untouched "apex mobile" files.
2. Scaffolded with `@quick-start/electron` (react-ts), flattened into the project root. `npm install` OK (0 vulnerabilities).
3. Added `qrcode`, `vitest`, `@playwright/test`.
4. **Decision D3:** checked `node:sqlite` works in both system Node 22 and Electron's Node 24.22 before choosing it over `better-sqlite3`.
5. Wrote DB layer, services (settings, products, bills), shared types.
6. Wrote 17 unit tests; all passed first run.
7. Wrote IPC handlers, preload API, hardened window (context isolation, sandbox on).
8. Wrote React UI: Billing, Products (+QR dialog, label printing), Bill history, Settings (logo upload), print layouts.
9. Lint flagged a fast-refresh rule error; split context/hook from provider component.
10. Added `UBS_DATA_DIR` override so E2E tests use a temp database.
11. Wrote 4 E2E tests. First runs failed: two were test bugs (locator, print timing); one exposed a **real bug** (scan race + side effect inside state updater). Fixed in `Billing.tsx`; 8/8 consecutive stable runs after.
12. Updated `electron-builder.yml`: appId `com.universalbilling.app`, productName Universal Billing System, Windows NSIS target, removed placeholder update URL, excluded tests/docs from package.
13. Wrote documentation.

**Issues / things to know**
- `node:sqlite` prints an ExperimentalWarning; accepted for now, tracked in TASKS.
- `npm run build:win` has not been run. Installer and app icon are unverified (icon is still the Electron default).
- Folder is not a git repository. Nothing was committed.
- Existing files in `/Users/mac/work/Basit Dev` (apex mobile, zip, md) were not read or modified.

**Next:** verify on Windows with real scanner/printer; build installer; answer open questions; reports and backup.

## 2026-10-23 (session 2): rename, purchases, printer settings

**Requirements from the user**
- App name: Universal Billing System.
- Record "total bills" from suppliers, e.g. 200 covers from ABC traders for 10000.
- Printer is a receipt printer; user has an XPrinter ("barcode xprinter"). Exact model unknown.

**Decisions**
- Interpreted "total bills" as supplier purchase bills that increase stock (assumption; flagged to user). Entered as total cost per line (D7).
- The XPrinter may be a receipt model, a label/barcode model, or both are needed: made receipt width and label size configurable instead of guessing.

**Steps**
1. Renamed the app everywhere (code, tests, docs, packaging); product code prefix `SB-` to `P-`. A first sed with an unquoted file list silently only changed one file; re-ran with a loop and grepped for leftovers.
2. Migration 2: `purchases`, `purchase_items`. New `purchases.ts` service, IPC, preload, Purchases page and nav tab.
3. Settings: `receiptWidthMm`, `labelWidthMm`, `labelHeightMm` with validation. Print area injects `@page` size per job; labels are one per page; copies prompt added.
4. Tests: 7 new unit tests (24 total, pass), 2 new E2E tests (6 total).
5. E2E first run failed on a locator matching two cells (test bug, fixed with `exact: true`); a second failure was a knock-on. 4/4 consecutive passes afterwards.

**Not done / risks**
- Print layouts unverified on the real XPrinter. Purchases cannot be edited/voided and do not track payment owed. Both listed in TASKS.

## 2026-10-23 (session 3): sample receipt, barcode labels, cash/change

**Requirements from the user**
- Receipt should look like the supplied sample image (dashed separators, RECEIPT title, item lines, TOTAL AMOUNT, CASH, CHANGE, THANK YOU, barcode).
- The barcode printer must print labels showing price, barcode, name and logo.

**Decisions**
- Labels default to Code 128 barcode (D8); QR stays selectable. Receipt barcode encodes the bill number so a bill can be looked up by scanning later (lookup feature not built yet).
- CASH/CHANGE need the cash handed over, which was not stored: added optional "Cash received" and migration 3. Not recorded = receipt shows PAID BY.
- Kept shop logo/name at the top of the receipt (white-label requirement) above the sample's RECEIPT title.

**Steps**
1. Backend: `tendered_minor`, validation, settings `labelCodeType`; 3 new unit tests (27 total, pass).
2. UI: `BarcodeSVG`, `ProductCode`, rewritten `Print.tsx` (receipt + labels), print CSS, billing cash field, settings option.
3. E2E updated (button renamed, cash/change, QR switch): 7 pass.
4. Visual verification: wrote a throwaway script that emulates print media, captures the print area and screenshots it. Receipt matched the sample. The barcode label showed a cropped barcode: root cause was an invalid viewBox (`"246px"`). Fixed, re-rendered, added an E2E regression assertion.
5. Final run: lint 0 problems, typecheck 0 errors, 27 unit tests pass, 7 E2E pass x5 runs, production build OK.

**Not verified:** a real printer, a real scanner decoding the barcode, Windows. Rendering was checked on macOS Chromium only; thermal printers may shift margins or drop thin lines.


## 2026-10-23 (session 4): full QA audit

- Read-only audit first, then reproduced each suspect with a failing test before fixing it. Found that `window.prompt` throws in Electron, which silently broke the Stock and Print-labels buttons (no existing test covered them).
- Decision D8: added numeric safety limits (price/cost <= 10,000,000.00, quantity <= 1,000,000, bill total < 1e15 minor units) and a payment-method whitelist. These are safety guards, not pricing rules; flagged for the user to confirm.
- Test mistakes made and corrected: a D3 test that passed without the fix (unreachable URL), a revert check run with a filter that skipped the setup tests, a partial revert that left `min-width:0` in place, and a nested transaction in the perf test. Each regression test was re-verified to fail without its fix.
- Bugs in my own tooling: macOS `sed -i` needs a suffix argument, so two CSS edits silently did not apply until redone.
- See [QA_REPORT.md](QA_REPORT.md).

## 2026-10-24: Day book (v0.5.0)
User showed their old desktop POS and their Excel day sheet (items with buy/sale, shop expense column, totals, profit, remaining balance, notes). Built a Day book tab: `services/daybook.ts`, schema v5 (`expenses`, `day_book`), IPC `daybook:*`, `pages/DayBook.tsx`. Balance carry-forward is computed by replaying days up to the chosen day; a typed opening balance resets the chain. Decision: credit bills are not "money received"; supplier purchases are informational only (user's earlier "just for info" request). E2E expectation first assumed 1,150 but received cash includes the 10% tax (1,170): test bug, not app bug.

## 2026-10-25: Printing straight to the printer (v0.9.5)
User ran the Windows installer (so it works there) and printing showed the system print window with "Something went wrong" and a greyed-out Print for the Xprinter XP-420B. Could not reproduce (no Windows or printer here), and a web search found no exact match, so rather than guess at a flag I bypass that window: choose the printer in Settings and print silently from the main process. Left the old path as the default so nothing changes for people whose window works. Risk: silent printing with a custom paper size depends on the driver; untested on the real printer.

## 2026-10-25: Windows installer for a client (v0.9.3)
User wants to hand the client only an .exe and a database file. Built the NSIS installer from the Mac. Two mistakes caught: the first installer contained the user's exported database (electron-builder packs every file not excluded, and I had put the export inside the project folder); fixed by excluding data/build files in `electron-builder.yml`, moving the export to a separate `Delivery` folder, rebuilding and listing the asar to confirm. Also, inspecting the asar with `asar extract-file` overwrote the project's `package.json`; restored from git. Lesson: inspect packages in a scratch folder.

## 2026-10-24: Add phones directly, owed money out of spending (v0.9.0)
User could not add IMEIs for a new tracked phone (only via a purchase) and said the money owed to parties should not appear in the day book or dashboard spending, only on the Parties page, with a "money owed" section at the end of the dashboard. This settles the cash-basis question left open in v0.7.0: supplier spend is now paid_minor + later payments. Profit was already independent of purchases. Two e2e tests broke because a new tracked phone now opens the IMEI window; fixed in the tests, not by changing the behaviour.

## 2026-10-24: Product details and IMEI (v0.8.0)
User wanted phones with storage, RAM, IMEI, colors, while covers keep a "for which mobile" field. Decisions: each variant is its own product (own stock, price, label); IMEI tracking is a per-product switch and every unit is a row in `serial_units`, with `stock_qty` kept equal to the in-stock count so reports, low-stock and labels need no change; a tracked product is billed one line per unit so cost and IMEI are exact; tracking can change only at 0 stock; duplicate IMEIs are refused (trade-in of a sold unit left for later). Gotcha: the product form's "Name" label was changed first to a long hint and broke older tests that find it by exact label, so the hint moved into the placeholder. Mistake: a script that edited several files stopped halfway on a wrong anchor, so bills/IPC edits had to be redone; the unit tests caught nothing missing afterwards.

## 2026-10-24: Parties (v0.7.0)
User asked for suppliers ("parties") with what we get from them added to products automatically, products also addable by hand, and balances / amounts given per party. Built on the existing purchases: a purchase now belongs to a party and records how much was paid; balance is computed from records (never stored). Decisions: paid defaults to the full total so old behaviour and tests are unchanged; old purchases count as fully paid on upgrade; extra money is a separate payment; a purchase line may create a new product (`insertProduct` split out of `createProduct` so it can share the purchase transaction); parties with history cannot be deleted. Open question left to the user: reports still count spend when bought, not when paid.

## 2026-10-24: Label designer (v0.6.0)
User asked for a way for the shopkeeper to design labels; their label is 38 x 25 mm. Built level 1+: items stored as boxes in mm (`label_designs`, schema v6) so drag-and-drop and a later resize handle need no data change. `LabelView` draws both the preview and the printed label. Decisions: first saved design becomes the default; Standard layout stays built in as fallback; Settings label size kept (used by Standard). Bugs found by looking at a screenshot of my own work: the price was clipped on the Standard layout (box too narrow); fixed. Mistake: my screenshot script launched the built `out/` folder, so the first re-shot showed the old code until I rebuilt.
