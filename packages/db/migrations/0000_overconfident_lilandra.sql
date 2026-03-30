CREATE TYPE "public"."booking_status" AS ENUM('pending', 'confirmed', 'completed', 'cancelled', 'no_show');--> statement-breakpoint
CREATE TYPE "public"."coupon_discount_type" AS ENUM('percentage', 'fixed');--> statement-breakpoint
CREATE TYPE "public"."coupon_status" AS ENUM('active', 'paused', 'expired', 'exhausted');--> statement-breakpoint
CREATE TYPE "public"."file_category" AS ENUM('medical_report', 'blood_test', 'xray', 'competition_result', 'registration', 'insurance', 'purchase_agreement', 'vaccination_certificate', 'other');--> statement-breakpoint
CREATE TYPE "public"."horse_sale_status" AS ENUM('not_for_sale', 'for_sale', 'sold');--> statement-breakpoint
CREATE TYPE "public"."horse_status" AS ENUM('available', 'resting', 'injured', 'retired', 'off_site', 'sold');--> statement-breakpoint
CREATE TYPE "public"."invoice_status" AS ENUM('draft', 'sent', 'paid', 'overdue', 'void');--> statement-breakpoint
CREATE TYPE "public"."lesson_type" AS ENUM('group', 'semi_private', 'private', 'desert_ride', 'beach_ride', 'endurance', 'camp', 'clinic', 'custom');--> statement-breakpoint
CREATE TYPE "public"."livery_type" AS ENUM('full', 'part', 'diy');--> statement-breakpoint
CREATE TYPE "public"."payment_method" AS ENUM('card', 'apple_pay', 'google_pay', 'tabby', 'tamara', 'knet', 'mada', 'benefit', 'cash', 'card_in_person', 'package_credit', 'bank_transfer');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('pending', 'paid', 'partial', 'refunded', 'failed', 'overdue');--> statement-breakpoint
CREATE TYPE "public"."post_type" AS ENUM('discussion', 'photo', 'video', 'poll');--> statement-breakpoint
CREATE TYPE "public"."skill_level" AS ENUM('beginner', 'intermediate', 'advanced');--> statement-breakpoint
CREATE TYPE "public"."subscription_status" AS ENUM('active', 'past_due', 'cancelled', 'trialing');--> statement-breakpoint
CREATE TYPE "public"."task_status" AS ENUM('pending', 'in_progress', 'completed', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('club_admin', 'club_manager', 'coach', 'horse_owner', 'rider', 'parent', 'groom', 'veterinarian');--> statement-breakpoint
CREATE TABLE "clubs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"slug" varchar(100) NOT NULL,
	"email" varchar(255),
	"phone" varchar(50),
	"address" text,
	"city" varchar(100),
	"country" varchar(100),
	"timezone" varchar(50) DEFAULT 'Asia/Dubai' NOT NULL,
	"currency" varchar(3) DEFAULT 'AED' NOT NULL,
	"logo_url" text,
	"cover_photo_url" text,
	"description" text,
	"website_url" text,
	"social_instagram" text,
	"social_facebook" text,
	"social_tiktok" text,
	"stripe_account_id" varchar(255),
	"stripe_customer_id" varchar(255),
	"stripe_subscription_id" varchar(255),
	"subscription_tier" varchar(20) DEFAULT 'trial' NOT NULL,
	"subscription_status" "subscription_status" DEFAULT 'trialing' NOT NULL,
	"trial_ends_at" timestamp with time zone,
	"platform_fee_percent" numeric(4, 2) DEFAULT '3.5' NOT NULL,
	"advance_booking_days" integer DEFAULT 30 NOT NULL,
	"booking_cutoff_hours" integer DEFAULT 2 NOT NULL,
	"cancellation_notice_hours" integer DEFAULT 24 NOT NULL,
	"default_lesson_duration_minutes" integer DEFAULT 60 NOT NULL,
	"allow_overbooking" boolean DEFAULT false NOT NULL,
	"overbooking_limit" integer DEFAULT 0 NOT NULL,
	"clerk_org_id" varchar(255),
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "clubs_slug_unique" UNIQUE("slug"),
	CONSTRAINT "clubs_clerk_org_id_unique" UNIQUE("clerk_org_id")
);
--> statement-breakpoint
CREATE TABLE "club_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"club_id" uuid NOT NULL,
	"clerk_user_id" varchar(255) NOT NULL,
	"role" "user_role" NOT NULL,
	"display_name" varchar(255),
	"email" varchar(255),
	"phone" varchar(50),
	"is_active" boolean DEFAULT true NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "club_members_club_user_unique" UNIQUE("club_id","clerk_user_id")
);
--> statement-breakpoint
CREATE TABLE "rider_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"club_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"date_of_birth" date,
	"weight_kg" numeric(5, 1),
	"height_cm" numeric(5, 1),
	"skill_level" "skill_level" DEFAULT 'beginner' NOT NULL,
	"emergency_contact_name" varchar(255),
	"emergency_contact_phone" varchar(50),
	"emergency_contact_relation" varchar(100),
	"medical_notes" text,
	"total_lessons_completed" integer DEFAULT 0 NOT NULL,
	"parent_member_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "horses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"club_id" uuid NOT NULL,
	"owner_member_id" uuid,
	"name" varchar(255) NOT NULL,
	"barn_name" varchar(255),
	"breed" varchar(100),
	"gender" varchar(20),
	"date_of_birth" date,
	"color" varchar(100),
	"height_hands" numeric(4, 1),
	"weight_kg" numeric(6, 1),
	"markings" text,
	"microchip_number" varchar(100),
	"passport_number" varchar(100),
	"registration_number" varchar(100),
	"status" "horse_status" DEFAULT 'available' NOT NULL,
	"skill_level" "skill_level" DEFAULT 'beginner' NOT NULL,
	"temperament" text[],
	"weight_limit_kg" numeric(5, 1),
	"min_rider_age" integer,
	"max_lessons_per_day" integer DEFAULT 3 NOT NULL,
	"mandatory_rest_days" integer DEFAULT 1 NOT NULL,
	"sale_status" "horse_sale_status" DEFAULT 'not_for_sale' NOT NULL,
	"purchase_price" integer,
	"current_value" integer,
	"sale_price" integer,
	"sale_date" date,
	"buyer_name" varchar(255),
	"saddle_size" varchar(50),
	"girth_size" varchar(50),
	"bridle_size" varchar(50),
	"bit_type" varchar(100),
	"bit_size" varchar(50),
	"blanket_size" varchar(50),
	"boots_size" varchar(50),
	"gear_notes" text,
	"insurance_provider" varchar(255),
	"insurance_policy_number" varchar(100),
	"insurance_coverage" text,
	"insurance_expiry" date,
	"primary_photo_url" text,
	"photo_urls" text[],
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "horse_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"club_id" uuid NOT NULL,
	"horse_id" uuid NOT NULL,
	"file_name" varchar(255) NOT NULL,
	"file_url" text NOT NULL,
	"file_size_bytes" integer,
	"file_type" varchar(50),
	"category" "file_category" DEFAULT 'other' NOT NULL,
	"description" text,
	"uploaded_by_member_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "horse_exercise_schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"club_id" uuid NOT NULL,
	"horse_id" uuid NOT NULL,
	"day_of_week" integer NOT NULL,
	"exercise_type" varchar(100) NOT NULL,
	"duration_minutes" integer,
	"intensity" varchar(20),
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "horse_feed_tracker" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"club_id" uuid NOT NULL,
	"feed_type" varchar(255) NOT NULL,
	"total_kg" numeric(8, 2) NOT NULL,
	"horses_eating_count" integer NOT NULL,
	"daily_consumption_kg" numeric(6, 2) NOT NULL,
	"purchased_at" date NOT NULL,
	"estimated_empty_date" date NOT NULL,
	"alert_sent" boolean DEFAULT false NOT NULL,
	"cost" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "horse_feeding_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"club_id" uuid NOT NULL,
	"horse_id" uuid NOT NULL,
	"meal_name" varchar(100) NOT NULL,
	"feed_type" varchar(255),
	"quantity_kg" numeric(5, 2),
	"supplements" text[],
	"notes" text,
	"time_of_day" time,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "horse_health_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"club_id" uuid NOT NULL,
	"horse_id" uuid NOT NULL,
	"record_type" varchar(50) NOT NULL,
	"title" varchar(255) NOT NULL,
	"description" text,
	"date" date NOT NULL,
	"next_due_date" date,
	"vet_name" varchar(255),
	"vet_clinic" varchar(255),
	"diagnosis" text,
	"treatment" text,
	"cost" integer,
	"recovery_time_days" integer,
	"follow_up_needed" boolean DEFAULT false NOT NULL,
	"follow_up_date" date,
	"batch_number" varchar(100),
	"product_used" varchar(255),
	"document_urls" text[],
	"created_by_member_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "horse_medication_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"club_id" uuid NOT NULL,
	"medication_id" uuid NOT NULL,
	"horse_id" uuid NOT NULL,
	"administered_at" timestamp with time zone NOT NULL,
	"administered_by_member_id" uuid,
	"was_administered" boolean DEFAULT true NOT NULL,
	"skip_reason" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "horse_medications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"club_id" uuid NOT NULL,
	"horse_id" uuid NOT NULL,
	"medication_name" varchar(255) NOT NULL,
	"dosage" varchar(100) NOT NULL,
	"frequency" varchar(100) NOT NULL,
	"time_of_day" text[],
	"start_date" date NOT NULL,
	"end_date" date,
	"is_active" boolean DEFAULT true NOT NULL,
	"prescribed_by" varchar(255),
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "arena_schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"club_id" uuid NOT NULL,
	"arena_id" uuid NOT NULL,
	"day_of_week" integer NOT NULL,
	"open_time" time NOT NULL,
	"close_time" time NOT NULL,
	"is_maintenance" boolean DEFAULT false NOT NULL,
	"maintenance_notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "arenas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"club_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"capacity" integer,
	"surface_type" varchar(100),
	"has_lighting" boolean DEFAULT false NOT NULL,
	"is_indoor" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "booking_slots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"club_id" uuid NOT NULL,
	"lesson_type_id" uuid NOT NULL,
	"arena_id" uuid,
	"coach_member_id" uuid,
	"date" date NOT NULL,
	"start_time" time NOT NULL,
	"end_time" time NOT NULL,
	"max_riders" integer NOT NULL,
	"current_riders" integer DEFAULT 0 NOT NULL,
	"is_cancelled" boolean DEFAULT false NOT NULL,
	"cancellation_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bookings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"club_id" uuid NOT NULL,
	"slot_id" uuid NOT NULL,
	"rider_member_id" uuid NOT NULL,
	"horse_id" uuid,
	"booked_by_member_id" uuid NOT NULL,
	"status" "booking_status" DEFAULT 'pending' NOT NULL,
	"payment_status" "payment_status" DEFAULT 'pending' NOT NULL,
	"payment_method" "payment_method",
	"amount" integer,
	"currency" varchar(3) DEFAULT 'AED' NOT NULL,
	"discount_amount" integer DEFAULT 0,
	"coupon_id" uuid,
	"package_id" uuid,
	"stripe_payment_intent_id" varchar(255),
	"checked_in_at" timestamp with time zone,
	"qr_code" varchar(100),
	"coach_notes" text,
	"rider_skill_assessment" "skill_level",
	"horse_match_score" integer,
	"horse_match_auto" boolean DEFAULT true NOT NULL,
	"cancellation_reason" text,
	"cancelled_at" timestamp with time zone,
	"cancelled_by_member_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "horse_pairing_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"club_id" uuid NOT NULL,
	"horse_id" uuid NOT NULL,
	"rider_member_id" uuid NOT NULL,
	"booking_id" uuid NOT NULL,
	"rating" integer,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lesson_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"club_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"type" "lesson_type" NOT NULL,
	"description" text,
	"duration_minutes" integer DEFAULT 60 NOT NULL,
	"price" integer NOT NULL,
	"currency" varchar(3) DEFAULT 'AED' NOT NULL,
	"max_riders" integer DEFAULT 1 NOT NULL,
	"min_riders" integer DEFAULT 1 NOT NULL,
	"max_sessions_per_day" integer,
	"arena_id" uuid,
	"is_active" boolean DEFAULT true NOT NULL,
	"color" varchar(7),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "waitlist" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"club_id" uuid NOT NULL,
	"slot_id" uuid NOT NULL,
	"rider_member_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"notified_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"status" varchar(20) DEFAULT 'waiting' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "waitlist_slot_rider_unique" UNIQUE("slot_id","rider_member_id")
);
--> statement-breakpoint
CREATE TABLE "coupon_usages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"club_id" uuid NOT NULL,
	"coupon_id" uuid NOT NULL,
	"rider_member_id" uuid NOT NULL,
	"booking_id" uuid,
	"original_amount" integer NOT NULL,
	"discount_amount" integer NOT NULL,
	"final_amount" integer NOT NULL,
	"booking_type" varchar(50),
	"used_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "coupons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"club_id" uuid NOT NULL,
	"code" varchar(50) NOT NULL,
	"discount_type" "coupon_discount_type" NOT NULL,
	"discount_value" integer NOT NULL,
	"max_discount" integer,
	"applicable_types" "lesson_type"[],
	"minimum_amount" integer,
	"max_uses" integer,
	"max_uses_per_rider" integer,
	"usage_count" integer DEFAULT 0 NOT NULL,
	"first_time_only" boolean DEFAULT false NOT NULL,
	"is_stackable" boolean DEFAULT false NOT NULL,
	"status" "coupon_status" DEFAULT 'active' NOT NULL,
	"starts_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"created_by_member_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "coupons_club_code_unique" UNIQUE("club_id","code")
);
--> statement-breakpoint
CREATE TABLE "packages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"club_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"lesson_type_id" uuid,
	"total_credits" integer NOT NULL,
	"price" integer NOT NULL,
	"currency" varchar(3) DEFAULT 'AED' NOT NULL,
	"validity_days" integer DEFAULT 90 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rider_packages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"club_id" uuid NOT NULL,
	"package_id" uuid NOT NULL,
	"rider_member_id" uuid NOT NULL,
	"total_credits" integer NOT NULL,
	"used_credits" integer DEFAULT 0 NOT NULL,
	"purchased_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"payment_status" "payment_status" DEFAULT 'pending' NOT NULL,
	"stripe_payment_intent_id" varchar(255),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "expenses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"club_id" uuid NOT NULL,
	"category" varchar(100) NOT NULL,
	"description" text NOT NULL,
	"amount" integer NOT NULL,
	"currency" varchar(3) DEFAULT 'AED' NOT NULL,
	"date" date NOT NULL,
	"horse_id" uuid,
	"receipt_url" text,
	"vendor_name" varchar(255),
	"created_by_member_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"club_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"invoice_number" varchar(50) NOT NULL,
	"status" "invoice_status" DEFAULT 'draft' NOT NULL,
	"amount" integer NOT NULL,
	"tax_amount" integer DEFAULT 0 NOT NULL,
	"total_amount" integer NOT NULL,
	"currency" varchar(3) DEFAULT 'AED' NOT NULL,
	"description" text,
	"line_items" jsonb DEFAULT '[]' NOT NULL,
	"due_date" date,
	"paid_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"pdf_url" text,
	"livery_contract_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoices_club_number_unique" UNIQUE("club_id","invoice_number")
);
--> statement-breakpoint
CREATE TABLE "livery_contracts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"club_id" uuid NOT NULL,
	"owner_member_id" uuid NOT NULL,
	"horse_id" uuid NOT NULL,
	"livery_type" "livery_type" NOT NULL,
	"monthly_cost" integer NOT NULL,
	"currency" varchar(3) DEFAULT 'AED' NOT NULL,
	"inclusions" text[],
	"start_date" date NOT NULL,
	"end_date" date,
	"stripe_subscription_id" varchar(255),
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"club_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"amount" integer NOT NULL,
	"currency" varchar(3) DEFAULT 'AED' NOT NULL,
	"payment_method" "payment_method" NOT NULL,
	"status" "payment_status" DEFAULT 'pending' NOT NULL,
	"description" text,
	"booking_id" uuid,
	"package_id" uuid,
	"livery_contract_id" uuid,
	"invoice_id" uuid,
	"stripe_payment_intent_id" varchar(255),
	"stripe_charge_id" varchar(255),
	"platform_fee" integer,
	"refunded_amount" integer DEFAULT 0,
	"refunded_at" timestamp with time zone,
	"paid_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"club_id" uuid,
	"actor_member_id" uuid,
	"action" varchar(100) NOT NULL,
	"resource_type" varchar(100) NOT NULL,
	"resource_id" uuid,
	"changes" jsonb,
	"ip_address" "inet",
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "community_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"post_id" uuid NOT NULL,
	"parent_comment_id" uuid,
	"author_member_id" uuid NOT NULL,
	"author_club_id" uuid NOT NULL,
	"body" text NOT NULL,
	"upvotes" integer DEFAULT 0 NOT NULL,
	"downvotes" integer DEFAULT 0 NOT NULL,
	"is_removed" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "community_posts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"topic_id" uuid NOT NULL,
	"author_member_id" uuid NOT NULL,
	"author_club_id" uuid NOT NULL,
	"post_type" "post_type" DEFAULT 'discussion' NOT NULL,
	"title" varchar(500),
	"body" text NOT NULL,
	"media_urls" text[],
	"poll_options" jsonb,
	"upvotes" integer DEFAULT 0 NOT NULL,
	"downvotes" integer DEFAULT 0 NOT NULL,
	"comment_count" integer DEFAULT 0 NOT NULL,
	"is_pinned" boolean DEFAULT false NOT NULL,
	"is_locked" boolean DEFAULT false NOT NULL,
	"is_removed" boolean DEFAULT false NOT NULL,
	"removed_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "community_topics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"slug" varchar(100) NOT NULL,
	"description" text,
	"icon" varchar(50),
	"is_default" boolean DEFAULT false NOT NULL,
	"club_id" uuid,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "community_topics_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "community_votes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_id" uuid NOT NULL,
	"post_id" uuid,
	"comment_id" uuid,
	"vote_type" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "community_votes_member_post_unique" UNIQUE("member_id","post_id"),
	CONSTRAINT "community_votes_member_comment_unique" UNIQUE("member_id","comment_id"),
	CONSTRAINT "vote_type_check" CHECK ("community_votes"."vote_type" IN (1, -1))
);
--> statement-breakpoint
CREATE TABLE "groom_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"club_id" uuid NOT NULL,
	"horse_id" uuid NOT NULL,
	"assigned_to_member_id" uuid,
	"task_type" varchar(100) NOT NULL,
	"description" text,
	"scheduled_date" date NOT NULL,
	"scheduled_time" time,
	"status" "task_status" DEFAULT 'pending' NOT NULL,
	"completed_at" timestamp with time zone,
	"completed_by_member_id" uuid,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"club_id" uuid,
	"recipient_member_id" uuid NOT NULL,
	"type" varchar(100) NOT NULL,
	"title" varchar(255) NOT NULL,
	"body" text NOT NULL,
	"data" jsonb,
	"is_read" boolean DEFAULT false NOT NULL,
	"read_at" timestamp with time zone,
	"email_sent" boolean DEFAULT false NOT NULL,
	"push_sent" boolean DEFAULT false NOT NULL,
	"sms_sent" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rider_achievements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"club_id" uuid NOT NULL,
	"rider_member_id" uuid NOT NULL,
	"achievement_type" varchar(100) NOT NULL,
	"title" varchar(255) NOT NULL,
	"description" text,
	"unlocked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"notified" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "club_members" ADD CONSTRAINT "club_members_club_id_clubs_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."clubs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rider_profiles" ADD CONSTRAINT "rider_profiles_club_id_clubs_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."clubs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rider_profiles" ADD CONSTRAINT "rider_profiles_member_id_club_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."club_members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rider_profiles" ADD CONSTRAINT "rider_profiles_parent_member_id_club_members_id_fk" FOREIGN KEY ("parent_member_id") REFERENCES "public"."club_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "horses" ADD CONSTRAINT "horses_club_id_clubs_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."clubs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "horses" ADD CONSTRAINT "horses_owner_member_id_club_members_id_fk" FOREIGN KEY ("owner_member_id") REFERENCES "public"."club_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "horse_documents" ADD CONSTRAINT "horse_documents_club_id_clubs_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."clubs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "horse_documents" ADD CONSTRAINT "horse_documents_horse_id_horses_id_fk" FOREIGN KEY ("horse_id") REFERENCES "public"."horses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "horse_documents" ADD CONSTRAINT "horse_documents_uploaded_by_member_id_club_members_id_fk" FOREIGN KEY ("uploaded_by_member_id") REFERENCES "public"."club_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "horse_exercise_schedules" ADD CONSTRAINT "horse_exercise_schedules_club_id_clubs_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."clubs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "horse_exercise_schedules" ADD CONSTRAINT "horse_exercise_schedules_horse_id_horses_id_fk" FOREIGN KEY ("horse_id") REFERENCES "public"."horses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "horse_feed_tracker" ADD CONSTRAINT "horse_feed_tracker_club_id_clubs_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."clubs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "horse_feeding_plans" ADD CONSTRAINT "horse_feeding_plans_club_id_clubs_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."clubs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "horse_feeding_plans" ADD CONSTRAINT "horse_feeding_plans_horse_id_horses_id_fk" FOREIGN KEY ("horse_id") REFERENCES "public"."horses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "horse_health_records" ADD CONSTRAINT "horse_health_records_club_id_clubs_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."clubs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "horse_health_records" ADD CONSTRAINT "horse_health_records_horse_id_horses_id_fk" FOREIGN KEY ("horse_id") REFERENCES "public"."horses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "horse_health_records" ADD CONSTRAINT "horse_health_records_created_by_member_id_club_members_id_fk" FOREIGN KEY ("created_by_member_id") REFERENCES "public"."club_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "horse_medication_logs" ADD CONSTRAINT "horse_medication_logs_club_id_clubs_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."clubs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "horse_medication_logs" ADD CONSTRAINT "horse_medication_logs_medication_id_horse_medications_id_fk" FOREIGN KEY ("medication_id") REFERENCES "public"."horse_medications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "horse_medication_logs" ADD CONSTRAINT "horse_medication_logs_horse_id_horses_id_fk" FOREIGN KEY ("horse_id") REFERENCES "public"."horses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "horse_medication_logs" ADD CONSTRAINT "horse_medication_logs_administered_by_member_id_club_members_id_fk" FOREIGN KEY ("administered_by_member_id") REFERENCES "public"."club_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "horse_medications" ADD CONSTRAINT "horse_medications_club_id_clubs_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."clubs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "horse_medications" ADD CONSTRAINT "horse_medications_horse_id_horses_id_fk" FOREIGN KEY ("horse_id") REFERENCES "public"."horses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "arena_schedules" ADD CONSTRAINT "arena_schedules_club_id_clubs_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."clubs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "arena_schedules" ADD CONSTRAINT "arena_schedules_arena_id_arenas_id_fk" FOREIGN KEY ("arena_id") REFERENCES "public"."arenas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "arenas" ADD CONSTRAINT "arenas_club_id_clubs_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."clubs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_slots" ADD CONSTRAINT "booking_slots_club_id_clubs_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."clubs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_slots" ADD CONSTRAINT "booking_slots_lesson_type_id_lesson_types_id_fk" FOREIGN KEY ("lesson_type_id") REFERENCES "public"."lesson_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_slots" ADD CONSTRAINT "booking_slots_arena_id_arenas_id_fk" FOREIGN KEY ("arena_id") REFERENCES "public"."arenas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_slots" ADD CONSTRAINT "booking_slots_coach_member_id_club_members_id_fk" FOREIGN KEY ("coach_member_id") REFERENCES "public"."club_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_club_id_clubs_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."clubs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_slot_id_booking_slots_id_fk" FOREIGN KEY ("slot_id") REFERENCES "public"."booking_slots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_rider_member_id_club_members_id_fk" FOREIGN KEY ("rider_member_id") REFERENCES "public"."club_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_horse_id_horses_id_fk" FOREIGN KEY ("horse_id") REFERENCES "public"."horses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_booked_by_member_id_club_members_id_fk" FOREIGN KEY ("booked_by_member_id") REFERENCES "public"."club_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_cancelled_by_member_id_club_members_id_fk" FOREIGN KEY ("cancelled_by_member_id") REFERENCES "public"."club_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "horse_pairing_history" ADD CONSTRAINT "horse_pairing_history_club_id_clubs_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."clubs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "horse_pairing_history" ADD CONSTRAINT "horse_pairing_history_horse_id_horses_id_fk" FOREIGN KEY ("horse_id") REFERENCES "public"."horses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "horse_pairing_history" ADD CONSTRAINT "horse_pairing_history_rider_member_id_club_members_id_fk" FOREIGN KEY ("rider_member_id") REFERENCES "public"."club_members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "horse_pairing_history" ADD CONSTRAINT "horse_pairing_history_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_types" ADD CONSTRAINT "lesson_types_club_id_clubs_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."clubs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_types" ADD CONSTRAINT "lesson_types_arena_id_arenas_id_fk" FOREIGN KEY ("arena_id") REFERENCES "public"."arenas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waitlist" ADD CONSTRAINT "waitlist_club_id_clubs_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."clubs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waitlist" ADD CONSTRAINT "waitlist_slot_id_booking_slots_id_fk" FOREIGN KEY ("slot_id") REFERENCES "public"."booking_slots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waitlist" ADD CONSTRAINT "waitlist_rider_member_id_club_members_id_fk" FOREIGN KEY ("rider_member_id") REFERENCES "public"."club_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coupon_usages" ADD CONSTRAINT "coupon_usages_club_id_clubs_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."clubs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coupon_usages" ADD CONSTRAINT "coupon_usages_coupon_id_coupons_id_fk" FOREIGN KEY ("coupon_id") REFERENCES "public"."coupons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coupon_usages" ADD CONSTRAINT "coupon_usages_rider_member_id_club_members_id_fk" FOREIGN KEY ("rider_member_id") REFERENCES "public"."club_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coupon_usages" ADD CONSTRAINT "coupon_usages_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coupons" ADD CONSTRAINT "coupons_club_id_clubs_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."clubs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coupons" ADD CONSTRAINT "coupons_created_by_member_id_club_members_id_fk" FOREIGN KEY ("created_by_member_id") REFERENCES "public"."club_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "packages" ADD CONSTRAINT "packages_club_id_clubs_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."clubs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rider_packages" ADD CONSTRAINT "rider_packages_club_id_clubs_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."clubs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rider_packages" ADD CONSTRAINT "rider_packages_package_id_packages_id_fk" FOREIGN KEY ("package_id") REFERENCES "public"."packages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rider_packages" ADD CONSTRAINT "rider_packages_rider_member_id_club_members_id_fk" FOREIGN KEY ("rider_member_id") REFERENCES "public"."club_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_club_id_clubs_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."clubs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_horse_id_horses_id_fk" FOREIGN KEY ("horse_id") REFERENCES "public"."horses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_created_by_member_id_club_members_id_fk" FOREIGN KEY ("created_by_member_id") REFERENCES "public"."club_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_club_id_clubs_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."clubs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_member_id_club_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."club_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_livery_contract_id_livery_contracts_id_fk" FOREIGN KEY ("livery_contract_id") REFERENCES "public"."livery_contracts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "livery_contracts" ADD CONSTRAINT "livery_contracts_club_id_clubs_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."clubs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "livery_contracts" ADD CONSTRAINT "livery_contracts_owner_member_id_club_members_id_fk" FOREIGN KEY ("owner_member_id") REFERENCES "public"."club_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "livery_contracts" ADD CONSTRAINT "livery_contracts_horse_id_horses_id_fk" FOREIGN KEY ("horse_id") REFERENCES "public"."horses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_club_id_clubs_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."clubs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_member_id_club_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."club_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_livery_contract_id_livery_contracts_id_fk" FOREIGN KEY ("livery_contract_id") REFERENCES "public"."livery_contracts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_club_id_clubs_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."clubs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_member_id_club_members_id_fk" FOREIGN KEY ("actor_member_id") REFERENCES "public"."club_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_comments" ADD CONSTRAINT "community_comments_post_id_community_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."community_posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_comments" ADD CONSTRAINT "community_comments_author_member_id_club_members_id_fk" FOREIGN KEY ("author_member_id") REFERENCES "public"."club_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_comments" ADD CONSTRAINT "community_comments_author_club_id_clubs_id_fk" FOREIGN KEY ("author_club_id") REFERENCES "public"."clubs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_posts" ADD CONSTRAINT "community_posts_topic_id_community_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."community_topics"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_posts" ADD CONSTRAINT "community_posts_author_member_id_club_members_id_fk" FOREIGN KEY ("author_member_id") REFERENCES "public"."club_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_posts" ADD CONSTRAINT "community_posts_author_club_id_clubs_id_fk" FOREIGN KEY ("author_club_id") REFERENCES "public"."clubs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_topics" ADD CONSTRAINT "community_topics_club_id_clubs_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."clubs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_votes" ADD CONSTRAINT "community_votes_member_id_club_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."club_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_votes" ADD CONSTRAINT "community_votes_post_id_community_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."community_posts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_votes" ADD CONSTRAINT "community_votes_comment_id_community_comments_id_fk" FOREIGN KEY ("comment_id") REFERENCES "public"."community_comments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "groom_tasks" ADD CONSTRAINT "groom_tasks_club_id_clubs_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."clubs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "groom_tasks" ADD CONSTRAINT "groom_tasks_horse_id_horses_id_fk" FOREIGN KEY ("horse_id") REFERENCES "public"."horses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "groom_tasks" ADD CONSTRAINT "groom_tasks_assigned_to_member_id_club_members_id_fk" FOREIGN KEY ("assigned_to_member_id") REFERENCES "public"."club_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "groom_tasks" ADD CONSTRAINT "groom_tasks_completed_by_member_id_club_members_id_fk" FOREIGN KEY ("completed_by_member_id") REFERENCES "public"."club_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_club_id_clubs_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."clubs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_recipient_member_id_club_members_id_fk" FOREIGN KEY ("recipient_member_id") REFERENCES "public"."club_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rider_achievements" ADD CONSTRAINT "rider_achievements_club_id_clubs_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."clubs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rider_achievements" ADD CONSTRAINT "rider_achievements_rider_member_id_club_members_id_fk" FOREIGN KEY ("rider_member_id") REFERENCES "public"."club_members"("id") ON DELETE no action ON UPDATE no action;