'use client';

import { useState, useRef, useCallback } from 'react';
import { Upload, X, FileText, Loader2, AlertCircle } from 'lucide-react';
import Image from 'next/image';
import { cn } from '@/lib/utils';

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

  const handleFile = useCallback(async (file: File) => {
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
        if (pattern === 'application/pdf' || pattern === '.pdf') return file.type === 'application/pdf';
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
      // Step 1: Get presigned URL from our API
      const presignRes = await fetch('/api/v1/upload', {
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

      if (!presignRes.ok) {
        const errData = await presignRes.json();
        throw new Error(errData.error?.message ?? 'Failed to prepare upload');
      }

      const { uploadUrl, publicUrl, key } = await presignRes
        .json()
        .then(
          (r: {
            data: { uploadUrl: string; publicUrl: string; key: string };
          }) => r.data,
        );

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
      const verifyRes = await fetch('/api/v1/upload/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, contentType: file.type }),
      });
      if (!verifyRes.ok) {
        const errData = await verifyRes.json().catch(() => ({}));
        throw new Error(
          (errData as { error?: { message?: string } }).error?.message ??
            'Uploaded file could not be verified. Please try again.',
        );
      }

      // Step 4: Pass the public URL back to the form
      onChange(publicUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed. Please try again.');
    } finally {
      setUploading(false);
    }
  }, [accept, folder, maxSizeBytes, maxSizeMB, onChange, targetClubId]);

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
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
    if (file) handleFile(file);
    // Reset so same file can be uploaded again
    if (inputRef.current) inputRef.current.value = '';
  }

  function handleRemove() {
    onChange('');
    setError(null);
  }

  const hasValue = !!value;
  const isImage = value && (value.includes('.jpg') || value.includes('.jpeg') || value.includes('.png') || value.includes('.webp') || value.includes('.gif') || value.includes('image'));

  // Show preview of existing image
  if (hasValue && preview && isImage) {
    return (
      <div className={cn('relative', className)}>
        <div className="relative h-40 w-full overflow-hidden rounded-lg border bg-muted">
          <Image
            src={value}
            alt="Uploaded file"
            fill
            className="object-cover"
            sizes="400px"
          />
        </div>
        <button
          type="button"
          onClick={handleRemove}
          className="absolute -right-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90"
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
        <FileText className="h-8 w-8 text-muted-foreground" />
        <div className="flex-1 min-w-0">
          <p className="truncate text-sm font-medium">{value.split('/').pop()}</p>
          <a href={value} target="_blank" rel="noopener noreferrer" className="text-xs text-primary hover:underline">
            View file
          </a>
        </div>
        <button
          type="button"
          onClick={handleRemove}
          className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-muted"
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
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click(); }}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        className={cn(
          'flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-6 transition-colors cursor-pointer',
          dragOver ? 'border-primary bg-primary/5' : 'border-muted-foreground/25 hover:border-muted-foreground/50',
          uploading && 'pointer-events-none opacity-60',
        )}
        aria-label={label ?? 'Drop file here or click to browse'}
      >
        {uploading ? (
          <>
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">Uploading...</p>
          </>
        ) : (
          <>
            <Upload className="h-8 w-8 text-muted-foreground" />
            <div className="text-center">
              <p className="text-sm font-medium">{label ?? 'Drop file here or click to browse'}</p>
              <p className="mt-1 text-xs text-muted-foreground">Max {maxSizeMB}MB</p>
            </div>
          </>
        )}
      </div>

      {error && (
        <div className="mt-2 flex items-center gap-1.5 text-sm text-destructive">
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
