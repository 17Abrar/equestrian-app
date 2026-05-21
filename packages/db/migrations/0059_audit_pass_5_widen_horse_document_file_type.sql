-- Audit pass-5 MED-1 (2026-05-21):
-- Widens `horse_documents.file_type` from varchar(50) → varchar(127) so
-- the column can hold the openxmlformats MIME types the upload form's
-- `accept` list explicitly permits:
--
--   .docx → application/vnd.openxmlformats-officedocument.wordprocessingml.document  (71 chars)
--   .pptx → application/vnd.openxmlformats-officedocument.presentationml.presentation (73 chars)
--   .xlsx → application/vnd.openxmlformats-officedocument.spreadsheetml.sheet         (66 chars)
--
-- Before this migration:
--   1. The user uploaded a .docx via /api/v1/upload → R2 PUT succeeded.
--   2. /api/v1/upload/verify cached (key, "application/vnd...document").
--   3. The route's INSERT against horse_documents bombed with
--      `value too long for type character varying(50)` and surfaced a
--      generic 500 to the user — orphaning the R2 object.
--
-- A widening ALTER on a varchar column is metadata-only in Postgres
-- (no table rewrite, no row scan, instantaneous on any table size).

ALTER TABLE "horse_documents"
  ALTER COLUMN "file_type" TYPE varchar(127);
