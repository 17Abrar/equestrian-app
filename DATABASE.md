# Database Schema — Equestrian Club Management Platform

Database: PostgreSQL (Neon Serverless)
ORM: Drizzle ORM
Every table has Row-Level Security (RLS) enabled.

---

## CORE RULES

1. Every table MUST have: `id` (uuid, primary key), `club_id` (uuid, foreign key to clubs), `created_at` (timestamp), `updated_at` (timestamp)
2. Exception: The `clubs` table itself does not have a `club_id` foreign key
3. Exception: The `users` table is managed by Clerk — we store minimal user data locally
4. All IDs are UUIDs (never auto-increment integers)
5. All timestamps are `timestamptz` (timestamp with timezone)
6. Never hard delete user-facing records. We use three deletion patterns depending on the entity — see "Deletion patterns" below.
7. All monetary amounts stored as integers in smallest currency unit (fils for AED, cents for USD)
8. All foreign keys have explicit ON DELETE behavior
9. Index all columns used in WHERE, JOIN, and ORDER BY clauses
10. Use ENUMs for fixed sets of values (status, role, type)

---

## Deletion patterns

Audit F-65 (2026-05-07 r4): the platform never hard-deletes user-facing rows, but it uses three different soft-delete idioms depending on the table's lifecycle. New tables MUST pick one of these three patterns; do not invent a fourth.

| Pattern | Tables | Mechanism | Why this shape |
|---|---|---|---|
| `deleted_at` timestamp | `clubs`, `horses` | Set `deleted_at = now()` on delete; queries filter `WHERE deleted_at IS NULL`. Restorable. | Top-level entities with their own URL space and detail pages. Soft-delete preserves audit trail and supports GDPR right-to-erasure flows that need to scrub but keep referential integrity. |
| Status enum | `bookings` (`status='cancelled'` + `cancelled_at`), `invoices` (`status='void'`), `livery_invoices` (`status='void'`), `platform_subscription_invoices` (`status='void'`), `coupons` (`status='expired'`/`'paused'`) | Mutate the row's status enum to a terminal "voided" value. Not restorable. | Financial / scheduled rows that need a non-null lifecycle state for downstream queries (revenue rollups, dunning, refund eligibility). A `deleted_at`-style filter would silently exclude voided rows from compliance / accounting reporting. |
| Deactivation flag | `club_members` (`is_active=false` via `deactivateMember()`), `arenas` (`is_active=false`), `lesson_types` (`is_active=false`) | Flip `is_active` to false. Restorable. | Configuration entities — coaches/staff who leave, arenas taken out of rotation, lesson types renamed. Forward-creation paths (booking-slot create) check `is_active=true` to keep deactivated rows out of pickers without losing historical FKs from past bookings. |

**Append-only tables** (`audit_log`, `webhook_events`, `competition_results`, `community_votes`, `horse_pairing_history`, `coupon_usages`, `rider_achievements`, `horse_medication_logs`, `horse_care_reminder_sends`, `waitlist`) have no delete pattern by design — they're write-once historical records and contain no user-deletable content.

---

## PII / PHI columns by table

Audit F-76 (2026-05-07 r4): the rows below tell a compliance reviewer ("what data do you process about me?") which fields qualify. Encryption-at-rest applies to a narrow whitelist (`HEALTH_ENCRYPTED_FIELDS`, `MEDICATION_ENCRYPTED_FIELDS` in `packages/db/src/crypto.ts`); other PII fields are stored as plaintext by design because they're load-bearing for joins, indexes, search, and email composition.

### Encrypted-at-rest fields

| Table | Column | Reason |
|---|---|---|
| `horses` | `medical_notes` | Free-text vet notes; high-sensitivity PHI |
| `horse_health_records` | `description`, `diagnosis`, `treatment`, `notes` | Diagnostic and treatment text |
| `horse_medications` | `notes` | Vet-prescribed regimen detail |
| `payment_accounts` | `encrypted_credentials` | Provider API keys (Stripe `sk_…`, N-Genius outlet creds, Ziina API key + webhook secret) |

### Plaintext PII / PHI by design

| Table | Column | Reason |
|---|---|---|
| `club_members` | `display_name`, `email`, `phone`, `clerk_id` | Contact info; `clerk_id` is the auth foreign key. Used in every email and in pickers — encryption would break joins and search |
| `rider_profiles` | `date_of_birth`, `weight_kg`, `height_cm` | Used in horse-matching algorithm at booking time; encryption would force per-row decryption on every match |
| `horses` | `name`, `breed`, `microchip_number`, `passport_number`, `insurance_policy_number`, `insurance_provider` | Identifiers used in lists, search, and pickers |
| `horse_health_records` | `vet_name`, `title` | Used in care-reminder email subject + body (Round 6.2) |
| `horse_medications` | `medication_name`, `dosage` | Used in medication-end reminder email body |
| `bookings` / `livery_invoices` / `platform_subscription_invoices` | `notes` (where present), guest fields | Composing receipts and reminders |
| `audit_log` | `actor_member_id`, `ip_address`, `user_agent`, `changes` (JSONB) | Operational audit trail. Member IDs are joinable to PII — see also F-47 |

