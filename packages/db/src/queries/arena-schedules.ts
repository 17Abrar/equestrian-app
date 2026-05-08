// Audit F-55 (2026-05-08 r6): stub for the `arena_schedules` table.
//
// The schema is fully wired (composite FK `arena_schedules_arena_club_fk`,
// row-level columns for `dayOfWeek`, `openTime`, `closeTime`,
// `isMaintenance`, `maintenanceNotes`) but no consumer exists yet.
// When the first consumer ships (likely an arena-availability calendar
// view or a maintenance-window cron), the read query MUST scope by
// `clubId` exactly like every other tenant table:
//
//   await db
//     .select(...)
//     .from(arenaSchedules)
//     .where(eq(arenaSchedules.clubId, ctx.clubId));
//
// The composite FK on `(arena_id, club_id)` blocks cross-tenant FK
// smuggle even if a future writer takes `arenaId` from request input;
// the WHERE on `clubId` is what makes the READ tenant-correct.
//
// This file is intentionally export-free so consumers must add their
// query here (centralized) rather than scatter `db.select(...).from
// (arenaSchedules)` across `apps/web/app/api/v1/...` routes.

export {};
