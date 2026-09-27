# Backend — REST API

Node.js + Express 5 + PostgreSQL (Knex). Serves `/api/v1`.

## Setup

```bash
cd backend
npm install
cp .env.example .env        # then edit DB_* and JWT_ACCESS_SECRET
npm run migrate             # create tables
npm run seed                # roles, permissions, GST rates, admin user (+ demo data outside production)
npm run dev                 # http://localhost:5000/api/v1/health
```

Create the two databases first (`jcb_inventory` and `jcb_inventory_test`). The test database is wiped on every test run.

### Seeded accounts (development)

| Username    | Password                                    | Role           |
| ----------- | ------------------------------------------- | -------------- |
| `admin`     | `SEED_ADMIN_PASSWORD` (default `Admin@123`) | Admin          |
| `warehouse` | `Password@123`                              | Warehouse User |
| `salesman`  | `Password@123`                              | Salesman       |

Demo users, products and customers are **not** created when `NODE_ENV=production`.

## Scripts

| Script                                 | Purpose                                                         |
| -------------------------------------- | --------------------------------------------------------------- |
| `npm run dev`                          | Start with file watching                                        |
| `npm start`                            | Start (production)                                              |
| `npm run migrate` / `migrate:rollback` | Apply / roll back all migrations                                |
| `npm run seed`                         | Seed reference data (idempotent) and demo data (non-production) |
| `npm run db:reset`                     | Rollback + migrate + seed (development only)                    |
| `npm test`                             | Unit + integration tests (real PostgreSQL)                      |
| `npm run lint` / `format`              | ESLint / Prettier                                               |

## Environment variables

See [.env.example](.env.example). Invalid or missing values stop the server at boot with a clear message.
Key ones: `DB_*`, `JWT_ACCESS_SECRET` (≥ 32 chars, must be changed in production), `CORS_ORIGINS`,
`APP_TIMEZONE` (what "today" means, default `Asia/Kolkata`), `COOKIE_SECURE`, `TRUST_PROXY`.

## Architecture

```
src/
├── config/        env (zod-validated), database (knex)
├── constants/     permissions, transaction types, master data, audit actions
├── middleware/    auth (JWT), role (requirePermission), validate (zod), upload, errorHandler
├── routes/        one router per module, mounted in routes/index.js
├── controllers/   thin HTTP layer
├── services/      business rules and transactions
├── repositories/  SQL only (knex), accept an optional transaction
├── validators/    zod request schemas
├── utils/         gstCalculator, numberToWords, pagination, tokens, ApiError, ...
├── pdf/           invoice PDF (pdfmake)
├── migrations/    schema
└── seeders/       reference + demo data
```

Layering: **route → controller → service → repository**. Controllers never query the database; repositories contain no business rules.

### Key design decisions

- **One stock engine.** `inventoryService.applyMovement()` is the only code that changes stock. Stock IN/OUT, adjustments, opening stock and invoice finalize/cancel all use it. It locks the stock row (`SELECT … FOR UPDATE`), rejects negative stock, writes the ledger row with previous/new balance, updates the stock and writes the audit entry in one transaction. A `CHECK (quantity >= 0)` constraint is the final safety net.
- **Immutable ledger.** A database trigger rejects `UPDATE`/`DELETE` on `inventory_transactions`; corrections are new entries.
- **Money** is `NUMERIC` in PostgreSQL and `decimal.js` in code; the server always recalculates invoice totals.
- **GST**: company state = place of supply → CGST + SGST (half each), otherwise IGST. Rates live in the `gst_rates` table.
- **Invoices**: `DRAFT` (editable, no stock impact) → `FINAL` (gap-free number per financial year e.g. `INV/2026-27/0001`, stock deducted, customer/company details snapshotted) → `CANCELLED` (stock returned, number kept).
- **Auth**: 15-minute JWT access token in memory + rotating refresh token in an httpOnly cookie (stored hashed; reuse revokes all sessions). Users are re-read on every request, so deactivation and permission changes apply immediately.
- **Permissions** are data (`module.action` codes), not role names. The Admin role always holds all permissions and cannot be deleted; the last active admin cannot be deactivated.
- **Multi-warehouse ready**: `warehouses` table with a default warehouse; `warehouse_id` on stock, ledger, invoices and audit logs.

## API overview (`/api/v1`)

| Area                | Endpoints                                                                                                                         |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Auth                | `POST /auth/login`, `POST /auth/refresh`, `POST /auth/logout`, `GET /auth/me`, `PATCH /auth/change-password`                      |
| Users & roles       | `/users`, `/roles`, `GET /roles/permissions`                                                                                      |
| Masters             | `/categories`, `/brands`, `/units`, `/gst-rates`, `/adjustment-codes`                                                             |
| Products            | `/products`, `GET /products/search?q=`                                                                                            |
| Inventory           | `GET /inventory`, `GET /inventory/ledger`, `POST /inventory/stock-in`, `POST /inventory/stock-out`, `POST /inventory/adjustments` |
| Customers           | `/customers`                                                                                                                      |
| Invoices            | `/invoices`, `POST /invoices/:id/finalize`, `POST /invoices/:id/cancel`, `GET /invoices/:id/pdf`                                  |
| Settings            | `GET/PUT /settings/company`, `POST/DELETE /settings/company/logo`, `GET /settings/states`                                         |
| Dashboard & reports | `GET /dashboard/summary`, `GET /dashboard/movement?range=daily                                                                    | weekly | monthly`, `GET /reports/stock-valuation`, `GET /reports/movement?from&to` |
| Audit               | `GET /audit-logs`                                                                                                                 |
| Health              | `GET /health`                                                                                                                     |

Responses: `{ success: true, data, meta? }` or `{ success: false, error: { code, message, details? } }`.
Lists accept `page`, `limit` (max 100), `search`, `sortBy`, `sortOrder` plus module filters.

## Tests

```bash
npm test
```

Covers login/refresh/logout and token reuse, permission checks, Stock IN/OUT, negative-stock prevention, concurrent stock-out (no overselling), adjustments, ledger immutability, GST calculation, invoice totals and lifecycle, customers, settings, dashboard, reports and audit logging.
