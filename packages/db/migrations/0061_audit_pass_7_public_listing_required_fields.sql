-- 0061_audit_pass_7_public_listing_required_fields.sql
--
-- Audit pass-7 (2026-05-25 LOW-5): `clubs.email`, `phone`, `address`,
-- `city`, `country` are all nullable. The application enforces the
-- onboarding-wizard fields at write time, but a row created via
-- `/api/v1/sync-org` (dev-only) or a direct DB write can end up with
-- NULL in any of these columns. `findPublicListings` and the discovery
-- rider funnel can then return clubs with no contact info; the public
-- profile page (`/c/[slug]`) renders a club with no city/country pill;
-- receipt/invoice emails can render with `null` in the header.
--
-- The agent suggested two paths: (a) tighten the columns to NOT NULL
-- with backfill, or (b) document the nullability and add a CHECK that
-- a publicly-listed club must have at least the public-facing contact
-- fields. Path (a) is high risk on an existing prod table (would
-- require backfilling NULLs to something, picking a sentinel value for
-- email is awkward, and a future DB-direct write could still create
-- NULL rows in dev). Path (b) is the surgical fix: enforce the
-- invariant where it actually matters — at the point a club becomes
-- visible on the public discovery surface.
--
-- The check: a row with `is_public_listing = TRUE` must have
-- `city`, `country`, and `email` set. Phone and address are NOT in the
-- check because they are not rendered on `/c/[slug]` (`phone` is the
-- private operations contact, `address` is the street-level detail
-- that maps to the city pill on the profile). A club that wants to
-- list publicly without contact info is told "fill these in first" at
-- the toggle point in the settings UI.
--
-- Backfill: spot-checked production data — JSR (the only live club at
-- pass-7) has all five fields set. The constraint validates clean.
-- For an unlisted club whose owner later flips the toggle, the
-- application-side write to set `is_public_listing = TRUE` will fail
-- with the CHECK error if any required field is NULL; the UI in
-- `apps/web/components/settings/settings-page.tsx` should gate the
-- toggle behind a precondition (out of scope for this migration —
-- tracked as follow-up).

ALTER TABLE clubs
  ADD CONSTRAINT clubs_public_listing_requires_contact_check
  CHECK (
    is_public_listing = FALSE
    OR (
      city IS NOT NULL
      AND char_length(trim(city)) > 0
      AND country IS NOT NULL
      AND char_length(trim(country)) > 0
      AND email IS NOT NULL
      AND char_length(trim(email)) > 0
    )
  )
  NOT VALID;

ALTER TABLE clubs
  VALIDATE CONSTRAINT clubs_public_listing_requires_contact_check;
