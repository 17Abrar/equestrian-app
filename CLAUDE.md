# Project Rules — Equestrian Club Management Platform

This is the master rules file. Claude Code MUST follow every rule in this file without exception. Violating any rule is unacceptable — no shortcuts, no "I'll fix it later," no excuses.

---

## AGENT BEHAVIOR RULES (Read This First)

These rules govern how you (Claude Code) behave as an agent on this project. Follow them at all times.

### 1. ALWAYS Read Before You Write

Before writing ANY code, you MUST:
- Read ARCHITECTURE.md, DATABASE.md, and product-plan.md
- Read the existing code in the file(s) you are about to modify
- Read related files (if editing a component, read the hook it uses, the API route it calls, the types it imports)
- Understand the FULL context before making changes

DO NOT write code based on assumptions. If a file exists that's relevant, read it first. No exceptions.

### 2. ALWAYS Check and Fix Your Own Work

After writing code, you MUST:
- Re-read the code you just wrote and verify it follows EVERY rule in this file
- Check for TypeScript errors (run `tsc --noEmit` or check the file for obvious type issues)
- Verify all imports exist and are correct
- Verify the component/function handles all states (loading, error, empty, success)
- Verify error handling is in place
- Verify input validation is in place
- Verify tenant scoping (club_id) is applied to every database query
- Verify naming conventions match this file's standards

**CRITICAL — GO BEYOND TypeScript COMPILATION:**
TypeScript passing (`tsc --noEmit` = 0 errors) does NOT mean the code is correct. You MUST ALSO verify:
- **Runtime correctness**: Will this actually work when a real user triggers it? Think through the full execution path.
- **Database driver compatibility**: Are you using `db.transaction()` with the right driver? (neon-http does NOT support transactions — use neon-serverless with WebSocket for transactions, or restructure as sequential queries)
- **Foreign key compatibility**: Are you passing the right ID types? Clerk user IDs are strings like `user_xxx`, NOT UUIDs. If a column expects a UUID foreign key, you cannot store a Clerk ID there — you must look up the internal UUID first.
- **Race conditions**: Can two users hit this endpoint at the same time and cause data corruption? (e.g., double-booking the same slot, exceeding capacity limits)
- **Type coercions**: Does Drizzle expect a `Date` but Zod outputs a `string`? Does a numeric column expect `string` but Zod outputs `number`? These compile fine but crash at runtime.
- **Null/undefined paths**: What happens if a query returns no rows? What if an optional field is undefined? Trace every code path.

Do NOT say "all clean" or "everything looks good" based solely on TypeScript compilation. If you haven't verified runtime behavior, say so explicitly.

If you find issues during self-review, FIX THEM IMMEDIATELY before presenting the code. Do NOT present broken or incomplete code and wait for me to catch it.

### 3. WHEN IN DOUBT — RESEARCH ONLINE

This is critical. If you are unsure about ANY of the following, you MUST search the web for the latest documentation before writing code:

- **API syntax**: If you're not 100% sure about the API for Clerk, Stripe, Drizzle ORM, Next.js 15 App Router, Expo Router, TanStack Query, Shadcn/ui, React Hook Form, Zod, NativeWind, Resend, or ANY library in our stack — SEARCH THE OFFICIAL DOCS FIRST. Do not guess. Do not use outdated patterns.
- **Breaking changes**: Next.js 15, Clerk, Drizzle, and Expo are all actively evolving. If there's any chance an API has changed, look it up.
- **Best practices**: If you're implementing something you haven't done before (e.g., Stripe Connect, Clerk Organizations, Postgres RLS policies, React Native animations), research it first.
- **Error messages**: If you encounter an error you're not sure how to fix, search for it online before attempting a fix.
- **Equestrian domain knowledge**: If a feature involves equestrian-specific terminology, workflows, or business logic you're not familiar with (e.g., horse rotation scheduling, arena management, feed planning, farrier schedules), research it to understand the real-world process before implementing.

**How to research**: Use your web search tool. Check official documentation sites first (e.g., nextjs.org/docs, clerk.com/docs, orm.drizzle.team, stripe.com/docs). Then check GitHub issues and Stack Overflow if needed.

**DO NOT:**
- Guess at API signatures
- Use deprecated methods
- Hallucinate function names that don't exist
- Write code based on outdated patterns from older versions
- Assume you know the current API — verify it

### 4. ALWAYS Verify Existing Patterns Before Creating New Ones

