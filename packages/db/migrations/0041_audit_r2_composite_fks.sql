-- 2026-05-06 audit (round 2 — comprehensive). Closes F-3, F-4, F-5,
-- F-6, F-10. Brings the community schema + lesson_types.arena_id +
-- rider_profiles.parent_member_id under the composite-FK invariant
-- the rest of the schema enforces.
--
-- The community feature isn't shipped yet (no /api/v1/community/**
-- routes exposed), so this is defense-in-depth ahead of the route
-- surface landing. Pre-clean DELETE blocks intentionally omitted —
-- pre-flight probe shows zero orphan / cross-tenant rows on every
-- relation. The IF NOT EXISTS guards make the migration idempotent.

-- ─── F-3 — community_votes club_id + composite FK ──────────────────────

ALTER TABLE "community_votes" ADD COLUMN IF NOT EXISTS "club_id" UUID;

UPDATE "community_votes" v
   SET club_id = (SELECT cm.club_id FROM "club_members" cm WHERE cm.id = v.member_id)
 WHERE club_id IS NULL;

ALTER TABLE "community_votes" ALTER COLUMN "club_id" SET NOT NULL;

ALTER TABLE "community_votes"
  DROP CONSTRAINT IF EXISTS "community_votes_member_id_club_members_id_fk";
ALTER TABLE "community_votes"
  DROP CONSTRAINT IF EXISTS "community_votes_post_id_community_posts_id_fk";
ALTER TABLE "community_votes"
  DROP CONSTRAINT IF EXISTS "community_votes_comment_id_community_comments_id_fk";

DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'community_votes_member_club_fk') THEN
  ALTER TABLE "community_votes" ADD CONSTRAINT "community_votes_member_club_fk"
    FOREIGN KEY ("member_id", "club_id") REFERENCES "club_members"(id, club_id);
END IF; END $$;

CREATE INDEX IF NOT EXISTS "idx_community_votes_club" ON "community_votes"(club_id);

-- ─── F-4 — community_posts + community_comments author composites ──────

ALTER TABLE "community_posts"
  DROP CONSTRAINT IF EXISTS "community_posts_author_member_id_club_members_id_fk";
ALTER TABLE "community_comments"
  DROP CONSTRAINT IF EXISTS "community_comments_author_member_id_club_members_id_fk";

DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'community_posts_author_member_club_fk') THEN
  ALTER TABLE "community_posts" ADD CONSTRAINT "community_posts_author_member_club_fk"
    FOREIGN KEY ("author_member_id", "author_club_id") REFERENCES "club_members"(id, club_id);
END IF; END $$;

DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'community_comments_author_member_club_fk') THEN
  ALTER TABLE "community_comments" ADD CONSTRAINT "community_comments_author_member_club_fk"
    FOREIGN KEY ("author_member_id", "author_club_id") REFERENCES "club_members"(id, club_id);
END IF; END $$;

-- ─── F-10 partial — community_posts/comments unique + comment.post_id composite ─

DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'community_posts_id_author_club_unique') THEN
  ALTER TABLE "community_posts" ADD CONSTRAINT "community_posts_id_author_club_unique" UNIQUE (id, author_club_id);
END IF; END $$;

DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'community_comments_id_author_club_unique') THEN
  ALTER TABLE "community_comments" ADD CONSTRAINT "community_comments_id_author_club_unique" UNIQUE (id, author_club_id);
END IF; END $$;

ALTER TABLE "community_comments"
  DROP CONSTRAINT IF EXISTS "community_comments_post_id_community_posts_id_fk";

DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'community_comments_post_club_fk') THEN
  ALTER TABLE "community_comments" ADD CONSTRAINT "community_comments_post_club_fk"
    FOREIGN KEY ("post_id", "author_club_id") REFERENCES "community_posts"(id, author_club_id)
    ON DELETE CASCADE;
END IF; END $$;

-- F-3 follow-on: composite FKs from votes to posts/comments now that
-- the parent uniques exist.

DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'community_votes_post_club_fk') THEN
  ALTER TABLE "community_votes" ADD CONSTRAINT "community_votes_post_club_fk"
    FOREIGN KEY ("post_id", "club_id") REFERENCES "community_posts"(id, author_club_id);
END IF; END $$;

DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'community_votes_comment_club_fk') THEN
  ALTER TABLE "community_votes" ADD CONSTRAINT "community_votes_comment_club_fk"
    FOREIGN KEY ("comment_id", "club_id") REFERENCES "community_comments"(id, author_club_id);
END IF; END $$;

-- F-10 community_posts.topic_id INTENTIONALLY NOT REWRITTEN. Topics
-- can be system-level with `club_id IS NULL` — a naive composite would
-- block per-club posts from referencing system topics. Solving that
-- requires either (a) a partial constraint that permits NULL-club
-- topics or (b) materializing the topic's club onto the post. Both
-- are non-trivial and depend on the eventual community-feature
-- semantics; deferring until the feature ships and the routes lock
-- the model.

-- ─── F-5 — lesson_types.arena_id composite ─────────────────────────────

ALTER TABLE "lesson_types"
  DROP CONSTRAINT IF EXISTS "lesson_types_arena_id_arenas_id_fk";

DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lesson_types_arena_club_fk') THEN
  ALTER TABLE "lesson_types" ADD CONSTRAINT "lesson_types_arena_club_fk"
    FOREIGN KEY ("arena_id", "club_id") REFERENCES "arenas"(id, club_id);
END IF; END $$;

-- ─── F-6 — rider_profiles.parent_member_id composite ───────────────────

ALTER TABLE "rider_profiles"
  DROP CONSTRAINT IF EXISTS "rider_profiles_parent_member_id_club_members_id_fk";

DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rider_profiles_parent_member_club_fk') THEN
  ALTER TABLE "rider_profiles" ADD CONSTRAINT "rider_profiles_parent_member_club_fk"
    FOREIGN KEY ("parent_member_id", "club_id") REFERENCES "club_members"(id, club_id)
    ON DELETE SET NULL;
END IF; END $$;
