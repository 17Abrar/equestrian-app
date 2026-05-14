# Equestrian Club Management Platform -- Complete Product Plan

## Last updated: 2026-03-28

---

# PART 1: THE VISION

## THE PROBLEM

Equestrian clubs run on WhatsApp, pen and paper, and prayer. Booking is manual. Horse allocation is guesswork. Owners get updates via text. Financials live in spreadsheets. Staff coordination is chaos.

No single platform covers booking + horse management + business ops + client portal. The market is fragmented -- BarnManager does horse care, HorseBooking does scheduling, Ridely does training logs, Equo does competitions. Nobody owns the full workflow.

Common complaint across every competitor: "I use 3-4 apps to run my barn."

This is the Mindbody moment for equestrian.

## THE PRODUCT

Two interfaces, one system:

1. WEB APP (Business Dashboard) -- Club admins, managers, coaches
2. MOBILE APP (iOS + Android) -- Riders, parents, private horse owners

Everything syncs in real-time. What the club updates, the rider sees instantly.

## USER TYPES

1. CLUB ADMIN -- Full control. Manages horses, staff, bookings, finances, settings.
2. COACH/INSTRUCTOR -- Views schedule, marks attendance, logs session notes, sees horse assignments.
3. RIDER/CUSTOMER -- Books lessons/rides, pays, tracks progress, sees schedule.
4. PARENT -- Books for kids, pays, gets notifications, tracks child's progress.
5. PRIVATE HORSE OWNER -- Manages their horse's profile, vet records, feed, costs.
6. GROOM/STAFF -- Receives daily task lists, logs feeding/turnout/care completion.

---

# PART 2: WEB APP LAYOUT (Business Dashboard)

## Navigation (Left Sidebar)

- Dashboard (home)
- Calendar
- Bookings
- Horses
- Riders and Clients
- Staff and Coaches
- Private Owners
- Finances
- Emails (compose, sent, templates, audiences)
- Arena and Facilities
- Reports
- Settings

---

### 1. DASHBOARD (Home)

TOP ROW -- Key metrics cards:

- Today's bookings (count + capacity %)
- Revenue this month (vs last month)
- Active riders (total)
- Horses available today (vs total)

MIDDLE -- Today's timeline:

- Visual timeline showing all arenas, all slots, all coaches, color-coded by lesson type
- Quick-glance: which horses are assigned, which are resting
- Drag-and-drop to reassign horses or coaches

BOTTOM LEFT -- Action items:

- Unconfirmed bookings needing approval
- Payment overdue alerts
- Horse health alerts (vaccination due, vet visit scheduled, feed running low)
- Staff schedule gaps

BOTTOM RIGHT -- Recent activity feed:

- New bookings, cancellations, payments received, messages from owners

---

### 2. CALENDAR

Full calendar view (day/week/month) showing:

- All lessons across all arenas
- Coach assignments
- Horse assignments per lesson
- Desert rides, beach rides, events
- Private owner appointments (vet visits, farrier)
- Facility maintenance blocks

Filters: by arena, by coach, by lesson type, by horse
Color coding: group = blue, private = green, semi-private = orange, ride-out = purple

Click any slot to view, edit, reassign, or cancel with auto-notification to the rider.

---

### 3. BOOKINGS

Sub-tabs: Upcoming, Pending Approval, Completed, Cancelled

Each booking shows:

- Rider name + contact
- Lesson type + duration
- Coach assigned
- Horse assigned (with smart recommendation badge)
- Arena
- Payment status (paid / unpaid / partial)
- Notes

Actions: Approve, Reschedule, Cancel, Mark Paid, Assign Horse, Send Message
MANUAL BOOKING button for walk-ins or phone bookings.

---

### 4. HORSES

The brain of the system.

HORSE LIST VIEW:

- Grid or list with photo, name, breed, status (available/resting/injured/retired), today's workload
- Filter by: status, skill level suitability, weight limit, availability

INDIVIDUAL HORSE PROFILE:
Editable by: Club admin, club manager, and private horse owner (for their own horses).

BASIC INFO:

- Photos: multiple images, set primary photo, upload from phone or desktop
- Name, barn name / nickname
- Breed, gender, age / date of birth
- Color / print (bay, chestnut, grey, palomino, pinto, appaloosa, etc.)
- Height (hands / cm)
- Weight (kg)
- Markings (star, blaze, stripe, socks, etc.)
- Microchip number
- Passport / registration number
- Status toggle: Available / Resting / Injured / Retired / Off-site / Sold
- Skill level: Beginner / Intermediate / Advanced
- Temperament tags: calm, spirited, lazy, responsive, spooky, bombproof
- Weight limit (max rider weight in kg)
- Age limit (min rider age)

VALUE AND COSTS:

- Purchase price (optional, private to owner/admin)
- Current estimated value
- Sale status: Not for sale / For sale (with asking price) / Sold (with sale date, sale price, buyer name)
- Total cost of ownership: auto-calculated from all logged expenses (feed, vet, farrier, livery, equipment)
- Monthly cost breakdown chart

GEAR SIZING:

- Saddle size
- Girth size
- Bridle size
- Bit type and size
- Blanket/rug size
- Boots/wraps size
- Any custom equipment notes

TABS within horse profile:

a) Schedule -- calendar of bookings, rest days, blocked times, vet appointments, farrier visits, competitions

b) Health -- FULL MEDICAL HISTORY:

- Conditions and illnesses: log any chronic or past conditions (e.g., laminitis, colic history, sweet itch, COPD/heaves)
- Injury history: every injury logged with date, description, treatment, recovery time, vet who treated
- Vaccination records: type, date administered, next due date, batch number, vet name
- Vet visits: date, reason, diagnosis, treatment, cost, vet name, follow-up needed
- Dental records: date, procedure, next scheduled
- Deworming: date, product used, next due
- Blood test results: date, results summary, document upload
- Allergies / sensitivities
- Current medications with dosage and schedule
- Insurance policy details (provider, policy number, coverage, expiry)

c) Medicine Schedule -- dedicated tab:

- List of all current medications
- Dosage, frequency, time of day
- Start date, end date (or ongoing)
- Administered by (auto-assigned to groom or owner)
- Check-off system: groom/staff marks "administered" each day
- Missed dose alert
- Medication history log

d) Feeding Schedule:

- Morning feed: type, quantity, supplements
- Midday feed (if applicable)
- Evening feed: type, quantity, supplements
- Hay/forage: type, quantity, frequency
- Supplements: name, dosage, frequency
- Special dietary notes (e.g., "no grain", "soaked hay only")
- Smart Feed Tracker: consumption rate, days until restock, restock alert
- Feeding history / changes log

e) Exercise Schedule:

- Weekly exercise plan: which days, what type (flatwork, jumping, hacking, lunging, turnout)
- Duration per session
- Intensity level
- Rest days marked
- Links to lesson bookings (auto-populated from booking system)
- Exercise log: completed sessions, duration, notes from coach/rider
- Fitness tracking over time

f) Farrier -- shoeing schedule, farrier notes, next appointment, shoe type, cost per visit

g) Workload -- daily/weekly lesson count, max per day, auto-blocks when limit reached, fatigue indicator

h) Documents -- ORGANIZED FILE MANAGEMENT:

- Upload any document: PDFs, images, scans
- Folders / categories:
  - Medical reports
  - Blood tests
  - X-rays / imaging
  - Competition results
  - Registration / passport
  - Insurance documents
  - Purchase / sale agreements
  - Vaccination certificates
  - Other
- Search across all documents
- Sort by date, category, name
- Preview documents in-app
- Download individual files or bulk download as ZIP
- Share specific documents (e.g., email vet records to new vet)

i) Gallery -- photo and video gallery:

- Upload photos and videos
- Auto-organized by date
- Stable staff can upload daily photos (visible to owner in app)
- Tag photos: training, competition, daily life, medical
- Set cover photo

j) Notes -- free-form notes from coaches, grooms, admin, owner

DELETING A HORSE PROFILE:

- Admin or owner can delete a horse profile
- Confirmation prompt: "Are you sure? This will archive all records."
- Soft delete: profile is archived, not permanently destroyed (can be restored within 90 days)
- After 90 days: permanent deletion with option to export all data/documents first
- Financial records linked to the horse are retained for accounting (anonymized if needed)

SMART HORSE MATCHING (when assigning to a booking):

- System recommends top 3 horses based on rider skill, weight, age, horse workload, availability, past pairing history, temperament
- Admin can always override

---

### 5. RIDERS AND CLIENTS

RIDER LIST: Search, filter by status, lesson type, skill level