GDPR / right-to-erasure: a member-deletion sweep MUST scrub the encrypted-at-rest fields above (re-write the `v1:` envelope to `v1:[REDACTED]`), null the contact info on `club_members`, and stamp `deleted_at` on the row. The audit_log retention cron (`pruneAuditLog`) handles older rows automatically.

---

## ENUMS

```sql
CREATE TYPE horse_status AS ENUM ('available', 'resting', 'injured', 'retired', 'off_site', 'sold');
CREATE TYPE skill_level AS ENUM ('beginner', 'intermediate', 'advanced');
CREATE TYPE booking_status AS ENUM ('pending', 'confirmed', 'completed', 'cancelled', 'no_show');
CREATE TYPE payment_status AS ENUM ('pending', 'paid', 'partial', 'refunded', 'failed', 'overdue');
CREATE TYPE payment_method AS ENUM ('card', 'apple_pay', 'google_pay', 'tabby', 'tamara', 'knet', 'mada', 'benefit', 'cash', 'card_in_person', 'package_credit', 'bank_transfer');
CREATE TYPE lesson_type AS ENUM ('group', 'semi_private', 'private', 'desert_ride', 'beach_ride', 'endurance', 'camp', 'clinic', 'custom');
CREATE TYPE user_role AS ENUM ('club_admin', 'club_manager', 'coach', 'horse_owner', 'rider', 'parent', 'groom', 'veterinarian');
CREATE TYPE livery_type AS ENUM ('full', 'part', 'diy');
CREATE TYPE coupon_status AS ENUM ('active', 'paused', 'expired', 'exhausted');
CREATE TYPE coupon_discount_type AS ENUM ('percentage', 'fixed');
CREATE TYPE invoice_status AS ENUM ('draft', 'sent', 'paid', 'overdue', 'void');
CREATE TYPE subscription_status AS ENUM ('active', 'past_due', 'cancelled', 'trialing');
CREATE TYPE task_status AS ENUM ('pending', 'in_progress', 'completed', 'skipped');
CREATE TYPE post_type AS ENUM ('discussion', 'photo', 'video', 'poll');
CREATE TYPE file_category AS ENUM ('medical_report', 'blood_test', 'xray', 'competition_result', 'registration', 'insurance', 'purchase_agreement', 'vaccination_certificate', 'other');
CREATE TYPE horse_sale_status AS ENUM ('not_for_sale', 'for_sale', 'sold');
```

---

## TABLES

### clubs
The top-level tenant. Everything belongs to a club.

```sql
CREATE TABLE clubs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  slug VARCHAR(100) UNIQUE NOT NULL,          -- URL-friendly identifier
  email VARCHAR(255),
  phone VARCHAR(50),
  address TEXT,
  city VARCHAR(100),
  country VARCHAR(100),
  timezone VARCHAR(50) NOT NULL DEFAULT 'Asia/Dubai',
  currency VARCHAR(3) NOT NULL DEFAULT 'AED',
  logo_url TEXT,
  cover_photo_url TEXT,
  description TEXT,
  website_url TEXT,
  social_instagram TEXT,
  social_facebook TEXT,
  social_tiktok TEXT,

  -- Stripe
  stripe_account_id VARCHAR(255),             -- Stripe Connect account
  stripe_customer_id VARCHAR(255),            -- For paying SaaS subscription
  stripe_subscription_id VARCHAR(255),

  -- Subscription
  subscription_tier VARCHAR(20) NOT NULL DEFAULT 'trial',  -- trial, starter, professional, enterprise
  subscription_status subscription_status NOT NULL DEFAULT 'trialing',
  trial_ends_at TIMESTAMPTZ,
  platform_fee_percent DECIMAL(4,2) NOT NULL DEFAULT 3.5,  -- Transaction fee based on tier

  -- Booking settings
  advance_booking_days INT NOT NULL DEFAULT 30,
  booking_cutoff_hours INT NOT NULL DEFAULT 2,
  cancellation_notice_hours INT NOT NULL DEFAULT 24,
  default_lesson_duration_minutes INT NOT NULL DEFAULT 60,
  allow_overbooking BOOLEAN NOT NULL DEFAULT false,
  overbooking_limit INT NOT NULL DEFAULT 0,

  -- Metadata
  clerk_org_id VARCHAR(255) UNIQUE,           -- Links to Clerk Organization
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX idx_clubs_clerk_org_id ON clubs(clerk_org_id);
CREATE INDEX idx_clubs_slug ON clubs(slug);
```

### club_members
Links users to clubs with their role. One user can be in multiple clubs.

```sql
CREATE TABLE club_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id UUID NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  clerk_user_id VARCHAR(255) NOT NULL,        -- Clerk user ID
  role user_role NOT NULL,
  display_name VARCHAR(255),
  email VARCHAR(255),
  phone VARCHAR(50),
  is_active BOOLEAN NOT NULL DEFAULT true,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE(club_id, clerk_user_id)
);

CREATE INDEX idx_club_members_club ON club_members(club_id);
CREATE INDEX idx_club_members_user ON club_members(clerk_user_id);
CREATE INDEX idx_club_members_role ON club_members(club_id, role);
```

