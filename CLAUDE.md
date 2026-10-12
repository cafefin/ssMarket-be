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
    ├── users/       accounts, roles, language and seller profile
    ├── banks/       static directory of banks that accept VietQR
    ├── categories/  categories, managed by admins
    ├── listings/    listings (one product each), combos, images, search, stock
    ├── campaigns/   pre-order rounds: shared terms and their products
    ├── orders/      orders, state rules, idempotency, round summary
    ├── cart/        server-side cart, checkout preview and checkout
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
`SUMMARY_TOO_LARGE` (422), `CATEGORY_EXISTS` (409), `CATEGORY_INACTIVE` (400),
`CART_FULL` (409), `CHECKOUT_CHANGED` (409), `INVALID_CAMPAIGN` (422),
`CAMPAIGN_ITEM_HAS_ORDERS` (409).
Pass structured data the frontend needs
(which items ran out, the id of an existing order) as the `details` argument.

## Listings

- A listing is **one product**: one unit, one unit price, its own combos.
  Its mode, `in_stock` or `preorder`, never changes. An in-stock product has
  `stock_quantity`. A pre-order product is an **item of a campaign** (see
  "Campaigns"): it has no stock limit (NULL) and no deadline, delivery date or
  payment flags of its own; the campaign holds them. `POST /listings` makes
  in-stock goods only. There are no options or variants.
- A listing is **open** when `status = 'open'` and, for a campaign item, its
  campaign is open too. That condition is evaluated in queries and in
  `isListingOpen` (which goes through `isCampaignOpen`); no background job
  flips a status. `paymentTermsOf` gives the payment methods that apply: the
  campaign's for an item, else the listing's own.
- Rules that depend only on the input live in `listing-rules.ts` (listings)
  and `campaign-rules.ts` (rounds) as pure functions. DTO classes check shape
  and types only.
- Money is integer VND. Quantities are `numeric(10,3)` and arrive from
  PostgreSQL as strings.
- Other people get 404, not 403, for a listing they may not see.
- A campaign item cannot be changed, published or closed through
  `/listings/:id` (409 `INVALID_LISTING_STATE`); use its round. `GET
  /users/me/listings` lists the seller's own goods only, not round items.
- A summary carries `unitPrice`, `unit`, `stockQuantity` (null for a
  pre-order), `hasCombos`, the seller's `handle` (email before @) and, for a
  campaign item, `campaign` (`ListingCampaignDto`: id, title, deadline,
  delivery date).
- `GET /listings?mode=in_stock` (the default) lists goods that can still be
  bought, newest first, and leaves out sold-out products
  (`stock_quantity = 0`). `mode=preorder` lists the items of open rounds,
  closing soonest first, with its own cursor kind. There is no `sort` parameter.
- `GET /listings?seller=<uuid>` limits the list to one seller.
- `condition` (`new` 100% … `worn` 70%, `CONDITION_PERCENT`) is required for
  in-stock goods outside perishable categories (`categories.is_perishable`)
  and refused elsewhere; `condition_percent` is stored for filtering.
- `GET /listings?minPrice&maxPrice` filters on the unit price;
  `minCondition` keeps second-hand goods at least that good.

## Campaigns

A campaign is a pre-order round (`campaigns`): a title, the shared terms and
its products, which are rows of `listings` with `campaign_id`.

- The campaign is the only source of the **order deadline, the delivery date
  and the accepted payment methods**. Items store none of them
  (`accepts_*` are NULL on an item). A round is open when its status is `open`
  and the deadline is ahead (`isCampaignOpen`); a closed round or one past its
  deadline takes no orders and no edits to orders.
- `category_id` (and the seller) is copied from the campaign onto its items on
  every save, so category filters and search keep working on `listings`.
- **`CampaignsRepository` is the only writer of item rows**: create and
  update save the campaign and all its items in one transaction (an item with
  an `id` is changed, one without is added, one left out is removed), and
  replace the items' combos. Nothing else inserts or updates a campaign item.
- Item status follows the round: `draft` while the round is a draft, `open`
  once it is published, and `closed` when the seller stops selling it
  (`selling: false`). Closing the round ends it without changing item status;
  the round decides. Only a draft round can be deleted.
- An item that any order line references is **stopped, not deleted**: leaving
  it out of an update answers 409 `CAMPAIGN_ITEM_HAS_ORDERS` (with the items);
  `selling: false` keeps it. A stopped item stays in orders and in the summary.
