import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL);

const checks = [
  ['community_votes', ['member_id', 'post_id', 'comment_id']],
  ['community_posts', ['author_member_id', 'topic_id']],
  ['community_comments', ['author_member_id', 'post_id']],
  ['lesson_types', ['arena_id']],
  ['rider_profiles', ['parent_member_id']],
];

console.log('=== existing FKs ===');
for (const [t, cols] of checks) {
  for (const col of cols) {
    const r = await sql`
      SELECT conname, confdeltype, pg_get_constraintdef(oid) AS def
      FROM pg_constraint
      WHERE conrelid = (SELECT oid FROM pg_class WHERE relname = ${t})
        AND contype = 'f'`;
    const matches = r.filter((c) => new RegExp(`\\(${col}\\)|\\(${col},`).test(c.def));
    if (matches.length === 0) console.log(`  ${t}.${col}: NO FK`);
    else for (const c of matches) console.log(`  ${t}.${col}: ${c.conname} [del=${c.confdeltype}] -> ${c.def}`);
  }
}

console.log('\n=== existing UNIQUEs / CHECKs on community_votes ===');
const cv = await sql`
  SELECT conname, contype, pg_get_constraintdef(oid) AS def
  FROM pg_constraint
  WHERE conrelid = (SELECT oid FROM pg_class WHERE relname = 'community_votes')`;
for (const c of cv) console.log(`  ${c.conname} [${c.contype}] -> ${c.def}`);

console.log('\n=== community_posts UNIQUEs (target for comments composite) ===');
const cp = await sql`
  SELECT conname, contype FROM pg_constraint
  WHERE conrelid = (SELECT oid FROM pg_class WHERE relname = 'community_posts')
    AND contype IN ('u','p')`;
for (const c of cp) console.log(`  ${c.conname} [${c.contype}]`);

console.log('\n=== orphan checks ===');
const o1 = await sql`SELECT count(*)::int AS n FROM community_votes v JOIN club_members m ON m.id = v.member_id LEFT JOIN community_posts p ON p.id = v.post_id LEFT JOIN community_comments c ON c.id = v.comment_id WHERE TRUE`;
console.log(`  community_votes total rows joinable: ${o1[0].n}`);
const o2 = await sql`SELECT count(*)::int AS n FROM community_votes WHERE member_id IS NOT NULL`;
console.log(`  community_votes total: ${o2[0].n}`);
const o3 = await sql`SELECT count(*)::int AS n FROM community_posts p JOIN club_members m ON m.id = p.author_member_id WHERE m.club_id <> p.author_club_id`;
console.log(`  community_posts mismatched author_club: ${o3[0].n}`);
const o4 = await sql`SELECT count(*)::int AS n FROM community_comments c JOIN club_members m ON m.id = c.author_member_id WHERE m.club_id <> c.author_club_id`;
console.log(`  community_comments mismatched author_club: ${o4[0].n}`);
const o5 = await sql`SELECT count(*)::int AS n FROM lesson_types l JOIN arenas a ON a.id = l.arena_id WHERE l.arena_id IS NOT NULL AND a.club_id <> l.club_id`;
console.log(`  lesson_types arena mismatch: ${o5[0].n}`);
const o6 = await sql`SELECT count(*)::int AS n FROM rider_profiles rp JOIN club_members m ON m.id = rp.parent_member_id WHERE rp.parent_member_id IS NOT NULL AND m.club_id <> rp.club_id`;
console.log(`  rider_profiles parent mismatch: ${o6[0].n}`);
const o7 = await sql`SELECT count(*)::int AS n FROM community_comments c JOIN community_posts p ON p.id = c.post_id WHERE c.author_club_id <> p.author_club_id`;
console.log(`  community_comments cross-post-club: ${o7[0].n}`);
