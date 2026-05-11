'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  Building2,
  MapPin,
  BookOpen,
  Users,
  CreditCard,
  Check,
  ChevronRight,
  ChevronLeft,
  Plus,
  Info,
} from 'lucide-react';
import { toast } from 'sonner';
import { type CreateArenaInput, type CreateLessonTypeInput } from '@equestrian/shared/schemas';
import { DEFAULT_LESSON_TYPES } from '@equestrian/shared/types';
import { formatMoney } from '@equestrian/shared/utils';
import { useUpdateSettings } from '@/hooks/use-settings';
import {
  useArenas,
  useCreateArena,
  useLessonTypes,
  useCreateLessonType,
  type Arena,
  type LessonType,
} from '@/hooks/use-bookings';
import { fetchJson } from '@/lib/fetch-json';
import { reportMutationError } from '@/components/shared/report-mutation-error';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

// ─── Constants ───────────────────────────────────────────────────────

const STEPS = [
  { id: 'welcome', label: 'Club Setup', icon: Building2 },
  { id: 'arenas', label: 'Arenas', icon: MapPin },
  { id: 'lessons', label: 'Lesson Types', icon: BookOpen },
  { id: 'payments', label: 'Payments', icon: CreditCard },
  { id: 'staff', label: 'Staff', icon: Users },
] as const;

const TIMEZONES = [
  { value: 'Asia/Dubai', label: 'Asia/Dubai (UTC+4)' },
  { value: 'Asia/Riyadh', label: 'Asia/Riyadh (UTC+3)' },
  { value: 'Asia/Kuwait', label: 'Asia/Kuwait (UTC+3)' },
  { value: 'Asia/Bahrain', label: 'Asia/Bahrain (UTC+3)' },
  { value: 'Asia/Qatar', label: 'Asia/Qatar (UTC+3)' },
  { value: 'Asia/Muscat', label: 'Asia/Muscat (UTC+4)' },
  { value: 'Europe/London', label: 'Europe/London (GMT)' },
  { value: 'America/New_York', label: 'America/New York (EST)' },
  { value: 'America/Los_Angeles', label: 'America/Los Angeles (PST)' },
] as const;

const CURRENCIES = [
  { value: 'AED', label: 'AED (UAE Dirham)' },
  { value: 'SAR', label: 'SAR (Saudi Riyal)' },
  { value: 'KWD', label: 'KWD (Kuwaiti Dinar)' },
  { value: 'BHD', label: 'BHD (Bahraini Dinar)' },
  { value: 'QAR', label: 'QAR (Qatari Riyal)' },
  { value: 'OMR', label: 'OMR (Omani Rial)' },
  { value: 'USD', label: 'USD (US Dollar)' },
  { value: 'GBP', label: 'GBP (British Pound)' },
  { value: 'EUR', label: 'EUR (Euro)' },
] as const;

const LESSON_TYPE_COLORS: Record<string, string> = {
  Group: '#3b82f6',
  'Semi-Private': '#8b5cf6',
  Private: '#f59e0b',
  'Desert Ride': '#f97316',
  'Beach Ride': '#06b6d4',
  Endurance: '#ef4444',
  Camp: '#10b981',
  Clinic: '#ec4899',
};

// ─── Step Indicator ──────────────────────────────────────────────────

interface StepIndicatorProps {
  currentStep: number;
}

function StepIndicator({ currentStep }: StepIndicatorProps) {
  return (
    <nav className="flex items-center justify-center gap-2" aria-label="Onboarding progress">
      {STEPS.map((step, index) => {
        const Icon = step.icon;
        const isActive = index === currentStep;
        const isCompleted = index < currentStep;

        return (
          <div key={step.id} className="flex items-center">
            <div
              className={`flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-primary text-primary-foreground'
                  : isCompleted
                    ? 'bg-green-100 text-green-800'
                    : 'bg-muted text-muted-foreground'
              }`}
            >
              {isCompleted ? <Check className="h-4 w-4" /> : <Icon className="h-4 w-4" />}
              <span className="hidden sm:inline">{step.label}</span>
            </div>
            {index < STEPS.length - 1 && (
              <ChevronRight className="text-muted-foreground mx-1 h-4 w-4" />
            )}
          </div>
        );
      })}
    </nav>
  );
}

