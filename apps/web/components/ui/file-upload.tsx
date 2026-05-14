'use client';

import { useState, useRef, useCallback } from 'react';
import { Upload, X, FileText, Loader2, AlertCircle } from 'lucide-react';
import Image from 'next/image';
import { cn } from '@/lib/utils';
import { reportMutationError } from '@/components/shared/report-mutation-error';
import { fetchJson } from '@/lib/fetch-json';
import { safeHref } from '@/lib/safe-href';

interface FileUploadProps {
  /** Current file URL (displays existing file) */
  value?: string;
  /** Called with the public R2 URL after successful upload */
  onChange: (url: string) => void;
  /** File type filter: "image/*" or "image/*,.pdf" */
  accept?: string;
  /** R2 folder path: "horses/photos", "horses/documents", "club/logo" */
  folder: string;
  /** Max file size in MB (default 15) */
  maxSizeMB?: number;
  /** Show image preview (for photo uploads) */
  preview?: boolean;
  /** Custom label text */
  label?: string;
  /** CSS class for the container */
  className?: string;
  /**
   * Override the R2 club prefix. Useful when the active tenant differs from
   * the destination — e.g. a rider uploading a horse photo for a stable
   * that's not their active club. Server re-validates membership.
   */
  targetClubId?: string;
}

