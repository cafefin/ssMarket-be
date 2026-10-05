# ssMarket Backend

API for ssMarket, an internal marketplace where company employees buy and sell
personal items. The web app lives in a separate repository, `ssMarket-fe`.

**Stack:** NestJS · TypeScript · PostgreSQL (TypeORM) · Redis · Google OAuth · Vitest · Docker · GitHub Actions

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

## How sign-in works

1. The browser opens `/auth/google`; the API redirects to Google.
2. Google redirects back with a code. The API accepts the account only if the
   email is verified and belongs to `ALLOWED_EMAIL_DOMAIN`.
3. The API sets two `HttpOnly` cookies: a 15-minute JWT access token and a
   7-day refresh token that is stored hashed in Redis and rotated on every use.

## Architecture

Each domain module is split into controller → service → repository. See
[CLAUDE.md](./CLAUDE.md) for the layering rules and conventions.