// ─── Step 1: Welcome + Club Basics ───────────────────────────────────

const clubBasicsSchema = z.object({
  timezone: z.string().min(1),
  currency: z.string().length(3),
});

type ClubBasicsInput = z.input<typeof clubBasicsSchema>;
type ClubBasicsOutput = z.output<typeof clubBasicsSchema>;

interface WelcomeStepProps {
  onNext: () => void;
}

function WelcomeStep({ onNext }: WelcomeStepProps) {
  const updateSettings = useUpdateSettings();

  const form = useForm<ClubBasicsInput, unknown, ClubBasicsOutput>({
    resolver: zodResolver(clubBasicsSchema),
    defaultValues: {
      timezone: 'Asia/Dubai',
      currency: 'AED',
    },
  });

  async function onSubmit(data: ClubBasicsOutput) {
    try {
      await updateSettings.mutateAsync(data);
      toast.success('Club settings saved');
      onNext();
    } catch (err) {
      reportMutationError('onboarding.club_basics.save', err);
      toast.error(err instanceof Error ? err.message : 'Failed to save settings');
    }
  }

  return (
    <Card className="mx-auto max-w-lg">
      <CardHeader className="text-center">
        <CardTitle className="text-2xl">Welcome to Cavaliq</CardTitle>
        <CardDescription>
          Let&apos;s set up your club in a few quick steps. You can always change these later in
          Settings.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            <FormField
              control={form.control}
              name="timezone"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Timezone</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {TIMEZONES.map((tz) => (
                        <SelectItem key={tz.value} value={tz.value}>
                          {tz.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="currency"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Currency</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {CURRENCIES.map((c) => (
                        <SelectItem key={c.value} value={c.value}>
                          {c.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <Button type="submit" className="w-full" disabled={updateSettings.isPending}>
              {updateSettings.isPending ? 'Saving...' : 'Continue'}
              <ChevronRight className="ml-2 h-4 w-4" />
            </Button>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}

// ─── Step 2: Arenas ──────────────────────────────────────────────────

const quickArenaSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  isIndoor: z.boolean().default(false),
  hasLighting: z.boolean().default(false),
});

type QuickArenaInput = z.input<typeof quickArenaSchema>;
type QuickArenaOutput = z.output<typeof quickArenaSchema>;

interface ArenasStepProps {
  onNext: () => void;
  onBack: () => void;
}

function ArenasStep({ onNext, onBack }: ArenasStepProps) {
  const { data: arenasData, refetch } = useArenas();
  const createArena = useCreateArena();
  const arenas: Arena[] = arenasData?.data ?? [];

  const form = useForm<QuickArenaInput, unknown, QuickArenaOutput>({
    resolver: zodResolver(quickArenaSchema),
    defaultValues: { name: '', isIndoor: false, hasLighting: false },
  });

  async function onSubmit(data: QuickArenaOutput) {
    try {
      await createArena.mutateAsync(data as CreateArenaInput);
      toast.success(`Arena "${data.name}" added`);
      form.reset();
      void refetch();
    } catch (err) {
      reportMutationError('onboarding.arena.create', err, { name: data.name });
      toast.error(err instanceof Error ? err.message : 'Failed to add arena');
    }
  }

  return (
    <Card className="mx-auto max-w-lg">
      <CardHeader className="text-center">
        <CardTitle className="text-2xl">Add Your Arenas</CardTitle>
        <CardDescription>Where do your lessons take place? Add at least one arena.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Existing arenas */}
        {arenas.length > 0 && (
          <div className="space-y-2">
            {arenas.map((arena) => (
              <div
                key={arena.id}
                className="flex items-center justify-between rounded-lg border px-4 py-2"
              >
                <div className="flex items-center gap-2">
                  <MapPin className="text-muted-foreground h-4 w-4" />
                  <span className="font-medium">{arena.name}</span>
                </div>
                <div className="flex gap-1">
                  {arena.isIndoor && <Badge variant="secondary">Indoor</Badge>}
                  {arena.hasLighting && <Badge variant="secondary">Lighting</Badge>}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Quick add form */}
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Arena Name</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g. Main Arena, Indoor Hall" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="flex gap-6">
              <FormField
                control={form.control}
                name="isIndoor"
                render={({ field }) => (
                  <FormItem className="flex items-center gap-2 space-y-0">
                    <FormControl>
                      <Switch checked={field.value} onCheckedChange={field.onChange} />
                    </FormControl>
                    <FormLabel className="!mt-0">Indoor</FormLabel>
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="hasLighting"
                render={({ field }) => (
                  <FormItem className="flex items-center gap-2 space-y-0">
                    <FormControl>
                      <Switch checked={field.value} onCheckedChange={field.onChange} />
                    </FormControl>
                    <FormLabel className="!mt-0">Has Lighting</FormLabel>
                  </FormItem>
                )}
              />
            </div>
            <Button
              type="submit"
              variant="outline"
              className="w-full"
              disabled={createArena.isPending}
            >
              <Plus className="mr-2 h-4 w-4" />
              {createArena.isPending ? 'Adding...' : 'Add Arena'}
            </Button>
          </form>
        </Form>

        {/* Navigation */}
        <div className="flex gap-3">
          <Button variant="outline" onClick={onBack} className="flex-1">
            <ChevronLeft className="mr-2 h-4 w-4" />
            Back
          </Button>
          <Button onClick={onNext} className="flex-1" disabled={arenas.length === 0}>
            Continue
            <ChevronRight className="ml-2 h-4 w-4" />
          </Button>
        </div>
        {arenas.length === 0 && (
          <p className="text-muted-foreground text-center text-xs">
            Add at least one arena to continue
          </p>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Step 3: Lesson Types ────────────────────────────────────────────

// Audit F-7: mirror quickArenaSchema/quickStaffSchema — Zod resolver enforces
// min/max bounds and refines `maxRiders >= minRiders`. The previous bare
// `useForm` allowed clearing the price input to submit `NaN`.
const quickLessonSchema = z
  .object({
    name: z.string().min(1, 'Name is required').max(255),
    type: z.string().min(1, 'Type is required').max(100),
    durationMinutes: z.coerce.number().int().min(15, 'Min 15 minutes'),
    price: z.coerce.number().min(0, 'Price cannot be negative'),
    currency: z.string().length(3),
    maxRiders: z.coerce.number().int().min(1, 'At least 1'),
    minRiders: z.coerce.number().int().min(1, 'At least 1'),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Pick a color'),
  })
  .refine((d) => d.maxRiders >= d.minRiders, {
    message: 'Max riders must be ≥ min riders',
    path: ['maxRiders'],
  });
type QuickLessonValues = z.input<typeof quickLessonSchema>;
type QuickLessonOutput = z.output<typeof quickLessonSchema>;

interface LessonsStepProps {
  onNext: () => void;
  onBack: () => void;
}

function LessonsStep({ onNext, onBack }: LessonsStepProps) {
  const { data: ltData, refetch } = useLessonTypes();
  const createLessonType = useCreateLessonType();
  const lessonTypes: LessonType[] = ltData?.data ?? [];

  const form = useForm<QuickLessonValues, unknown, QuickLessonOutput>({
    resolver: zodResolver(quickLessonSchema),
    defaultValues: {
      name: '',
      type: '',
      durationMinutes: 60,
      price: 0,
      currency: 'AED',
      maxRiders: 6,
      minRiders: 1,
      color: '#3b82f6',
    },
  });

  function selectSuggestion(suggestion: string) {
    const slug = suggestion.toLowerCase().replace(/[^a-z0-9]+/g, '_');
    form.setValue('type', slug);
    form.setValue('name', suggestion);
    form.setValue('color', LESSON_TYPE_COLORS[suggestion] ?? '#6366f1');
  }

  async function onSubmit(data: QuickLessonOutput) {
    try {
      await createLessonType.mutateAsync({
        ...data,
        // User enters AED (major units); DB stores fils (minor units).
        price: Math.round(data.price * 100),
      } as CreateLessonTypeInput);
      toast.success(`Lesson type "${data.name}" added`);
      form.reset();
      void refetch();
    } catch (err) {
      reportMutationError('onboarding.lesson_type.create', err, { name: data.name });
      toast.error(err instanceof Error ? err.message : 'Failed to add lesson type');
    }
  }

  // Filter out already-added suggestions
  const addedTypes = new Set(lessonTypes.map((lt) => lt.name));
  const availableSuggestions = DEFAULT_LESSON_TYPES.filter((s) => !addedTypes.has(s));

  return (
    <Card className="mx-auto max-w-lg">
      <CardHeader className="text-center">
        <CardTitle className="text-2xl">Add Lesson Types</CardTitle>
        <CardDescription>
          What kinds of lessons does your club offer? Add at least one.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Existing lesson types */}
        {lessonTypes.length > 0 && (
          <div className="space-y-2">
            {lessonTypes.map((lt) => (
              <div
                key={lt.id}
                className="flex items-center justify-between rounded-lg border px-4 py-2"
              >
                <div className="flex items-center gap-2">
                  <div
                    className="h-3 w-3 rounded-full"
                    style={{ backgroundColor: lt.color ?? '#6366f1' }}
                  />
                  <span className="font-medium">{lt.name}</span>
                </div>
                <div className="text-muted-foreground flex items-center gap-2 text-sm">
                  <span>{lt.durationMinutes}min</span>
                  <span>{formatMoney(lt.price, lt.currency)}</span>
                  <span>max {lt.maxRiders}</span>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Quick-start suggestions */}
        {availableSuggestions.length > 0 && (
          <div>
            <p className="text-muted-foreground mb-2 text-sm font-medium">Quick start:</p>
            <div className="flex flex-wrap gap-2">
              {availableSuggestions.map((s) => (
                <Badge
                  key={s}
                  variant="outline"
                  className="hover:bg-primary/10 cursor-pointer"
                  onClick={() => selectSuggestion(s)}
                >
                  <Plus className="mr-1 h-3 w-3" />
                  {s}
                </Badge>
              ))}
            </div>
          </div>
        )}

        {/* Quick add form */}
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Name</FormLabel>
                    <FormControl>
                      <Input placeholder="e.g. Private Lesson" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="type"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Type ID</FormLabel>
                    <FormControl>
                      <Input placeholder="e.g. private" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <FormField
                control={form.control}
                name="durationMinutes"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Duration (min)</FormLabel>
                    <FormControl>
                      <Input type="number" min={15} step={15} {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="price"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Price</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        min={0}
                        step="0.01"
                        placeholder="e.g. 150.00"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="maxRiders"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Max Riders</FormLabel>
                    <FormControl>
                      <Input type="number" min={1} {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <Button
              type="submit"
              variant="outline"
              className="w-full"
              disabled={createLessonType.isPending}
            >
              <Plus className="mr-2 h-4 w-4" />
              {createLessonType.isPending ? 'Adding...' : 'Add Lesson Type'}
            </Button>
          </form>
        </Form>

        {/* Navigation */}
        <div className="flex gap-3">
          <Button variant="outline" onClick={onBack} className="flex-1">
            <ChevronLeft className="mr-2 h-4 w-4" />
            Back
          </Button>
          <Button onClick={onNext} className="flex-1" disabled={lessonTypes.length === 0}>
            Continue
            <ChevronRight className="ml-2 h-4 w-4" />
          </Button>
        </div>
        {lessonTypes.length === 0 && (
          <p className="text-muted-foreground text-center text-xs">
            Add at least one lesson type to continue
          </p>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Step 4: Payments (optional) ─────────────────────────────────────

import { PaymentsPanel } from '@/components/payments/payments-panel';

interface PaymentsStepProps {
  onNext: () => void;
  onBack: () => void;
}

function PaymentsStep({ onNext, onBack }: PaymentsStepProps) {
  return (
    <Card className="mx-auto max-w-3xl">
      <CardHeader className="text-center">
        <CardTitle className="text-2xl">Accept Payments</CardTitle>
        <CardDescription>
          Connect a payment processor so riders can pay for lessons online. You can finish setup
          without this and add it later.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex gap-2 rounded-md border border-blue-200 bg-blue-50 p-3 text-xs text-blue-900">
          <Info className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <p>
            Stripe uses an OAuth redirect — clicking &ldquo;Connect Stripe&rdquo; will leave the
            wizard. If you&apos;d rather finish onboarding first, pick Stripe from{' '}
            <span className="font-medium">Settings &rarr; Payments</span> after setup. N-Genius and
            Ziina connect inline here without leaving.
          </p>
        </div>

        <PaymentsPanel />

        <div className="flex gap-3">
          <Button variant="outline" onClick={onBack} className="flex-1">
            <ChevronLeft className="mr-2 h-4 w-4" />
            Back
          </Button>
          <Button onClick={onNext} className="flex-1">
            Continue
            <ChevronRight className="ml-2 h-4 w-4" />
          </Button>
        </div>
        <p className="text-muted-foreground text-center text-xs">
          Payments are optional at setup — you can connect a processor any time.
        </p>
      </CardContent>
    </Card>
  );
}

// ─── Step 5: Staff ───────────────────────────────────────────────────

const quickStaffSchema = z.object({
  displayName: z.string().min(1, 'Name is required'),
  email: z.string().email('Valid email required'),
  role: z.enum(['club_manager', 'coach', 'groom']),
});

type QuickStaffInput = z.input<typeof quickStaffSchema>;
type QuickStaffOutput = z.output<typeof quickStaffSchema>;

interface StaffMember {
  id: string;
  displayName: string;
  email: string;
  role: string;
}

interface StaffStepProps {
  onComplete: () => void;
  onBack: () => void;
}

function StaffStep({ onComplete, onBack }: StaffStepProps) {
  const [staffList, setStaffList] = useState<StaffMember[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const form = useForm<QuickStaffInput, unknown, QuickStaffOutput>({
    resolver: zodResolver(quickStaffSchema),
    defaultValues: { displayName: '', email: '', role: 'coach' },
  });

  async function addStaff(data: QuickStaffOutput) {
    setIsSubmitting(true);
    try {
      const res = await fetchJson<{ data: StaffMember }>('/api/v1/staff', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      setStaffList((prev) => [...prev, res.data]);
      toast.success(`${data.displayName} added as ${data.role.replace('_', ' ')}`);
      form.reset();
    } catch (err) {
      reportMutationError('onboarding.staff.create', err, { role: data.role });
      toast.error(err instanceof Error ? err.message : 'Failed to add staff');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Card className="mx-auto max-w-lg">
      <CardHeader className="text-center">
        <CardTitle className="text-2xl">Invite Staff</CardTitle>
        <CardDescription>
          Add your coaches, managers, and grooms. You can skip this and add them later.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Staff list */}
        {staffList.length > 0 && (
          <div className="space-y-2">
            {staffList.map((member) => (
              <div
                key={member.id}
                className="flex items-center justify-between rounded-lg border px-4 py-2"
              >
                <div>
                  <span className="font-medium">{member.displayName}</span>
                  <span className="text-muted-foreground ml-2 text-sm">{member.email}</span>
                </div>
                <Badge variant="secondary">{member.role.replace('_', ' ')}</Badge>
              </div>
            ))}
          </div>
        )}

        {/* Quick add form */}
        <Form {...form}>
          <form onSubmit={form.handleSubmit(addStaff)} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="displayName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Name</FormLabel>
                    <FormControl>
                      <Input placeholder="Full name" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email</FormLabel>
                    <FormControl>
                      <Input type="email" placeholder="email@example.com" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <FormField
              control={form.control}
              name="role"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Role</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="coach">Coach</SelectItem>
                      <SelectItem value="club_manager">Manager</SelectItem>
                      <SelectItem value="groom">Groom</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            <Button type="submit" variant="outline" className="w-full" disabled={isSubmitting}>
              <Plus className="mr-2 h-4 w-4" />
              {isSubmitting ? 'Adding...' : 'Add Staff Member'}
            </Button>
          </form>
        </Form>

        {/* Navigation */}
        <div className="flex gap-3">
          <Button variant="outline" onClick={onBack} className="flex-1">
            <ChevronLeft className="mr-2 h-4 w-4" />
            Back
          </Button>
          <Button onClick={onComplete} className="flex-1">
            {staffList.length === 0 ? 'Skip & Finish' : 'Finish Setup'}
            <Check className="ml-2 h-4 w-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Main Onboarding Page ────────────────────────────────────────────

export default function OnboardingPage() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [completing, setCompleting] = useState(false);

  const handleComplete = useCallback(async () => {
    setCompleting(true);
    try {
      await fetchJson('/api/v1/onboarding', { method: 'POST' });
      toast.success('Setup complete! Welcome to your dashboard.');
      router.push('/');
    } catch (err) {
      reportMutationError('onboarding.complete', err);
      toast.error(err instanceof Error ? err.message : 'Failed to complete onboarding');
    } finally {
      setCompleting(false);
    }
  }, [router]);

  return (
    <div className="from-background to-muted/30 min-h-screen bg-gradient-to-b">
      <div className="mx-auto max-w-3xl px-4 py-12">
        {/* Step indicator */}
        <div className="mb-10">
          <StepIndicator currentStep={step} />
        </div>

        {/* Loading overlay for completion. Audit AI-32d — skeleton card
            previewing the next dashboard view rather than a generic
            spinner; CLAUDE.md mandates skeleton-over-spinner. */}
        {completing && (
          <div className="bg-background/80 fixed inset-0 z-50 flex items-center justify-center px-4">
            <div className="bg-card w-full max-w-md rounded-xl border p-6 shadow-md">
              <div className="space-y-3">
                <div className="bg-muted h-5 w-2/3 animate-pulse rounded" />
                <div className="bg-muted h-3 w-full animate-pulse rounded" />
                <div className="bg-muted h-3 w-4/5 animate-pulse rounded" />
                <div className="grid grid-cols-3 gap-3 pt-2">
                  <div className="bg-muted h-16 animate-pulse rounded" />
                  <div className="bg-muted h-16 animate-pulse rounded" />
                  <div className="bg-muted h-16 animate-pulse rounded" />
                </div>
              </div>
              <p className="text-muted-foreground mt-4 text-center text-sm">
                Setting up your dashboard...
              </p>
            </div>
          </div>
        )}

        {/* Steps */}
        {step === 0 && <WelcomeStep onNext={() => setStep(1)} />}
        {step === 1 && <ArenasStep onNext={() => setStep(2)} onBack={() => setStep(0)} />}
        {step === 2 && <LessonsStep onNext={() => setStep(3)} onBack={() => setStep(1)} />}
        {step === 3 && <PaymentsStep onNext={() => setStep(4)} onBack={() => setStep(2)} />}
        {step === 4 && <StaffStep onComplete={handleComplete} onBack={() => setStep(3)} />}
      </div>
    </div>
  );
}