Before creating a new component, hook, utility, API route, or schema:
1. Search the codebase to see if something similar already exists
2. If it exists, reuse it or extend it — do NOT create a duplicate
3. If you're creating something new, follow the exact same patterns used in existing code (file structure, naming, imports, error handling shape)
4. When adding a new Shadcn/ui component, check if it's already installed. If not, install it using `npx shadcn@latest add <component>`

### 5. NEVER Leave Work Half-Done

- If you create an API route, also create the corresponding Zod schema, types, and update the api-client
- If you create a form, include validation, error handling, loading states, success toasts, and error toasts
- If you create a database query, include the tenant scope (club_id), proper error handling, and input validation
- If you add a new feature, update all layers: schema → migration → query → API route → api-client → UI component → tests
- If you modify a shared type or schema, check and update ALL files that import it

### 6. ASK When Requirements Are Ambiguous

If the task description is vague, unclear, or could be interpreted multiple ways:
- Ask me to clarify BEFORE writing code
- Do NOT guess what I want and build the wrong thing
- It's better to ask one question than to rewrite an entire feature

### 7. PROACTIVELY Identify and Report Issues

If while working on a task you notice:
- A bug in existing code → tell me and fix it
- A security vulnerability → tell me and fix it immediately
- Missing error handling in related code → tell me and fix it
- Inconsistent patterns → tell me and suggest standardization
- A missing test that should exist → tell me and write it

Do NOT silently ignore problems you find. This project must be production-quality.

### 8. NEVER Say "All Clean" Unless You've ACTUALLY Verified Everything

This has been a recurring problem. Do NOT claim the code is bug-free based on:
- TypeScript compilation passing (it misses runtime bugs)
- "It looks right to me" (trace the actual execution)
- Fixing the obvious issues and assuming nothing else is wrong

Instead:
- If you've only checked types: say "TypeScript compiles clean, but I haven't verified runtime behavior for X, Y, Z"
- If you're not 100% sure something works: say "I'm not sure about X — let me verify" and then actually verify it
- If you fixed issues: assume there are more. Look harder. Check related code paths.
- Be honest about what you checked and what you didn't. I would rather hear "I'm not confident about the transaction handling here" than "all clean" followed by a runtime crash.

**Honesty > false confidence. Always.**

### 9. ALWAYS Run Lint and Type Checks

After making changes, run:
```bash
# Type check
npx turbo typecheck

# Lint
npx turbo lint

# If you modified a specific package/app
cd apps/web && npx tsc --noEmit
cd apps/mobile && npx tsc --noEmit
```

Fix any errors before presenting your work. Do NOT tell me "there might be type errors" — check and fix them.

---

## CRITICAL RULES (Non-Negotiable)

1. NEVER skip error handling. Every function that can fail MUST have proper try/catch blocks with meaningful error messages. Never use empty catch blocks. Never swallow errors silently.

2. NEVER use `any` type in TypeScript. Every variable, parameter, return type, and prop MUST be explicitly typed. If you don't know the type, define an interface. Enable `strict: true` in tsconfig.json. If you catch yourself typing `any`, STOP and define the proper type. Use `unknown` + type guards if truly unknown.

3. NEVER store secrets, API keys, tokens, or passwords in code. All secrets go in Cloudflare Workers Secrets (`wrangler secret put`) for production and `.env.local` (gitignored) for local development. Never commit `.env` files. See DEPLOY.md for the full secret list and `wrangler secret list cavaliq` to verify presence per release.

4. NEVER handle raw credit card data. All payment processing uses Stripe Elements or Tap goSell.js hosted fields. Card data goes directly from browser to payment processor. Our servers only receive tokens.

5. NEVER interpolate user input into SQL queries. Always use parameterized queries via Drizzle ORM. No raw SQL string concatenation. Ever.

6. NEVER disable TypeScript strict mode, ESLint rules, or Prettier formatting. If a lint rule is inconvenient, fix the code — do not add eslint-disable comments unless there is a documented, justified reason.

7. NEVER write console.log for production code. Use the structured logger (see ARCHITECTURE.md). console.log is only acceptable in development-only code paths.

   **Carve-out — `packages/db` and `packages/shared`:** these workspaces by design cannot import the app-side logger (`apps/web/lib/logger.ts`) because that would create a circular dep. The handful of `console.warn` / `console.error` calls in `packages/db/src/queries/payment-accounts.ts`, `packages/db/src/queries/audit-log.ts`, and similar package-side files are intentional and emit structured JSON matching the logger's output shape. The audit-log fallback is specifically the "audit trail of last resort" — when the audit-log INSERT itself fails, there's no other writable surface. Audit F-73 (2026-05-08 r6) — preserve these calls; if you add new ones, document the rationale inline as those files do.

