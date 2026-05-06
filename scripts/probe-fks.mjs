import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL);

const expected = [
  ['horses_owner_member_club_fk', 'a'],
  ['booking_slots_lesson_type_club_fk', 'a'],
  ['booking_slots_arena_club_fk', 'a'],
  ['booking_slots_coach_member_club_fk', 'a'],
  ['bookings_slot_club_fk', 'c'],
  ['bookings_booked_by_member_club_fk', 'a'],
  ['bookings_cancelled_by_member_club_fk', 'n'],
  ['waitlist_slot_club_fk', 'c'],
  ['competition_entries_class_club_fk', 'c'],
  ['competition_entries_rider_member_club_fk', 'a'],
  ['competition_results_entry_club_fk', 'c'],
  ['horse_health_records_created_by_member_club_fk', 'a'],
  ['horse_medication_logs_medication_club_fk', 'c'],
  ['horse_medication_logs_administered_by_member_club_fk', 'a'],
  ['horse_documents_uploaded_by_member_club_fk', 'a'],
  ['groom_tasks_assigned_to_member_club_fk', 'a'],
  ['groom_tasks_completed_by_member_club_fk', 'n'],
  ['rider_achievements_rider_member_club_fk', 'a'],
  ['invoices_livery_contract_club_fk', 'a'],
  ['payments_livery_contract_club_fk', 'n'],
  ['payments_invoice_club_fk', 'n'],
  ['expenses_created_by_member_club_fk', 'n'],
  ['packages_lesson_type_club_fk', 'n'],
  ['rider_packages_package_club_fk', 'a'],
  ['rider_packages_rider_member_club_fk', 'a'],
  ['coupons_created_by_member_club_fk', 'a'],
  ['coupon_usages_coupon_club_fk', 'c'],
  ['coupon_usages_rider_member_club_fk', 'a'],
  ['coupon_usages_booking_club_fk', 'n'],
  ['audiences_created_by_member_club_fk', 'n'],
  ['competitions_arena_club_fk', 'a'],
];

let bad = 0;
for (const [name, want] of expected) {
  const r = await sql`SELECT confdeltype FROM pg_constraint WHERE conname = ${name}`;
  if (r.length === 0) { console.log(`MISSING: ${name}`); bad++; }
  else if (r[0].confdeltype !== want) { console.log(`WRONG: ${name} got=${r[0].confdeltype} want=${want}`); bad++; }
}
console.log(`OK: ${expected.length - bad}/${expected.length}`);

const dropped = [
  'horses_owner_member_id_club_members_id_fk',
  'booking_slots_lesson_type_id_lesson_types_id_fk',
  'bookings_slot_id_booking_slots_id_fk',
  'bookings_booked_by_member_id_club_members_id_fk',
  'waitlist_slot_id_booking_slots_id_fk',
  'competition_entries_class_id_competition_classes_id_fk',
  'horse_medication_logs_medication_id_horse_medications_id_fk',
  'invoices_livery_contract_id_livery_contracts_id_fk',
  'payments_livery_contract_id_livery_contracts_id_fk',
  'payments_invoice_id_invoices_id_fk',
  'rider_packages_package_id_packages_id_fk',
  'coupon_usages_coupon_id_coupons_id_fk',
  'coupon_usages_booking_id_bookings_id_fk',
  'audiences_created_by_member_id_fkey',
  'competitions_arena_id_arenas_id_fk',
  'horses_id_club_id_unique',
];
let stillThere = 0;
for (const name of dropped) {
  const r = await sql`SELECT 1 FROM pg_constraint WHERE conname = ${name}`;
  if (r.length > 0) { console.log(`STILL_PRESENT: ${name}`); stillThere++; }
}
console.log(`DROPPED OK: ${dropped.length - stillThere}/${dropped.length}`);

const parents = ['booking_slots','lesson_types','arenas','livery_contracts','invoices','competition_classes','competition_entries','horse_medications','packages','coupons'];
let parentsOk = 0;
for (const t of parents) {
  const r = await sql`
    SELECT conname FROM pg_constraint
    WHERE conrelid = (SELECT oid FROM pg_class WHERE relname = ${t})
      AND conname = ${`${t}_id_club_unique`}`;
  if (r.length === 0) console.log(`MISSING UNIQUE: ${t}_id_club_unique`);
  else parentsOk++;
}
console.log(`PARENT UNIQUES OK: ${parentsOk}/${parents.length}`);

process.exit(bad + stillThere ? 1 : 0);