INDIVIDUAL RIDER PROFILE:

- Personal info (name, email, phone, emergency contact, DOB, weight, height)
- Skill level (auto-updated based on lessons + coach assessments)
- Lesson history (every lesson, horse, coach, date, notes)
- Packages owned (e.g., "8-class group, 5 remaining, expires Apr 30")
- Payment history
- Coach notes
- Parent/guardian link (for minors)

PACKAGES AND MEMBERSHIPS:

- Create packages: "8 Group Lessons - AED 1,200" with expiry
- Create memberships: "Monthly Unlimited - AED 2,500/month"
- Auto-track usage, auto-notify when low or expired

---

### 6. STAFF AND COACHES

COACH PROFILE:

- Specialties (dressage, jumping, flatwork, endurance, kids)
- Working hours / availability
- Lessons calendar
- Performance metrics (lessons taught, cancellation rate, rider retention)
- Rider reviews/ratings

GROOM/STAFF PROFILE:

- Assigned horses
- Daily task checklist (auto-generated from horse care schedules)
- Task completion log

---

### 7. PRIVATE OWNERS (Admin View)

Per owner:

- Owner info + their horse(s)
- Livery type (full / part / DIY)
- Monthly cost + inclusions
- Invoice history
- Communication log

---

### 8. FINANCES

Sub-tabs: Overview, Invoices, Payments, Outstanding, Expenses, Coupons

OVERVIEW TAB:

- Revenue dashboard: total revenue this month/quarter/year, with comparison to previous period
- Revenue breakdown by source: lessons, livery, rides, packages, events, merchandise
- Revenue trend chart (line graph over time)
- Top paying customers: ranked list of riders/owners by total spend, with spend amount, frequency, and last payment date
- Lowest paying customers: ranked by spend (useful for identifying upsell opportunities)
- Top returning customers: ranked by visit frequency, total lessons, streak (consecutive weeks active)
- At-risk customers: riders who were active but haven't booked in 30/60/90 days (churn risk)
- Average revenue per rider
- Average transaction value
- Payment method breakdown (card vs Apple Pay vs Tabby vs cash)
- Outstanding balance total (how much is owed across all riders)

INVOICES TAB:

- Auto-generate monthly livery invoices (recurring)
- Auto-generate lesson package invoices
- Manual invoice creation
- Invoice status: draft, sent, paid, overdue, void
- Bulk send invoices

PAYMENTS TAB:

- Payment gateway integration (Stripe + regional gateways)
- Payment history: every transaction with rider name, amount, method, date, status
- Export to CSV/Excel for accountant

OUTSTANDING TAB:

- List of all unpaid amounts per rider/owner
- Age of debt (30/60/90 days overdue)
- Send payment reminder button (email + push)

EXPENSES TAB:

- Log stable expenses: feed purchases, vet bills, farrier costs, equipment, utilities, staff wages
- Categorized expense tracking
- Expense per horse breakdown
- Profit and loss summary (revenue minus expenses)

COUPONS TAB:

- List of all coupons with: code, discount type, status (active/paused/expired/exhausted), usage count, total uses allowed
- USAGE TRACKING PER COUPON: every time someone uses a code, it's logged. Each coupon shows:
  - Total times used (e.g., "23 / 50 uses")
  - Usage history: list of every use with rider name, date, booking type, original amount, discount amount, final amount paid
  - Revenue impact: total discount given across all uses
  - New customers acquired: how many first-time riders used this code
  - Conversion tracking: if coupon was for a specific influencer/campaign, see exactly how many bookings it drove
- Quick actions: pause, resume, extend expiry, edit limits, duplicate, delete
- Create new coupon button (see Smart Features > Coupons for full creation options)

---

### 9. ARENA AND FACILITIES

- Name, capacity, surface type, lighting per arena
- Operating hours per arena
- Maintenance time blocks
- Utilization rate analytics

---

### 10. REPORTS

Pre-built: Revenue, lesson popularity, horse utilization, coach performance, rider retention, cancellation rate, peak hours, feed consumption, vet cost per horse.

Custom report builder with date ranges, metric selection, and export (CSV/PDF).

---

### 11. SETTINGS

Club profile, booking rules (advance window, cancellation policy, min notice), lesson types setup, payment config, notification templates (email/SMS/push), staff permissions and roles, branding/white-label (premium), integrations (Google Calendar, Apple Calendar, payment gateways, WhatsApp Business API), multi-language settings.

---

# PART 3: MOBILE APP LAYOUT (Rider / Owner Facing)

## Bottom Navigation (5 tabs)

1. Home
2. Book
3. My Horses (owners) / Progress (riders)
4. Community
5. Profile

Top bar (persistent): Stable selector (switch between connected stables) + Messages icon + Notifications bell

---

### 1. HOME

- Stable selector at top (if connected to multiple stables -- switch between them, or "All Stables" view)
- Greeting + selected club banner ("Good morning, Sarah")
- Next upcoming lesson card with countdown timer (across all stables in "All" view)
- Quick action buttons: Book a Lesson, Book a Ride
- Package status ("3 of 8 lessons remaining" -- per selected stable)
- Club announcements feed
- Weather widget (for outdoor rides)

---

### 2. BOOK

Step-by-step booking flow (clean, linear, zero confusion):

STEP 1: What do you want to do?
Arena Lesson (Group / Semi-Private / Private), Desert Ride, Beach Ride, Endurance, Camp/Clinic

STEP 2: Pick a date
Calendar with available dates highlighted, full dates greyed out

STEP 3: Pick a time
Available slots showing coach name and spots remaining (e.g., "3 spots left" in orange, "1 spot left!" in red, "FULLY BOOKED" greyed out with "Join Waitlist" option)

STEP 4: Rider details
Pre-filled for self, or select child from family members. Smart Horse Match runs silently in the background.

STEP 5: Confirm and Pay
Summary card (date, time, type, horse auto-assigned, coach, price). "Have a promo code?" input field -- enter code, discount applied instantly. Apply package credit if available. Pay now (card/Apple Pay/Google Pay/Tabby), use package credit, or pay at stable.

STEP 6: Confirmation
Booking confirmed screen. Add to calendar button (Apple/Google). Share with friend/parent. QR code for check-in at stable.

---

### 3a. PROGRESS (Regular riders)

- Skill level badge (Beginner / Intermediate / Advanced) -- visual, motivating
- Total lessons taken
- Lesson log with coach notes
- Skills checklist (walk, trot, canter, jumping -- checked off as progressed)
- Achievements ("First canter!", "10 lessons!", "First jump!")
- Favorite horses (based on ride history)

---

### 3b. MY HORSES (Private owners)

- Horse cards with photos (shows all horses across ALL stables the owner is connected to)
- Tap into horse profile:
  - Live status (in stable / turned out / in lesson)
  - EDIT horse info: owners can update basic info, add conditions/illnesses, update gear sizing, log weight changes
  - Add value/cost: input purchase price, current value, mark as sold
  - Health records: view full medical history, add notes, upload documents (blood tests, vet reports)
  - Injury/condition log: add new entries with description, photos, date
  - Medicine schedule: view current medications, check off daily administration
  - Feeding schedule: view and request changes
  - Exercise schedule: view weekly plan, see completed sessions
  - Farrier schedule + history
  - Smart Feed Tracker: consumption rate, restock alerts
  - Documents: browse organized folders (medical, competition, registration), upload new files, download/share
  - Photo/video gallery: view stable's uploads + upload own photos
  - Monthly livery cost breakdown
  - Upcoming appointments
  - Request buttons: "Request Vet Visit", "Request Extra Turnout", "Schedule Farrier"
  - Delete horse profile (with confirmation + 90-day archive period)

---

### 4. MESSAGES

- Direct chat with stable admin (per stable, if connected to multiple)
- Direct chat with coach
- Notification feed (confirmations, reminders, schedule changes, horse updates)
- Push notifications for important updates

### 4b. COMMUNITY (Reddit-style)

A social feed / forum built into the app where the equestrian community can connect.

STRUCTURE:

- Topics / Channels (like subreddits):
  - General Discussion
  - Training Tips
  - Horse Care & Health
  - Tack & Equipment
  - Competition / Show Talk
  - Buying & Selling (horses, equipment, tack)
  - Stable Reviews
  - Beginners Corner
  - Funny / Memes
  - Events & Meetups
  - Per-stable community channel (private to members of that stable)
- Clubs can create custom channels for their community (e.g., "JSR Competition Team")

FEATURES:

