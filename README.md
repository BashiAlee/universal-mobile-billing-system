# Universal Billing System

Offline desktop app for small shops: manage products and stock, generate a QR code for each product, and create bills by scanning those QR codes. Built to be sold to any shop: each customer's **shop name and logo** are set in the Settings screen, so one build serves everyone.

- **Target platform:** Windows (first release). Code is cross-platform Electron, but only Windows is a goal for now.
- **Data:** stored locally in a SQLite file per installation. No internet or server needed.
- **Status:** working version v0.7.0 (QA-audited, see [docs/QA_REPORT.md](docs/QA_REPORT.md)). See [docs/TASKS.md](docs/TASKS.md) for what is done and pending.

## Features (v0.1.0)

| Feature | State |
|---|---|
| Per-shop branding (name, logo, address, phone, currency, tax %, receipt footer) | Done, tested |
| Add / edit / remove products, auto-generated codes | Done, tested |
| Stock tracking with audit trail, low-stock highlight | Done, tested |
| Product labels (logo, name, barcode or QR, code, price), N copies, one label per page | Done. Layout checked on rendered output; **not yet on a real printer** |
| Label designer: design product labels (38 x 25 mm default), save named designs, print with one | Done, tested. **Not yet printed on a real label printer** |
| Billing by scanning QR (USB scanner) or typing name/code | Done, tested with simulated scanner input |
| Discount, tax, payment method, customer name | Done, tested |
| Receipt in the supplied style (dashed sections, TOTAL AMOUNT, CASH, CHANGE, THANK YOU, bill barcode), bill history, reprint | Done. Layout checked on rendered output; **not yet on a real printer** |
| Cash received and change on the billing screen | Done, tested |
| Parties (suppliers): balance owed, payments, ledger, part-payment on purchases, new products created from a purchase | Done, tested |
| Purchases from suppliers (e.g. 200 covers from ABC Traders for 10000): adds stock, sets cost price, history | Done, tested |
| Quick note: just record supplier, what you bought and the cost, without touching stock | Done, tested |
| Printer settings: receipt width 58/80 mm, label size, copies per label | Done (layout not yet verified on the XPrinter) |
| Export Day book and reports to CSV (Excel) | Done, tested |
| Dashboard with charts (sales, profit, payment methods, top products) | Done, tested |
| Day book: daily sales sheet, shop expenses, opening/remaining balance, notes | Done, tested |
| Reports: financial summary, daily and monthly sales, profit, by product, stock value | Done, tested |
| Backup/restore, licensing, Windows installer | Not started (see TASKS) |

## Requirements

- Node.js 22+ and npm (developed on Node 22.23, npm 10.9)
- Windows 10/11 for the intended target (development also works on macOS)

## Setup

```bash
npm install
npm run dev        # run the app with hot reload
```

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Start the app in development |
| `npm run typecheck` | TypeScript checks (main + renderer) |
| `npm run lint` | ESLint + Prettier |
| `npm test` | Unit tests (Vitest) |
| `npm run test:e2e` | Build, then run end-to-end tests that drive the real Electron app (Playwright) |
| `npm run build` | Typecheck and production build to `out/` |
| `npm run build:win` | Build the Windows installer (**not yet run/verified**, see TASKS) |

## Environment variables

| Name | Purpose | Default |
|---|---|---|
| `UBS_DATA_DIR` | Folder holding `billing.db`. Used by E2E tests to isolate data. | OS per-user app-data folder (Electron `userData`) |

No secrets or API keys are used by this project.

## Recording a purchase from a supplier

1. Make sure the product exists in **Products & stock** (opening stock 0 is fine for a new item).
2. Open **Purchases**, click **New purchase**, enter the supplier, add the product, then enter the quantity and the **total cost for that quantity** (e.g. 200 and 10000). The cost per item (50.00) is calculated and saved as the product's cost price.
   To only remember who you bought from (no stock change), click **Quick note (no stock)** instead: supplier, what you bought (e.g. 200 phone covers), total cost, optional date.
3. Save: stock increases by the quantity and the purchase appears in the history.

## Printer setup (XPrinter)

In **Settings > Printer** choose the receipt paper width (80 mm or 58 mm), the label size in mm, and whether labels carry a **barcode (Code 128, default)** or a **QR code**. Each label shows the shop logo, product name, code, text code and price. In the print dialog, pick your XPrinter. Receipt printers and label printers are different devices: use the receipt printer for bills and the label/barcode printer for QR labels. Layouts have **not yet been checked on your printer**; see docs/TASKS.md.

## Using a hardware QR scanner

USB scanners behave like a keyboard: they type the code and press Enter. On the **New bill** screen the scan box is auto-focused, so scan a product label to add it. Scanning the same label again increases the quantity.

## Giving the app to a customer

1. Install the app on their PC.
2. Open **Settings**, enter their shop name, address, phone, currency symbol, tax rate and upload their logo.
3. Add their products and print QR labels.

## Documentation

- [Architecture, structure, schema, IPC API, decisions](docs/ARCHITECTURE.md)
- [Task tracker](docs/TASKS.md)
- [Testing: commands, cases, results](docs/TESTING.md)
- [Development log](docs/DEVELOPMENT_LOG.md)
- [Changelog](docs/CHANGELOG.md)
