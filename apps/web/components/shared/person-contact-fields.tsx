'use client';

import type { Control } from 'react-hook-form';
import { Input } from '@/components/ui/input';
import { FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';

// The minimal shape a form must have to render these fields. Constraining
// the generic to this interface keeps call sites type-safe (a form without
// these fields won't compile) WITHOUT forcing the consumers onto one shared
// zod schema: createOwnerSchema and createStaffSchema stay independent and
// only need to structurally overlap on this triplet.
interface PersonContactFieldValues {
  displayName: string;
  email: string;
  phone?: string;
  // react-hook-form's FieldValues is Record<string, any>; consumers carry
  // extra fields (e.g. staff `role`) beyond the triplet.
  [key: string]: unknown;
}

interface PersonContactFieldsProps<TFieldValues extends PersonContactFieldValues> {
  control: Control<TFieldValues>;
  /** Differs per audience: "owner@example.com", "staff@example.com", etc. */
  emailPlaceholder: string;
}

// Extracted from the owners + staff invite dialogs, which duplicated this
// exact Name / Email / Phone FormField triplet verbatim (only the email
// placeholder differed). The riders dialog has the same three fields but
// splits them across two `grid grid-cols-2` wrappers with Date of Birth
// interleaved between email and phone, so it can't adopt this component
// without changing its rendered DOM — it intentionally keeps its own copy.
//
// Renders a fragment (no wrapper element) so each dialog's surrounding
// layout (`space-y-4` form, grids, etc.) stays in full control of spacing.
export function PersonContactFields<TFieldValues extends PersonContactFieldValues>({
  control,
  emailPlaceholder,
}: PersonContactFieldsProps<TFieldValues>) {
  // WHY the cast: react-hook-form's `FieldPath<T>` can't resolve literal key
  // names against an unresolved generic `T`, so `name="displayName"` won't
  // typecheck even though the constraint guarantees the field exists. Narrow
  // the control once here instead of sprinkling `as FieldPath<TFieldValues>`
  // casts on every FormField below.
  const personControl = control as unknown as Control<PersonContactFieldValues>;
  return (
    <>
      <FormField
        control={personControl}
        name="displayName"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Name *</FormLabel>
            <FormControl>
              <Input placeholder="Full name" {...field} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
      <FormField
        control={personControl}
        name="email"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Email *</FormLabel>
            <FormControl>
              <Input type="email" placeholder={emailPlaceholder} {...field} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
      <FormField
        control={personControl}
        name="phone"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Phone</FormLabel>
            <FormControl>
              <Input placeholder="+971..." {...field} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
    </>
  );
}
