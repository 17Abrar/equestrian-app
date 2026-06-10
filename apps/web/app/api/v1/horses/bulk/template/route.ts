import { NextResponse, type NextRequest } from 'next/server';
import { withAuth } from '@/lib/api-utils';

/**
 * GET /api/v1/horses/bulk/template — downloadable CSV template for
 * bulk horse import. Headers match the subset of fields
 * `createHorseSchema` accepts that are practical to fill in a
 * spreadsheet. Photo URLs, ownerMemberId, and similar are
 * intentionally omitted — those go through dedicated flows after
 * the bulk insert.
 *
 * The first non-header row is a sample. Admins should clear it
 * before adding their own data. We document the column conventions
 * in a comment row at the top, prefixed with `#` (Excel preserves
 * `#`-prefixed strings as a literal text cell — the bulk parser on
 * the client treats `#`-leading rows as a hint to skip).
 */
const COLUMNS = [
  'name',
  'barnName',
  'breed',
  'gender',
  'dateOfBirth',
  'color',
  'heightHands',
  'weightKg',
  'weightLimitKg',
  'microchipNumber',
  'passportNumber',
  'registrationNumber',
  'status',
  'skillLevel',
  'minRiderAge',
  'maxLessonsPerDay',
  'mandatoryRestDays',
  'saddleSize',
  'girthSize',
  'bridleSize',
  'bitType',
  'bitSize',
  'blanketSize',
  'bootsSize',
  'insuranceProvider',
  'insurancePolicyNumber',
  'insuranceExpiry',
  'notes',
] as const;

const SAMPLE_ROW = {
  name: 'Bella',
  barnName: 'Bels',
  breed: 'Arabian',
  gender: 'mare',
  dateOfBirth: '2015-03-12',
  color: 'Bay',
  heightHands: '15.2',
  weightKg: '450',
  weightLimitKg: '75',
  microchipNumber: '985112004567890',
  passportNumber: '',
  registrationNumber: '',
  status: 'available',
  skillLevel: 'intermediate',
  minRiderAge: '8',
  maxLessonsPerDay: '4',
  mandatoryRestDays: '1',
  saddleSize: '17',
  girthSize: '54',
  bridleSize: 'Cob',
  bitType: 'snaffle',
  bitSize: '5"',
  blanketSize: '6\'3"',
  bootsSize: 'M',
  insuranceProvider: '',
  insurancePolicyNumber: '',
  insuranceExpiry: '',
  notes: 'Good with intermediate riders. Avoid the back arena (skittish).',
} as const satisfies Record<(typeof COLUMNS)[number], string>;

function csvEscape(value: string): string {
  // CSV escape: wrap in quotes if the value contains a comma, quote,
  // or newline. Embedded quotes are doubled per RFC 4180.
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export async function GET(_request: NextRequest) {
  return withAuth(
    async () => {
      const headerRow = COLUMNS.map(csvEscape).join(',');
      // Prefix the sample row with `#` so the bulk-import parser
      // skips it as a comment line. Without this, admins who forget
      // to delete "Bella" from the template would import the sample
      // as a real horse. Codex P2 (2026-05-28).
      const sampleRow = '# ' + COLUMNS.map((c) => csvEscape(SAMPLE_ROW[c] ?? '')).join(',');
      // Escaped UTF-8 BOM (U+FEFF) prefix \u2014 Excel/Numbers display
      // BOM-prefixed UTF-8 cleanly; without it, Excel on Windows
      // defaults to Latin-1 and mangles non-ASCII horse names. Use
      // the `\uFEFF` escape rather than a literal BOM character so
      // ESLint's `no-irregular-whitespace` rule doesn't trip on
      // source-level whitespace (codex P1 2026-05-28).
      const body = `\uFEFF${headerRow}\n${sampleRow}\n`;
      return new NextResponse(body, {
        status: 200,
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': 'attachment; filename="cavaliq-horses-template.csv"',
          'Cache-Control': 'no-store',
        },
      });
    },
    { requiredPermission: 'horses:update' },
  );
}
