# ssMarket Backend

API for ssMarket, an internal marketplace where company employees buy and sell
personal items. The web app lives in a separate repository, `ssMarket-fe`.

**Stack:** NestJS · TypeScript · PostgreSQL (TypeORM, full-text search) · Redis · Google OAuth · sharp · Vitest · Docker · GitHub Actions

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

## Testing

```bash
pnpm test        # unit
pnpm test:e2e    # integration, needs docker compose up
pnpm test:cov    # everything, fails under 80% coverage
```

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

## How sign-in works

1. The browser opens `/auth/google`; the API redirects to Google.
2. Google redirects back with a code. The API accepts the account only if the
   email is verified and belongs to `ALLOWED_EMAIL_DOMAIN`.
3. The API sets two `HttpOnly` cookies: a 15-minute JWT access token and a
   7-day refresh token that is stored hashed in Redis and rotated on every use.

## Architecture

Each domain module is split into controller → service → repository. See
[CLAUDE.md](./CLAUDE.md) for the layering rules and conventions.
