# ssMarket Backend

API for ssMarket, an internal marketplace where company employees buy and sell
personal items: things in stock, and pre-order rounds that close at a set time.

The web app lives in a separate repository,
[ssMarket-fe](https://github.com/cafefin/ssMarket-fe). The two share no code;
they are connected by environment variables and by this API's OpenAPI document.

## Tech stack

| Area | Choice |
|---|---|
| Runtime | Node.js 24, TypeScript 6, ES modules |
| Framework | NestJS 12 on Express |
| Database | PostgreSQL 17, TypeORM 1 with hand-written migrations |
| Search | PostgreSQL full-text search, matching Vietnamese with or without diacritics |
| Cache and sessions | Redis 7 (ioredis) |
| Sign-in | Google OAuth 2.0 (Passport), JWT access token, rotating refresh token |
| Validation and docs | class-validator, class-transformer, Swagger / OpenAPI |
| Images | sharp (re-encode to WebP, strip metadata) |
| Hardening | helmet, rate limiting with @nestjs/throttler |
| Tests | Vitest 4, Supertest; 80% coverage gate |
| Lint and format | oxlint (type-aware), Prettier |
| Delivery | Docker (multi-stage, non-root), GitHub Actions |

## Features

- Listings in two modes: in-stock items with stock, and pre-order rounds with
  an order deadline and a delivery date.
- Search that matches Vietnamese text typed with or without diacritics, built
  on PostgreSQL full-text search.
- Orders with stock reserved atomically (no overselling under concurrent
  buyers), idempotent order placement, and independent payment and delivery
  states.
- A VietQR code per order with the exact amount and the order code as the
  transfer content; payment is confirmed manually by the seller.
- A per-listing order summary for sellers with SQL-computed totals, bulk
  actions and a CSV export that is safe to open in Excel.
- Buyers can edit a pre-order until its deadline; sellers can reopen a
  finished round as a new draft.
- Image uploads re-encoded to WebP with metadata removed, stored on local disk
  (`UPLOAD_DIR`) behind a storage interface.
- Redis cache for public listing reads, invalidated by a namespace version.

## Getting started

Requirements: Node.js 24, pnpm, Docker.

```bash
cp .env.example .env        # then fill in the Google OAuth values
docker compose up -d        # Postgres on 5433, Redis on 6380
pnpm install
pnpm migration:run
pnpm dev
```

The API runs at http://localhost:4000 and Swagger UI at http://localhost:4000/docs.

In Google Cloud Console, the OAuth client's authorized redirect URI must be
`http://localhost:3000/api/auth/google/callback` (the frontend origin, because
the browser reaches this API through the frontend's `/api` proxy).

### Environment

Copy `.env.example` to `.env`. Never commit `.env`.

| Variable | Purpose |
|---|---|
| `NODE_ENV`, `PORT` | `development` and `4000` locally |
| `WEB_URL` | Origin of the frontend; used for redirects and the OAuth callback URL |
| `DATABASE_URL` | PostgreSQL connection string |
| `REDIS_URL` | Redis connection string |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Google OAuth client (Web application) |
| `ALLOWED_EMAIL_DOMAIN` | Only verified accounts on this domain may sign in |
| `JWT_ACCESS_SECRET` | Random string of at least 32 characters |
| `UPLOAD_DIR` | Directory for uploaded images |
| `DEV_LOGIN_ENABLED` | Local testing only; see "Development sign-in" |

## Scripts

```bash
pnpm dev                 # watch mode
pnpm build               # compile to dist/
pnpm start:prod          # run the compiled app
pnpm lint                # oxlint, type-aware
pnpm typecheck
pnpm format              # Prettier
pnpm migration:run       # build, then apply pending migrations
pnpm migration:revert    # build, then undo the last migration
```

## Testing

```bash
pnpm test        # unit tests (src/**/*.spec.ts), dependencies mocked
pnpm test:e2e    # integration tests (test/), needs docker compose up
pnpm test:cov    # everything, fails under 80% coverage
```

Integration tests boot the real app against the `ssmarket_test` database and
Redis database 1, so they never touch development data. Only Google is faked.

## API overview

All routes are documented in Swagger UI (`/docs`). In short:

| Area | Routes |
|---|---|
| Sign-in | `GET /auth/google`, `GET /auth/google/callback`, `POST /auth/refresh`, `POST /auth/logout` |
| People | `GET /users/me`, `PATCH /users/me` |
| Reference data | `GET /categories`, `GET /banks` |
| Listings | `GET /listings` (search, filters, cursor paging), `GET /listings/:id`, `POST /listings`, `PATCH /listings/:id`, `POST /listings/:id/publish`, `POST /listings/:id/close`, `POST /listings/:id/reopen`, `GET /users/me/listings` |
| Listing photos | `POST /listings/:listingId/images`, `DELETE /listings/:listingId/images/:imageId`, `GET /media/*` |
| Orders | `POST /orders`, `GET /orders`, `GET /orders/:id`, `PATCH /orders/:id`, `POST /orders/:id/report-payment`, `confirm-payment`, `reject-payment`, `deliver`, `cancel`, `GET /users/me/sales` |
| Seller tools | `GET /listings/:listingId/summary`, `GET /listings/:listingId/summary.csv`, `POST /listings/:listingId/orders/bulk` |
| Operations | `GET /health` |

## Architecture

```
src/
├── main.ts, app.module.ts, app.setup.ts
├── config/        environment validation
├── database/      data source and migrations
├── redis/, cache/ Redis client and the listing cache
├── common/        filters, guards, decorators shared by modules
└── modules/
    ├── auth/        Google sign-in, cookies, refresh rotation
    ├── users/       profile, delivery location, bank details
    ├── categories/, banks/   reference data
    ├── listings/    listings, items, photos, search
    ├── orders/      orders, stock, seller summary, CSV, bulk actions
    ├── payments/    VietQR payload
    ├── storage/     StorageService (local disk today) and /media
    ├── dev-login/   development-only sign-in
    └── health/
test/              integration tests and their helpers
```

Each domain module is split into controller → service → repository. See
[CLAUDE.md](./CLAUDE.md) for the layering rules and conventions.

### How sign-in works

1. The browser opens `/auth/google`; the API redirects to Google.
2. Google redirects back with a code. The API accepts the account only if the
   email is verified and belongs to `ALLOWED_EMAIL_DOMAIN`.
3. The API sets two `HttpOnly` cookies: a 15-minute JWT access token and a
   7-day refresh token that is stored hashed in Redis and rotated on every use.

### Development sign-in

`GET /auth/dev-login?as=<name>` signs in as a made-up person without Google, so
one developer can act as buyer and seller in two browser windows. It exists
only when `NODE_ENV=development` and `DEV_LOGIN_ENABLED=true`; elsewhere the
route is a 404, and the app refuses to start with the flag set in production.

## Docker

```bash
docker build -t ssmarket-be .
docker run --env-file .env -p 4000:4000 -v ssmarket_uploads:/app/uploads ssmarket-be
```

The image is a multi-stage build on `node:24-alpine` and runs as the `node`
user. Mount a volume at `/app/uploads` to keep uploaded images.

## Continuous integration

GitHub Actions runs on every pull request and on pushes to `production`:
install, lint, typecheck, tests with the coverage gate (against Postgres and
Redis service containers), build, and a Docker image build.

## Branches

- `production` is the default branch and must stay green.
- Work happens on `feat/...`, `fix/...` or `chore/...` branches and reaches
  `production` through a pull request. Commits follow Conventional Commits.

## Roadmap

| Phase | Scope | Status |
|---|---|---|
| 1. Foundation | Google sign-in, tests, CI, Docker | Done |
| 2a. Listings | Seller profile, listings with photos in two modes, search, Redis cache | Done |
| 2b. Orders | Orders, stock, VietQR payment codes, payment confirmation | Done |
| 2c. Seller tools | Summary table and CSV, editing pre-orders, reopening a round | Done |
| 3. Event-driven | RabbitMQ, background worker, notifications | Planned |
| 4. AI | Embeddings and semantic search (pgvector), shopping assistant | Planned |
| 5. Operations | Nginx reverse proxy, Prometheus and Grafana, VPS deployment | Planned |

## Notes

- This is an ES module project: relative imports end in `.js` even though the
  files are `.ts`.
- Local Postgres and Redis use host ports 5433 and 6380 so they can run next
  to other projects that use the default ports.
- The Postgres image is `pgvector/pgvector:pg17`; the extension is there for
  phase 4 and is not used yet.
- Payment is not automated: the buyer transfers with the VietQR code and the
  seller confirms by hand.
- User-facing text is Vietnamese; code, comments and commits are English.