### rider_profiles
Extended profile data for riders (stored separately for privacy — weight/height used for horse matching).

```sql
CREATE TABLE rider_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id UUID NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  member_id UUID NOT NULL REFERENCES club_members(id) ON DELETE CASCADE,
  date_of_birth DATE,
  weight_kg DECIMAL(5,1),
  height_cm DECIMAL(5,1),
  skill_level skill_level NOT NULL DEFAULT 'beginner',
  emergency_contact_name VARCHAR(255),
  emergency_contact_phone VARCHAR(50),
  emergency_contact_relation VARCHAR(100),
  medical_notes TEXT,                          -- Allergies, conditions
  total_lessons_completed INT NOT NULL DEFAULT 0,
  parent_member_id UUID REFERENCES club_members(id),  -- If rider is a minor

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_rider_profiles_club ON rider_profiles(club_id);
CREATE INDEX idx_rider_profiles_member ON rider_profiles(member_id);
CREATE INDEX idx_rider_profiles_skill ON rider_profiles(club_id, skill_level);
```

### horses

```sql
CREATE TABLE horses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id UUID NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  owner_member_id UUID REFERENCES club_members(id),   -- NULL if club-owned

  -- Basic info
  name VARCHAR(255) NOT NULL,
  barn_name VARCHAR(255),
  breed VARCHAR(100),
  gender VARCHAR(20),
  date_of_birth DATE,
  color VARCHAR(100),                          -- bay, chestnut, grey, etc.
  height_hands DECIMAL(4,1),                   -- Height in hands
  weight_kg DECIMAL(6,1),
  markings TEXT,                               -- star, blaze, socks, etc.
  microchip_number VARCHAR(100),
  passport_number VARCHAR(100),
  registration_number VARCHAR(100),

  -- Status and capabilities
  status horse_status NOT NULL DEFAULT 'available',
  skill_level skill_level NOT NULL DEFAULT 'beginner',
  temperament TEXT[],                          -- Array: ['calm', 'responsive', 'bombproof']
  weight_limit_kg DECIMAL(5,1),               -- Max rider weight
  min_rider_age INT,
  max_lessons_per_day INT NOT NULL DEFAULT 3,
  mandatory_rest_days INT NOT NULL DEFAULT 1,  -- Rest days per week

  -- Value and sale
  sale_status horse_sale_status NOT NULL DEFAULT 'not_for_sale',
  purchase_price INT,                          -- In smallest currency unit
  current_value INT,
  sale_price INT,
  sale_date DATE,
  buyer_name VARCHAR(255),

  -- Gear sizing
  saddle_size VARCHAR(50),
  girth_size VARCHAR(50),
  bridle_size VARCHAR(50),
  bit_type VARCHAR(100),
  bit_size VARCHAR(50),
  blanket_size VARCHAR(50),
  boots_size VARCHAR(50),
  gear_notes TEXT,

  -- Insurance
  insurance_provider VARCHAR(255),
  insurance_policy_number VARCHAR(100),
  insurance_coverage TEXT,
  insurance_expiry DATE,

  -- Photos
  primary_photo_url TEXT,
  photo_urls TEXT[],                           -- Array of photo URLs

  -- Metadata
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ                       -- Soft delete
);

CREATE INDEX idx_horses_club ON horses(club_id);
CREATE INDEX idx_horses_status ON horses(club_id, status);
CREATE INDEX idx_horses_skill ON horses(club_id, skill_level);
CREATE INDEX idx_horses_owner ON horses(owner_member_id);
CREATE INDEX idx_horses_deleted ON horses(deleted_at);
```

### horse_health_records

```sql
CREATE TABLE horse_health_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id UUID NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  horse_id UUID NOT NULL REFERENCES horses(id) ON DELETE CASCADE,

  record_type VARCHAR(50) NOT NULL,            -- vaccination, vet_visit, dental, deworming, blood_test, injury, condition, allergy
  title VARCHAR(255) NOT NULL,
  description TEXT,                            -- Encrypted for sensitive records
  date DATE NOT NULL,
  next_due_date DATE,
  vet_name VARCHAR(255),
  vet_clinic VARCHAR(255),
  diagnosis TEXT,                              -- Encrypted
  treatment TEXT,                              -- Encrypted
  cost INT,                                    -- In smallest currency unit
  recovery_time_days INT,
  follow_up_needed BOOLEAN NOT NULL DEFAULT false,
  follow_up_date DATE,
  batch_number VARCHAR(100),                   -- For vaccinations
  product_used VARCHAR(255),                   -- For deworming
  document_urls TEXT[],                        -- Attached files

  created_by_member_id UUID REFERENCES club_members(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_health_records_horse ON horse_health_records(horse_id);
CREATE INDEX idx_health_records_club ON horse_health_records(club_id);
CREATE INDEX idx_health_records_type ON horse_health_records(horse_id, record_type);
CREATE INDEX idx_health_records_next_due ON horse_health_records(next_due_date);
```

### horse_medications