- Invalid input (bad title, dates or items, no payment method, a repeated item)
  answers 422 `INVALID_CAMPAIGN` with the list of `problems`.
- `POST /campaigns/:id/reopen` copies a finished round (closed, or past its
  deadline) into a new draft: the same terms, the items that were on sale
  (combos, and photos as separate files), dates moved forward by whole weeks,
  `reopened_from_id` set. It never changes the source round or its orders.
- Routes: `POST/GET /campaigns`, `GET /campaigns/mine`, `GET/PATCH/DELETE
  /campaigns/:id`, `POST /campaigns/:id/publish|close|reopen`. Every write
  bumps the listings cache version; the public round page is cached.
- Module direction is `orders → campaigns → listings`; never the reverse.

## Combos

- A product may have up to three combos: "N units for a set price"
  (`listing_combos`), each cheaper than buying N singly.
- `lineTotalWithCombos` (`listings/pricing.ts`, re-exported by
  `orders/order-math.ts`) charges the cheapest mix of combos and single
  units, by dynamic programming. Combos never add up across products or
  orders; that is a coupon, for later.
- An order line snapshots `combos` and `list_total` (retail) next to
  `line_total`, like the unit price.

## Categories

- Admins add, rename and hide categories through `/admin/categories`. There
  is no delete. The slug is made from the Vietnamese name once and never
  changes.
- A hidden category (`is_active = false`) is left out of `GET /categories`
  and refuses new listings with `CATEGORY_INACTIVE`; listings already in it
  stay visible and editable. Publishing also refuses a hidden category, which
  covers drafts written earlier and reopened rounds.
- Responses carry both `name` and `nameEn`; the frontend picks one. The API
  never reads `Accept-Language`, so caches are not split by language.
- Every category write bumps the listings cache version.

## Orders

- An order line is one product (`order_lines.listing_id`) with its title,
  unit, price and combos copied. `orders.campaign_id` is set only for
  pre-orders: **one order per buyer per round**, holding a line per product
  (up to 50); an in-stock order may hold several products of one seller.
  Order counts, seller filters and the listing summary go through the lines,
  and a listing summary shows only its listing's part of a mixed order.
- A buyer has at most one live (not cancelled) order per round
  (`UQ_orders_one_active_preorder`); a second checkout answers
  `ALREADY_ORDERED` with the id of the existing order, and the buyer edits
  that order instead. `GET /campaigns/:id/my-order` returns `{ orderId }`
  (null when none; 404 for a missing or draft round).
- Orders are created only by `POST /checkout` ("buy now" is a checkout of
  one product). `OrdersService.createMany` places every order of a checkout
  in one transaction, all or none.
- An order has two independent state axes. Payment: `unpaid` → `reported` →
  `paid`. Fulfilment: `pending` → `delivered` or `cancelled`. Delivering does
  not mark an order paid, because pay-on-delivery is often collected later.
  The rules are pure functions in `order-transitions.ts`; change them there.
- The server never trusts amounts from the client. Prices come from the
  listing, totals from `lineTotal`, which works in integers only (quantity in
  thousandths) and rounds half up.
- An order line snapshots the product's title, unit and price, and a QR order
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
- `POST /checkout` requires an `Idempotency-Key` header
  (`IdempotencyService`), so a double click creates one set of orders.
- Buyer and seller see an order; anyone else gets 404.
- After anything that changes stock or order counts, call
  `listings.invalidateCache()`.
- Editing a listing never changes existing orders: they hold their own copy
  of the price.

## Seller tools

- `GET /listings/:id/summary` is the table that replaces the seller's
  spreadsheet for in-stock goods: one row per order with its quantity. A
  campaign item has none (404); its round has one.