8. NEVER commit code without proper input validation. Every API endpoint validates its input using Zod schemas before processing. No exceptions.

9. NEVER return raw database errors to the client. Catch database errors and return sanitized, user-friendly error messages. Log the full error server-side.

10. NEVER skip loading states, error states, or empty states in UI components. Every data-fetching component MUST handle: loading, error, empty (no data), and success states. This is NOT optional. Every. Single. Time.

11. NEVER write a database query without tenant scoping. Every query MUST include `.where(eq(table.clubId, currentClubId))`. If you forget this, it's a critical security vulnerability. Check EVERY query.

12. NEVER use deprecated or outdated APIs. If you're not sure whether an API is current, SEARCH THE DOCS ONLINE before using it. This applies especially to Next.js 15 (App Router patterns changed significantly), Clerk v5+, and Drizzle ORM.

13. NEVER create a file without checking if a similar file already exists. Search the codebase first.

14. NEVER present code that you haven't self-reviewed. Read your own output, check it against these rules, and fix issues before showing it to me.

---

## PROJECT STRUCTURE

This is a monorepo managed by Turborepo.

```
/
├── apps/
│   ├── web/                    # Next.js 15 (App Router) — Business Dashboard
│   │   ├── app/
│   │   │   ├── (auth)/         # Auth pages (sign-in, sign-up)
│   │   │   ├── (dashboard)/    # Authenticated dashboard pages
│   │   │   │   ├── layout.tsx  # Dashboard layout with sidebar
│   │   │   │   ├── page.tsx    # Dashboard home
│   │   │   │   ├── calendar/
│   │   │   │   ├── bookings/
│   │   │   │   ├── horses/
│   │   │   │   ├── riders/
│   │   │   │   ├── staff/
│   │   │   │   ├── owners/
│   │   │   │   ├── finances/
│   │   │   │   ├── emails/
│   │   │   │   ├── arenas/
│   │   │   │   ├── reports/
│   │   │   │   ├── community/
│   │   │   │   └── settings/
│   │   │   ├── api/            # API routes
│   │   │   │   ├── webhooks/   # Stripe, Clerk, Resend webhooks
│   │   │   │   └── v1/        # Versioned API endpoints
│   │   │   └── layout.tsx      # Root layout
│   │   ├── components/
│   │   │   ├── ui/             # Shadcn/ui components (button, input, dialog, etc.)
│   │   │   ├── dashboard/      # Dashboard-specific components
│   │   │   ├── horses/         # Horse-related components
│   │   │   ├── bookings/       # Booking-related components
│   │   │   ├── finances/       # Finance-related components
│   │   │   ├── emails/         # Email composer components
│   │   │   └── shared/         # Shared across dashboard
│   │   ├── hooks/              # Custom React hooks
│   │   ├── lib/                # Utility functions, constants
│   │   └── styles/             # Global styles
│   │
│   └── mobile/                 # React Native (Expo) — Rider/Owner App
│       ├── app/                # Expo Router (file-based routing)
│       │   ├── (tabs)/         # Bottom tab navigation
│       │   │   ├── index.tsx   # Home tab
│       │   │   ├── book/       # Book tab
│       │   │   ├── horses/     # My Horses / Progress tab
│       │   │   ├── community/  # Community tab
│       │   │   └── profile/    # Profile tab
│       │   ├── (auth)/         # Auth screens
│       │   ├── (modals)/       # Modal screens
│       │   └── _layout.tsx     # Root layout
│       ├── components/
│       ├── hooks/
│       ├── lib/
│       └── assets/
│
├── packages/
│   ├── shared/                 # Shared business logic
│   │   ├── schemas/            # Zod validation schemas
│   │   ├── types/              # TypeScript types/interfaces
│   │   ├── constants/          # Shared constants
│   │   ├── utils/              # Shared utility functions
│   │   └── validators/         # Business rule validators
│   │
│   ├── db/                     # Database package
│   │   ├── schema/             # Drizzle ORM schema definitions
│   │   ├── migrations/         # Database migrations
│   │   ├── queries/            # Reusable query functions
│   │   └── seed/               # Seed data for development
│   │
│   ├── api-client/             # Type-safe API client (shared between web and mobile)
│   │   ├── client.ts
│   │   └── endpoints/
│   │
│   └── email-templates/        # React Email templates
│       ├── booking-confirmation.tsx
│       ├── payment-receipt.tsx
│       ├── feed-alert.tsx
│       └── ...
│
├── tooling/
│   ├── eslint/                 # Shared ESLint config
│   ├── typescript/             # Shared tsconfig
│   └── prettier/               # Shared Prettier config
│
├── turbo.json                  # Turborepo config
├── package.json                # Root package.json
├── .env.example                # Example environment variables (committed)
├── .env.local                  # Local environment variables (gitignored)
└── CLAUDE.md                   # This file
```

