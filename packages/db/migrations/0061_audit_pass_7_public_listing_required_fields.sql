-- 0061_audit_pass_7_public_listing_required_fields.sql
--
-- Audit pass-7 (2026-05-25 LOW-5): `clubs.email`, `phone`, `address`,
-- `city`, `country` are all nullable. The application enforces the
-- onboarding-wizard fields at write time, but a row created via
-- `/api/v1/sync-org` (dev-only) or a direct DB write can end up with
-- NULL in any of these columns. `findPublicListings` and the discovery
-- rider funnel can then return clubs with no contact info; the public
-- profile page (`/c/[slug]`) renders a club with no city/country pill.
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
-- `city` and `country` set. Email, phone, and address are NOT in the
-- check because they are not rendered on `/c/[slug]`:
--   * `email` is the operations contact (used for receipts, not on the public profile);
--   * `phone` is the private operations contact;
--   * `address` is the street-level detail that maps to the city pill.
--
-- Pass-7 evolution:
--   * v1 included `email` in the check; CI failed because at least one
--     existing publicly-listed prod row has email = NULL.
--   * v2 (this) narrowed to city + country only. CI failed AGAIN —
--     there's a publicly-listed row missing city or country too. So a
--     pre-existing dev/legacy bootstrap created a discovery row whose
--     location pill would render empty.
--   * v3 adds a backfill UPDATE that flips `is_public_listing = FALSE`
--     for any non-compliant row BEFORE applying the CHECK. The club's
--     owner can re-list once they fill in city/country via the settings
--     UI. This is the right semantic: a discovery row without a location
--     pill was always broken UX; quietly hiding it from `findPublicListings`
--     until the data is good is preferable to either failing the
--     migration or surfacing an empty pill on the public site.
--
-- For an unlisted club whose owner later flips the toggle, the
-- application-side write to set `is_public_listing = TRUE` will fail
-- with the CHECK error if city or country is NULL/empty; the UI in
-- `apps/web/components/settings/settings-page.tsx` should gate the
-- toggle behind a precondition (out of scope for this migration —
-- tracked as follow-up).

-- v3 backfill: silently auto-unlist any publicly-listed club that doesn't
-- meet the contract. Affected rows can be re-listed via the settings UI
-- once city/country are populated. No rows are deleted; only the visibility
-- bit is flipped, and downstream queries (`findPublicListings`) already
-- filter `is_public_listing = true AND deleted_at IS NULL`, so the row
-- just drops out of the discovery surface — invisible to riders but the
-- club's own dashboard is unaffected.
UPDATE clubs
SET is_public_listing = FALSE,
    updated_at = NOW()
WHERE is_public_listing = TRUE
  AND (
    city IS NULL
    OR char_length(trim(city)) = 0
    OR country IS NULL
    OR char_length(trim(country)) = 0
  );

ALTER TABLE clubs
  ADD CONSTRAINT clubs_public_listing_requires_contact_check
  CHECK (
    is_public_listing = FALSE
    OR (
      city IS NOT NULL
      AND char_length(trim(city)) > 0
      AND country IS NOT NULL
      AND char_length(trim(country)) > 0
    )
  )
  NOT VALID;

ALTER TABLE clubs
  VALIDATE CONSTRAINT clubs_public_listing_requires_contact_check;
