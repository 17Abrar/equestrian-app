# Cavaliq Front-End Audit and Simplification Plan

Generated 2026-06-07 by a multi-agent audit (6 dimensions, 3 research topics, adversarial verification of the top findings). 62 findings total, 9 of 10 high-severity code claims independently verified, 1 refuted and corrected.

## 1. Executive Summary

Cavaliq's front end is competently built and architecturally sound. Pages are mostly thin server wrappers that delegate to client components, the React Query hooks layer is well organized with surgical invalidation, forms use React Hook Form plus Zod consistently, and the team builds on Radix primitives that deliver focus trapping, ESC-to-close, and ARIA roles for free. There is a clear trail of prior audit comments in the code showing real care. The booking flow specifically already does many things right: skeletons, error and empty states with retry, sticky mobile CTAs, a thumb-reachable day strip and FAB, and a payment dialog that correctly branches on Stripe intent statuses so riders are not stranded on unpaid bookings.

What holds the product back is not architecture, it is three things. First, the design system is a thin monochrome shell: the token layer in app/globals.css is a flat list of colors with no spacing, typography, shadow, or motion scales, the real brand navy lives only as scattered hex literals, and several inherited shadcn capabilities (dark mode, overlay animations) are referenced but never wired, so they are dead code that ships inert. Second, the product leaves significant user-perceived-speed on the table: zero code-splitting, no server-side React Query prefetch, and a public discovery funnel that caches only an empty shell. Third, and most important for the operator's stated goal, there is no in-app guidance anywhere: no product tour, no coach marks, no tooltips, and an onboarding wizard with concrete friction (a raw "Type ID" slug field, no smart defaults, no save-and-resume) followed by an activation cliff where a freshly onboarded club is not actually bookable until an admin manually creates calendar slots, and nothing teaches that.

The 5 highest-leverage moves:

1. Fix the onboarding wizard friction: auto-derive the lesson "Type ID" slug from the name and hide the raw field (WIZ-1), add smart-default lesson templates with non-zero prices (SMART-1), and add save-and-resume so a refresh does not drop the admin to step 1 (WIZ-2).
2. Add a dismissible "Get your stable live" checklist on the dashboard that teaches the slot-creation activation step, driven by real data state, not a one-time flag (TOUR-1).
3. Add a first-run rider booking tour whose positioning matches Cavaliq's existing Radix stack (TOUR-1 rider side, TOUR-2).
4. Wire capacity color and urgency into the slot card and day strip (the data is already computed in lib/capacity.ts and thrown away), group slots by time of day, and add a "next available" empty-state fallback. These are pure presentational reworks of data already in memory.
5. Ship the config-only and CSS-only performance and polish wins: add experimental.optimizePackageImports for radix-ui only, code-split PayBookingDialog with next/dynamic, install tw-animate-css to restore dead Radix overlay animations, and fix the public /discover funnel to server-fetch its club list.

## 2. Scorecard

| Dimension                           | Grade | One-line verdict                                                                                                                                                          |
| ----------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Visual design and design system     | C+    | Solid shadcn components, but a thin monochrome token layer with dead tokens, dead dark mode, dead animations, and brand navy scattered as raw hex.                        |
| Performance and end-user speed      | B-    | Architecturally clean, but zero code-splitting, zero server prefetch, an empty-shell public funnel, and a non-functional Cloudflare image path leave real wins unclaimed. |
| Code complexity and maintainability | B-    | Consistent stack and careful comments, undermined by multi-component god files and heavily copy-pasted scaffolding (query triad, mutation catch blocks, dialog chrome).   |
| UX and booking flow                 | B     | Strong mobile-aware booking core, but the public club profile is a conversion dead end, there is no real guest path, and no filtering or week overview.                   |
| Accessibility                       | B     | Good Radix-based baseline, gaps in color contrast, status announcements, one broken radiogroup contract, and no reduced-motion handling.                                  |
| Simplification, wizards, tutorials  | D+    | Competent but bare wizard with real friction, and zero in-app guidance anywhere despite this being the operator's primary goal.                                           |

## 3. Prioritized Roadmap

### Quick wins (do now)

| #   | Action                                                                   | Theme      | Effort | Impact | Risk |
| --- | ------------------------------------------------------------------------ | ---------- | ------ | ------ | ---- |
| 1   | Auto-derive lesson Type ID from name, hide raw field                     | Wizard     | S      | High   | Low  |
| 2   | Wire capacity color + urgency into slot card and day strip               | Booking    | S      | High   | Low  |
| 3   | Fix green/destructive contrast (green-700; darken --color-destructive)   | A11y       | S      | High   | Low  |
| 4   | Install tw-animate-css, import in globals.css (restore Radix animations) | Design     | S      | Medium | Low  |
| 5   | Add --color-brand token + migrate 4 className navy usages                | Design     | S      | High   | Low  |
| 6   | Replace em/en dashes in copy                                             | Design     | S      | Medium | Low  |
| 7   | optimizePackageImports: ['radix-ui'] only                                | Perf       | S      | Medium | Low  |
| 8   | Add prefers-reduced-motion block                                         | A11y       | S      | Medium | Low  |
| 9   | Darken --color-muted-foreground to ~#666                                 | A11y       | S      | Medium | Low  |
| 10  | Gate Continue on memberId + replace silent early-returns with toast      | UX         | S      | Medium | Low  |
| 11  | aria-label on cancel-reason input; role=alert on file-upload error       | A11y       | S      | Medium | Low  |
| 12  | Replace 3 inline currency unions with SupportedCurrency                  | Complexity | S      | Medium | Low  |
| 13  | Fix drifted club-admin help doc                                          | Wizard     | S      | Medium | Low  |
| 14  | "Next available" empty-state fallback + soonest chip                     | Booking    | S      | Medium | Low  |