- `GET /campaigns/:id/summary` is the same for a round (`CampaignSummaryService`):
  one row per order, oldest first, with `quantities` aligned to `items`
  (the round's products on sale or that anyone ordered, in round order), and
  `itemTotals` per product. `?includeCancelled=true` adds cancelled orders as
  rows. Both summaries refuse more than 1000 orders with `SUMMARY_TOO_LARGE`.
- Totals come from SQL aggregates (`OrdersRepository.totalsForListing`,
  `totalsForCampaign`, `itemTotalsForCampaign`), never from adding up rows in
  code, and never include cancelled orders.
- `summary.csv` (`/listings/:id/` and `/campaigns/:id/`) is written in the
  caller's `users.locale` (`vi` or `en`); the labels live in `LABELS` in
  `summary-csv.ts`, shared with `campaign-summary-csv.ts`. The round's file has
  a quantity column per product.
- The CSV builders pass every cell through `cell`. Buyers control some of that
  text, so any cell starting with `=`, `+`, `-` or `@` gets a leading
  apostrophe. Keep that when adding columns.
- `POST /listings/:id/orders/bulk` and `POST /campaigns/:id/orders/bulk` run
  each order through the normal single-order method and report per order; one
  failure never stops the rest. The loop is `runBulk` (`bulk-orders.ts`); an
  order outside the listing or round is reported as `NOT_IN_LISTING` or
  `NOT_IN_CAMPAIGN`.
- `PATCH /orders/:id` lets a buyer replace the lines of a pre-order (up to 50,
  products of its round) while it is unpaid, pending and its round is open.
  Existing lines keep their snapshot price; a stopped product can be kept or
  lowered, never added or raised.
- `POST /campaigns/:id/reopen` (see "Campaigns") starts the next round from a
  finished one.
- `orderCount` on a listing is a database-computed virtual column.

## Cart and checkout

- `cart_lines` holds product and quantity per person (max 50, `CART_FULL`);
  no price. `PUT /cart/lines/:listingId` sets one line and `PUT /cart/lines`
  sets several in one request; both refuse more than the stock left
  (`OUT_OF_STOCK`, with `available`). `GET /cart` groups by seller with
  current prices, combos applied and a `problem` per line
  (`LISTING_NOT_OPEN`, `OUT_OF_STOCK`). The cart never reserves stock.
- `splitIntoOrders` (`cart/checkout-split.ts`) decides the orders, grouping
  by campaign: the products of one round share one order (key
  `campaign:<id>`); a seller's in-stock goods together when their listings
  share a payment method (`seller:<id>`), otherwise one order per listing
  (`listing:<id>`).
- `POST /checkout/preview` returns those orders with a `key`, prices and
  allowed payment methods. `POST /checkout` (`Idempotency-Key` required) sends
  the lines and one choice per key; a different split answers
  `CHECKOUT_CHANGED`. With `fromCart` the bought lines leave the cart in the
  same transaction.

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
- Browsing pages by keyset on `(published_at, id)` (`mode=in_stock`) and, for
  `mode=preorder`, by keyset on the round's `(order_deadline, campaign id,
  sort_order, id)`; ranked results page by offset. A campaign item matches on
  its own `search_text`; rounds are searched through `GET /campaigns`. Cursors are opaque
  and validated in `listing-cursor.ts`.

## Cache

- Read through `CacheService.getOrSet`. It never fails a request: when Redis
  is down it calls the loader.
- Keys embed a namespace version: `listings:v{n}:...`. **Every write to a
  listing, a campaign, their combos or images must call
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

## Roles and admin routes

- `users.role` is `user` or `admin`. It is set at every sign-in and every
  token refresh from `ADMIN_EMAILS` (`UsersService.upsertFromGoogle`,
  `UsersService.syncRole`), so the variable is the
  only source of truth; never write the role anywhere else.
- Protect an admin route with `@UseGuards(JwtAuthGuard, RolesGuard)` and
  `@Roles(UserRole.Admin)`. Admin routes live under `/admin/...`.
- The role is re-checked against `ADMIN_EMAILS` at every sign-in and every
  token refresh (`UsersService.syncRole`), so removing an email takes the role
  away within one access-token lifetime (15 minutes).

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
- Integration tests truncate `users` between tests, which does not reset
  `categories`. A test that changes categories restores them in `beforeEach`:
  `DELETE FROM categories WHERE id > 6`, then the six seeded names and
  `is_active = true`.

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
| `ADMIN_EMAILS` | Comma-separated emails that get the admin role at sign-in |
| `DEV_LOGIN_ENABLED` | `true` enables the development sign-in; development only |

## Conventions

- TypeScript strict; no `any` without a comment explaining why.
- Conventional Commits (`feat:`, `fix:`, `chore:`, `test:`, `docs:`).
- Work on `feat/...`, `fix/...` or `chore/...` branches; `production` must stay green.
- Code, comments and commits in English.