```sql
CREATE TABLE horse_medications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id UUID NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  horse_id UUID NOT NULL REFERENCES horses(id) ON DELETE CASCADE,

  medication_name VARCHAR(255) NOT NULL,
  dosage VARCHAR(100) NOT NULL,
  frequency VARCHAR(100) NOT NULL,             -- 'twice daily', 'every 8 hours', etc.
  time_of_day TEXT[],                          -- ['06:00', '18:00']
  start_date DATE NOT NULL,
  end_date DATE,                               -- NULL = ongoing
  is_active BOOLEAN NOT NULL DEFAULT true,
  prescribed_by VARCHAR(255),
  notes TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_medications_horse ON horse_medications(horse_id);
CREATE INDEX idx_medications_active ON horse_medications(horse_id, is_active);
```

### horse_medication_logs

```sql
CREATE TABLE horse_medication_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id UUID NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  medication_id UUID NOT NULL REFERENCES horse_medications(id) ON DELETE CASCADE,
  horse_id UUID NOT NULL REFERENCES horses(id) ON DELETE CASCADE,

  administered_at TIMESTAMPTZ NOT NULL,
  administered_by_member_id UUID REFERENCES club_members(id),
  was_administered BOOLEAN NOT NULL DEFAULT true,  -- false = missed/skipped
  skip_reason TEXT,
  notes TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_med_logs_medication ON horse_medication_logs(medication_id);
CREATE INDEX idx_med_logs_date ON horse_medication_logs(administered_at);
```

### horse_feeding_plans

```sql
CREATE TABLE horse_feeding_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id UUID NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  horse_id UUID NOT NULL REFERENCES horses(id) ON DELETE CASCADE,

  meal_name VARCHAR(100) NOT NULL,             -- 'morning', 'midday', 'evening'
  feed_type VARCHAR(255),
  quantity_kg DECIMAL(5,2),
  supplements TEXT[],
  notes TEXT,
  time_of_day TIME,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_feeding_plans_horse ON horse_feeding_plans(horse_id);
```

### horse_feed_tracker

```sql
CREATE TABLE horse_feed_tracker (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id UUID NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,

  feed_type VARCHAR(255) NOT NULL,
  total_kg DECIMAL(8,2) NOT NULL,
  horses_eating_count INT NOT NULL,
  daily_consumption_kg DECIMAL(6,2) NOT NULL,  -- Calculated
  purchased_at DATE NOT NULL,
  estimated_empty_date DATE NOT NULL,          -- Calculated
  alert_sent BOOLEAN NOT NULL DEFAULT false,
  cost INT,                                    -- Purchase cost

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_feed_tracker_club ON horse_feed_tracker(club_id);
CREATE INDEX idx_feed_tracker_empty ON horse_feed_tracker(estimated_empty_date);
```

### horse_exercise_schedules

```sql
CREATE TABLE horse_exercise_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id UUID NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  horse_id UUID NOT NULL REFERENCES horses(id) ON DELETE CASCADE,

  day_of_week INT NOT NULL,                    -- 0=Sunday, 6=Saturday
  exercise_type VARCHAR(100) NOT NULL,         -- flatwork, jumping, hacking, lunging, turnout, rest
  duration_minutes INT,
  intensity VARCHAR(20),                       -- light, moderate, intense
  notes TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_exercise_horse ON horse_exercise_schedules(horse_id);
```

### horse_documents

```sql
CREATE TABLE horse_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id UUID NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  horse_id UUID NOT NULL REFERENCES horses(id) ON DELETE CASCADE,

  file_name VARCHAR(255) NOT NULL,
  file_url TEXT NOT NULL,                      -- R2 key/URL
  file_size_bytes INT,
  file_type VARCHAR(50),                       -- pdf, jpg, png, etc.
  category file_category NOT NULL DEFAULT 'other',
  description TEXT,
  uploaded_by_member_id UUID REFERENCES club_members(id),

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_documents_horse ON horse_documents(horse_id);
CREATE INDEX idx_documents_category ON horse_documents(horse_id, category);
```

### horse_pairing_history

```sql
CREATE TABLE horse_pairing_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id UUID NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  horse_id UUID NOT NULL REFERENCES horses(id) ON DELETE CASCADE,
  rider_member_id UUID NOT NULL REFERENCES club_members(id) ON DELETE CASCADE,
  booking_id UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,

  rating INT CHECK (rating >= 1 AND rating <= 5),   -- Coach rates the pairing 1-5
  notes TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_pairing_horse_rider ON horse_pairing_history(horse_id, rider_member_id);
```

### arenas

```sql
CREATE TABLE arenas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id UUID NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,

  name VARCHAR(255) NOT NULL,
  capacity INT,
  surface_type VARCHAR(100),                   -- sand, grass, rubber, etc.
  has_lighting BOOLEAN NOT NULL DEFAULT false,
  is_indoor BOOLEAN NOT NULL DEFAULT false,
  is_active BOOLEAN NOT NULL DEFAULT true,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_arenas_club ON arenas(club_id);
```

### arena_schedules

