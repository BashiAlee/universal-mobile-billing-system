# Architecture

## Overview

Electron app with three layers. The renderer (React UI) never touches the database or Node; it calls a small explicit API exposed by the preload script, which forwards to IPC handlers in the main process, which call plain service functions over SQLite.

```
Renderer (React, sandboxed)  --window.api-->  Preload (contextBridge)  --IPC invoke-->  Main: ipc.ts  -->  services/*  -->  SQLite file
```

## Tech stack

| Part | Choice |
|---|---|
| Shell | Electron 44 (electron-vite build tooling) |
| UI | React 19 + TypeScript |
| Database | SQLite via Node's built-in `node:sqlite` (`DatabaseSync`) |
| Codes | `jsbarcode` (Code 128) and `qrcode` (QR), both rendered as inline SVG |
| Unit tests | Vitest |
| E2E tests | Playwright (Electron driver) |

## Folder structure

```
src/
  main/            Electron main process
    index.ts         window creation, opens DB, registers IPC
    ipc.ts           IPC handlers (each returns Result<T>)
    db/database.ts   open DB, versioned migrations, transaction helper
    services/        business logic (pure functions taking a db)
      settings.ts      shop branding/config
      products.ts      products + stock + audit trail
      bills.ts         bill creation, tax, history
      purchases.ts     supplier purchases: add stock, set cost, history
  preload/         contextBridge API (index.ts) and its types (index.d.ts)
  shared/types.ts  types used by all three layers
  renderer/src/    React UI
    pages/           Billing, Products, Purchases, Bills, Settings
    components/      Print (receipt + labels), BarcodeSVG, QRCodeSVG, ProductCode
    lib/             money helpers, settings context
tests/             unit tests (Vitest)
e2e/               end-to-end tests (Playwright)
docs/              project documentation
```

## Database schema (schema version 6, tracked with `PRAGMA user_version`)

| Table | Columns |
|---|---|
| `settings` | `key` PK, `value` |
| `products` | `id` PK, `code` UNIQUE, `name`, `price_minor`, `cost_minor`, `stock_qty`, `low_stock_threshold`, `active`, `created_at`, `updated_at` |
| `stock_movements` | `id` PK, `product_id` FK, `delta`, `reason` (`initial`/`purchase`/`adjustment`/`sale`/`return`), `ref`, `created_at` |
| `bills` | `id` PK, `bill_no` UNIQUE, `created_at`, `subtotal_minor`, `discount_minor`, `tax_minor`, `total_minor`, `payment_method`, `customer_name`, `tendered_minor` (cash received, 0 if not recorded) |
| `bill_items` | `id` PK, `bill_id` FK, `product_id` FK, `code`, `name`, `unit_price_minor`, `qty`, `line_total_minor`, `unit_cost_minor` (cost at time of sale, v4) |

| `purchases` | `id` PK, `purchase_no` UNIQUE, `created_at`, `supplier_name`, `party_id` FK (v7), `note`, `total_minor`, `paid_minor` (paid at purchase time, v7) |
| `purchase_items` | `id` PK, `purchase_id` FK, `product_id` FK, `code`, `name`, `qty`, `unit_cost_minor`, `line_total_minor` |
| `expenses` | `id` PK, `day` (YYYY-MM-DD), `title`, `amount_minor`, `created_at` (v5) |
| `day_book` | `day` PK, `opening_minor` (NULL = carry forward), `notes` (v5) |
| `parties` | `id` PK, `name` UNIQUE (nocase), `phone`, `address`, `notes`, `opening_minor` (owed before the app; negative = they owe us), `created_at` (v7). Balance is never stored: opening + sum(total - paid) - sum(payments) |
| `party_payments` | `id` PK, `party_id` FK, `amount_minor` > 0, `day`, `note`, `created_at` (v7) |
| `label_designs` | `id` PK, `name` UNIQUE (nocase), `width_mm`, `height_mm`, `code_type`, `elements` (JSON list of boxes in mm), `is_default`, `created_at` (v6) |

Settings keys: `shopName`, `address`, `phone`, `currencySymbol`, `taxRateBp`, `logoDataUrl`, `receiptFooter`, `receiptWidthMm` (58/80), `labelWidthMm`, `labelHeightMm`, `labelCodeType` (`barcode` | `qr`).

Bill and purchase items store a **snapshot** of name/code/price, so later product edits never change past bills. Products are soft-deleted (`active = 0`) to keep history valid.

Migrations live in `src/main/db/database.ts`. Never edit a shipped migration; append a new one.

## IPC API (renderer -> main)

Every call returns `{ ok: true, data }` or `{ ok: false, error }`. Handlers never throw to the UI.

