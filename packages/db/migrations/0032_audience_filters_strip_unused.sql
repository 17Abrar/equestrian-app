-- 2026-05-05 — audit M-1 — strip unused keys from audiences.filters jsonb.
--
-- Background. `AudienceFilters` (TS interface), the three audience Zod
-- validators (POST / PATCH / preview), and the `audiences.filters` jsonb
-- column all carried `hasActivePackage` and `tags` keys, but neither
-- `resolveAudienceMembers` nor `countAudienceMembersBatch` ever
-- evaluated them — the resolver branched on three fields and dropped
-- the rest.
--
-- Two consequences if a row had ever set them (via direct API call or
-- a prior UI iteration):
--   * the live-preview count would not match the eventual recipient
--     list (preview drops the keys; resolver drops the keys; the
--     audience persists them in jsonb, so the user sees a saved filter
--     they cannot reproduce in preview).
--   * a future UI feature exposing either control would inherit the
--     dead state silently.
--
-- This migration prunes both keys from every persisted `filters`
-- payload using the jsonb `#-` (delete-at-path) operator. Rows that
-- never set them are unaffected (`#-` on a missing path is a no-op).
-- The `WHERE` clause limits the rewrite to rows that actually carry
-- one of the keys, so the row's `updated_at` only churns when there's
-- real cleanup to do.
--
-- The Zod `.strict()` validators (POST / PATCH / preview) now reject
-- the keys at the API layer, so future writes can't re-introduce them.
--
-- Idempotent: re-running this migration on an already-cleaned table is
-- a no-op (the `WHERE` matches nothing on the second run).

UPDATE "audiences"
   SET "filters" = ("filters" #- '{hasActivePackage}') #- '{tags}'
 WHERE "filters" ? 'hasActivePackage'
    OR "filters" ? 'tags';
