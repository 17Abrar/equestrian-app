'use client';

import * as React from 'react';
import { Input } from '@/components/ui/input';

// Audit F-67 (2026-05-07 r5): wrapper around `<Input type="number">`
// that handles the empty-string-vs-number coercion internally. Replaces
// the `(field.value as number | undefined) ?? ''` cast pattern used in
// 13+ callsites.
//
// Why the wrapper exists:
// - HTML number inputs always emit `string` from `e.target.value`. RHF
//   Zod schemas typed as `z.number().optional()` expect `number | undefined`.
//   The displayed value also has to be a `string` (or `''`), so the
//   value flowing through the input is double-typed: `value: number | ''`,
//   `onChange: number | undefined`.
// - The cast `(field.value as number | undefined) ?? ''` was load-bearing
//   in round 4 (audit F-37) — without the fallback to `''`, RHF
//   interprets an undefined value as uncontrolled, which throws "input
//   switched from controlled to uncontrolled" warnings and breaks reset.
// - This component centralises that coercion so the consumer just passes
//   `field` from RHF and the wrapper's internal logic handles the
//   string↔number translation.
// Why `value: unknown`?
// RHF's `field.value` is typed off the form schema. When the schema
// uses `numericField`/`optionalNumeric` (the project's preprocessor
// helpers in packages/shared/src/schemas), `z.input<schema>` is
// effectively `unknown` — the preprocessor accepts strings, numbers,
// or undefined. Typing `value` as `unknown` here means the consumer
// can spread `{...field}` directly without a cast. The internal logic
// narrows to `number | string | null | undefined` at runtime; anything
// else renders as the empty string (the safe fallback).
interface NumberInputProps
  extends Omit<React.ComponentProps<'input'>, 'value' | 'onChange' | 'type'> {
  value: unknown;
  onChange: (value: number | undefined) => void;
}

export function NumberInput({
  value,
  onChange,
  ...rest
}: NumberInputProps) {
  // Coerce the loose `unknown` from RHF into a string the input can
  // render. `''` renders as empty (necessary for RHF controlled-input
  // semantics — see comment at the top of the file).
  let displayValue: string | number = '';
  if (typeof value === 'number' && Number.isFinite(value)) {
    displayValue = value;
  } else if (typeof value === 'string') {
    displayValue = value;
  }

  return (
    <Input
      type="number"
      value={displayValue}
      onChange={(e) => {
        const raw = e.target.value;
        if (raw === '') {
          onChange(undefined);
          return;
        }
        const parsed = Number(raw);
        // Pass-through `NaN` would crash schemas relying on `Number(...)`
        // downstream; surface as undefined so the schema's "required"
        // check fires instead of a misleading "expected number got NaN".
        onChange(Number.isNaN(parsed) ? undefined : parsed);
      }}
      {...rest}
    />
  );
}