| Channel | Arguments | Returns |
|---|---|---|
| `settings:get` | none | `ShopSettings` |
| `settings:save` | `ShopSettings` | `ShopSettings` |
| `products:list` | `search?`, `includeInactive?` | `Product[]` |
| `products:byCode` | `code` | `Product \| null` |
| `products:create` | `ProductInput` | `Product` |
| `products:update` | `id`, `ProductInput` (no stock) | `Product` |
| `products:deactivate` | `id` | void |
| `products:adjustStock` | `id`, `delta`, `reason`, `ref?` | `Product` |
| `products:lowStock` | none | `Product[]` |
| `purchases:create` | `PurchaseInput` | `Purchase` |
| `purchases:list` | `search?` | `Purchase[]` |
| `purchases:suppliers` | none | `string[]` |
| `parties:list` | search? | `Party[]` (with totals and balance) |
| `parties:save` | `PartyInput` (id = update) | `Party` |
| `parties:delete` | `id` | void (only without history) |
| `parties:ledger` | `id` | `PartyLedger` |
| `parties:pay` | `PartyPaymentInput` | `Party` |
| `parties:deletePayment` | `id` | void |
| `labels:list` | none | `LabelDesign[]` |
| `labels:save` | `LabelDesignInput` (id = update) | `LabelDesign` |
| `labels:delete` | `id` | void |
| `labels:setDefault` | `id` | void |
| `daybook:get/save/addExpense/deleteExpense`, `dashboard:get`, `file:saveCsv` | see `services/daybook.ts`, `dashboard.ts`, `exportFile.ts` | |
| `bills:create` | `BillInput` | `Bill` |
| `bills:list` | `search?` | `Bill[]` |
| `bills:get` | `id` | `Bill \| null` |

Types are in `src/shared/types.ts`.

## Business rules

- **Money** is stored as integer minor units (2 decimals, e.g. 1250 = 12.50). No floating point.
- **Tax:** one shop-wide rate in basis points (1800 = 18%), added on top of (subtotal - discount), rounded half up.
- **Stock:** quantities are whole numbers. A sale that exceeds stock is rejected and the whole bill rolls back.
- **Purchase:** the user enters the **total cost for a line** (e.g. 200 units for 10000). Unit cost = round(total / qty) and becomes the product's cost price (latest purchase wins, no averaging). Line totals are stored exactly, so rounding never changes what was paid. Stock increases atomically with reason `purchase`. Supplier is free text (remembered for suggestions); purchases cannot yet be edited or voided.
- **Cash and change:** `tenderedMinor` is stored only for cash payments and must be at least the bill total when given. The receipt prints CASH and CHANGE (= cash - total) when it is recorded, otherwise "PAID BY <method>".
- **Codes:** product labels encode the product code (`P-000123`) as Code 128 barcode (default) or QR; the receipt footer carries a Code 128 barcode of the bill number (`INV-000123`). Both render as SVG, stretched to the printed size in mm.
- **Printing:** receipt and label print layouts are driven by settings (`@page` size injected per print job). Printer is chosen in the system print dialog.
- **Product code** (what the QR encodes): auto `P-000123`, or any unique text the user supplies.
- **Bill number:** `INV-000123`, derived from the bill's row id.
- **Branding** is stored in the `settings` table; the logo is a validated base64 data URL (png/jpeg/webp/svg, under ~1 MB).

## Security notes

- Renderer runs with `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`; only `window.api` is exposed.
- Content-Security-Policy in `index.html` restricts scripts to the app itself; images allowed from `self` and `data:` (logo).
- All SQL uses parameterised statements.
- Logo input is validated by type and size on both the UI and the service.
- No credentials or secrets exist in the project.

## Key decisions

| # | Decision | Reason | Trade-off |
|---|---|---|---|
| D1 | Electron + React + TypeScript | Chosen by the user; fastest route to a polished, sellable Windows app | Larger installer than Tauri |
| D2 | Local-only SQLite | Chosen by the user; no hosting cost, works offline | No multi-device sync yet |
| D3 | `node:sqlite` instead of `better-sqlite3` | No native-module rebuild per Electron version; same code runs in Vitest and Electron (verified on Node 22.23 and Electron's Node 24.22) | Marked "experimental" by Node; DB access is isolated in `db/` + services, so it can be swapped. Revisit before release (see TASKS) |
| D4 | Money as integer minor units, 2 decimals fixed | Avoids rounding errors | Currencies with 0 or 3 decimals not supported |
| D5 | Branding in DB, not in the build | One installer for all customers | None significant |
| D7 | Purchase entry takes line total, not unit price | Matches how shopkeepers think ("200 for 10000"); avoids rounding drift | Cost price is rounded to the minor unit |
| D8 | Barcode (Code 128) is the default label code; QR kept as an option | User's printer is a barcode printer and labels must show a barcode; Code 128 is readable by every scanner | Two code paths to maintain |
| D6 | Cart held in a ref + state in Billing page | Rapid scanner input must never see a stale cart (found by a flaky E2E test, see log) | Slightly more code |
