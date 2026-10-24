# Testing

Last full run: 2026-10-23 on macOS (Darwin 24.6), Node 22.23.3, Electron 44. **Not yet run on Windows.**

## Commands

| Command | Scope |
|---|---|
| `npm test` | Unit tests of services against an in-memory SQLite DB |
| `npm run test:e2e` | Builds, then launches the real Electron app and drives the UI (isolated temp data dir via `UBS_DATA_DIR`) |
| `npm run lint` | ESLint + Prettier |
| `npm run typecheck` | TypeScript, main + renderer |

## Latest results (actually run)

| Check | Result |
|---|---|
| `npm run lint` | 0 errors, 0 warnings |
| `npm run typecheck` | 0 errors |
| `npm test` | 4 files, **27 passed**, 0 failed |
| `npm run test:e2e` | **7 passed**, 0 failed. 5 consecutive runs (1 via `test:e2e`, 4 repeats): all passed |
| Visual check of print layouts | Receipt (80 mm), barcode label and QR label (40x30 mm) rendered with print media and inspected by eye: matches the sample layout. Throwaway script, not part of the suite |
| `npm run build` | succeeds |

## Unit test cases (`tests/`)

**settings.test.ts**: defaults on fresh DB; save/reload name+logo+tax; replace and clear logo; reject empty name, tax > 100%, non-image data URL, remote URL as logo.

**products.test.ts**: auto code generation (P-000001...); duplicate code and invalid input rejected; initial stock movement + lookup by code; stock adjust, refuse negative, movement history; update keeps stock, soft-delete hides product; low-stock report.

**bills.test.ts**: tax half-up rounding; bill totals, stock decrement, sale movement; repeated scans merge; insufficient stock rolls back the whole bill; input validation (empty, qty 0, discount > subtotal, unknown product); price snapshot unaffected by later price change; list and search.

**bills.test.ts (added)**: cash received stored and change derivable; insufficient cash rejected with no stock change; cash ignored for card payments; not recorded = 0.

**settings.test.ts (added)**: label code type default `barcode`, `qr` accepted, unknown rejected.

**purchases.test.ts**: 200 units for 10000 gives stock +200, cost 50.00, `purchase` movement; uneven totals round unit cost but keep exact line total; several products and merged repeated lines; validation (supplier, empty, qty, negative cost) and full rollback when one line is invalid; list/search/supplier suggestions; schema reaches version 2.

**settings.test.ts (added)**: printer settings saved; rejects receipt width other than 58/80 and label sizes outside 15-200 mm.

## E2E test cases (`e2e/app.spec.ts`)

1. White-label: set shop name, logo and tax in Settings; header shows name and logo.
2. Add a product; QR dialog shows an image labelled with the generated code.
3. Scan the code twice (typed + Enter), total = 220.00 with 10% tax, save; success message `INV-000001`; print was invoked once; stock drops 5 -> 3; bill appears in history.
4. Scanning past stock on hand is blocked with "Only 3 of Green Tea in stock".
5. Purchase 200 covers from ABC Traders for 10000: cost each shows 50.00, purchase `PUR-000001` saved, product stock becomes 200. (Settings test also selects 58 mm paper and a 50 mm label width.)
6. A purchase without a supplier name is rejected with a message.
7. Settings can switch label code to QR and the label dialog then shows a QR image.

Test 3 also checks cash received below total is refused, and 250 for a 220 bill shows change 30.00. Test 2 asserts the barcode SVG has a valid numeric `viewBox` (regression for the cropped-barcode bug).

`window.print` is replaced by a counter in E2E, so no real printing is exercised.

## Not tested (known gaps)

- Barcode/QR decodability by a real scanner or a decoder library (only inspected visually)
- Real printer output on the XPrinter (receipt and label layout, label size, copies per label). Print CSS (`@page` size) is not exercised by tests
- Real USB scanner hardware; QR codes decoded by a scanner
- Windows runtime and installer
- Packaged (production) app; E2E runs the built output via `electron .`
- Backup/restore, reports, licensing (not implemented)
- Performance with large catalogues (thousands of products, no pagination yet)
- Accessibility audit with assistive tech