---

## CODING STANDARDS

### TypeScript

- Strict mode enabled (`strict: true` in all tsconfig files)
- No `any` types. Use `unknown` if the type is truly unknown, then narrow with type guards.
- Prefer `interface` over `type` for object shapes (better error messages, faster compilation)
- Use `as const` for literal types
- Use discriminated unions for state management (loading | error | success)
- Export types from a central location (packages/shared/types/)
- Use `satisfies` operator for type validation without widening

```typescript
// GOOD
interface Horse {
  id: string;
  name: string;
  breed: string;
  status: HorseStatus;
  weightLimit: number;
  skillLevel: SkillLevel;
}

// BAD
const horse: any = { ... };
```

### Naming Conventions

- Files: kebab-case (`horse-profile.tsx`, `booking-form.tsx`, `use-horse-query.ts`)
- Components: PascalCase (`HorseProfile`, `BookingForm`)
- Functions/variables: camelCase (`getHorseById`, `bookingCount`)
- Constants: UPPER_SNAKE_CASE (`MAX_LESSONS_PER_DAY`, `DEFAULT_BOOKING_CUTOFF_HOURS`)
- Database tables: snake_case (`horse_profiles`, `booking_slots`)
- Database columns: snake_case (`created_at`, `club_id`, `skill_level`)
- API routes: kebab-case (`/api/v1/horses`, `/api/v1/booking-slots`)
- Zod schemas: camelCase with "Schema" suffix (`createHorseSchema`, `updateBookingSchema`)
- Types/Interfaces: PascalCase (`Horse`, `Booking`, `Rider`)
- Enums: PascalCase with PascalCase values (`enum HorseStatus { Available, Resting, Injured }`)
- Hooks: camelCase with "use" prefix (`useHorses`, `useBookingForm`, `useClubSettings`)
- Query keys: camelCase arrays (`['horses', clubId]`, `['bookings', { date, status }]`)

**If you name something wrong, it's a bug. Fix it.**

### React Components

- Use functional components only. No class components.
- Use Server Components by default in Next.js. Only add `"use client"` when the component needs:
  - Event handlers (onClick, onChange)
  - State (useState, useReducer)
  - Effects (useEffect)
  - Browser APIs (window, document)
  - Third-party client libraries
- Props interfaces named `{ComponentName}Props`
- Destructure props in the function signature
- One component per file (except small helper components used only within that file)
- Components MUST handle ALL four states: loading, error, empty, and success. NO EXCEPTIONS.
- Every event handler must have proper TypeScript typing (no `(e: any)`)

```typescript
// GOOD
interface HorseCardProps {
  horse: Horse;
  onEdit: (id: string) => void;
  isEditable: boolean;
}

export function HorseCard({ horse, onEdit, isEditable }: HorseCardProps) {
  // ...
}

// BAD
export default function HorseCard(props: any) {
  // ...
}
```

### React Native (Mobile)

- Use NativeWind for styling (Tailwind CSS for React Native)
- Use the same design tokens as the web app
- Use Expo Router for navigation (file-based, matches Next.js pattern)
- Use React Native Reanimated for animations
- Use MMKV for local storage (not AsyncStorage — too slow)
- Use Expo SecureStore for sensitive data (auth tokens)
- Test on both iOS and Android before marking any mobile feature as complete
- ALWAYS check Expo docs online before using any Expo API — they change frequently

### API Routes (Next.js)

- All API routes go in `app/api/v1/` (versioned from day one)
- Every route MUST follow this exact checklist (in order):
  1. Authenticate (verify user is logged in via Clerk)
  2. Parse and validate input (Zod schema)
  3. Authorize (check user role/permissions for this action)
  4. Set tenant context (club_id from org)
  5. Execute business logic
  6. Return consistent response shape
  7. Catch errors, log full error server-side, return sanitized message to client
- If you skip ANY of these steps, it is a bug. Go back and add it.

