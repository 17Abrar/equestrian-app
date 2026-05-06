import { neon } from '@neondatabase/serverless';
const sql = neon(process.env.DATABASE_URL);

const checks = [
  ['notifications', ['recipient_member_id', 'club_id']],
  ['club_join_requests', ['reviewed_by_member_id']],
  ['bookings', ['coupon_id', 'package_id']],
  ['payments', ['package_id']],
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

console.log('\n=== column nullability ===');
const cols = await sql`
  SELECT table_name, column_name, is_nullable
  FROM information_schema.columns
  WHERE (table_name = 'notifications' AND column_name = 'club_id')
     OR (table_name = 'club_join_requests' AND column_name IN ('reviewed_by_member_id', 'club_id'))
     OR (table_name = 'bookings' AND column_name IN ('coupon_id', 'package_id', 'club_id'))
     OR (table_name = 'payments' AND column_name IN ('package_id', 'club_id'))
  ORDER BY table_name, column_name`;
for (const c of cols) console.log(`  ${c.table_name}.${c.column_name}: nullable=${c.is_nullable}`);

console.log('\n=== orphan checks ===');
const o1 = await sql`SELECT count(*)::int AS n FROM notifications n WHERE n.club_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM club_members cm WHERE cm.id = n.recipient_member_id AND cm.club_id = n.club_id)`;
console.log(`  notifications recipient_member mismatched club: ${o1[0].n}`);
const o2 = await sql`SELECT count(*)::int AS n FROM club_join_requests j WHERE j.reviewed_by_member_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM club_members cm WHERE cm.id = j.reviewed_by_member_id AND cm.club_id = j.club_id)`;
console.log(`  club_join_requests reviewer mismatch: ${o2[0].n}`);
const o3 = await sql`SELECT count(*)::int AS n FROM bookings b WHERE b.coupon_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM coupons c WHERE c.id = b.coupon_id AND c.club_id = b.club_id)`;
console.log(`  bookings coupon mismatch: ${o3[0].n}`);
const o4 = await sql`SELECT count(*)::int AS n FROM bookings b WHERE b.package_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM rider_packages p WHERE p.id = b.package_id AND p.club_id = b.club_id)`;
console.log(`  bookings package mismatch: ${o4[0].n}`);
const o5 = await sql`SELECT count(*)::int AS n FROM payments p WHERE p.package_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM rider_packages rp WHERE rp.id = p.package_id AND rp.club_id = p.club_id)`;
console.log(`  payments package mismatch: ${o5[0].n}`);
