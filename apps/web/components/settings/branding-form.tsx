'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { Palette } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { FileUpload } from '@/components/ui/file-upload';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { useUpdateSettings, type ClubSettings } from '@/hooks/use-settings';
import { reportMutationError } from '@/components/shared/report-mutation-error';

const HEX_RE = /^#(?:[0-9a-fA-F]{3}){1,2}$/;

function normalizeHex(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const withHash = trimmed.startsWith('#') ? trimmed : `#${trimmed}`;
  return HEX_RE.test(withHash) ? withHash.toLowerCase() : null;
}

// Audit F-30 (2026-05-07 r5): RHF schema replaces the previous `useState`
// per field + `toast.error` on submit. Hex validation is enforced at
// the schema level so the field surfaces "Enter a valid hex (e.g.
// #6366f1)" inline as the user types instead of as a toast on save.
const brandingFormSchema = z.object({
  brandPrimaryColor: z
    .string()
    .min(1, 'Primary color is required')
    .refine((v) => normalizeHex(v) !== null, {
      message: 'Enter a valid hex color (e.g. #6366f1)',
    }),
  brandSecondaryColor: z
    .string()
    .min(1, 'Accent color is required')
    .refine((v) => normalizeHex(v) !== null, {
      message: 'Enter a valid hex color (e.g. #ec4899)',
    }),
  logoUrl: z.string(),
  coverPhotoUrl: z.string(),
  faviconUrl: z.string(),
});
type BrandingFormValues = z.infer<typeof brandingFormSchema>;