## Failures encountered and fixed

| Date | Failure | Root cause | Fix |
|---|---|---|---|
| 2026-10-23 | E2E strict-mode locator error on `cell 'Green Tea'` | Locator also matched the "Remove Green Tea" cell | Test locator made `exact: true` (test bug) |
| 2026-10-23 | E2E print count was 0 right after checkout | Print fires after a 150 ms timer; test read too early | Test now polls (test bug) |
| 2026-10-23 | Visual check showed the barcode cropped on the right with no quiet zone | **Real app bug:** JsBarcode reports width as `"246px"`, producing an invalid `viewBox` that the browser ignored | Parse numbers before building the viewBox; E2E asserts a valid viewBox; re-rendered and re-inspected |
| 2026-10-23 | E2E purchase test: strict-mode locator matched both the name cell and the checkbox cell | Test locator made `exact: true` (test bug) |
| 2026-10-23 | E2E "stock limit" test failed intermittently (then every time) | **Real app bug:** (a) `setMsg` called inside a `setLines` updater (side effect in updater); (b) scan input was cleared only after the async lookup, so a quick second scan was erased | Cart moved to a ref-backed `updateLines`; scan input read from the DOM and cleared synchronously before the lookup. 8/8 stable runs afterwards |


## QA audit (v0.3.1)

Full matrix, results, defects and limitations: [QA_REPORT.md](QA_REPORT.md).
Latest actually-run results: `npm run lint` clean; `npm run typecheck` 0 errors; `npm test` 43 passed (6 files); `npm run test:e2e` 16 passed (3 more repeat runs 16/16); `npm audit` 0 vulnerabilities; `npm run build` OK.
New files: `tests/qa.test.ts`, `tests/perf.test.ts`, `e2e/qa.spec.ts` (runs real dialogs, only `window.print` is stubbed).
Not run: Firefox/WebKit (app is Electron-only), real XPrinter, real scanner, Windows.

## Day book (v0.5.0)

Actually run: `npm run lint` clean; `npm run typecheck` 0 errors; `npm test` 56 passed (8 files, incl. `tests/daybook.test.ts`: sales lines/profit/expenses, balance carry-forward, manual opening override and reset, credit not counted as received, input validation); `npm run test:e2e` 19 passed (new: day book sale, expense, opening balance, notes persisted); `npm audit` 0 vulnerabilities.
Not run: visual/screenshot check of the Day book page, real printer/scanner, Windows.

Dashboard (v0.5.1): lint clean, typecheck 0 errors, `npm run test:e2e` 20 passed (new dashboard test: tile value, chart present, top-product bar). Not run: visual check of chart appearance.

Dashboard redesign (v0.5.2): lint clean, typecheck 0 errors, npm test 57 passed (new dashboard test), npm run test:e2e 20 passed. Not run: visual check of the layout.

CSV export (v0.5.3): lint clean, typecheck 0 errors, npm test 61 passed (new tests/csv.test.ts), npm run test:e2e 23 passed (exports a day book and a daily report to a temp folder and reads the files back; the Save-as window is bypassed in tests via UBS_EXPORT_DIR). Not run: the real Save-as window, opening the files in actual Excel. Known: minorToInput (used by input boxes) mishandles negative amounts; not reachable from current inputs, left unchanged.

Label designer (v0.6.0): lint clean, typecheck 0 errors, npm test 68 passed (new tests/labels.test.ts: save/update/list, one default, delete fallback, duplicate names, bad sizes/items outside the label/unknown kinds/NaN, unknown properties dropped, standard layout and every new item kind pass the same validation), npm run test:e2e 24 passed (new: open designer, remove an item, add free text, drag by mouse with snapping, arrow-key nudge, typed value clamped inside the label, save, saved design pre-selected in Print labels, printed labels use the design: item removed, text present, `@page` 38mm 25mm), npm audit 0 vulnerabilities. Screenshot of the designer checked by eye (found and fixed a clipped price on the Standard layout).
Not run: printing on a real label printer or Windows, scanning a printed label, drag-resize handles (not built).
