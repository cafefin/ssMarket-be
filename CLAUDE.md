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
├── common/      cross-cutting filter, decorators, helpers
├── database/    TypeORM connection, health check, migrations/
├── redis/       Redis client provider and health check
└── modules/     one folder per domain: auth, users, health
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
3. Protect routes with `@UseGuards(JwtAuthGuard)` and read the caller with `@CurrentUser()`.
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

## Auth

- Sign-in is Google OAuth restricted to `ALLOWED_EMAIL_DOMAIN`. The check is in `AuthService.toAllowedProfile`.
- Access token: JWT, 15 minutes, cookie `access_token`.
- Refresh token: opaque, 7 days, cookie `refresh_token`, stored hashed in Redis and rotated on every use.
- The OAuth `state` value lives in the `oauth_state` cookie (`CookieStateStore`); there is no server-side session.

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

## Conventions

- TypeScript strict; no `any` without a comment explaining why.
- Conventional Commits (`feat:`, `fix:`, `chore:`, `test:`, `docs:`).
- Work on `feat/...`, `fix/...` or `chore/...` branches; `main` must stay green.
- Code, comments and commits in English.
