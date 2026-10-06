# ssMarket Backend

NestJS API for ssMarket, an internal marketplace where company employees buy
and sell personal items. The frontend lives in a separate repository
(`ssMarket-fe`) and reaches this API through its own `/api/*` proxy, so every
URL the browser sees is on the frontend origin.

## Commands

```bash
docker compose up -d      # Postgres (host port 5433) and Redis (host port 6380)
pnpm dev                  # API on http://localhost:4000, Swagger at /docs
pnpm test                 # unit tests
pnpm test:e2e             # integration tests (needs docker compose up)
pnpm test:cov             # all tests with the 80% coverage gate
pnpm lint && pnpm typecheck
pnpm migration:run        # build, then apply migrations to DATABASE_URL
```

## Structure

```
src/
├── config/      environment validation (the app refuses to start if invalid)
├── common/      cross-cutting filter, guards, decorators, errors, text helpers
├── cache/       CacheService: fail-open cache-aside with versioned namespaces
├── database/    TypeORM connection, health check, migrations/
├── redis/       Redis client provider and health check
└── modules/
    ├── auth/        Google sign-in, tokens, guards
    ├── users/       accounts and seller profile (delivery location, bank)
    ├── banks/       static directory of banks that accept VietQR
    ├── categories/  reference data, seeded by migration
    ├── listings/    listings, items, images, search, stock
    ├── orders/      orders, state rules, idempotency
    ├── payments/    VietQR payload builder
    ├── dev-login/   development-only sign-in
    ├── storage/     StorageService (local disk today) and /media
    └── health/
test/            integration tests (*.e2e-spec.ts) and their helpers
```

## This is an ES module project

- `package.json` has `"type": "module"`. Relative imports must end in `.js`
  (`import { User } from './user.entity.js'`), even though the file is `.ts`.
- Use `import type` for anything used only as a type. With `isolatedModules`
  and decorator metadata, a type-only import written as a value import in a
  decorated constructor or method signature fails to compile.
- Tests run on Vitest with globals (`describe`, `it`, `expect`, `vi`). Linting
  is oxlint.

## Layering rules

- **Controller**: parses the request, calls a service, shapes the response. No business logic.
- **Service**: business logic. Never imports `typeorm`, never touches `Request` or `Response`.
- **Repository**: the only place that uses TypeORM. Returns entities or `null`.
- A module uses another module only through that module's exported service.

## Adding a module

1. Create `src/modules/<name>/` with `<name>.entity.ts`, `<name>.repository.ts`, `<name>.service.ts`, `<name>.controller.ts`, `dto/`, `<name>.module.ts`.
2. Register the module in `src/app.module.ts`.
3. Protect routes with `@UseGuards(JwtAuthGuard)` and read the caller with `@CurrentUser()`. Rate-limit writes with `UserThrottlerGuard` after it.
4. Annotate every response DTO with `@ApiProperty` and every route with its `@Api*Response`; the frontend generates its types from `/docs-json`.

## Database changes

- `synchronize` is off. Every schema change is a migration in `src/database/migrations/`.
- Name the file `<unix-ms>-<kebab-description>.ts`, then add the class to `src/database/migrations/index.ts`.
- The TypeORM CLI loads the compiled data source from `dist/`, which is why `pnpm migration:run` builds first.
- Add an index for every column used in a `WHERE`, `JOIN` or `ORDER BY` of a list query.

## Errors

Throw NestJS HTTP exceptions (`NotFoundException`, `ConflictException`, ...).
`AllExceptionsFilter` turns everything into
`{ statusCode, code, message, timestamp, path }`. Never build error responses
by hand in a controller.

Use `DomainException(status, code, message)` when the frontend must react to a
specific case. Codes in use: `BANK_PROFILE_REQUIRED` (422), `INVALID_IMAGE`
(422), `TOO_MANY_IMAGES` (409), `INVALID_LISTING_STATE` (409), `OUT_OF_STOCK`
(409), `LISTING_NOT_OPEN` (409), `ALREADY_ORDERED` (409),
`INVALID_ORDER_STATE` (409), `REQUEST_IN_PROGRESS` (409), `OWN_LISTING` (422),
`PAYMENT_METHOD_NOT_ACCEPTED` (422), `INVALID_QUANTITY` (422),
`IDEMPOTENCY_KEY_REQUIRED` (400), `ORDER_NOT_EDITABLE` (409),
`SUMMARY_TOO_LARGE` (422). Pass structured data the frontend needs
(which items ran out, the id of an existing order) as the `details` argument.

## Listings

- A listing has a mode, `in_stock` or `preorder`, that never changes. In-stock
  items have stock; pre-order listings have an order deadline and a delivery
  date and unlimited items.
- A listing is **open** when `status = 'open'` and its deadline, if any, is in
  the future. That condition is evaluated in queries and in `isListingOpen`;
  no background job flips a status.
- Rules that depend only on the input live in `listing-rules.ts` as pure
  functions. DTO classes check shape and types only.
- Money is integer VND. Quantities are `numeric(10,3)` and arrive from
  PostgreSQL as strings.
- Other people get 404, not 403, for a listing they may not see.

## Orders

- An order has two independent state axes. Payment: `unpaid` → `reported` →
  `paid`. Fulfilment: `pending` → `delivered` or `cancelled`. Delivering does
  not mark an order paid, because pay-on-delivery is often collected later.
  The rules are pure functions in `order-transitions.ts`; change them there.
- The server never trusts amounts from the client. Prices come from the
  listing, totals from `lineTotal`, which works in integers only (quantity in
  thousandths) and rounds half up.
- An order line snapshots the item's name, unit and price, and a QR order
  snapshots the seller's bank details. Never read those from the listing or
  the profile when showing an existing order.