export function FileUpload({
  value,
  onChange,
  accept = 'image/*',
  folder,
  maxSizeMB = 15,
  preview = false,
  label,
  className,
  targetClubId,
}: FileUploadProps) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const maxSizeBytes = maxSizeMB * 1024 * 1024;

  const handleFile = useCallback(
    async (file: File) => {
      setError(null);

      // Client-side size check
      if (file.size > maxSizeBytes) {
        setError(`File is too large. Maximum size is ${maxSizeMB}MB.`);
        return;
      }

      // Client-side type check
      if (accept !== '*') {
        const acceptParts = accept.split(',').map((a) => a.trim());
        const isAllowed = acceptParts.some((pattern) => {
          if (pattern === 'image/*') return file.type.startsWith('image/');
          if (pattern === 'application/pdf' || pattern === '.pdf')
            return file.type === 'application/pdf';
          if (pattern.startsWith('.')) return file.name.toLowerCase().endsWith(pattern);
          return file.type === pattern;
        });

        if (!isAllowed) {
          setError(`This file type is not allowed. Accepted: ${accept}`);
          return;
        }
      }

      setUploading(true);

      try {
        // Step 1: Get presigned URL from our API.
        //
        // audit L-2 (2026-05-05) — switched from raw fetch + .json() to
        // fetchJson<T>. Cloudflare workerd types correctly tighten
        // `Response.json(): Promise<unknown>` (the prior `Promise<any>`
        // was a lie); fetchJson wraps the validation, surfaces the
        // server's error message via `throw`, and does the cast in one
        // place.
        const presignJson = await fetchJson<{
          success: true;
          data: { uploadUrl: string; publicUrl: string; key: string };
        }>('/api/v1/upload', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fileName: file.name,
            contentType: file.type,
            folder,
            fileSizeBytes: file.size,
            ...(targetClubId ? { targetClubId } : {}),
          }),
        });
        const { uploadUrl, publicUrl, key } = presignJson.data;

        // Step 2: Upload directly to R2
        const uploadRes = await fetch(uploadUrl, {
          method: 'PUT',
          body: file,
          headers: {
            'Content-Type': file.type,
          },
        });

        if (!uploadRes.ok) {
          throw new Error('Upload to storage failed. Please try again.');
        }

        // Step 3: Ask the server to inspect the uploaded bytes. R2 trusts the
        // client-declared content-type; this catches a file that claims to be
        // `image/jpeg` but actually contains something else. On mismatch the
        // server deletes the object, so we never hand a tainted URL to the
        // form.
        //
        // Audit 2026-05-13 (P1): migrated to `fetchJson` to match step 1
        // (audit L-2). Before, a Cloudflare 502 with an HTML body landed in
        // the `verifyRes.json().catch(() => ({}))` swallow path and produced
        // the generic fallback message; `fetchJson` surfaces the structured
        // error envelope when the server returns one and reports a clean
        // network error otherwise.
        await fetchJson<{ success: true; data: { ok: true } }>('/api/v1/upload/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key, contentType: file.type }),
        });

        // Step 4: Pass the public URL back to the form
        onChange(publicUrl);
      } catch (err) {
        reportMutationError('upload.file', err, { folder });
        setError(err instanceof Error ? err.message : 'Upload failed. Please try again.');
      } finally {
        setUploading(false);
      }
    },
    [accept, folder, maxSizeBytes, maxSizeMB, onChange, targetClubId],
  );

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) void handleFile(file);
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(true);
  }

  function handleDragLeave(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
  }

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) void handleFile(file);
    // Reset so same file can be uploaded again
    if (inputRef.current) inputRef.current.value = '';
  }

  function handleRemove() {
    onChange('');
    setError(null);
  }

  function hasImageExtension(raw: string): boolean {
    const path = (() => {
      try {
        return new URL(raw).pathname;
      } catch {
        return raw;
      }
    })();
    return /\.(jpe?g|png|webp|gif|avif)$/i.test(path);
  }

  const hasValue = !!value;
  // Substring matches were prone to false positives — e.g. a non-image file
  // with `.png` in a query string would render as an image. Parse the URL
  // pathname and check the actual extension; tolerate non-URL values by
  // matching the trailing extension on the raw string instead.
  const isImage = !!value && hasImageExtension(value);

  // Show preview of existing image
  if (hasValue && preview && isImage) {
    return (
      <div className={cn('relative', className)}>
        <div className="bg-muted relative h-40 w-full overflow-hidden rounded-lg border">
          <Image src={value} alt="Uploaded file" fill className="object-cover" sizes="400px" />
        </div>
        <button
          type="button"
          onClick={handleRemove}
          className="bg-destructive text-destructive-foreground hover:bg-destructive/90 absolute -right-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full shadow-sm"
          aria-label="Remove file"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    );
  }

  // Show existing non-image file
  if (hasValue && !isImage) {
    return (
      <div className={cn('flex items-center gap-3 rounded-lg border p-3', className)}>
        <FileText className="text-muted-foreground h-8 w-8" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{value.split('/').pop()}</p>
          {/* Audit F-19 (2026-05-06): server-returned R2 URL still
              goes through safeHref at the render boundary —
              defense-in-depth, matches documents-tab.tsx pattern. */}
          <a
            href={safeHref(value)}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary text-xs hover:underline"
          >
            View file
          </a>
        </div>
        <button
          type="button"
          onClick={handleRemove}
          className="hover:bg-muted flex h-8 w-8 items-center justify-center rounded-full"
          aria-label="Remove file"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    );
  }

  // Upload dropzone
  return (
    <div className={className}>
      <div
        role="button"
        tabIndex={0}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click();
        }}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        className={cn(
          'flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-6 transition-colors',
          dragOver
            ? 'border-primary bg-primary/5'
            : 'border-muted-foreground/25 hover:border-muted-foreground/50',
          uploading && 'pointer-events-none opacity-60',
        )}
        aria-label={label ?? 'Drop file here or click to browse'}
      >
        {uploading ? (
          <>
            <Loader2 className="text-primary h-8 w-8 animate-spin" />
            <p className="text-muted-foreground text-sm">Uploading...</p>
          </>
        ) : (
          <>
            <Upload className="text-muted-foreground h-8 w-8" />
            <div className="text-center">
              <p className="text-sm font-medium">{label ?? 'Drop file here or click to browse'}</p>
              <p className="text-muted-foreground mt-1 text-xs">Max {maxSizeMB}MB</p>
            </div>
          </>
        )}
      </div>

      {error && (
        <div className="text-destructive mt-2 flex items-center gap-1.5 text-sm">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <p>{error}</p>
        </div>
      )}

      <input
        ref={inputRef}
        type="file"
        accept={accept}
        onChange={handleInputChange}
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
      />
    </div>
  );
}