```sql
CREATE TABLE arena_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id UUID NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  arena_id UUID NOT NULL REFERENCES arenas(id) ON DELETE CASCADE,

  day_of_week INT NOT NULL,
  open_time TIME NOT NULL,
  close_time TIME NOT NULL,
  is_maintenance BOOLEAN NOT NULL DEFAULT false,
  maintenance_notes TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_arena_schedules ON arena_schedules(arena_id, day_of_week);
```

### lesson_types

```sql
CREATE TABLE lesson_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id UUID NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,

  name VARCHAR(255) NOT NULL,
  type lesson_type NOT NULL,
  description TEXT,
  duration_minutes INT NOT NULL DEFAULT 60,
  price INT NOT NULL,                          -- In smallest currency unit
  currency VARCHAR(3) NOT NULL DEFAULT 'AED',
  max_riders INT NOT NULL DEFAULT 1,
  min_riders INT NOT NULL DEFAULT 1,           -- Minimum to run
  max_sessions_per_day INT,
  arena_id UUID REFERENCES arenas(id),
  is_active BOOLEAN NOT NULL DEFAULT true,
  color VARCHAR(7),                            -- Hex color for calendar

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_lesson_types_club ON lesson_types(club_id);
```

### booking_slots

```sql
CREATE TABLE booking_slots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id UUID NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  lesson_type_id UUID NOT NULL REFERENCES lesson_types(id),
  arena_id UUID REFERENCES arenas(id),
  coach_member_id UUID REFERENCES club_members(id),

  date DATE NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  max_riders INT NOT NULL,
  current_riders INT NOT NULL DEFAULT 0,
  is_cancelled BOOLEAN NOT NULL DEFAULT false,
  cancellation_reason TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_slots_club_date ON booking_slots(club_id, date);
CREATE INDEX idx_slots_coach ON booking_slots(coach_member_id, date);
CREATE INDEX idx_slots_arena ON booking_slots(arena_id, date);
```

### bookings

```sql
CREATE TABLE bookings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id UUID NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  slot_id UUID NOT NULL REFERENCES booking_slots(id),
  rider_member_id UUID NOT NULL REFERENCES club_members(id),
  horse_id UUID REFERENCES horses(id),
  booked_by_member_id UUID NOT NULL REFERENCES club_members(id),  -- Could be parent booking for child

  status booking_status NOT NULL DEFAULT 'pending',
  payment_status payment_status NOT NULL DEFAULT 'pending',
  payment_method payment_method,
  amount INT,                                  -- In smallest currency unit
  currency VARCHAR(3) NOT NULL DEFAULT 'AED',
  discount_amount INT DEFAULT 0,
  coupon_id UUID REFERENCES coupons(id),
  package_id UUID REFERENCES rider_packages(id),

  -- Stripe
  stripe_payment_intent_id VARCHAR(255),

  -- Check-in
  checked_in_at TIMESTAMPTZ,
  qr_code VARCHAR(100),

  -- Coach notes (after lesson)
  coach_notes TEXT,
  rider_skill_assessment skill_level,

  -- Smart match
  horse_match_score INT,                       -- Score from matching algorithm
  horse_match_auto BOOLEAN NOT NULL DEFAULT true,  -- Was horse auto-assigned?

  cancellation_reason TEXT,
  cancelled_at TIMESTAMPTZ,
  cancelled_by_member_id UUID REFERENCES club_members(id),

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_bookings_club ON bookings(club_id);
CREATE INDEX idx_bookings_rider ON bookings(rider_member_id);
CREATE INDEX idx_bookings_slot ON bookings(slot_id);
CREATE INDEX idx_bookings_horse ON bookings(horse_id);
CREATE INDEX idx_bookings_status ON bookings(club_id, status);
CREATE INDEX idx_bookings_date ON bookings(club_id, created_at);
CREATE INDEX idx_bookings_stripe ON bookings(stripe_payment_intent_id);
```

### waitlist

```sql
CREATE TABLE waitlist (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id UUID NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  slot_id UUID NOT NULL REFERENCES booking_slots(id),
  rider_member_id UUID NOT NULL REFERENCES club_members(id),

  position INT NOT NULL,
  notified_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,                      -- 15-minute acceptance window
  status VARCHAR(20) NOT NULL DEFAULT 'waiting',  -- waiting, notified, accepted, expired, cancelled

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE(slot_id, rider_member_id)
);

CREATE INDEX idx_waitlist_slot ON waitlist(slot_id, position);
```

### packages

```sql
CREATE TABLE packages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id UUID NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,

  name VARCHAR(255) NOT NULL,
  description TEXT,
  lesson_type_id UUID REFERENCES lesson_types(id),  -- NULL = any lesson type
  total_credits INT NOT NULL,
  price INT NOT NULL,
  currency VARCHAR(3) NOT NULL DEFAULT 'AED',
  validity_days INT NOT NULL DEFAULT 90,       -- How many days before credits expire
  is_active BOOLEAN NOT NULL DEFAULT true,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_packages_club ON packages(club_id);
```

### rider_packages