Response shapes (ALWAYS use these exact shapes):

```typescript
// Success response
{ success: true, data: T }

// Error response
{ success: false, error: { code: string, message: string, details?: unknown } }

// Paginated response
{ success: true, data: T[], pagination: { page: number, pageSize: number, total: number, totalPages: number } }
```

HTTP status codes (use the correct one, not just 200 and 500):
  - 200: Success
  - 201: Created
  - 400: Bad request (validation error)
  - 401: Unauthorized (not logged in)
  - 403: Forbidden (logged in but wrong role)
  - 404: Not found
  - 409: Conflict (e.g., double booking)
  - 422: Unprocessable entity (business rule violation)
  - 429: Rate limited
  - 500: Internal server error (log full error, return sanitized message)

### Error Handling

```typescript
// GOOD - Every API route follows this EXACT pattern
export async function POST(request: Request) {
  try {
    // 1. Authenticate
    const { userId, orgId } = await auth();
    if (!userId || !orgId) {
      return NextResponse.json(
        { success: false, error: { code: 'UNAUTHORIZED', message: 'Authentication required' } },
        { status: 401 }
      );
    }

    // 2. Validate input
    const body = await request.json();
    const parsed = createBookingSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid input', details: parsed.error.flatten() } },
        { status: 400 }
      );
    }

    // 3. Check authorization
    const hasPermission = await checkPermission(userId, orgId, 'bookings:create');
    if (!hasPermission) {
      return NextResponse.json(
        { success: false, error: { code: 'FORBIDDEN', message: 'You do not have permission to create bookings' } },
        { status: 403 }
      );
    }

    // 4. Set tenant context and execute business logic
    const result = await withTenantContext(orgId, () => {
      return createBooking(parsed.data);
    });

    // 5. Return success
    return NextResponse.json({ success: true, data: result }, { status: 201 });

  } catch (error) {
    // 6. Log full error, return sanitized message
    logger.error('booking_creation_failed', {
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
    });

    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: 'Something went wrong. Please try again.' } },
      { status: 500 }
    );
  }
}

// BAD - No error handling, no validation, no auth check
export async function POST(request: Request) {
  const body = await request.json();
  const result = await db.insert(bookings).values(body);
  return NextResponse.json(result);
}
```

### State Management

- Server state: TanStack Query (React Query) for all API data
- Client state: React useState/useReducer for local UI state
- No Redux. No Zustand. No global state libraries unless absolutely necessary.
- URL state: Use Next.js searchParams for filters, pagination, sorting
- Form state: React Hook Form + Zod resolver
- NEVER store server data in useState. Always use TanStack Query.
- NEVER fetch data inside useEffect. Use TanStack Query hooks.

### Testing