- **Stock changes only through `ListingsService.reserveStock` /
  `releaseStock`, inside the order's transaction.** Each reservation is one
  `UPDATE ... WHERE stock_quantity >= :q`, with rows taken in id order, so
  concurrent buyers cannot oversell or deadlock. Never read stock, compare in
  code, then write.
- State changes load the order with `findForUpdate` (row lock) inside
  `TransactionRunner.run`. Services receive the transaction as the opaque
  type `Tx` and pass it to repositories.
- `POST /orders` requires an `Idempotency-Key` header (`IdempotencyService`),
  so a double click creates one order.
- Buyer and seller see an order; anyone else gets 404.
- After anything that changes stock or order counts, call
  `listings.invalidateCache()`.
- Editing a listing matches items by id. An item that people have ordered is
  never deleted, only set `is_active = false`.

## Seller tools

- `GET /listings/:id/summary` is the table that replaces the seller's
  spreadsheet: one row per order, one column per item. Totals come from SQL
  aggregates in `OrdersRepository.totalsForListing`, never from adding up rows
  in code, and never include cancelled orders.
- `summary.csv` is built by `buildSummaryCsv`. Buyers control some of that
  text, so any cell starting with `=`, `+`, `-` or `@` gets a leading
  apostrophe. Keep that when adding columns.
- `POST /listings/:id/orders/bulk` runs each order through the normal
  single-order method and reports per order; one failure never stops the rest.
- `PATCH /orders/:id` lets a buyer edit a pre-order while it is unpaid,
  pending and its listing is open. Lines the order already had keep their
  snapshot price; added items use the current price.
- `POST /listings/:id/reopen` copies a finished pre-order round into a new
  draft (items, and image files as separate copies) with `reopened_from_id`
  set. It never changes the source listing or its orders.
- `orderCount` on a listing is a database-computed virtual column.

## Payments

`buildVietQrPayload` builds the text of a VietQR code for one order (bank,
account, exact amount, order code as content). Its output was checked to be
identical to the public VietQR generator's. Nothing is sent to a bank or a
payment provider: the seller confirms payment by hand after checking their
statement for the order code.

## Search

- `normalizeForSearch` (strip Vietnamese diacritics, lower-case) is applied to
  the stored `search_text` and to every user query. Never compare raw text.
- `toTsQuery` is the only way a user query reaches `to_tsquery`. It keeps
  letters and digits only, so search operators cannot be injected.
- Browsing pages by keyset on `(published_at, id)`; ranked results page by
  offset. Cursors are opaque and validated in `listing-cursor.ts`.

## Cache

- Read through `CacheService.getOrSet`. It never fails a request: when Redis
  is down it calls the loader.
- Keys embed a namespace version: `listings:v{n}:...`. **Every write to a
  listing, its items or its images must call
  `cache.bumpVersion(LISTINGS_CACHE_NAMESPACE)`.**
- Cache public data only. Drafts, closed listings and per-user lists are read
  from the database.

## Uploads

- Images are re-encoded to WebP by `processListingImage`, which reads the
  format from the bytes and drops EXIF. Never store an upload as received.
- Files go through `StorageService`; do not use `fs` elsewhere. Storage keys
  must match the allowlist in `local-storage.service.ts`.
- `/media/*` requires a session.

## Auth

- Sign-in is Google OAuth restricted to `ALLOWED_EMAIL_DOMAIN`. The check is in `AuthService.toAllowedProfile`.
- Access token: JWT, 15 minutes, cookie `access_token`.
- Refresh token: opaque, 7 days, cookie `refresh_token`, stored hashed in Redis and rotated on every use.
- The OAuth `state` value lives in the `oauth_state` cookie (`CookieStateStore`); there is no server-side session.

## Development sign-in

`GET /auth/dev-login?as=<name>` signs in as a made-up person
(`<name>@dev.invalid`) without Google, so one developer can act as buyer and
seller in two browser windows. Through the frontend it is
`http://localhost:3000/api/auth/dev-login?as=buyer`.

- It exists only when `NODE_ENV=development` **and** `DEV_LOGIN_ENABLED=true`.
  The module is registered conditionally, so elsewhere the route is a 404.
- The app refuses to start when `DEV_LOGIN_ENABLED=true` in production.
- Never widen these conditions, and never add another way to obtain a session
  without Google. Backend tests do not use this route; the frontend's
  Playwright suite does, against its own throwaway database.

## Testing

- Write the test first. Unit tests sit next to the code as `*.spec.ts` and mock dependencies.
- Integration tests in `test/` boot the real app against the `ssmarket_test` database and Redis database 1; only Google is faked. `test/setup-env.ts` forces those connections, so tests never touch development data.
- Coverage must stay at or above 80% for lines, branches, functions and statements. Add tests rather than exclusions.

## Environment

Copy `.env.example` to `.env`. Never commit `.env`.

| Variable | Purpose |
|---|---|
| `PORT` | HTTP port (4000) |
| `WEB_URL` | Frontend origin; used for redirects and the OAuth callback URL |
| `DATABASE_URL`, `REDIS_URL` | Connections |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Google OAuth client |
| `ALLOWED_EMAIL_DOMAIN` | Only this email domain may sign in |
| `JWT_ACCESS_SECRET` | At least 32 characters |
| `UPLOAD_DIR` | Directory for uploaded images (default `./uploads`) |
| `DEV_LOGIN_ENABLED` | `true` enables the development sign-in; development only |

## Conventions

- TypeScript strict; no `any` without a comment explaining why.
- Conventional Commits (`feat:`, `fix:`, `chore:`, `test:`, `docs:`).
- Work on `feat/...`, `fix/...` or `chore/...` branches; `main` must stay green.
- Code, comments and commits in English.