```sql
CREATE TABLE rider_packages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id UUID NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  package_id UUID NOT NULL REFERENCES packages(id),
  rider_member_id UUID NOT NULL REFERENCES club_members(id),

  total_credits INT NOT NULL,
  used_credits INT NOT NULL DEFAULT 0,
  remaining_credits INT GENERATED ALWAYS AS (total_credits - used_credits) STORED,
  purchased_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  payment_status payment_status NOT NULL DEFAULT 'pending',
  stripe_payment_intent_id VARCHAR(255),

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_rider_packages_rider ON rider_packages(rider_member_id);
CREATE INDEX idx_rider_packages_expiry ON rider_packages(expires_at);
```

### coupons

```sql
CREATE TABLE coupons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id UUID NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,

  code VARCHAR(50) NOT NULL,
  discount_type coupon_discount_type NOT NULL,
  discount_value INT NOT NULL,                 -- Percentage (0-100) or fixed amount in smallest currency unit
  max_discount INT,                            -- Cap for percentage discounts
  applicable_types lesson_type[],              -- NULL = all types
  minimum_amount INT,                          -- Minimum order amount
  max_uses INT,                                -- NULL = unlimited
  max_uses_per_rider INT,                      -- NULL = unlimited
  usage_count INT NOT NULL DEFAULT 0,
  first_time_only BOOLEAN NOT NULL DEFAULT false,
  is_stackable BOOLEAN NOT NULL DEFAULT false,
  status coupon_status NOT NULL DEFAULT 'active',
  starts_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,

  created_by_member_id UUID REFERENCES club_members(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE(club_id, code)
);

CREATE INDEX idx_coupons_club ON coupons(club_id);
CREATE INDEX idx_coupons_code ON coupons(club_id, code);
CREATE INDEX idx_coupons_status ON coupons(club_id, status);
```

### coupon_usages

```sql
CREATE TABLE coupon_usages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id UUID NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  coupon_id UUID NOT NULL REFERENCES coupons(id) ON DELETE CASCADE,
  rider_member_id UUID NOT NULL REFERENCES club_members(id),
  booking_id UUID REFERENCES bookings(id),

  original_amount INT NOT NULL,
  discount_amount INT NOT NULL,
  final_amount INT NOT NULL,
  booking_type VARCHAR(50),

  used_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_coupon_usages_coupon ON coupon_usages(coupon_id);
CREATE INDEX idx_coupon_usages_rider ON coupon_usages(coupon_id, rider_member_id);
```

### livery_contracts

```sql
CREATE TABLE livery_contracts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id UUID NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  owner_member_id UUID NOT NULL REFERENCES club_members(id),
  horse_id UUID NOT NULL REFERENCES horses(id),

  livery_type livery_type NOT NULL,
  monthly_cost INT NOT NULL,
  currency VARCHAR(3) NOT NULL DEFAULT 'AED',
  inclusions TEXT[],                           -- ['feed', 'turnout', 'grooming']
  start_date DATE NOT NULL,
  end_date DATE,
  stripe_subscription_id VARCHAR(255),
  is_active BOOLEAN NOT NULL DEFAULT true,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_livery_club ON livery_contracts(club_id);
CREATE INDEX idx_livery_owner ON livery_contracts(owner_member_id);
CREATE INDEX idx_livery_horse ON livery_contracts(horse_id);
```

### payments

```sql
CREATE TABLE payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id UUID NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  member_id UUID NOT NULL REFERENCES club_members(id),

  amount INT NOT NULL,
  currency VARCHAR(3) NOT NULL DEFAULT 'AED',
  payment_method payment_method NOT NULL,
  status payment_status NOT NULL DEFAULT 'pending',
  description TEXT,

  -- References (at least one should be set)
  booking_id UUID REFERENCES bookings(id),
  package_id UUID REFERENCES rider_packages(id),
  livery_contract_id UUID REFERENCES livery_contracts(id),
  invoice_id UUID REFERENCES invoices(id),

  -- Stripe
  stripe_payment_intent_id VARCHAR(255),
  stripe_charge_id VARCHAR(255),
  platform_fee INT,                            -- Our cut in smallest currency unit

  refunded_amount INT DEFAULT 0,
  refunded_at TIMESTAMPTZ,

  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_payments_club ON payments(club_id);
CREATE INDEX idx_payments_member ON payments(member_id);
CREATE INDEX idx_payments_status ON payments(club_id, status);
CREATE INDEX idx_payments_stripe ON payments(stripe_payment_intent_id);
CREATE INDEX idx_payments_date ON payments(club_id, paid_at);
```

### invoices

```sql
CREATE TABLE invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id UUID NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  member_id UUID NOT NULL REFERENCES club_members(id),

  invoice_number VARCHAR(50) NOT NULL,
  status invoice_status NOT NULL DEFAULT 'draft',
  amount INT NOT NULL,
  tax_amount INT NOT NULL DEFAULT 0,
  total_amount INT NOT NULL,
  currency VARCHAR(3) NOT NULL DEFAULT 'AED',
  description TEXT,
  line_items JSONB NOT NULL DEFAULT '[]',      -- Array of line items
  due_date DATE,
  paid_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  pdf_url TEXT,

  livery_contract_id UUID REFERENCES livery_contracts(id),

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE(club_id, invoice_number)
);

CREATE INDEX idx_invoices_club ON invoices(club_id);
CREATE INDEX idx_invoices_member ON invoices(member_id);
CREATE INDEX idx_invoices_status ON invoices(club_id, status);
```

