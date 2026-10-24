# QA report: full audit, testing and defect fixing (v0.3.1)

Date: 2026-10-23. Scope: the whole app as it exists. Environment: macOS dev machine, Electron 44 (Chromium), Node 22 (unit tests), isolated temp data folders and in-memory databases only. No production data was touched.

**Final status: PASS WITH LIMITATIONS** (see section 7). Everything that could be run here passed; physical printer, scanner, Windows and non-Chromium browsers were not testable.

## 1. Application inventory (from the code)

- **Stack:** Electron 44 + React 19 + TypeScript + Vite (electron-vite), SQLite via `node:sqlite` (experimental), Vitest, Playwright `_electron`. Desktop app, Windows target, local-only data. It is **not** a mobile or web app, so there is no browser URL routing, server, CORS/CSRF surface, or mobile layout.
- **Modules:** Billing (`pages/Billing.tsx`), Products & stock (`Products.tsx`), Purchases (`Purchases.tsx`), Bill history + reprint (`Bills.tsx`), Settings (`Settings.tsx`), Receipt + label printing (`components/Print.tsx`), barcode/QR (`BarcodeSVG.tsx`, `QRCodeSVG.tsx`).
- **Roles / auth / sessions:** none exist. Single local user, no login, no permissions. Reported as a gap, not invented.
- **Data model** (`src/main/db/database.ts`, schema v3): settings, products, stock_movements, bills, bill_items, purchases, purchase_items. Bill/purchase items snapshot name/code/price; products are soft-deleted.
- **Business rules:** integer minor units; single shop-wide exclusive tax in basis points, rounded half up (`bills.ts` `computeTax`); discount is one flat amount per bill, cannot exceed subtotal; whole-number quantities; stock cannot go negative; cash received optional, must be >= total when entered; bill numbers `INV-000123`; purchase unit cost = round(total / qty) and it overwrites the product cost.
- **Not present** (so not tested, listed as gaps): login/roles, returns/refunds, void/cancel bill, reports/dashboard, backup/restore, export, supplier payables, user management.

## 2. Test coverage matrix

| Area | Unit/integration | E2E (real Electron) | Visual | Gap |
|---|---|---|---|---|
| Auth / roles / sessions | n/a (not implemented) | n/a | n/a | Recommendation R1 |
| Navigation, direct nav | n/a | all 5 tabs exercised | screenshots 4 sizes | no routes/URLs exist |
| Products CRUD, codes, duplicates | yes | add, edit dialog, stock dialog | yes | none |
| Stock adjust, zero/negative/huge | yes | stock dialog +/-, refusal | | none |
| Billing totals, tax, discount, rounding | yes | totals, cash/change | yes | none |
| Double submit / failed sale / oversell | yes | double-click test | | true multi-process concurrency not applicable (single process) |
| Purchases | yes | 200 covers / 10000 | yes | purchase edit/void not implemented |
| Receipt content & layout | n/a | print stub + layout measurement | 80 and 58 mm, stress data | real printer |
| Labels (barcode / QR, sizes) | n/a | copy count, QR switch | 5 sizes | real printer, real scanner |
| Settings persistence/validation | yes | save, restart persistence | yes | no "reset to defaults" exists |
| Security (XSS, SQLi, IPC abuse, navigation) | yes | yes | | see section 7 |
| History/search/reprint | yes | reprint | yes | no pagination beyond 200 bills |
| Reports / backup / returns | not implemented | | | R2, R3 |

## 3. Test results (all actually executed)

| Category | Command | Result |
|---|---|---|
| Lint | `npm run lint` | clean |
| Typecheck | `npm run typecheck` | 0 errors |
| Unit + integration | `npm test` | **43 passed** (6 files: settings, products, bills, purchases, qa, perf) |
| E2E | `npm run test:e2e` | **16 passed** (`e2e/app.spec.ts` 7, `e2e/qa.spec.ts` 9); 3 further repeat runs of `npx playwright test`: 16/16 each |
| Security | included above + `npm audit` | 0 vulnerabilities (615 packages) |
| Performance | `npx vitest run tests/perf.test.ts --silent=false` | measured, see below |
| Responsive / visual | `scratchpad/ui.cjs` (not committed) | screenshots at 1440x900, 1280x800, 960x600, 390x800 for all 5 screens, inspected by eye |
| Print layout | `scratchpad/print.cjs` (not committed) | receipts 80/58 mm, labels 40x30, 25x15, 100x50 (barcode + QR), inspected by eye |
| Production build | `npm run build` | OK |
| Cross-browser | n/a | **Not run.** The app is an Electron (Chromium) desktop app; Firefox/WebKit cannot host it and are not installed. Chromium is the only engine that ships to users. |
| Real printer / scanner / Windows | | **Not run, unavailable. Unverified.** |

Performance (in-memory DB, so disk fsync cost is excluded): scan lookup by code 0.05 ms each; search across 20,000 products 10.7 ms; list 20,000 products 177 ms; create product 0.17 ms each; create bill (5 lines) 1.2 ms each; list latest 200 bills 19 ms. Bottleneck: Products page renders every matching row with no pagination or virtualisation, so a 20,000-product list would be slow to draw (not measured in the UI).

## 4. Defects found and fixed

