# Cavaliq — Equestrian Club Management Platform

Turborepo monorepo for Cavaliq, a multi-tenant SaaS for equestrian clubs in the GCC. Production deployment runs on Cloudflare Workers (via OpenNext) against Neon Postgres, with Clerk Organizations for auth and per-club payment provider keys (Stripe / Ziina / N-Genius).

Live: [cavaliq.com](https://cavaliq.com)

---

## Repo layout

```
apps/
  web/         Next.js 15 (App Router) — club business dashboard
  mobile/      Expo / React Native — rider + horse-owner app
packages/
  shared/      Zod schemas, types, constants, business validators
  db/          Drizzle ORM schema, migrations, seed data, query helpers
  api-client/  Type-safe client shared between web and mobile
  email-templates/ React Email templates
tooling/       Shared eslint / prettier / tsconfig
scripts/       One-off migration, smoke-test, and ops scripts
docs/audits/   Historical audit + fixes-pass reports
```

## Core documentation

Start here if you're new to the codebase:

| Doc                                            | What it covers                                                                                                 |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| [`CLAUDE.md`](./CLAUDE.md)                     | Project rules — coding standards, security, UI/UX, known pitfalls. The source of truth for "how we work here." |
| [`AGENTS.md`](./AGENTS.md)                     | Codex equivalent — points back to CLAUDE.md.                                                                   |
| [`ARCHITECTURE.md`](./ARCHITECTURE.md)         | System design, tech stack rationale, integration patterns.                                                     |
| [`DATABASE.md`](./DATABASE.md)                 | Full schema reference, relationships, query patterns, tenant scoping rules.                                    |
| [`product-plan.md`](./product-plan.md)         | Feature list, user flows, business logic.                                                                      |
| [`ENV.md`](./ENV.md)                           | Per-variable explanation companion to `.env.example`.                                                          |
| [`DEPLOY.md`](./DEPLOY.md)                     | Production deploy procedure, secret list, rollback playbook.                                                   |
| [`OBSERVABILITY.md`](./OBSERVABILITY.md)       | Logging, Sentry, metrics, alert routing.                                                                       |
| [`INCIDENT_RUNBOOK.md`](./INCIDENT_RUNBOOK.md) | On-call response procedures.                                                                                   |
| [`docs/audits/`](./docs/audits/)               | Point-in-time audit reports and fixes-pass logs. Historical context only — current state lives in the code.    |

## Getting started

Prerequisites: Node 20+, pnpm 10.20+, a Neon Postgres database, Clerk app credentials.

```bash
# 1. Install dependencies
pnpm install

# 2. Configure environment
cp .env.example .env.local
# Fill in DATABASE_URL, Clerk keys, etc. See ENV.md for each variable.

# 3. Run database migrations
pnpm db:migrate

# 4. Start dev servers
pnpm dev              # both apps
pnpm dev:web          # web only
pnpm dev:mobile       # mobile only (Expo)
```

## Common scripts

```bash
pnpm typecheck        # tsc --noEmit across the monorepo
pnpm lint             # eslint
pnpm format           # prettier --write
pnpm format:check     # prettier --check (CI-friendly)
pnpm build            # production build via Turborepo
pnpm db:generate      # generate Drizzle migration from schema diff
pnpm db:studio        # Drizzle Studio
```

## Stack at a glance

- **Web:** Next.js 15 App Router, Shadcn/ui + Tailwind, TanStack Query, React Hook Form + Zod
- **Mobile:** Expo Router, NativeWind, MMKV, Expo SecureStore
- **DB:** Neon Postgres + Drizzle ORM (HTTP for reads, serverless WebSocket for transactions)
- **Auth:** Clerk Organizations (one org = one club)
- **Payments:** Stripe Elements, Ziina hosted checkout, N-Genius hosted payment page — per-club direct keys, not a Connect platform
- **Hosting:** Cloudflare Workers via OpenNext
- **Email:** Resend + React Email
- **Observability:** Sentry, structured JSON logger
