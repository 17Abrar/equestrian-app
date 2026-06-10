'use client';

import { useMemo, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Upload, Download, CheckCircle2, AlertCircle, FileSpreadsheet } from 'lucide-react';
import {
  bulkCreateHorsesSchema,
  bulkCreateHorseRowSchema,
  BULK_HORSES_MAX,
  type CreateHorseInput,
} from '@equestrian/shared/schemas';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { reportMutationError } from '@/components/shared/report-mutation-error';
import { fetchJson } from '@/lib/fetch-json';
import { type ApiSuccessResponse } from '@equestrian/shared/types';

/**
 * Bulk horse import — feature 2026-05-27 (user request). CSV
 * template + upload + preview + batch create.
 *
 * Why CSV instead of XLSX: parsing native xlsx in a Worker is heavy
 * (needs a 200KB+ library and zlib). CSV covers 90% of the use case
 * — Excel exports to CSV with one click, Numbers and Google Sheets
 * both export CSV natively. If admins need true XLSX support in
 * the future, we add a server-side parse via a library or shift
 * the parse to a Worker queue.
 *
 * Why client-side preview: validation feedback should be instant.
 * The server re-validates every row at submit (see
 * `apps/web/app/api/v1/horses/bulk/route.ts`) so a tampered client
 * can't bypass the Zod schema.
 */

interface BulkResult {
  successCount: number;
  failureCount: number;
  total: number;
  results: Array<
    | { success: true; index: number; csvRow: number; id: string; name: string }
    | { success: false; index: number; csvRow: number; name: string; error: string }
  >;
}

interface PreviewRow {
  /** 1-based CSV row number (header is row 1, first data is row 2). */
  csvRowNumber: number;
  raw: Record<string, string>;
  parsed: CreateHorseInput | null;
  errors: string[];
}

export function BulkImportButton() {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <FileSpreadsheet className="mr-2 h-4 w-4" />
          Bulk import
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <BulkImportBody onDone={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  );
}