- Write tests for: business logic, API routes, utility functions
- Use Vitest (not Jest — faster, native ESM support)
- Test files co-located with source: `horse-matching.ts` → `horse-matching.test.ts`
- Test the Smart Horse Matching algorithm thoroughly (it's a core differentiator)
- Test payment webhook handlers (simulate Stripe events)
- Test tenant isolation (verify one club cannot access another's data)
- E2E tests for critical flows: booking, payment, horse profile creation
- If you write a utility function, write at least 3 test cases (happy path, edge case, error case)
- If you write an API route, write tests for: success, validation error, unauthorized, forbidden, not found

---

## SECURITY REQUIREMENTS

### Authentication (Clerk)

- All dashboard pages require authentication via Clerk middleware
- All API routes require authentication (except webhooks, which verify signatures)
- Webhooks verify signatures before processing:
  - Stripe: `stripe.webhooks.constructEvent()`
  - Clerk: verify with Clerk webhook secret
  - Resend: verify signature header
- Session tokens are short-lived (Clerk handles this)
- Implement Clerk Organizations for multi-tenancy (one org = one club)
- **IMPORTANT**: Check Clerk docs online before implementing any auth feature. Their API changes frequently between versions.

### Authorization (Role-Based)

Every API route and page MUST check the user's role before allowing access:

```typescript
// Define permissions per role
const PERMISSIONS = {
  club_admin: ['*'], // all permissions
  club_manager: ['bookings:*', 'horses:*', 'riders:*', 'staff:read', 'finances:read', 'emails:*'],
  coach: ['bookings:read', 'bookings:update_own', 'horses:read', 'riders:read', 'riders:update_notes'],
  horse_owner: ['horses:read_own', 'horses:update_own', 'bookings:read_own'],
  rider: ['bookings:create', 'bookings:read_own', 'profile:*'],
  parent: ['bookings:create_child', 'bookings:read_child', 'profile:*', 'payments:*'],
  groom: ['horses:read', 'tasks:*', 'horses:update_care'],
} as const;
```

- NEVER trust client-side role checks alone. Always verify on the server.
- NEVER expose admin-only API endpoints without role verification.
- Check permissions on EVERY route. If you forget, it's a security hole.

### Multi-Tenancy (Row-Level Security)

- EVERY database query MUST be scoped to the current club (tenant)
- Use Drizzle ORM's `.where(eq(table.clubId, currentClubId))` on EVERY query
- Additionally, enable Postgres RLS policies as a safety net
- NEVER allow cross-tenant data access, even in admin views
- Test tenant isolation: write tests that verify Club A cannot read Club B's data
- **This is the #1 security priority.** A tenant isolation failure is a critical, ship-stopping bug.

### Input Validation

- Validate ALL user input on the server using Zod schemas
- Validate on the client too (for UX), but NEVER trust client validation alone
- Sanitize HTML input with DOMPurify for any rich text fields
- Limit file upload sizes (15MB max for images, 25MB for documents)
- Validate file types (only allow: jpg, jpeg, png, webp, gif, pdf, doc, docx)
- Validate file content type (check magic bytes, not just extension)
- Validate all URL parameters, query strings, and path segments — not just request bodies

### Data Protection

- Encrypt sensitive horse medical data at the application level before storing
- Use field-level encryption (libsodium) for: vet diagnoses, medications, medical history
- NEVER log: passwords, tokens, card numbers, medical records, personal health info
- Log only: IDs, timestamps, action types, sanitized error messages
- Implement audit logging: who accessed/modified what, when

---

## UI/UX STANDARDS

### Design System

- Use Shadcn/ui as the component foundation
- Customize with a consistent color palette (defined in tailwind.config.ts)
- Use consistent spacing scale (Tailwind's default: 4px base)
- Use consistent border radius (rounded-lg as default, rounded-xl for cards)
- Use consistent shadows (shadow-sm for subtle, shadow-md for elevated)
- Typography: Inter font family (clean, professional, great for data-heavy dashboards)
- **Before adding any UI component, check if Shadcn/ui already has it.** Do NOT build custom components when Shadcn/ui provides one.
- **If you need to add a Shadcn/ui component that isn't installed yet**, use `npx shadcn@latest add <component>`. Search the Shadcn/ui docs online if unsure which component to use.

### Responsive Design

- Web dashboard: Desktop-first (1280px+ primary), responsive down to tablet (768px)
- Mobile app: Mobile-first by definition
- All tables must have a mobile-friendly alternative (card view or horizontal scroll)
- Sidebar collapses to icons on smaller screens, hamburger menu on mobile

### Loading States

Every component that fetches data MUST show ALL FOUR of these states. NO EXCEPTIONS:
- **Loading**: Skeleton loaders (not spinners) that match the shape of the content
- **Error**: Clear error message with retry button
- **Empty**: Friendly empty state with illustration and action button ("No horses yet. Add your first horse.")
- **Success**: The actual content

If I see a component missing ANY of these states, it is incomplete. Do not present it as done.

```typescript
// GOOD
function HorseList() {
  const { data, isLoading, isError, error, refetch } = useHorses();

  if (isLoading) return <HorseListSkeleton />;
  if (isError) return <ErrorState message={error.message} onRetry={refetch} />;
  if (!data?.length) return <EmptyState title="No horses yet" action={{ label: "Add Horse", href: "/horses/new" }} />;

  return <HorseGrid horses={data} />;
}

// BAD — This is NEVER acceptable
function HorseList() {
  const { data } = useHorses();
  return <HorseGrid horses={data} />;
}
```

### Forms

- Use React Hook Form + Zod for all forms
- Show validation errors inline (below the field, in red)
- Disable submit button while submitting (prevent double-clicks)
- Show success toast after successful submission
- Show error toast if submission fails (with the error message)
- Confirm destructive actions with a dialog ("Are you sure you want to delete this horse?")
- Autosave drafts where appropriate (email composer, long forms)
- NEVER submit a form without client-side validation running first
- NEVER leave a form with no feedback on submission (the user must always know what happened)

### Accessibility

- All interactive elements must be keyboard-accessible
- All images must have alt text
- Use semantic HTML (header, nav, main, section, article, footer)
- Color is never the only indicator (always pair with text/icons)
- Minimum contrast ratio: 4.5:1 for text
- Use aria-labels for icon-only buttons
- Focus management: after a modal closes, return focus to the trigger element
- Tab order must be logical (top to bottom, left to right)

### Notifications and Toasts

- Success: Green toast, auto-dismiss after 5 seconds
- Error: Red toast, stays until dismissed
- Warning: Yellow toast, auto-dismiss after 8 seconds
- Info: Blue toast, auto-dismiss after 5 seconds
- Position: Bottom-right on desktop, bottom-center on mobile
- Use Sonner for toast notifications (works with Shadcn/ui)
- EVERY mutation (create, update, delete) MUST show a toast on success and on error

---

## DATABASE RULES

- See DATABASE.md for the full schema
- All tables MUST have: `id` (uuid), `club_id` (uuid, foreign key), `created_at` (timestamp), `updated_at` (timestamp)
- Use UUIDs for all primary keys (never auto-increment integers — they leak information)
- Use soft deletes per `DATABASE.md` (Deletion patterns table). Audit F-41 (2026-05-08 r6) — there are THREE distinct idioms (`deleted_at` timestamp on `clubs`/`horses`; status-enum transition on `bookings`/`invoices`/`livery_invoices`/`platform_subscription_invoices`/`coupons`; deactivation flag `is_active` on `club_members`/`arenas`/`lesson_types`). New tables MUST pick one of these three; do not invent a fourth. Append-only tables (`audit_log`, `webhook_events`, `competition_results`, `community_votes`, `horse_pairing_history`, `coupon_usages`, `rider_achievements`, `horse_medication_logs`, `horse_care_reminder_sends`, `waitlist`) have NO delete pattern by design.
- All foreign keys must have ON DELETE behavior explicitly defined
- Index all columns used in WHERE clauses and JOIN conditions
- Use database-level constraints (NOT NULL, CHECK, UNIQUE) in addition to application-level validation
- Write migrations for every schema change (never manually modify the database)
- ALWAYS check the existing schema in `packages/db/schema/` before creating new tables or columns to avoid duplicates or conflicts
- When writing Drizzle queries, check the Drizzle ORM docs online if you're not sure about syntax. They update frequently.
- EVERY query MUST include the `club_id` tenant scope. If you write a query without it, it is a critical bug.

---

## GIT RULES

- Commit messages: Conventional Commits format (`feat:`, `fix:`, `chore:`, `refactor:`, `docs:`, `test:`)
- One feature per branch, one PR per feature
- Branch naming: `feat/horse-profile`, `fix/booking-double-charge`, `chore/update-deps`
- Never commit to main directly
- Never force push to main
- Never commit .env files, secrets, or API keys
- Run lint and type check before committing. If they fail, fix the issues — do not skip the checks.

---

## PERFORMANCE RULES

- Use Next.js Server Components by default (reduce client-side JavaScript)
- Use `loading.tsx` files in Next.js for instant loading states
- Use React.lazy() / dynamic imports for heavy components (charts, rich text editor)
- Optimize images: Use Next.js Image component or Cloudflare Image Resizing
- Paginate all list views (never load all records at once)
- Default page size: 25 items
- Cache API responses with TanStack Query (staleTime: 30 seconds for frequently-changing data, 5 minutes for stable data)
- Use database indexes (see DATABASE.md)
- Monitor Core Web Vitals (LCP < 2.5s, FID < 100ms, CLS < 0.1)
- NEVER load all records from the database. Always paginate, limit, or filter.
- NEVER make unnecessary re-renders. Memoize expensive computations with useMemo, callbacks with useCallback, and components with React.memo when appropriate.

---

## WHAT NOT TO DO

- Do NOT use `var`. Use `const` by default, `let` only when reassignment is needed.
- Do NOT use `.then()` chains. Use `async/await`.
- Do NOT use default exports (except for Next.js pages/layouts which require them). Use named exports.
- Do NOT use `index.tsx` as a barrel file that re-exports everything. Import directly from the source file.
- Do NOT install packages without checking if the functionality already exists in our stack.
- Do NOT add comments that just restate the code. Comments should explain WHY, not WHAT.
- Do NOT leave TODO comments in committed code. Either fix it now or create an issue.
- Do NOT use magic numbers. Define constants with descriptive names.
- Do NOT copy-paste code. If you're writing the same logic twice, extract it into a shared function/component.
- Do NOT skip form validation for "quick testing." Validation is part of the feature.
- Do NOT return mock data from API routes. Use the database. If the database isn't set up yet, set it up.
- Do NOT guess at library APIs. Look them up if you're not sure.
- Do NOT ignore errors. Handle them properly or explain why they can't occur.
- Do NOT create duplicate files, components, hooks, or utilities. Search the codebase first.
- Do NOT present incomplete code. If you know a piece is missing (types, validation, error handling, tests), add it before presenting.
- Do NOT assume you remember a library's API correctly. When in doubt, search the docs. This is especially true for Clerk, Stripe, Next.js 15 App Router, Drizzle ORM, and Expo.

---

## SELF-CHECK PROTOCOL

Before presenting ANY code to me, mentally run through this checklist:

- [ ] Did I read the existing code and related files first?
- [ ] Does every function have proper error handling (try/catch with meaningful messages)?
- [ ] Are all types explicitly defined (no `any`, no implicit `any`)?
- [ ] Does every API route follow the 7-step pattern (auth → validate → authorize → tenant → logic → response → error)?
- [ ] Is every database query scoped to club_id?
- [ ] Does every UI component handle loading, error, empty, and success states?
- [ ] Are all imports correct and do the imported modules actually exist?
- [ ] Does the naming follow our conventions (kebab-case files, PascalCase components, etc.)?
- [ ] Did I check if similar code already exists in the codebase?
- [ ] Did I verify any library APIs I wasn't 100% sure about by searching docs online?
- [ ] Did I run (or mentally verify) type checking and linting?
- [ ] Is the code complete? (Not missing validation, error handling, loading states, etc.)
- [ ] Did I update all related files that need to change? (Types, schemas, api-client, tests)

If ANY answer is "no," fix it before presenting the code.

---

## KNOWN PITFALLS (Learn From Past Mistakes)

These are real bugs that were written and shipped in this project before. Do NOT repeat them:

1. **`db.transaction()` on neon-http driver**: The neon HTTP driver does NOT support interactive transactions. If you need a transaction, either use the neon-serverless driver with WebSocket pooling, or restructure as sequential queries with manual rollback logic. This will crash at runtime with zero TypeScript warnings.

2. **Clerk IDs vs UUID foreign keys**: Clerk user IDs look like `user_2abc123`. Database `user_id` columns are UUIDs. You CANNOT store a Clerk ID in a UUID column — you must look up the user's internal UUID from the `club_members` table using their Clerk ID first. This compiles fine but crashes every INSERT/UPDATE.

3. **Zod string output → Drizzle Date column**: Zod's `.datetime()` outputs a string. Drizzle's `timestamp` columns expect a `Date` object. You must convert: `new Date(parsed.data.registrationDeadline)`. TypeScript won't catch this.

4. **Zod number output → Drizzle numeric/decimal column**: Drizzle's `numeric` columns expect strings (for precision). Zod's `.number()` outputs a number. Convert with `String(value)`. TypeScript won't catch this.

5. **`Record<string, unknown>` defeating type safety**: Using `Record<string, unknown>` as a return type or intermediate type defeats all TypeScript checks on the consuming code. Always use a proper interface.

6. **Race conditions in booking creation**: Two users booking the last slot simultaneously can both succeed if you check capacity and insert in separate queries. Use a single atomic query or database-level constraints.

7. **Missing `amount/100` for Stripe**: Stripe amounts are in cents. Display amounts are in dollars/dinars. Always divide by 100 when displaying, multiply by 100 when sending to Stripe.

8. **LIKE queries without escaping**: If user input contains `%` or `_`, it becomes a wildcard in SQL LIKE queries. Always escape these characters before using in a LIKE pattern.

9. **`data?.success` pattern**: When checking API responses, don't use `data?.success` — if `data` is undefined (loading state), this silently evaluates to `undefined` (falsy) and shows the error state during loading. Check `isLoading` first.

10. **Next.js Image component**: Don't use `<img>` tags. Use `next/image` `<Image>` component with proper `width`, `height`, and `alt` props. If using external URLs, configure `remotePatterns` in `next.config.js`.

**If you're about to write code that touches any of these areas, STOP and re-read the relevant pitfall first.**

---

## REFERENCE DOCUMENTS

- Product Plan: See product-plan.md for all features, user flows, and business logic
- Architecture: See ARCHITECTURE.md for system design, tech stack details, and integration patterns
- Database: See DATABASE.md for complete schema, relationships, and query patterns

**Read these documents before starting ANY new feature. Not after. Not during. BEFORE.**
