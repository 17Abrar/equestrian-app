import { neon } from '@neondatabase/serverless';
const sql = neon(process.env.DATABASE_URL);

console.log('=== competitions UNIQUE on (id, club_id) ===');
const c = await sql`SELECT conname FROM pg_constraint WHERE conrelid = (SELECT oid FROM pg_class WHERE relname = 'competitions') AND contype = 'u'`;
for (const x of c) console.log(`  ${x.conname}`);

console.log('\n=== competition_classes.competition_id FK ===');
const cc = await sql`SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conrelid = (SELECT oid FROM pg_class WHERE relname = 'competition_classes') AND contype = 'f'`;
for (const x of cc) console.log(`  ${x.conname} -> ${x.def}`);

console.log('\n=== bookings.provider_payment_id index ===');
const ix = await sql`SELECT indexname FROM pg_indexes WHERE tablename = 'bookings' AND indexname LIKE '%provider%'`;
for (const x of ix) console.log(`  ${x.indexname}`);

console.log('\n=== horse_pairing_history.booking_id FK ===');
const hp = await sql`SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conrelid = (SELECT oid FROM pg_class WHERE relname = 'horse_pairing_history') AND contype = 'f'`;
for (const x of hp) console.log(`  ${x.conname} -> ${x.def}`);

console.log('\n=== orphan checks ===');
const o1 = await sql`SELECT count(*)::int AS n FROM competition_classes c WHERE NOT EXISTS (SELECT 1 FROM competitions co WHERE co.id = c.competition_id AND co.club_id = c.club_id)`;
console.log(`  competition_classes cross-club: ${o1[0].n}`);
const o2 = await sql`SELECT count(*)::int AS n FROM horse_pairing_history h WHERE NOT EXISTS (SELECT 1 FROM bookings b WHERE b.id = h.booking_id AND b.club_id = h.club_id)`;
console.log(`  horse_pairing_history cross-booking-club: ${o2[0].n}`);
