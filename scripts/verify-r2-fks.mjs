import { neon } from '@neondatabase/serverless';
const sql = neon(process.env.DATABASE_URL);

const want = [
  ['community_votes_member_club_fk', 'a'],
  ['community_votes_post_club_fk', 'a'],
  ['community_votes_comment_club_fk', 'a'],
  ['community_posts_author_member_club_fk', 'a'],
  ['community_comments_author_member_club_fk', 'a'],
  ['community_comments_post_club_fk', 'c'],
  ['lesson_types_arena_club_fk', 'a'],
  ['rider_profiles_parent_member_club_fk', 'n'],
];
let bad = 0;
for (const [name, expect] of want) {
  const r = await sql`SELECT confdeltype FROM pg_constraint WHERE conname = ${name}`;
  if (r.length === 0) { console.log(`MISSING ${name}`); bad++; }
  else if (r[0].confdeltype !== expect) { console.log(`WRONG ${name} got=${r[0].confdeltype} want=${expect}`); bad++; }
  else console.log(`OK ${name} (${r[0].confdeltype})`);
}

const dropped = [
  'community_votes_member_id_club_members_id_fk',
  'community_votes_post_id_community_posts_id_fk',
  'community_votes_comment_id_community_comments_id_fk',
  'community_posts_author_member_id_club_members_id_fk',
  'community_comments_author_member_id_club_members_id_fk',
  'community_comments_post_id_community_posts_id_fk',
  'lesson_types_arena_id_arenas_id_fk',
  'rider_profiles_parent_member_id_club_members_id_fk',
];
for (const name of dropped) {
  const r = await sql`SELECT 1 FROM pg_constraint WHERE conname = ${name}`;
  if (r.length > 0) { console.log(`STILL_PRESENT ${name}`); bad++; }
  else console.log(`DROPPED ${name}`);
}

const uniques = ['community_posts_id_author_club_unique', 'community_comments_id_author_club_unique'];
for (const name of uniques) {
  const r = await sql`SELECT 1 FROM pg_constraint WHERE conname = ${name}`;
  if (r.length === 0) { console.log(`MISSING UNIQUE ${name}`); bad++; }
  else console.log(`UNIQUE OK ${name}`);
}

const cv = await sql`SELECT column_name FROM information_schema.columns WHERE table_name='community_votes' AND column_name='club_id'`;
console.log(cv.length ? 'community_votes.club_id column: OK' : 'community_votes.club_id column: MISSING');
process.exit(bad ? 1 : 0);