function BulkImportBody({ onDone }: { onDone: () => void }) {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [rows, setRows] = useState<PreviewRow[]>([]);
  const [parseError, setParseError] = useState<string | null>(null);
  const [submitResult, setSubmitResult] = useState<BulkResult | null>(null);

  const bulkMutation = useMutation({
    mutationFn: (payload: { horses: CreateHorseInput[]; csvRowNumbers: number[] }) =>
      fetchJson<ApiSuccessResponse<BulkResult>>('/api/v1/horses/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }),
    onSuccess: (res) => {
      setSubmitResult(res.data);
      void qc.invalidateQueries({ queryKey: ['horses'] });
      if (res.data.failureCount === 0) {
        toast.success(
          `Imported ${res.data.successCount} horse${res.data.successCount === 1 ? '' : 's'}`,
        );
      } else {
        toast.warning(
          `Imported ${res.data.successCount} of ${res.data.total} · ${res.data.failureCount} failed — see details below`,
        );
      }
    },
    onError: (err) => {
      reportMutationError('horse.bulk_import', err);
      toast.error(err instanceof Error ? err.message : 'Bulk import failed');
    },
  });

  const validRows = useMemo(
    () => rows.filter((r) => r.parsed !== null && r.errors.length === 0),
    [rows],
  );
  const invalidRows = useMemo(() => rows.filter((r) => r.errors.length > 0), [rows]);

  async function onFile(file: File) {
    setSubmitResult(null);
    setParseError(null);
    try {
      const text = await file.text();
      const parsed = parseCsvToHorseRows(text);
      if (parsed.error) {
        setParseError(parsed.error);
        setRows([]);
        return;
      }
      if (parsed.rows.length === 0) {
        setParseError('No data rows found. Did the file include only headers?');
        setRows([]);
        return;
      }
      if (parsed.rows.length > BULK_HORSES_MAX) {
        setParseError(
          `Limit is ${BULK_HORSES_MAX} horses per upload — your file has ${parsed.rows.length}. Split into smaller files.`,
        );
        setRows([]);
        return;
      }
      setRows(parsed.rows);
    } catch (err) {
      setParseError(err instanceof Error ? err.message : 'Failed to read file');
      setRows([]);
    }
  }

  async function onSubmit() {
    if (validRows.length === 0) return;
    const horses = validRows.map((r) => r.parsed).filter((h): h is CreateHorseInput => h !== null);
    // Send the parallel CSV-row-number array so the post-import view
    // can point at the right line in the spreadsheet even after we
    // filtered invalid rows out. Codex P3 (2026-05-27).
    const csvRowNumbers = validRows.map((r) => r.csvRowNumber);
    const payload = { horses, csvRowNumbers };
    // Final guard: re-validate the array shape (in case the client
    // upgraded only some rows). The server does this too.
    const check = bulkCreateHorsesSchema.safeParse(payload);
    if (!check.success) {
      toast.error('Validation failed before send — refresh and re-upload.');
      return;
    }
    try {
      await bulkMutation.mutateAsync(payload);
    } catch {
      // Codex P3 (2026-05-28): `onError` already surfaces a toast +
      // Sentry. Catching the re-thrown rejection here keeps the dev
      // unhandled-rejection overlay quiet.
    }
  }

  function reset() {
    setRows([]);
    setSubmitResult(null);
    setParseError(null);
    if (fileRef.current) fileRef.current.value = '';
  }

  // Post-submit result view
  if (submitResult) {
    return (
      <>
        <DialogHeader>
          <DialogTitle>Import complete</DialogTitle>
          <DialogDescription>
            {submitResult.successCount} of {submitResult.total} horses imported successfully.
            {submitResult.failureCount > 0 &&
              ` ${submitResult.failureCount} failed — see details below.`}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2 py-4 text-sm">
          {submitResult.results.map((r) => (
            <div key={r.index} className="flex items-start gap-2 rounded-md border p-2">
              {r.success ? (
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
              ) : (
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">
                  Row {r.csvRow}: {r.name || 'Unnamed'}
                </p>
                {!r.success && <p className="text-muted-foreground text-xs">{r.error}</p>}
              </div>
            </div>
          ))}
        </div>
        <DialogFooter>
          {submitResult.failureCount > 0 && (
            <Button variant="outline" onClick={reset}>
              Import more
            </Button>
          )}
          <Button onClick={onDone}>Done</Button>
        </DialogFooter>
      </>
    );
  }

  // Initial / preview view
  return (
    <>
      <DialogHeader>
        <DialogTitle>Bulk import horses</DialogTitle>
        <DialogDescription>
          Download the template, fill it in your spreadsheet tool, then upload the CSV. We validate
          each row before any horse is created. Max {BULK_HORSES_MAX} horses per upload.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4 py-4">
        {/* Step 1 — Template */}
        <div className="rounded-md border p-3">
          <p className="text-sm font-medium">Step 1 — Get the template</p>
          <p className="text-muted-foreground mt-1 text-xs">
            A CSV with the columns Cavaliq accepts. Open it in Excel / Numbers / Google Sheets, fill
            it in, then save as CSV.
          </p>
          <Button asChild variant="outline" size="sm" className="mt-2">
            <a href="/api/v1/horses/bulk/template" download="cavaliq-horses-template.csv">
              <Download className="mr-2 h-4 w-4" />
              Download template
            </a>
          </Button>
        </div>

        {/* Step 2 — Upload */}
        <div className="rounded-md border p-3">
          <p className="text-sm font-medium">Step 2 — Upload your filled CSV</p>
          <p className="text-muted-foreground mt-1 text-xs">
            We&apos;ll preview every row and call out validation errors before anything is saved.
          </p>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            className="mt-2 block w-full text-sm"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void onFile(file);
            }}
          />
          {parseError && <p className="text-destructive mt-2 text-xs">{parseError}</p>}
        </div>

        {/* Step 3 — Preview */}
        {rows.length > 0 && (
          <div className="rounded-md border">
            <div className="flex flex-wrap items-center gap-2 border-b p-3">
              <p className="text-sm font-medium">Step 3 — Preview</p>
              <Badge variant="secondary" className="bg-emerald-100 text-emerald-800">
                {validRows.length} valid
              </Badge>
              {invalidRows.length > 0 && (
                <Badge variant="secondary" className="bg-red-100 text-red-800">
                  {invalidRows.length} need fixing
                </Badge>
              )}
            </div>
            <div className="max-h-[40vh] overflow-y-auto p-2">
              {rows.map((r) => {
                const ok = r.errors.length === 0;
                return (
                  <div
                    key={r.csvRowNumber}
                    className={`flex items-start gap-2 rounded-md border p-2 ${ok ? '' : 'border-red-200 bg-red-50'} mb-2 last:mb-0`}
                  >
                    {ok ? (
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                    ) : (
                      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
                    )}
                    <div className="min-w-0 flex-1 text-sm">
                      <p className="truncate font-medium">
                        Row {r.csvRowNumber}: {r.raw.name || '(no name)'}
                      </p>
                      {r.errors.length > 0 && (
                        <ul className="text-muted-foreground mt-1 list-disc pl-4 text-xs">
                          {r.errors.map((e, i) => (
                            <li key={i}>{e}</li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      <DialogFooter>
        {rows.length > 0 && (
          <Button variant="outline" onClick={reset} disabled={bulkMutation.isPending}>
            Start over
          </Button>
        )}
        <Button onClick={onSubmit} disabled={validRows.length === 0 || bulkMutation.isPending}>
          <Upload className="mr-2 h-4 w-4" />
          {bulkMutation.isPending
            ? 'Importing…'
            : validRows.length === 0
              ? 'Pick a CSV first'
              : `Import ${validRows.length} horse${validRows.length === 1 ? '' : 's'}`}
        </Button>
      </DialogFooter>
    </>
  );
}

// ─── CSV parsing ────────────────────────────────────────────────────

/**
 * Minimal RFC 4180-ish CSV parser. Handles:
 *   - Quoted fields with embedded commas and newlines.
 *   - Doubled quotes inside a quoted field (`""` → `"`).
 *   - Mixed line endings (CR/LF/CRLF).
 *   - A leading UTF-8 BOM (which Excel inserts on save-as CSV).
 *   - `#`-prefixed comment lines (the template's first data line is
 *     a sample row that admins might keep — we don't comment it,
 *     but allow comments for hand-edited CSVs).
 *
 * Returns a flat array of string-record rows keyed by the header.
 * No locale parsing — values are kept as strings and Zod coerces /
 * validates per-row.
 *
 * Why hand-rolled: papaparse pulls ~50KB into the client bundle for
 * a one-time admin flow. The template we ship is well-formed and
 * the validation happens server-side anyway.
 */
/**
 * Returns parsed rows alongside their ORIGINAL CSV line numbers
 * (1-based). Blank lines and `#`-comment lines are skipped but their
 * presence advances the line counter — so a row at file line 7 with
 * two comment lines and a blank above it still surfaces as line 7
 * in the preview / result view. Codex P3 (2026-05-28): without the
 * carry-through, the previous implementation produced off-by-one
 * numbers whenever the upload contained skipped lines.
 */
function parseCsvRaw(
  text: string,
): { rows: Array<{ values: string[]; lineNumber: number }> } | { error: string } {
  // Strip UTF-8 BOM if present.
  const cleaned = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  const rows: Array<{ values: string[]; lineNumber: number }> = [];
  let current: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  let lineNumber = 1; // 1-based; advances on every line terminator.
  let rowStartLine = 1; // The line where the current logical row began.

  function commitField() {
    current.push(field);
    field = '';
  }
  function commitRow() {
    if (current.length === 1 && current[0] === '') {
      // Blank line — drop it.
    } else if (current[0]?.startsWith('#')) {
      // Comment line — drop it.
    } else {
      rows.push({ values: current, lineNumber: rowStartLine });
    }
    current = [];
    field = '';
  }

  while (i < cleaned.length) {
    const ch = cleaned[i];
    if (inQuotes) {
      if (ch === '"') {
        if (cleaned[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      // Quoted fields can span lines; advance the line counter so
      // the next row's `rowStartLine` is correct.
      if (ch === '\n') lineNumber += 1;
      field += ch;
      i += 1;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === ',') {
      commitField();
      i += 1;
      continue;
    }
    if (ch === '\n' || ch === '\r') {
      commitField();
      // Skip CRLF together.
      if (ch === '\r' && cleaned[i + 1] === '\n') i += 1;
      commitRow();
      i += 1;
      lineNumber += 1;
      rowStartLine = lineNumber;
      continue;
    }
    field += ch;
    i += 1;
  }
  if (inQuotes) {
    return { error: 'Unterminated quoted field — fix the file and re-upload.' };
  }
  // Tail row (no trailing newline).
  if (field !== '' || current.length > 0) {
    commitField();
    commitRow();
  }
  return { rows };
}

interface ParseResult {
  rows: PreviewRow[];
  error: string | null;
}

function parseCsvToHorseRows(text: string): ParseResult {
  const raw = parseCsvRaw(text);
  if ('error' in raw) return { rows: [], error: raw.error };
  if (raw.rows.length === 0) {
    return { rows: [], error: 'CSV is empty.' };
  }
  const headerRow = raw.rows[0];
  if (!headerRow) {
    return { rows: [], error: 'CSV is empty.' };
  }
  const headerKeys = headerRow.values.map((h) => h.trim());
  // Sanity: must include `name` column.
  if (!headerKeys.includes('name')) {
    return { rows: [], error: 'CSV must include a "name" column (the only required field).' };
  }

  const preview: PreviewRow[] = [];
  for (let rowIdx = 1; rowIdx < raw.rows.length; rowIdx += 1) {
    const row = raw.rows[rowIdx];
    if (!row) continue;
    const recordObj: Record<string, string> = {};
    for (let colIdx = 0; colIdx < headerKeys.length; colIdx += 1) {
      const key = headerKeys[colIdx];
      if (!key) continue;
      const value = row.values[colIdx];
      recordObj[key] = (value ?? '').trim();
    }

    // Coerce empty strings to undefined so the Zod schema's
    // `.optional()` accepts them. Numeric columns that arrive as
    // strings flow through `numericField` preprocessor.
    const coerced: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(recordObj)) {
      coerced[k] = v === '' ? undefined : v;
    }

    // Use the ORIGINAL file line number so the preview + result
    // pointers match what the operator sees in their spreadsheet,
    // even when the CSV had blank or `#`-comment lines above this
    // row. Codex P3 (2026-05-28).
    const csvRowNumber = row.lineNumber;
    // Preview MUST use the same row schema as the server submit
    // (`bulkCreateHorseRowSchema`) — it adds stricter YYYY-MM-DD
    // dates and drops ownerMemberId vs the single-horse form schema.
    // Codex P2 (2026-05-28).
    const parsed = bulkCreateHorseRowSchema.safeParse(coerced);
    if (parsed.success) {
      preview.push({
        csvRowNumber,
        raw: recordObj,
        parsed: parsed.data,
        errors: [],
      });
    } else {
      const errors = parsed.error.errors.map((e) => {
        const path = e.path.length > 0 ? `${e.path.join('.')}: ` : '';
        return `${path}${e.message}`;
      });
      preview.push({
        csvRowNumber,
        raw: recordObj,
        parsed: null,
        errors,
      });
    }
  }
  return { rows: preview, error: null };
}