### High-value (this sprint)

| #   | Action                                                                | Theme     | Effort | Impact | Risk |
| --- | --------------------------------------------------------------------- | --------- | ------ | ------ | ---- |
| 15  | Code-split PayBookingDialog via next/dynamic (2 sites)                | Perf      | M      | High   | Low  |
| 16  | Server-fetch /discover club list + add generateMetadata               | Perf      | M      | High   | Low  |
| 17  | Smart-default lesson templates (price, duration, capacity)            | Wizard    | M      | High   | Low  |
| 18  | Dashboard "Get your stable live" checklist (data-driven, dismissible) | Tutorials | L      | High   | Low  |
| 19  | Add Tooltip primitive + first-run rider tour                          | Tutorials | M      | High   | Med  |
| 20  | Wizard save-and-resume (read GET /onboarding, persist step)           | Wizard    | M      | Medium | Low  |
| 21  | Group slots by time of day                                            | Booking   | M      | Medium | Low  |
| 22  | Lesson-type / coach filter chips on booking surface                   | Booking   | M      | Medium | Low  |
| 23  | aria-current on onboarding step indicator + skip-to-content links     | A11y      | S      | Low    | Low  |
| 24  | One-click starter sets to clear wizard gates                          | Wizard    | M      | Medium | Low  |

### Larger bets (follow-up, higher risk or larger scope)

| #   | Action                                                                   | Theme      | Effort | Impact | Risk |
| --- | ------------------------------------------------------------------------ | ---------- | ------ | ------ | ---- |
| 25  | Public club profile schedule/lesson preview (new public query, no price) | UX         | L      | High   | Med  |
| 26  | Decide and build guest-booking path                                      | UX         | L      | High   | Med  |
| 27  | Split finances-page.tsx into flat \*-tab.tsx siblings                    | Complexity | M      | High   | Low  |
| 28  | Extract QueryStateBoundary for ~24 single-query sites                    | Complexity | M      | High   | Low  |
| 29  | Extract FormDialog + SubmitButton primitives                             | Complexity | L      | High   | Low  |
| 30  | runMutation / useMutationToast helper                                    | Complexity | M      | Medium | Low  |
| 31  | Server prefetch + HydrationBoundary on top 3 dashboard routes            | Perf       | L      | Medium | Med  |
| 32  | Three-layer token model (spacing/type/shadow/motion, OKLCH neutrals)     | Design     | M      | Medium | Med  |
| 33  | Resolve dark mode half-state                                             | Design     | L      | Medium | Med  |
| 34  | Optimistic UI for cancel + join                                          | UX         | M      | Medium | Med  |
| 35  | Cloudflare Images custom loader + IMAGES binding                         | Perf       | M      | Medium | Med  |
| 36  | Memoize finances-page + competition-detail row lists                     | Perf       | M      | Medium | Low  |
| 37  | Scope per-request CSP nonce to interactive routes (enable PPR on public) | Perf       | L      | Medium | High |

## 4. Detailed findings

See the full multi-agent output for evidence and file:line citations behind each item above. Key verified facts:

- 176 .tsx files, 94 marked 'use client' (53%). Zero next/dynamic code-splitting. PayBookingDialog statically pulls Stripe bindings into the booking bundle at app/rider/book/page.tsx:50.
- app/globals.css defines only colors + --radius (dead, zero var(--radius) usages) + --font-sans. No spacing/type/shadow/motion scales. Radix overlay animation classes ship across the ui kit but no tw-animate-css/keyframes exist, so every dialog/popover/sheet pops with zero transition.
- Brand navy #0d1f34 hardcoded in 6 places; no brand token.
- Contrast: text-green-600 (#00a63e, 3.22:1) and text-destructive (#ef4444, 3.76:1) both fail WCAG AA on white; muted-foreground #737373 on muted #f5f5f5 = 4.35 (fails).
- Onboarding wizard: raw "Type ID" slug field (no uniqueness constraint, never branched on in app logic, so auto-deriving is safe), price defaults to 0, step is useState(0) with no persistence so a refresh or Stripe OAuth redirect drops to step 1. GET /api/v1/onboarding already returns hasArenas/hasLessonTypes/counts but is unused by the front end.
- Activation cliff: the wizard creates arenas + lesson types but no calendar slots; a club is not bookable until slots exist, and nothing teaches that. The dashboard greets with generic copy and no pointer to slot creation.
- lib/capacity.ts already computes color + urgency labels and CAPACITY_BADGE_CLASSES, but SlotCard renders only a flat muted "N spots".
- No Tooltip primitive (components/ui/tooltip.tsx absent), zero Tooltip usages, no tour/coachmark anywhere.