### expenses

```sql
CREATE TABLE expenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id UUID NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,

  category VARCHAR(100) NOT NULL,              -- feed, vet, farrier, equipment, utilities, wages, other
  description TEXT NOT NULL,
  amount INT NOT NULL,
  currency VARCHAR(3) NOT NULL DEFAULT 'AED',
  date DATE NOT NULL,
  horse_id UUID REFERENCES horses(id),         -- If expense is for a specific horse
  receipt_url TEXT,
  vendor_name VARCHAR(255),

  created_by_member_id UUID REFERENCES club_members(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_expenses_club ON expenses(club_id);
CREATE INDEX idx_expenses_date ON expenses(club_id, date);
CREATE INDEX idx_expenses_horse ON expenses(horse_id);
CREATE INDEX idx_expenses_category ON expenses(club_id, category);
```

### groom_tasks

```sql
CREATE TABLE groom_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id UUID NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  horse_id UUID NOT NULL REFERENCES horses(id),
  assigned_to_member_id UUID REFERENCES club_members(id),

  task_type VARCHAR(100) NOT NULL,             -- feed_am, feed_pm, turnout, groom, stall_clean, etc.
  description TEXT,
  scheduled_date DATE NOT NULL,
  scheduled_time TIME,
  status task_status NOT NULL DEFAULT 'pending',
  completed_at TIMESTAMPTZ,
  completed_by_member_id UUID REFERENCES club_members(id),
  notes TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_groom_tasks_date ON groom_tasks(club_id, scheduled_date);
CREATE INDEX idx_groom_tasks_assigned ON groom_tasks(assigned_to_member_id, scheduled_date);
CREATE INDEX idx_groom_tasks_horse ON groom_tasks(horse_id, scheduled_date);
```

### rider_achievements

```sql
CREATE TABLE rider_achievements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id UUID NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  rider_member_id UUID NOT NULL REFERENCES club_members(id),

  achievement_type VARCHAR(100) NOT NULL,      -- first_lesson, first_canter, tenth_lesson, etc.
  title VARCHAR(255) NOT NULL,
  description TEXT,
  unlocked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notified BOOLEAN NOT NULL DEFAULT false,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_achievements_rider ON rider_achievements(rider_member_id);
```

### community_topics

```sql
CREATE TABLE community_topics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  name VARCHAR(255) NOT NULL,
  slug VARCHAR(100) UNIQUE NOT NULL,
  description TEXT,
  icon VARCHAR(50),
  is_default BOOLEAN NOT NULL DEFAULT false,   -- Pre-created topics
  club_id UUID REFERENCES clubs(id),           -- NULL = global topic, set = private club topic
  is_active BOOLEAN NOT NULL DEFAULT true,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_topics_club ON community_topics(club_id);
```

### community_posts

```sql
CREATE TABLE community_posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  topic_id UUID NOT NULL REFERENCES community_topics(id),
  author_member_id UUID NOT NULL REFERENCES club_members(id),
  author_club_id UUID NOT NULL REFERENCES clubs(id),  -- Which club context they posted from

  post_type post_type NOT NULL DEFAULT 'discussion',
  title VARCHAR(500),
  body TEXT NOT NULL,
  media_urls TEXT[],
  poll_options JSONB,                          -- For polls: [{text, votes}]

  upvotes INT NOT NULL DEFAULT 0,
  downvotes INT NOT NULL DEFAULT 0,
  score INT GENERATED ALWAYS AS (upvotes - downvotes) STORED,
  comment_count INT NOT NULL DEFAULT 0,

  is_pinned BOOLEAN NOT NULL DEFAULT false,
  is_locked BOOLEAN NOT NULL DEFAULT false,
  is_removed BOOLEAN NOT NULL DEFAULT false,
  removed_reason TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_posts_topic ON community_posts(topic_id, score DESC);
CREATE INDEX idx_posts_author ON community_posts(author_member_id);
CREATE INDEX idx_posts_created ON community_posts(topic_id, created_at DESC);
```

### community_comments

```sql
CREATE TABLE community_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id UUID NOT NULL REFERENCES community_posts(id) ON DELETE CASCADE,
  parent_comment_id UUID REFERENCES community_comments(id),  -- For nested replies
  author_member_id UUID NOT NULL REFERENCES club_members(id),
  author_club_id UUID NOT NULL REFERENCES clubs(id),

  body TEXT NOT NULL,
  upvotes INT NOT NULL DEFAULT 0,
  downvotes INT NOT NULL DEFAULT 0,
  is_removed BOOLEAN NOT NULL DEFAULT false,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_comments_post ON community_comments(post_id);
CREATE INDEX idx_comments_parent ON community_comments(parent_comment_id);
```

### community_votes