export function BrandingForm({ settings }: { settings: ClubSettings }) {
  const updateSettings = useUpdateSettings();

  const form = useForm<BrandingFormValues>({
    resolver: zodResolver(brandingFormSchema),
    defaultValues: {
      brandPrimaryColor: settings.brandPrimaryColor ?? '#6366f1',
      brandSecondaryColor: settings.brandSecondaryColor ?? '#ec4899',
      logoUrl: settings.logoUrl ?? '',
      coverPhotoUrl: settings.coverPhotoUrl ?? '',
      faviconUrl: settings.faviconUrl ?? '',
    },
  });

  const primaryColor = form.watch('brandPrimaryColor') ?? '#6366f1';
  const secondaryColor = form.watch('brandSecondaryColor') ?? '#ec4899';

  async function onSave(values: BrandingFormValues) {
    // The schema-level refine guarantees these are valid hexes — but
    // normalize one more time so we send `#aabbcc` lowercase to the API
    // even if the user typed `AABBCC`.
    const primary = normalizeHex(values.brandPrimaryColor)!;
    const secondary = normalizeHex(values.brandSecondaryColor)!;
    try {
      await updateSettings.mutateAsync({
        brandPrimaryColor: primary,
        brandSecondaryColor: secondary,
        logoUrl: values.logoUrl || null,
        coverPhotoUrl: values.coverPhotoUrl || null,
        faviconUrl: values.faviconUrl || null,
      });
      toast.success('Branding updated');
    } catch (err) {
      reportMutationError('settings.branding.save', err);
      toast.error(err instanceof Error ? err.message : 'Failed to save branding');
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSave)} className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Palette className="h-5 w-5" />
              Brand Colors
            </CardTitle>
            <CardDescription>
              Used on rider-facing pages, confirmation emails, and shared invoice PDFs.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <FormField
              control={form.control}
              name="brandPrimaryColor"
              render={({ field }) => (
                <ColorPickerField
                  field={field}
                  label="Primary color"
                  description="Main brand color — used for buttons, links, and headers."
                  placeholder="#6366f1"
                />
              )}
            />
            <FormField
              control={form.control}
              name="brandSecondaryColor"
              render={({ field }) => (
                <ColorPickerField
                  field={field}
                  label="Accent color"
                  description="Secondary color used for highlights and success states."
                  placeholder="#ec4899"
                />
              )}
            />

            <div
              className="rounded-lg border p-4"
              style={{ borderColor: normalizeHex(primaryColor) ?? '#6366f1' }}
            >
              <p className="text-xs text-muted-foreground">Preview</p>
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <span
                  className="rounded-md px-3 py-1.5 text-sm font-medium text-white"
                  style={{ backgroundColor: normalizeHex(primaryColor) ?? '#6366f1' }}
                >
                  Primary button
                </span>
                <span
                  className="rounded-md px-3 py-1.5 text-sm font-medium text-white"
                  style={{ backgroundColor: normalizeHex(secondaryColor) ?? '#ec4899' }}
                >
                  Accent badge
                </span>
                <a
                  href="#"
                  onClick={(e) => e.preventDefault()}
                  style={{ color: normalizeHex(primaryColor) ?? '#6366f1' }}
                  className="text-sm font-medium underline-offset-4 hover:underline"
                >
                  Sample link
                </a>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Logos &amp; Imagery</CardTitle>
            <CardDescription>
              High-resolution assets that show up across the app and on shared documents.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-6 md:grid-cols-2">
            <FormField
              control={form.control}
              name="logoUrl"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Club logo</FormLabel>
                  <FormDescription>
                    Recommended: 512×512 PNG with a transparent background.
                  </FormDescription>
                  <FormControl>
                    <FileUpload
                      value={field.value}
                      onChange={(v) => field.onChange(v ?? '')}
                      folder="club/logo"
                      accept="image/*"
                      preview
                      label="Drop a logo"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="coverPhotoUrl"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Cover photo</FormLabel>
                  <FormDescription>
                    Hero image shown on your public club profile. Landscape, ~1600×600.
                  </FormDescription>
                  <FormControl>
                    <FileUpload
                      value={field.value}
                      onChange={(v) => field.onChange(v ?? '')}
                      folder="club/cover"
                      accept="image/*"
                      preview
                      label="Drop a cover photo"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="faviconUrl"
              render={({ field }) => (
                <FormItem className="md:col-span-2">
                  <FormLabel>Favicon</FormLabel>
                  <FormDescription>
                    Square PNG or ICO, used in browser tabs. Keep it simple — 32×32 or 64×64.
                  </FormDescription>
                  <FormControl>
                    <FileUpload
                      value={field.value}
                      onChange={(v) => field.onChange(v ?? '')}
                      folder="club/favicon"
                      accept="image/png,image/x-icon,image/vnd.microsoft.icon"
                      preview
                      label="Drop a favicon"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </CardContent>
        </Card>

        <div className="flex justify-end">
          <Button type="submit" disabled={updateSettings.isPending} size="lg">
            {updateSettings.isPending ? 'Saving...' : 'Save branding'}
          </Button>
        </div>
      </form>
    </Form>
  );
}

interface ColorPickerFieldProps {
  field: {
    value: string;
    onChange: (value: string) => void;
    onBlur: () => void;
    name: string;
  };
  label: string;
  description: string;
  placeholder: string;
}

function ColorPickerField({
  field,
  label,
  description,
  placeholder,
}: ColorPickerFieldProps) {
  const hex = normalizeHex(field.value) ?? '#000000';

  return (
    <FormItem>
      <Label>{label}</Label>
      <FormDescription>{description}</FormDescription>
      <div className="flex items-center gap-3">
        <Input
          type="color"
          value={hex}
          onChange={(e) => field.onChange(e.target.value)}
          onBlur={field.onBlur}
          className="h-10 w-16 cursor-pointer p-1"
          aria-label={`${label} picker`}
        />
        <Input
          type="text"
          value={field.value}
          onChange={(e) => field.onChange(e.target.value)}
          onBlur={field.onBlur}
          className="w-32 font-mono"
          placeholder={placeholder}
          aria-label={`${label} hex`}
        />
      </div>
      <FormMessage />
    </FormItem>
  );
}