| ID | Sev | Defect | Root cause / location | Fix | Regression test |
|---|---|---|---|---|---|
| D1 | **High** | "Stock" button and "Print labels" did nothing in the real app (an error was thrown) | `window.prompt()` is unsupported in Electron (confirmed: `prompt() is not supported`); `Products.tsx` | In-app quantity dialog | `e2e/qa.spec.ts` D1 x2 |
| D2 | **High** | Double-click on "Save & print bill" could create two bills and deduct stock twice | no in-flight guard in `Billing.tsx` `checkout` (same in `Purchases.tsx` `save`) | ref + state guard, button disabled while saving | D2 E2E (verified failing without the fix) |
| D3 | Medium | Any `window.open` URL went to `shell.openExternal`; the window could be navigated away | `src/main/index.ts` | http(s) only; `will-frame-navigate` blocks leaving the app page | D3 E2E (verified failing without the fix) |
| D4 | Medium | Settings save stored any extra keys sent over IPC, accepted non-text values, and was not atomic | `settings.ts` | key whitelist, type and length checks, transaction | `tests/qa.test.ts` |
| D5 | Low | Searching `%` or `_` matched everything | unescaped `LIKE` in products/bills/purchases | `likePattern()` + `ESCAPE` | `tests/qa.test.ts` |
| D6 | Medium | No upper bound on price/quantity/stock: huge values could exceed safe integers and corrupt totals | `products.ts`, `bills.ts`, `purchases.ts` | limits: price/cost 10,000,000.00, quantity 1,000,000, bill total < 1e15 minor units | `tests/qa.test.ts`, API-abuse E2E |
| D8 | Low | Server accepted any payment-method string | `bills.ts` | whitelist cash/card/mobile/credit | `tests/qa.test.ts` |
| D9 | Low | Stock could be adjusted on a removed product | `products.ts` `adjustStock` | refuse | `tests/qa.test.ts` |
| D10 | Low | Malformed bill/purchase lines relied on incidental errors | `bills.ts`, `purchases.ts` | explicit validation | `tests/qa.test.ts` |
| U1 | Medium | At the minimum window width (960 px) the New bill summary panel (total, cash, Save button) was cut off | grid `1fr` column could not shrink (`main.css`) | `minmax(0, 1fr)` + scroll container for the bill table | visual re-check (screenshots) |
| U2 | Low | Products table: code wrapped mid-code ("P-" / "000004"), row borders stopped short | `display:flex` on a table cell (`.actions`) | nowrap codes, normal cell | visual re-check |
| U3 | Low | Qty buttons stacked vertically in bill rows | nowrap missing | `.qtycell` nowrap | visual re-check |
| P1 | **High** | Receipt: an item name without spaces ran off the paper and pushed that line's **price off the receipt** | `.r-item-name` could not shrink or wrap | `overflow-wrap:anywhere`, price `flex:none` | `e2e/qa.spec.ts` print layout (verified failing without the fix) |
| P2 | Low | Label price wrapped to two lines when the code text was long | `.label-foot` | price nowrap, code text ellipsis | visual re-check |

D7 was reserved during triage and is not used. A suspected issue with updating to a duplicate code was checked and is already handled (raw UNIQUE message mapped to a friendly one), with unit coverage.

Checked and found **correct** (tests added): failed sale leaves stock/bills unchanged, historical bills survive product edit/removal, bill numbers unique over 100 sales, last unit cannot be oversold, SQL-injection strings are inert, hostile text in names/customer/shop name renders as text (no script execution), invalid payloads sent directly to the IPC bridge are rejected, data and settings persist across restart, reprint works.

## 5. UI/UX findings

Fixed: U1-U3, P1, P2 (above), plus D1 (a dead button). Not changed, suggestions only:
- At 960 px with a very large price the bill table scrolls sideways inside its panel (Total column hidden until scrolled). Consider a narrower sidebar below ~1100 px.
- Extreme labels (25x15 mm with a 9-million price) abbreviate the printed code text with "..."; the barcode/QR still carries the full code.
- No keyboard shortcut for Save; Escape closes the new quantity dialog only.
- No visible "saving" text while a bill saves (button just disables).
- Accessibility audit (contrast, focus order, screen reader) was only visually spot-checked, not measured with a tool.

## 6. Missing functionality (not added; no business rules invented)

Necessary / strongly recommended: **R2 backup & restore** (a shop's whole history is one file; data loss on disk failure), **R3 void/return bill** (a wrong bill cannot be undone; today only manual stock adjustment).
Optional: R1 login/roles (only if shops share the PC), reports, export, supplier payables ("credit" payment is recorded but nothing tracks money owed), bill pagination, product list paging.

## 7. Unresolved issues and risks

- **Unverified hardware:** XPrinter receipt and label output (margins, density, thin dashed lines), scanner decoding of the generated codes, and anything on real Windows (installer never run, icon is still the template icon).
- **Business decisions needed:** tax model (single exclusive rate), whether "credit" sales need customer/payables tracking, new numeric limits from D6 (are 10,000,000.00 per item and 1,000,000 units acceptable?), how returns should work.
- `node:sqlite` is experimental in Node/Electron; decide whether to keep it before release.
- Printing always uses the system print dialog; silent printing is not implemented.
- `window.confirm` (remove product) still uses the native dialog; it works in Electron but is not E2E tested.
- Real-disk write latency was not measured (in-memory DB used).

## 8. Final commands

```bash
npm install
npm run lint
npm run typecheck
npm test                         # unit + integration (+ perf measurement)
npm run test:e2e                 # builds, then runs both Playwright specs
npm run build                    # typecheck + production build
npm audit
npx vitest run tests/perf.test.ts --silent=false   # shows PERF timings
```