```sql
CREATE TABLE community_votes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id UUID NOT NULL REFERENCES club_members(id),
  post_id UUID REFERENCES community_posts(id),
  comment_id UUID REFERENCES community_comments(id),
  vote_type INT NOT NULL CHECK (vote_type IN (1, -1)),  -- 1 = upvote, -1 = downvote

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- One vote per user per post/comment
  UNIQUE(member_id, post_id),
  UNIQUE(member_id, comment_id)
);
```

### notifications

```sql
CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id UUID REFERENCES clubs(id),
  recipient_member_id UUID NOT NULL REFERENCES club_members(id),

  type VARCHAR(100) NOT NULL,                  -- booking_confirmed, payment_received, feed_alert, etc.
  title VARCHAR(255) NOT NULL,
  body TEXT NOT NULL,
  data JSONB,                                  -- Additional data for deep linking
  is_read BOOLEAN NOT NULL DEFAULT false,
  read_at TIMESTAMPTZ,

  -- Delivery tracking
  email_sent BOOLEAN NOT NULL DEFAULT false,
  push_sent BOOLEAN NOT NULL DEFAULT false,
  sms_sent BOOLEAN NOT NULL DEFAULT false,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_notifications_recipient ON notifications(recipient_member_id, is_read);
CREATE INDEX idx_notifications_date ON notifications(recipient_member_id, created_at DESC);
```

### audit_log

```sql
CREATE TABLE audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id UUID REFERENCES clubs(id),
  actor_member_id UUID REFERENCES club_members(id),

  action VARCHAR(100) NOT NULL,                -- created, updated, deleted, viewed, exported, etc.
  resource_type VARCHAR(100) NOT NULL,         -- horse, booking, payment, etc.
  resource_id UUID,
  changes JSONB,                               -- What changed: {field: {old, new}}
  ip_address INET,
  user_agent TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_club ON audit_log(club_id, created_at DESC);
CREATE INDEX idx_audit_actor ON audit_log(actor_member_id, created_at DESC);
CREATE INDEX idx_audit_resource ON audit_log(resource_type, resource_id);
```

#### Audit log read permission — cross-permission identifier surfacing

> **Audit F-47 (2026-05-07 r4):** the `changes` JSONB field promotes
> internal member identifiers across permission boundaries. Two
> currently-active write paths store member UUIDs in the diff:
>
> - `/api/v1/horses/[horseId]/owner` PATCH stores the from/to
>   `ownerMemberId` (a `club_members.id` UUID).
> - `/api/v1/competitions/[competitionId]/classes/[classId]/entries`
>   PATCH stores the from/to `riderMemberId` UUID.
>
> Member UUIDs alone are not PII, but cross-referenced against
> `club_members` they identify a person. Today this is contained:
> the audit-log read endpoint already requires a club-scoped role and
> any role with audit-log read access ALSO has direct member-roster
> read access through the same permissions table. So the join the
> audit row enables is a join the staff member could already perform.
>
> If a future role is introduced with `audit_log:read` but NOT
> `members:read` (e.g. an external compliance auditor view), the
> audit log becomes a sidechannel for joinable identifiers. Two
> mitigations to apply at that point:
>
> 1. Redact member UUIDs in the audit-log GET response when the
>    caller's role lacks `members:read`. Replace with display names
>    fetched server-side via the same join.
> 2. OR: split the `changes` field into `changes_safe` (display-only)
>    and `changes_raw` (UUIDs, gated by an additional permission).
>
> No code change required at this round — the finding is documented
> here so the next role-permission revision considers the constraint.

---

## ROW-LEVEL SECURITY POLICIES

Apply to ALL tables with `club_id`:

```sql
-- Template for every table:
ALTER TABLE {table_name} ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON {table_name}
  FOR ALL
  USING (club_id = current_setting('app.current_club_id')::uuid);

-- For community tables that can be global (club_id NULL):
CREATE POLICY community_access ON community_topics
  FOR SELECT
  USING (club_id IS NULL OR club_id = current_setting('app.current_club_id')::uuid);
```

---

## KEY RELATIONSHIPS

```
clubs (1) ──── (N) club_members
clubs (1) ──── (N) horses
clubs (1) ──── (N) arenas
clubs (1) ──── (N) lesson_types
clubs (1) ──── (N) booking_slots
clubs (1) ──── (N) coupons
clubs (1) ──── (N) packages

club_members (1) ──── (1) rider_profiles
club_members (1) ──── (N) bookings (as rider)
club_members (1) ──── (N) bookings (as booker / parent)

horses (1) ──── (N) horse_health_records
horses (1) ──── (N) horse_medications
horses (1) ──── (N) horse_feeding_plans
horses (1) ──── (N) horse_exercise_schedules
horses (1) ──── (N) horse_documents
horses (1) ──── (N) horse_pairing_history
horses (1) ──── (N) bookings

booking_slots (1) ──── (N) bookings
booking_slots (1) ──── (N) waitlist

coupons (1) ──── (N) coupon_usages

packages (1) ──── (N) rider_packages
rider_packages (1) ──── (N) bookings

community_topics (1) ──── (N) community_posts
community_posts (1) ──── (N) community_comments
community_comments (1) ──── (N) community_comments (nested)
```