- Create posts: text, photos, videos, polls
- Upvote / downvote posts (Reddit-style ranking)
- Comment threads (nested replies)
- Save / bookmark posts
- Share posts
- Follow specific topics
- Search across all posts
- Sort by: Hot, New, Top (today/week/month/all time)
- User profiles show: username, skill level badge, stable affiliation(s), post history
- Mention other users (@username)
- Report / flag inappropriate content

MODERATION:

- Platform-level moderators (our team)
- Stable-level moderators (club admin can moderate their stable's channel)
- Auto-moderation: profanity filter, spam detection
- Report system with review queue
- Ban / mute users

WHY THIS MATTERS:

- Builds community and retention (riders open the app even when not booking)
- Knowledge sharing (experienced riders help beginners)
- Organic marketing (riders recommend stables, share experiences)
- Keeps users inside our ecosystem instead of going to Facebook groups or Reddit
- Stable-specific channels replace WhatsApp groups

---

### 5. PROFILE

- Personal info + physical info (for horse matching, kept private)
- Skill level
- My stables: list of all stables the rider is connected to, with ability to add/remove. Tap a stable to see bookings, packages, and history at that specific stable.
- My packages (active, remaining, expiry dates -- organized per stable)
- Payment methods (saved cards) + payment history / receipts
- Family members (add children, link profiles for easy booking)
- Settings (notifications, language, calendar sync)

### MULTI-STABLE SUPPORT FOR RIDERS

Riders can connect with multiple stables simultaneously. This is a key differentiator.

HOW IT WORKS:

- Rider downloads the app, creates one account
- Searches for stables or gets invited via link/QR code
- Joins as many stables as they want
- Each stable connection is independent: separate bookings, separate packages, separate lesson history

IN THE APP:

- Home screen: stable selector at the top (dropdown or swipe between stables)
- When a stable is selected, everything below shows that stable's data: upcoming lessons, available slots, packages, coaches
- "All Stables" view: consolidated view of ALL upcoming bookings across all stables
- Book tab: select which stable to book at first, then normal booking flow
- Progress tab: skill level and history is per-stable (a rider could be advanced at one stable, intermediate at another due to different disciplines)
- Messages: conversations organized per stable

FOR STABLES (Admin View):

- Stables see riders who are connected to them
- They do NOT see which other stables a rider is connected to (privacy)
- Rider's profile within a stable only shows data relevant to that stable

FOR HORSE OWNERS:

- An owner can board horses at multiple stables
- My Horses tab shows all horses across all stables
- Each horse is linked to the stable where it's boarded

---

# PART 4: SMART FEATURES (Differentiators)

### 1. Smart Horse Matching

Auto-recommends best horse based on: rider skill level, weight, height, age, horse's current daily workload, temperament tags (calm/spirited/lazy/responsive), past pairing success history, and real-time availability. System suggests top 3 matches. Admin always has final override. No competitor has this.

### 2. Smart Feed Tracker

Owner/admin inputs: feed type, total kg purchased, number of horses eating from it, daily ration per horse. System calculates: daily consumption rate, projected days until empty. Sends alert 2-3 days before feed runs out. Tracks feed cost per horse over time. Paylasan's idea.

### 3. Horse Workload Protection

Set max lessons/rides per horse per day. System auto-blocks horse from being assigned once limit is reached. Visual fatigue indicator (green/yellow/red based on weekly workload). Mandatory rest day enforcement (configurable).

### 4. Auto-Waitlist

When a lesson/ride is full, riders can join waitlist. If someone cancels, next on waitlist gets auto-notified. 15-minute acceptance window before moving to next person.

### 5. Rider Progression Tracking

Coaches log skill assessments after lessons. System auto-updates rider skill level over time. Riders see visual progress in the app (motivates repeat bookings -- this is a retention tool).

### 6. Multi-Location Support

One club account can manage multiple stable locations. Shared horse database (horses can be transferred between locations). Consolidated reporting across all locations.

### 7. Coupons and Promo Codes

Club admins can create discount coupons and promo codes directly from the dashboard.

CREATING A COUPON (Admin Dashboard > Finances > Coupons):

- Code: Custom code (e.g., "SUMMER25", "WELCOME10", "EID2026") or auto-generated
- Discount type: Percentage (e.g., 25% off) or Fixed amount (e.g., 50 AED off)
- Applies to: All services, specific lesson types only (e.g., group lessons only), specific packages only, specific ride types only (e.g., desert rides)
- Time limit: Start date + expiry date (e.g., valid June 1-30 only)
- Usage limit: Total uses allowed (e.g., first 50 riders only) and/or per-rider limit (e.g., 1 use per person)
- Minimum spend: Optional minimum purchase amount (e.g., "50 AED off orders over 500 AED")
- First-time riders only: Toggle to restrict to new customers
- Stackable: Can this coupon be used with packages/credits? (yes/no)
- Status: Active / Paused / Expired / Exhausted

COUPON DASHBOARD:

- List of all coupons with status, usage count, revenue impact
- Analytics per coupon: total uses, total discount given, new customers acquired via coupon
- Quick actions: pause, extend expiry, duplicate, delete

HOW RIDERS USE COUPONS:

- During checkout (Step 5 of booking flow): "Have a promo code?" input field
- Enter code > system validates (expiry, usage limit, eligibility)
- Discount applied to order total, shown on summary card
- If invalid: clear error message ("This code has expired" / "Maximum uses reached" / "Not applicable to this lesson type")

USE CASES:

- "WELCOME10" -- 10% off first lesson for new riders
- "SUMMER25" -- 25% off group lessons during summer
- "EID50" -- 50 AED off any package during Eid
- "REFERRAL15" -- 15% off when referred by existing rider
- "FLASH20" -- 20% off, valid for 48 hours only, max 30 uses
- "VIP" -- permanent 10% discount for competition team members
- Stable gives code to influencer for tracking ("SARAH10" -- track how many bookings Sarah drives)

### 8. Class Capacity and Availability

Every lesson/ride type has configurable capacity limits.

SETTING UP CLASS CAPACITY (Admin > Settings > Lesson Types):
For each lesson type, admin sets:

- Max riders per session (e.g., group lesson = 6 riders, semi-private = 3, private = 1)
- Max sessions per day (e.g., max 8 group lessons per day)
- Max riders per horse per day (links to Horse Workload Protection)
- Minimum riders to run (e.g., group lesson needs at least 3 riders or it's cancelled)
- Booking cutoff time (e.g., no bookings within 2 hours of lesson start)
- Cancellation deadline (e.g., 24 hours before -- or forfeit credit/payment)

WHAT RIDERS SEE IN THE APP:

- Available slots show remaining spots: "3 spots left" (in orange when <3 remaining)
- Full slots show: "FULLY BOOKED" badge (greyed out, not clickable)
- Almost full slots show: "1 spot left!" (in red, creates urgency)
- "Join Waitlist" button appears on fully booked slots
- Cancelled/closed slots show: "Cancelled" or "Not available"

WHAT ADMINS SEE IN THE DASHBOARD:

- Calendar view shows fill rate per slot: "4/6 riders" with color coding
  - Green: <50% full
  - Yellow: 50-80% full
  - Orange: 80-99% full
  - Red: 100% full (fully booked)
- "Low enrollment" alert for classes below minimum (e.g., only 1 rider booked for a group lesson that needs 3)
- Option to auto-cancel if minimum not met X hours before (with auto-notification to booked riders)
- Overbooking toggle: allow 1-2 extra riders beyond capacity (for expected no-shows, configurable)

AUTOMATED ACTIONS:

- When a class fills up: status changes to "Full", booking button disabled for that slot, waitlist enabled
- When someone cancels from a full class: next waitlister auto-notified, 15-minute acceptance window
- When class is below minimum X hours before: admin gets alert, option to auto-cancel or merge with another time slot
- When a new slot opens (admin adds a class): all riders who searched for that lesson type recently get a push notification

CAPACITY REPORTING:

- Fill rate by lesson type (which classes consistently sell out vs which underperform)
- Peak hours analysis (when are classes fullest)
- No-show rate by lesson type and by rider
- Waitlist conversion rate (how often waitlisted riders actually get a spot)

---

# PART 5: TECHNICAL ARCHITECTURE AND BACKEND

## How the System Works -- End to End

```
USER (Mobile App / Web App)
         |
         v
[CLOUDFLARE EDGE] -- DDoS protection, WAF, rate limiting, bot blocking, TLS termination
         |
         v
[CLOUDFLARE WORKERS] -- Edge compute: auth verification, tenant resolution, request routing, API gateway
         |
         v
[NEXT.JS API / BACKEND] -- Business logic, booking engine, horse matching algorithm, invoice generation
         |
    +---------+---------+---------+
    |         |         |         |
    v         v         v         v
[NEON DB] [CLERK]  [R2 STORAGE] [ABLY]
Postgres   Auth     Files/Photos  Real-time
(RLS)    (Identity)  (Zero egress) (Live updates)
    |         |         |         |
    v         v         v         v
[STRIPE / CHECKOUT.COM]  [RESEND]  [FCM + APNs]
     Payments              Email    Push Notifications
```

---

## SECURITY ARCHITECTURE

### Layer 1: Cloudflare Edge (Perimeter Defense)

Every single request hits Cloudflare first. Nothing reaches our servers unfiltered.

- WAF (Web Application Firewall): Blocks OWASP Top 10 attacks (SQL injection, XSS, CSRF) at the edge before they touch our code. Managed ruleset enabled on day one.
- DDoS Protection: Always-on, automatic. Cloudflare handles 200+ Tbps of capacity. Included free.
- Rate Limiting: Tiered by user type:
  - Unauthenticated: 20 requests/minute
  - Authenticated riders: 120 requests/minute
  - API integrations: 600 requests/minute
  - Admin/internal: 1,200 requests/minute
- Bot Management: Super Bot Fight Mode (Pro plan) blocks automated abuse, scrapers, credential stuffing.
- Turnstile: Invisible CAPTCHA replacement on registration, login (after failed attempts), and booking forms. Free. Privacy-respecting (no tracking cookies, no GDPR issues unlike Google reCAPTCHA).
- TLS 1.3: Enforced on all connections. Full (Strict) SSL mode so the connection between Cloudflare and our origin is also encrypted and certificate-verified.
- HSTS: Enabled with 1-year max-age, including subdomains.

Cost: Cloudflare Pro plan = $20/month per domain.

### Layer 2: Cloudflare Workers (Edge Compute)

V8 isolates, not containers. Zero cold start. $5/month for 10 million requests.

Workers handle:

- Auth verification: Verify Clerk JWT at the edge before request reaches backend
- Tenant resolution: Extract club_id from JWT, set tenant context
- Request routing: Direct to appropriate backend service
- Rate limiting enforcement: Per-tenant, per-user counters via Durable Objects
- File access control: Verify permissions before serving sensitive documents from R2
- Image optimization: Resize horse photos on-the-fly, serve WebP/AVIF to modern browsers

### Layer 3: Application Security

- Input validation: Zod schema validation on every API endpoint. Every request body, query parameter, and path parameter validated before processing.
- SQL injection prevention: Drizzle ORM with parameterized queries exclusively. Never interpolate user input into SQL.
- CORS: Strict origin whitelist (app domain, admin domain only). Never wildcard in production.
- Request signing: HMAC-SHA256 for all webhook receivers (Stripe, Clerk, payment gateways). Uses timing-safe comparison to prevent timing attacks.
- Payload limits: 1MB max for JSON bodies, 15MB max for file uploads (enforced at both Cloudflare and application level).

### Layer 4: Data Security

- Row-Level Security (RLS): Enforced at the Postgres database level. Even if there's a bug in our application code, one club can never see another club's data. The database itself enforces tenant isolation.
- Field-level encryption: Sensitive horse medical data (vet diagnoses, medications, medical history) encrypted with libsodium before being stored. Even a database breach won't expose medical records.
- At-rest encryption: Neon encrypts all data with AES-256. Cloudflare R2 encrypts all stored files with AES-256.
- In-transit encryption: TLS 1.3 everywhere. Database connections over TLS (Neon enforces this). All internal service communication encrypted.
- Secrets management: Doppler for managing environment variables, API keys, and secrets across dev/staging/production environments. No secrets in code, ever.

---

## AUTHENTICATION -- Clerk

Why Clerk (not Auth0, not Firebase, not custom):

- Organizations are first-class: Each equestrian club = one Clerk Organization. A coach working at 2 clubs can switch between them seamlessly.
- Custom roles built-in: We define roles per organization: club_admin, club_manager, coach, horse_owner, rider, parent, groom, veterinarian.
- Pre-built UI components: Sign-in, sign-up, user profile, organization switcher -- saves weeks of development. Fully customizable via CSS.
- MFA included: Two-factor authentication available for admin accounts.
- Edge-compatible: JWT verification works in Cloudflare Workers.
- Pricing: Free up to 10,000 monthly active users. $0.02/user after that. At 50 clubs x 100 users = 5,000 MAU = still free tier.

Auth0 costs $228/month for 1,000 MAU on the B2B plan. Clerk is free at that scale.
Firebase Auth has poor multi-tenant support and limited custom claims.
Custom JWT: Never build auth from scratch for a SaaS. The attack surface is too large.

Role hierarchy:

```
Platform Level:
  - platform_admin (us, the SaaS operators)
  - platform_support

Organization Level (per club):
  - club_admin (full access)
  - club_manager (everything except billing/settings)
  - coach (schedule, riders, horses -- read + limited write)
  - horse_owner (their horses only, read + request actions)
  - rider (booking, profile, progress -- read + book)
  - parent (linked to rider accounts, book + pay)
  - groom (task list, horse care -- limited write)
  - veterinarian (medical records only -- limited access)
```

---

## DATABASE -- Neon (Serverless Postgres)

Why Neon (not Supabase, not PlanetScale, not CockroachDB):

- Database branching: Create instant copies of production database for development, testing, staging. Test schema migrations against real data without risk. Game-changing for a complex SaaS.
- True serverless: Scales to zero when idle. Dev/staging databases cost nothing when not in use.
- Full Postgres: RLS, triggers, functions, JSONB, full-text search, PostGIS (for club location features).
- Edge-compatible: Neon's HTTP driver works natively in Cloudflare Workers.
- Autoscaling: Handles traffic spikes (competition day when everyone books at once) automatically.

Cost: Scale plan ~$69/month.

PlanetScale: Deprecated their self-serve. MySQL lacks native RLS. Not recommended for new projects.
CockroachDB: Designed for globally distributed workloads. Overkill for our scale.
Supabase: Strong alternative if we want auth + database + storage in one, but less flexibility per component.

### Multi-Tenancy Strategy

Row-Level Security (RLS), not separate databases:

```sql
-- Every table has a club_id column
ALTER TABLE horses ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON horses
  USING (club_id = current_setting('app.current_club_id')::uuid);

-- API middleware sets tenant context per request
SET app.current_club_id = 'uuid-of-club';
```

Benefits:

- Complete data isolation enforced at the database level
- Single database = simple operations
- Scales to hundreds of clubs without complexity
- Postgres enforces isolation even if application code has a bug
- No risk of cross-tenant data leaks

---

## FILE STORAGE -- Cloudflare R2

Why R2 (not AWS S3, not Supabase Storage):

- Zero egress fees: S3 charges $0.09/GB for data transfer out. R2 charges $0. For a platform serving thousands of horse photos, vet documents, and invoices, this saves hundreds per month.
- S3-compatible API: Same integration code, any S3 SDK works.
- Native Cloudflare CDN: Files served globally from edge without extra configuration.

Cost comparison (500GB stored, 100GB egress/month):

- AWS S3: ~$20.50/month
- Cloudflare R2: ~$7.50/month

File categories and access rules:

```
Public files (horse photos, club profile images):
  Client -> Presigned URL from API -> Direct upload to R2 -> CDN serves globally

Sensitive files (vet records, invoices, medical documents):
  Upload: Client -> API verifies auth -> Presigned URL -> Direct upload to R2
  Download: Client -> API verifies permission + role -> Time-limited presigned URL -> Download
  Worker middleware verifies JWT, checks role and club membership before serving
```

Storage structure:

```
/{club_id}/horses/{horse_id}/photos/{filename}
/{club_id}/horses/{horse_id}/medical/{filename}     <-- encrypted at rest + field-level
/{club_id}/members/{user_id}/documents/{filename}
/{club_id}/invoices/{year}/{month}/{filename}
/{club_id}/club-assets/{filename}
```

---

## REAL-TIME -- Ably

Why Ably (not Pusher, not Socket.io, not Supabase Realtime):

- 99.999% uptime SLA: The most reliable managed real-time service. Guaranteed message ordering and delivery.
- When someone books a lesson, every viewer of that calendar slot sees it update instantly. Can't have booking conflicts because a message was dropped.
- Presence detection: See who's online (useful for chat, admin dashboard).
- Message history: 24-72 hours built-in (no extra storage needed).

Cost: ~$29/month for 1M messages.

Socket.io: Requires us to manage WebSocket servers, Redis pub/sub, reconnection logic, horizontal scaling. Massive operational burden.
Pusher: No guaranteed delivery. More expensive than Ably.

Use cases:

1. Live calendar updates -- booking changes reflect instantly for all viewers
2. Booking notifications -- "Your 3pm lesson with Thunder has been confirmed"
3. Chat -- Coach-to-rider messaging, club announcements
4. Status updates -- Horse check-in/check-out, arena availability
5. Groom task completion -- Admin sees tasks checked off in real-time

Architecture:

```
User books lesson
  -> API writes to Neon database
  -> API publishes to Ably channel
  -> All calendar viewers receive update instantly
  -> UI re-renders the affected slot
```

---

## PAYMENTS -- Full Payment Architecture

> **STATUS (2026-05-04 pivot — read first):** The Stripe Connect marketplace model described in this section was the **original intent** and is preserved here for historical context. The **shipped architecture** is different:
>
> - **Cavaliq is NOT a Stripe Connect platform.** No platform `STRIPE_CLIENT_ID`, no OAuth, no `application_fee_amount`, no `transfer_data`, no `stripeAccount` SDK header.
> - **Each club pastes its own provider credentials** (Stripe `sk_…`/`pk_…`/`whsec_…`, Ziina API key, N-Genius API key) into Settings → Payments. We encrypt them into `club_payment_accounts.encrypted_credentials` and call providers directly under the club's merchant account.
> - **Three providers are wired today:** `stripe`, `ziina`, `n_genius`. Per-club webhook URLs are `/api/webhooks/<provider>/<clubId>`.
> - **Money lands in the club's own balance.** Cavaliq takes **no per-booking cut** — revenue comes from subscription tiers (Starter AED 300 / Growing AED 800 / Professional AED 2000) only. The 0.9% per-booking fee that earlier drafts of this plan referenced is retired.
> - **Platform billing for the Cavaliq SaaS itself** (Flow 2 below) is handled via Ziina manual pay-links, not Stripe Billing — see Round 6 launch notes in memory.
>
> The text below from "FLOW 1" onwards describes the original marketplace design. Treat it as background reading; the source of truth for current behaviour is `apps/web/lib/payments/*.ts` and ARCHITECTURE.md → PAYMENT INTEGRATION PATTERNS.

There are TWO payment flows in the platform:

FLOW 1: Riders paying the STABLE for services (lessons, rides, packages, livery)
FLOW 2: Stables paying US for the SaaS subscription

### How It Works -- The Money Flow

```
FLOW 1: Rider pays 200 AED for a lesson

  Rider's Card / Apple Pay / Google Pay (200 AED)
       |
       v
  Stripe Connect (Payment Intent with application_fee)
       |
       +---> Stable's Connected Account: ~190 AED (after fees)
       |
       +---> Milly Platform Account: 4 AED (2% platform fee)
       |
       +---> Stripe Processing Fee: ~5.8 AED (2.9%)

FLOW 2: Stable pays 349 AED/month for SaaS subscription

  Stable's Card (349 AED)
       |
       v
  Stripe Billing (automatic monthly charge)
       |
       +---> Milly Revenue Account: 349 AED
```

### Stripe Connect -- Marketplace Payments (Flow 1)

Stripe Connect is purpose-built for platforms that facilitate payments between buyers and sellers.

How it works:

- Each stable gets a Stripe "Connected Account" (Express type)
- When a rider pays for a lesson, the money goes to Stripe, then automatically splits:
  - Stable gets ~95% (minus processing fees and our platform cut)
  - Milly gets 1-3% platform fee (our revenue)
  - Stripe gets 2.9% + 1 AED processing fee
- We never touch the money directly -- Stripe handles everything
- Stables receive payouts to their bank account every 2-7 days

Stripe Connect Express accounts:

- We control the payment experience
- Stripe handles KYC onboarding for each stable (trade license, Emirates ID, bank details)
- Stable gets a limited dashboard to see their transactions
- Verification typically takes 1-3 business days in UAE

### Stable Onboarding for Payments

1. Stable signs up for our platform
2. We create a Stripe Connected Account via API
3. Stable clicks "Set up payments" -- redirected to Stripe-hosted onboarding
4. Stable enters: trade license number, Emirates ID, bank IBAN, business address
5. Stripe verifies identity and documents
6. Account activated -- stable can now accept payments through our platform

### Gateway Strategy by Market

Phase 1 (Launch -- UAE + Saudi):

- PRIMARY: Stripe Connect (cards, Apple Pay, Google Pay)
- BNPL: Tabby (split in 4 installments, rider pays over time, stable gets full amount upfront)

Phase 2 (Full GCC -- 6-12 months post-launch):

- ADD: Tap Payments (for Kuwait KNET, Bahrain Benefit, Qatar NAPS, Oman)
- ADD: Tamara BNPL (strong in Saudi)

Phase 3 (Scale -- 12-24 months):

- EVALUATE: Checkout.com for volume pricing (if processing >500K AED/month)
- ADD: Stripe Terminal or Tap POS for in-person payments

### Why This Gateway Order

Stripe first because:

- Best developer experience, fastest to build
- Stripe Connect marketplace support is best-in-class
- Available in UAE and Saudi (our launch markets)
- Apple Pay + Google Pay included at no extra fee
- Stripe Billing handles our SaaS subscriptions too

Tap Payments second because:

- Full GCC coverage (Kuwait, Bahrain, Qatar, Oman -- where Stripe doesn't operate)
- Supports KNET (Kuwait, used for 60% of online payments), mada (Saudi debit), Benefit (Bahrain)
- GCC-native company, Arabic support

Skip N-Genius:

- No marketplace/split payment capability
- API is older and less developer-friendly
- Their strength is POS/in-person, not online marketplaces
- Everything they do online, Stripe or Tap does better for us

### Payment Methods Available to Riders

| Method                              | Gateway                         | Markets                     |
| ----------------------------------- | ------------------------------- | --------------------------- |
| Visa / Mastercard                   | Stripe (Phase 1), Tap (Phase 2) | Global                      |
| Apple Pay                           | Stripe / Tap                    | Global                      |
| Google Pay                          | Stripe / Tap                    | Global                      |
| Samsung Pay                         | Tap                             | GCC                         |
| KNET                                | Tap (Phase 2)                   | Kuwait                      |
| mada                                | Tap (Phase 2)                   | Saudi Arabia                |
| Benefit                             | Tap (Phase 2)                   | Bahrain                     |
| Tabby (BNPL)                        | Tabby API                       | UAE, Saudi, Kuwait, Bahrain |
| Tamara (BNPL)                       | Tamara API (Phase 2)            | Saudi, UAE, Kuwait          |
| Pay at Stable (cash/card in person) | Manual "mark as paid"           | All markets                 |

### Payment Scenarios -- How Each Works

SCENARIO A: Rider pays for a single lesson (200 AED)

1. Rider books lesson in app, selects "Pay Now"
2. App shows payment sheet (Stripe Elements -- card, Apple Pay, Google Pay, Tabby)
3. Rider taps Apple Pay -- 200 AED charged
4. Backend creates PaymentIntent with application_fee (our 2% cut)
5. Stripe processes: rider charged 200 AED, stable receives ~190 AED, we get 4 AED
6. Webhook fires -- booking confirmed in app instantly
7. Stable sees payment in their dashboard, payout hits bank in 2-7 days

SCENARIO B: Rider buys an 8-lesson package (1,200 AED)

1. Rider selects package, pays 1,200 AED through Stripe
2. Full amount processed (application_fee applied, stable gets ~1,141 AED)
3. Our system creates a credit balance: 8 credits for this rider at this stable
4. Each time rider books a lesson: 1 credit deducted, no new payment needed
5. When credits run low: push notification + email ("2 lessons remaining!")
6. Credits expire per package settings (e.g., 3 months)
   NOTE: Package credits are managed in OUR database, not Stripe. Stripe only handles the initial payment.

SCENARIO C: Monthly livery charges (5,000 AED/month)

1. Stable sets up livery plan for horse owner: 5,000 AED/month
2. Owner subscribes -- card saved as payment method via Stripe
3. Stripe automatically charges 5,000 AED on the same date each month
4. Platform fee auto-applied on each charge
5. If payment fails: Stripe auto-retries (smart retry logic)
6. After 3-4 failures: subscription marked past_due, stable notified, owner notified
7. Owner receives monthly invoice via email automatically

SCENARIO D: Rider uses Tabby (Buy Now Pay Later)

1. Rider selects "Pay with Tabby" at checkout (great for expensive packages)
2. Tabby splits payment into 4 interest-free installments
3. Stable receives the FULL amount upfront from Tabby
4. Tabby collects installments from rider directly over time
5. Tabby handles all credit risk and collections -- not our problem
6. Merchant fee: 4-8% (absorbed by stable or split with platform)

SCENARIO E: Pay at Stable (cash or card in person)

1. Rider books lesson, selects "Pay at Stable"
2. Booking created with status: pending_payment
3. At the stable, rider pays cash or taps card on stable's own POS terminal
4. Stable staff opens our app, marks payment as received (cash / card)
5. Booking status --> confirmed + paid
6. No money flows through our platform (so we don't earn a transaction fee on these)
7. Still tracked in our system for reports and analytics

SCENARIO F: Refunds

- Full refund: Admin initiates in dashboard, Stripe reverses full amount to rider (5-10 business days). Our platform fee can be refunded or kept (configurable).
- Partial refund: Refund specific amount, platform fee proportionally reduced.
- Package credit refund: Restore unused credits to rider's balance instead of monetary refund.
- BNPL refund: We call Tabby/Tamara refund API, they adjust rider's installment schedule.
- NOTE: Stripe keeps their processing fee on refunds. Stable absorbs this.

### Settlement -- When Stables Get Their Money

| Gateway        | Initial Period | After Track Record |
| -------------- | -------------- | ------------------ |
| Stripe (UAE)   | T+7 (7 days)   | T+2 possible       |
| Stripe (US/EU) | T+2 to T+7     | T+2 standard       |
| Tap Payments   | T+2 to T+7     | Negotiable         |
| Tabby          | T+1 to T+3     | Fast settlement    |

### Multi-Currency

Charge in local currency, settle in local currency:

- UAE stable: charge riders in AED, settle to stable in AED
- Saudi stable: charge in SAR, settle in SAR
- UK stable: charge in GBP, settle in GBP
- US stable: charge in USD, settle in USD
  Stripe handles FX conversion for our platform fee if needed.

### Stripe Billing -- Our SaaS Subscription (Flow 2)

Stripe Billing handles stables paying us:

- Subscription plans created (Starter, Professional, Enterprise)
- Automatic monthly charges
- Dunning management (auto-retry failed payments with smart timing)
- Proration when stable changes plan mid-cycle
- Self-service portal for stables to update card, change plan, view invoices
- Invoice generation with tax calculation (5% VAT in UAE, 15% VAT in Saudi)
- Cost: 0.5% of billing volume on top of standard processing

### PCI Compliance

We qualify for SAQ-A (simplest level -- 22 questions, self-assessment, no auditor):

- Stripe Elements / Tap goSell.js handles card input (card data goes directly to Stripe/Tap, never touches our servers)
- Tabby/Tamara are redirect-based (rider goes to their site to pay)
- We store ONLY: Stripe customer ID, payment method token (pm_xxx), last 4 digits for display
- NEVER store: card numbers, CVVs, expiry dates, full PANs
- All payment pages served over HTTPS (Cloudflare enforces TLS 1.3)
- Annual SAQ-A self-assessment (free, takes a few hours)

Rules:

- Always verify webhook signatures (stripe.webhooks.constructEvent)
- Use idempotency keys on all payment creation requests (prevents double charges)
- Never build our own card input form -- always use hosted payment fields

### Payment Gateway Abstraction Layer

We build a gateway abstraction so adding new payment processors doesn't change business logic:

```typescript
interface PaymentGateway {
  createPaymentIntent(amount, currency, metadata): Promise<PaymentIntent>;
  confirmPayment(intentId): Promise<PaymentResult>;
  refund(paymentId, amount?): Promise<RefundResult>;
  createSubscription(customerId, planId): Promise<Subscription>;
  handleWebhook(payload, signature): Promise<WebhookEvent>;
}

// StripeGateway implements PaymentGateway
// TapGateway implements PaymentGateway
// Each normalizes responses into the same format
```

Adding Tap for Kuwait? Implement the interface. Adding Razorpay for India? Implement the interface. Business logic never changes.

---

## EMAIL AND MAILING SYSTEM -- Resend (Transactional + Broadcasts)

The platform has a full built-in mailing system. Two types of emails:

### A) AUTOMATED TRANSACTIONAL EMAILS (system-triggered)

These fire automatically based on events. No human action needed:

BOOKING:

- Booking confirmation (rider + parent if minor)
- Booking reminder (24 hours before + 1 hour before, configurable)
- Booking cancelled / rescheduled notification
- Waitlist spot available ("A spot opened up for Thursday 4pm!")

PAYMENTS:

- Payment receipt / invoice
- Payment failed / retry notice
- Package running low ("2 of 8 lessons remaining")
- Package expired
- Monthly livery invoice (auto-generated, auto-sent)
- Payment overdue reminder (3 days, 7 days, 14 days)

HORSE CARE (for private owners):

- Feed running low alert ("Thunder's feed is estimated to run out in 2 days -- time to restock!")
- Vaccination due reminder (30 days before, 7 days before)
- Vet visit scheduled / completed summary
- Farrier appointment reminder
- Daily/weekly horse status update (configurable -- photo + status)

RIDER:

- Welcome email (after registration)
- Skill level updated ("Congratulations! You've been upgraded to Intermediate!")
- Achievement unlocked ("You completed your 10th lesson!")
- Lesson notes from coach (after session)

ACCOUNT:

- Password reset
- Email verification
- New device login alert

STAFF:

- Daily schedule email (sent at 6am, shows today's lessons + horse assignments)
- Shift reminder

### B) MARKETING / BROADCAST EMAILS (club-composed)

Club admins can compose and send emails to their customers directly from the web dashboard. This is a built-in mini email marketing tool.

HOW IT WORKS IN THE DASHBOARD:

New section in the web app sidebar: "Emails" (or under Settings > Communications)

Sub-tabs:

- Compose -- write and send a new email
- Sent -- history of all sent broadcasts with analytics
- Templates -- saved email templates
- Audiences -- manage groups/segments

COMPOSE FLOW:

1. Admin clicks "New Email"
2. Rich text editor (Notion-style slash commands, or drag-and-drop blocks)
3. Select audience: All Riders, All Horse Owners, Beginners Only, Group Lesson Riders, etc.
4. Or create custom segment based on:
   - Skill level (beginner/intermediate/advanced)
   - Role (rider, horse owner, parent)
   - Lesson type (group, private, desert rides)
   - Activity (active in last 30 days, inactive 60+ days)
   - Package status (active package, expired, no package)
   - Custom tags (VIP, competition team, kids camp)
5. Preview email on desktop + mobile
6. Send now or schedule for later
7. Track: opens, clicks, bounces, unsubscribes

USE CASES:

- "Ramadan schedule change -- new operating hours"
- "Summer camp registrations are open!"
- "New coach joining next month -- meet Sarah!"
- "Holiday closure notice"
- "10% off private lessons this month"
- "Competition results and photos from last weekend"
- "Important: vaccination schedule update for all boarders"

TEMPLATES:
Pre-built templates for common emails:

- Schedule change announcement
- New horse / new coach introduction
- Event / camp promotion
- Holiday hours notice
- Monthly owner update (with horse photo placeholder)
- Welcome series (3-email drip: welcome, first lesson tips, meet the horses)

Clubs can save their own custom templates for reuse.

### WHY RESEND (not SendGrid, not Mailchimp, not AWS SES)

Resend handles both transactional AND marketing from one platform:

1. React Email is native -- Resend literally built the React Email library. Our email templates are React components with Tailwind CSS. Same framework as the rest of the app. No fighting with HTML tables.

2. 1,000 sending domains on Scale plan -- each club can verify their own domain. Newsletters come FROM the club's domain (info@mail.greenmeadows.com), not ours. Better deliverability, better branding.

3. Broadcast API -- we build the compose UI in our dashboard, call Resend's API to send. Club admins never see Resend. They compose in our app.

4. Audience segmentation via API -- we sync riders/owners to Resend Audiences with custom properties (rider_level, role, etc.). Segments target specific groups.

5. Built-in unsubscribe with topic preferences -- CAN-SPAM and GDPR compliant out of the box. Riders can unsubscribe from marketing but still receive booking confirmations.

6. Webhooks for delivery, open, click, bounce events -- feed into our dashboard so club admins see email analytics.

Why NOT the others:

- SendGrid: Two separate products (transactional vs marketing), mediocre DX, declining deliverability reputation
- Mailchimp: End-user tool, not API-first. Can't embed into our dashboard. $29.95/month per dedicated IP.
- AWS SES: Cheapest ($0.10/1K emails) but you build EVERYTHING -- templates, analytics, unsubscribe, reputation monitoring. Only worth it at millions/month.
- Customer.io / Loops: Wrong architecture. Designed for YOU emailing YOUR users, not your customers emailing THEIR customers.

### MULTI-TENANT EMAIL ARCHITECTURE

Domain strategy:

- System emails (booking confirmations, alerts): FROM notifications@mail.ourplatform.com (our domain)
- Club marketing emails (newsletters, announcements): FROM info@mail.{club-domain}.com (club's verified domain)
- Fallback for clubs without custom domain: FROM {clubname}@clubs.ourplatform.com

Tenant isolation:

- One Resend Audience per club (contact lists completely separate)
- Each club can only see and email THEIR riders, never another club's
- Contact properties synced from our database (rider_level, role, etc.)
- Sending rate limits per club to prevent abuse

Reputation protection:

- Monitor bounce rate and spam complaints per club
- Auto-suspend sending for clubs exceeding thresholds (>5% bounce, >0.1% spam)
- Shared IP pool is fine at our scale (individual clubs send low volume)
- Dedicated IP available at $30/month add-on when needed

### EMAIL COSTS

| Scale                             | Transactional | Marketing  | Total      |
| --------------------------------- | ------------- | ---------- | ---------- |
| Launch (10K emails, 1K contacts)  | $20/month     | $0 (free)  | $20/month  |
| Growth (50K emails, 5K contacts)  | $20/month     | $40/month  | $60/month  |
| Scale (100K emails, 10K contacts) | $90/month     | ~$70/month | $160/month |

### NOTIFICATION PREFERENCES (User Controls)

Riders and owners can control what they receive in their Profile > Settings:

Categories they can toggle:

- Booking confirmations (always on, cannot disable)
- Lesson reminders (on/off, timing: 1hr/24hr/both)
- Payment receipts (always on)
- Horse health updates (on/off -- owners only)
- Feed alerts (on/off -- owners only)
- Club announcements/newsletters (on/off)
- Promotions (on/off)
- Achievement notifications (on/off)
- Coach notes after lessons (on/off)

Delivery channel preference per category:

- Email only
- Push notification only
- Both email + push
- SMS (if SMS add-on is active for the club)

---

## PUSH NOTIFICATIONS -- Firebase Cloud Messaging + APNs

- FCM handles Android + web push
- APNs handles iOS
- Expo Push Notification Service wraps both (since we're using React Native with Expo)

Notification types:

- Booking confirmed / cancelled / rescheduled
- Lesson reminder (1 hour before, 24 hours before -- configurable)
- Payment received / overdue
- Horse health alert (for owners)
- Feed running low (Smart Feed Tracker)
- Waitlist spot available
- New message from coach/stable
- Achievement unlocked (rider progression)

---

## FRONTEND STACK

### Web App (Business Dashboard)

- Next.js 15 (App Router): Server components, streaming, edge rendering
- TypeScript: Type safety across the entire codebase
- Tailwind CSS: Utility-first styling, consistent design system
- Shadcn/ui: Beautiful, accessible component library (not a dependency -- components are copied into your project, fully customizable)
- TanStack Table: For data tables (horse lists, rider lists, booking lists, financial reports)
- TanStack Query: Server state management, caching, optimistic updates
- Recharts: Dashboard charts and analytics visualizations
- DnD Kit: Drag-and-drop for calendar timeline (reassigning horses/coaches)
- date-fns: Date manipulation (booking slots, calendar views)
- Zod: Schema validation (shared between frontend forms and backend API)

### Mobile App

- React Native with Expo: One codebase, iOS + Android, native performance
- Expo Router: File-based navigation (consistent with Next.js mental model)
- NativeWind: Tailwind CSS for React Native (same design tokens as web)
- React Native Reanimated: Smooth animations (booking flow transitions, pull-to-refresh)
- Expo Notifications: Push notification handling
- Expo SecureStore: Secure token storage on device
- React Native MMKV: Fast local storage (caching, offline-first capabilities)

### Shared Between Web and Mobile

- Zod schemas: Same validation logic on both platforms
- TypeScript types: Generated from database schema (Drizzle ORM), shared via a common package
- API client: Generated from OpenAPI spec, type-safe on both platforms
- Business logic: Horse matching algorithm, pricing calculations, date/slot logic -- all shared

---

## ORM -- Drizzle (not Prisma)

Why Drizzle over Prisma:

- Edge-compatible: Works natively in Cloudflare Workers. Prisma requires a separate Data Proxy.
- SQL-like syntax: Closer to raw SQL, easier to optimize, no "Prisma-isms"
- Smaller bundle: ~7KB vs Prisma's ~2MB client. Matters for Workers (128MB limit).
- Full RLS support: Works seamlessly with Postgres Row-Level Security.
- Type-safe: Full TypeScript inference from schema definitions.
- Migration system: Drizzle Kit handles schema migrations cleanly.

---

## MONITORING AND OBSERVABILITY

### Error Tracking -- Sentry ($26/month Team plan)

- Integrated into: Next.js frontend, Cloudflare Workers (via toucan-js), React Native app
- Source maps uploaded for readable stack traces
- Release tracking for deployment correlation
- User context: Clerk user ID + club ID attached to every error
- Alerts: Slack notification for new error types, escalation for error rate spikes

### Monitoring -- Grafana Cloud (free tier to start)

Dashboards:

1. API health: Request rate, error rate, p50/p95/p99 latency per endpoint
2. Business metrics: Bookings per hour, active users, payment success rate
3. Infrastructure: Database connections, R2 storage usage, Worker CPU time
4. Per-tenant: Request volume and error rate per club

Why not Datadog: Datadog's per-host pricing ($15/host + $0.10/GB logs) gets expensive fast. Grafana Cloud uses open standards (Prometheus, OpenTelemetry) with a generous free tier.

### Uptime -- Better Uptime ($20/month)

- Multi-region checks (verify API reachable from Middle East, Europe, etc.)
- Public status page: status.yourdomain.com
- Synthetic monitoring: Simulates a booking flow every 5 minutes
- Incident alerting via Slack, email, SMS

### Logging Best Practices

- Structured JSON logs only. Never console.log("user did thing").
- Correlation IDs: Unique request ID generated at edge, passed through entire stack.
- Sensitive data: NEVER log passwords, tokens, card numbers, medical records. Log IDs and references only.
- Retention: 30 days hot (searchable), 90 days warm, 1 year cold (compliance).

### Alert Priorities

- CRITICAL (phone/PagerDuty): API error rate >5% for 5 min, uptime failure in 2+ regions
- HIGH (Slack + email): Payment webhook failure, database connection exhaustion
- MEDIUM (Slack): P95 latency >2s for 10 min, new error type in Sentry
- LOW (weekly email): Storage >80%, approaching rate limits

---

## COMPLIANCE AND DATA PROTECTION

### GDPR

- Data Processing Agreements (DPAs) signed with all sub-processors: Clerk, Neon, Stripe, Cloudflare, Ably, Resend
- Right to erasure: Full "delete my account" flow that removes data from Clerk, anonymizes database records (keeps financial records for tax), deletes R2 files, removes analytics data
- Consent management: Cookie consent banner. Cloudflare Turnstile doesn't require consent.
- Data minimization: Only collect what's needed. No unnecessary personal data.

### GCC Data Residency

- Saudi Arabia (PDPL): Personal data should be processed within Saudi or approved jurisdictions. Neon database placed in aws-me-south-1 (Bahrain) for GCC customers.
- UAE (PDPL): More flexible, allows cross-border with adequate protections.
- Cloudflare Data Localization Suite ensures request metadata stays in-region.
- If hard residency requirements: Separate Neon database instance per region (manageable with their project model).

### PCI DSS

- SAQ-A compliance (simplest level) because we never handle raw card data.
- All payment pages served over HTTPS.
- Annual self-assessment questionnaire.

### SOC 2 Readiness (for enterprise clubs)

- All sub-processors are SOC 2 certified: Cloudflare, Stripe, Clerk, Neon, Ably.
- Access controls via Clerk RBAC, audit logging, Git-based deployments.
- When targeting enterprise: Use Vanta (~$10K/year) to automate SOC 2 evidence collection.
- Start with Type I (point-in-time), then Type II (ongoing 6-12 month assessment).

### Note on Horse Medical Data

Horse medical records are NOT covered by HIPAA (that's human health data only). They are still sensitive business data we protect with encryption, but we don't need healthcare-specific compliance frameworks.

---

# PART 6: REVENUE MODEL

> **STATUS (2026-05-04 pivot — read first):** The tier names, prices, and platform-transaction-fee percentages below are the **original 2025 plan** and have been superseded. Shipped pricing:
>
> - **Starter** — AED 300 / month
> - **Growing** — AED 800 / month
> - **Professional** — AED 2000 / month
> - All tiers: unlimited riders, 14-day trial, 2-months-free on annual.
> - **No per-booking transaction fee.** The 0.9% / 2% / 3.5% rates below are retired — Cavaliq operates on the direct-keys model and takes no cut on rider payments; clubs keep 100% of what Stripe/Ziina/N-Genius deposit.
>
> Treat the rest of this section as historical background.

Subscription per stable. Stables pay, riders don't.

### Tier 1 - Starter (~99 AED/month or ~$27/month)

- Up to 15 horses
- Booking system (online scheduling, calendar)
- Basic rider management
- 1 admin + 3 staff accounts
- Email notifications
- 3.5% platform transaction fee on rider payments

### Tier 2 - Professional (~349 AED/month or ~$95/month)

- Up to 50 horses
- Everything in Starter
- Private Owner Portal
- Smart Horse Matching
- Smart Feed Tracker
- Financial management (invoicing, payment tracking)
- Email marketing (compose and send to riders)
- Unlimited staff accounts
- SMS notifications
- Reporting and analytics
- 2% platform transaction fee on rider payments

### Tier 3 - Enterprise (~699 AED/month or ~$190/month, or custom)

- Unlimited horses
- Everything in Professional
- Multi-location support
- White-label branding (club's logo, colors)
- API access for integrations
- Priority support
- Advanced analytics and AI insights
- 1% platform transaction fee on rider payments (or 0% negotiable for large stables)

### Add-ons

- SMS packs: Per-message pricing
- Custom sending domain for emails: included in Pro+
- Dedicated IP for email: $30/month
- Stripe Terminal POS integration: custom pricing

### Free trial: 30 days, full features, no credit card required.

### Revenue Example -- Professional Tier Stable Processing 80,000 AED/month

```
SaaS subscription:                      349 AED/month
Platform transaction fee (2%):         1,600 AED/month (from rider payments)
----------------------------------------------------
TOTAL Milly revenue from this stable:  1,949 AED/month (~$530/month)

What the stable pays out of rider payments:
  Stripe processing (2.9% + 1 AED):  ~2,400 AED/month
  Milly platform fee (2%):           ~1,600 AED/month
  Stable keeps:                      ~76,000 AED/month (95% of gross)
```

The transaction fee on lower tiers is where margin is strongest. A busy stable processing 80K AED/month at 3.5% (Starter) generates 2,800 AED/month in transaction fees alone -- more than many subscription plans. This incentivizes stables to upgrade to Professional (2%) or Enterprise (1%) to save on transaction fees. Same model as Shopify.

---

# PART 7: INFRASTRUCTURE COSTS

Estimated monthly costs at different scales:

### At Launch (0-10 clubs)

| Service                       | Cost              |
| ----------------------------- | ----------------- |
| Cloudflare Pro                | $20               |
| Cloudflare Workers            | $5                |
| Vercel Pro                    | $20               |
| Clerk                         | $0 (free tier)    |
| Neon                          | $19 (Launch plan) |
| Ably                          | $29               |
| Cloudflare R2                 | $5                |
| Sentry                        | $26               |
| Resend (transactional)        | $20               |
| Resend (marketing/broadcasts) | $0 (free tier)    |
| Better Uptime                 | $20               |
| Doppler                       | $0 (free tier)    |
| **TOTAL**                     | **~$164/month**   |

### At Growth (50 clubs, ~5,000 users)

| Service                       | Cost             |
| ----------------------------- | ---------------- |
| Cloudflare Pro                | $20              |
| Cloudflare Workers            | $15              |
| Vercel Pro                    | $20              |
| Clerk                         | $0-50            |
| Neon                          | $69 (Scale plan) |
| Ably                          | $99              |
| Cloudflare R2                 | $15              |
| Sentry                        | $26              |
| Grafana Cloud                 | $29              |
| Resend (transactional)        | $20              |
| Resend (marketing/broadcasts) | $40              |
| Better Uptime                 | $20              |
| Doppler                       | $18              |
| **TOTAL**                     | **~$460/month**  |

### Revenue at 50 clubs ($149 avg): $7,450/month

### Infrastructure cost: $460/month

### Gross margin: ~94%

---

# PART 8: BUILD PHASES

### Phase 1 - Core MVP (Weeks 1-8)

- Club setup + onboarding flow
- Horse profiles (full profile: basic info, health, feeding, exercise, medicine schedules, documents, gallery, gear sizing, value/costs)
- Rider profiles + registration
- Multi-stable support (riders connect to multiple stables, stable selector in app)
- Booking system (lesson types, scheduling, calendar view)
- Class capacity limits + "fully booked" / "X spots left" indicators
- Smart Horse Matching v1
- Admin dashboard (today view, bookings, horses, finances overview)
- Mobile app (booking flow, home screen, profile)
- Stripe payment integration (Stripe Connect for marketplace)
- Coupon/promo code system with usage tracking
- Email notifications (Resend)
- Clerk authentication + role system
- Cloudflare edge security (WAF, rate limiting, Turnstile)
- Neon database with RLS multi-tenancy

### Phase 2 - Management Layer (Weeks 9-14)

- Coach/staff accounts + permissions
- Private Owner Portal (horse health, feeding, livery costs)
- Smart Feed Tracker
- Horse workload protection (auto-block, fatigue indicators)
- Financial management (invoicing, payment tracking, expense logging)
- Rider progression tracking
- In-app messaging (coach-rider, admin-owner)
- Push notifications (FCM + APNs via Expo)
- Auto-waitlist system
- Ably real-time integration (live calendar, notifications)

### Phase 3 - Growth Features (Weeks 15-20)

- Multi-location support
- Reports + analytics dashboard (Recharts)
- Package/membership management (create, track, auto-notify)
- Parent accounts + family member linking
- Calendar sync (Apple Calendar, Google Calendar)
- Groom task management (daily checklists, completion logging)
- Arena/facility management
- White-label branding (enterprise tier)
- Checkout.com integration (MENA markets)
- Tabby integration (buy now pay later)
- Community chat (Reddit-style forum with topics, upvotes, stable-specific channels)
- Horse document management (organized folders, upload/download/share)

### Phase 4 - Scale (Weeks 21+)

- Public API for third-party integrations
- Marketplace (riders discover and compare clubs)
- Multi-language support (English, Arabic, French, Spanish, German)
- AI-powered insights (booking trends, revenue forecasting, horse health patterns)
- WhatsApp Business API integration (notifications via WhatsApp)
- Affiliate/referral program
- Advanced mobile features (ride logging, offline mode)
- SOC 2 Type I certification preparation

---

# PART 9: COMPETITIVE LANDSCAPE

The market is fragmented. Every competitor does one thing:

- Equo: Competition/show management only. No stable operations.
- BarnManager: Best horse care features, but $50-150/month, weak on booking, no smart matching, complex onboarding.
- HorseBooking: Booking only. No horse management, no financials.
- Ridely: Training/ride logging only. Not a business management tool.
- StableSecretary: Basic record-keeping. Dated UI from 2010. No client-facing portal.
- Equestrian Office: Accounting focused. Legacy feel. UK-centric. Not mobile.

Common complaint: "I use 3-4 apps to run my barn."
The UX across the industry is 10 years behind fitness, salon, and restaurant software.

---

# PART 10: COMPETITIVE EDGE

1. Only platform doing booking + horse management + business ops in one place
2. Smart Horse Matching -- nobody else has this, solves the biggest daily headache
3. Mobile-first for riders, web-first for admins -- right tool for each user
4. Enterprise-grade security (Cloudflare edge, RLS, field-level encryption, SOC 2-ready)
5. Built by someone who actually operates equestrian businesses (credibility with club owners)
6. GCC-first launch (underserved market, high spending power, then expand globally)
7. Modern UX -- designed to feel like the best consumer apps, not legacy business software

---

# PART 11: MARKET

~30,000 equestrian facilities in Europe
~10,000 in North America
~2,000+ in GCC/Middle East
Growing markets: India, China, Southeast Asia, South America

At $149/month average:
100 clubs = $179K/year
500 clubs = $894K/year
1,000 clubs = $1.79M/year
5,000 clubs = $8.94M/year

The equestrian industry is worth ~$300B globally. Software penetration is embarrassingly low.

---

# NOTES

- Name: TBD (naming after everything is built)
- First beta client: JSR Equestrian Club
