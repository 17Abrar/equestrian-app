'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Palette } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { FileUpload } from '@/components/ui/file-upload';
import { useUpdateSettings, type ClubSettings } from '@/hooks/use-settings';

const HEX_RE = /^#(?:[0-9a-fA-F]{3}){1,2}$/;

function normalizeHex(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const withHash = trimmed.startsWith('#') ? trimmed : `#${trimmed}`;
  return HEX_RE.test(withHash) ? withHash.toLowerCase() : null;
}

export function BrandingForm({ settings }: { settings: ClubSettings }) {
  const updateSettings = useUpdateSettings();

  const [primaryColor, setPrimaryColor] = useState(settings.brandPrimaryColor ?? '#6366f1');
  const [secondaryColor, setSecondaryColor] = useState(
    settings.brandSecondaryColor ?? '#ec4899',
  );
  const [logoUrl, setLogoUrl] = useState(settings.logoUrl ?? '');
  const [coverPhotoUrl, setCoverPhotoUrl] = useState(settings.coverPhotoUrl ?? '');
  const [faviconUrl, setFaviconUrl] = useState(settings.faviconUrl ?? '');

  async function onSave() {
    const primary = normalizeHex(primaryColor);
    const secondary = normalizeHex(secondaryColor);
    if (!primary) {
      toast.error('Primary color must be a valid hex (e.g. #6366f1)');
      return;
    }
    if (!secondary) {
      toast.error('Secondary color must be a valid hex (e.g. #ec4899)');
      return;
    }
    try {
      await updateSettings.mutateAsync({
        brandPrimaryColor: primary,
        brandSecondaryColor: secondary,
        logoUrl: logoUrl || null,
        coverPhotoUrl: coverPhotoUrl || null,
        faviconUrl: faviconUrl || null,
      });
      toast.success('Branding updated');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save branding');
    }
  }

  return (
    <div className="space-y-4">
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
          <ColorPicker
            label="Primary color"
            description="Main brand color — used for buttons, links, and headers."
            value={primaryColor}
            onChange={setPrimaryColor}
          />
          <ColorPicker
            label="Accent color"
            description="Secondary color used for highlights and success states."
            value={secondaryColor}
            onChange={setSecondaryColor}
          />

          <div className="rounded-lg border p-4" style={{ borderColor: normalizeHex(primaryColor) ?? '#6366f1' }}>
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
          <CardTitle>Logos & Imagery</CardTitle>
          <CardDescription>
            High-resolution assets that show up across the app and on shared documents.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-6 md:grid-cols-2">
          <div className="space-y-2">
            <Label>Club logo</Label>
            <p className="text-xs text-muted-foreground">
              Recommended: 512×512 PNG with a transparent background.
            </p>
            <FileUpload
              value={logoUrl}
              onChange={(v) => setLogoUrl(v ?? '')}
              folder="club/logo"
              accept="image/*"
              preview
              label="Drop a logo"
            />
          </div>

          <div className="space-y-2">
            <Label>Cover photo</Label>
            <p className="text-xs text-muted-foreground">
              Hero image shown on your public club profile. Landscape, ~1600×600.
            </p>
            <FileUpload
              value={coverPhotoUrl}
              onChange={(v) => setCoverPhotoUrl(v ?? '')}
              folder="club/cover"
              accept="image/*"
              preview
              label="Drop a cover photo"
            />
          </div>

          <div className="space-y-2 md:col-span-2">
            <Label>Favicon</Label>
            <p className="text-xs text-muted-foreground">
              Square PNG or ICO, used in browser tabs. Keep it simple — 32×32 or 64×64.
            </p>
            <FileUpload
              value={faviconUrl}
              onChange={(v) => setFaviconUrl(v ?? '')}
              folder="club/favicon"
              accept="image/png,image/x-icon,image/vnd.microsoft.icon"
              preview
              label="Drop a favicon"
            />
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button onClick={onSave} disabled={updateSettings.isPending} size="lg">
          {updateSettings.isPending ? 'Saving...' : 'Save branding'}
        </Button>
      </div>
    </div>
  );
}

interface ColorPickerProps {
  label: string;
  description: string;
  value: string;
  onChange: (value: string) => void;
}

function ColorPicker({ label, description, value, onChange }: ColorPickerProps) {
  const hex = normalizeHex(value) ?? '#000000';

  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <p className="text-xs text-muted-foreground">{description}</p>
      <div className="flex items-center gap-3">
        <Input
          type="color"
          value={hex}
          onChange={(e) => onChange(e.target.value)}
          className="h-10 w-16 cursor-pointer p-1"
          aria-label={`${label} picker`}
        />
        <Input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-32 font-mono"
          placeholder="#6366f1"
          aria-label={`${label} hex`}
        />
      </div>
    </div>
  );
}
