import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';

// Audit 2026-05-13 (P1): tests for the pure-function side of api-utils.ts.
// The auth-bearing wrappers (withAuth, requireCronSecret) need Clerk + DB
// + rate-limit mocks and are left as integration tests — out of scope for
// the unit pass. What this file covers:
//   - successResponse / errorResponse envelope shapes
//   - validateInput happy + sad paths
//   - validateUuidParam happy + sad paths
//   - parsePagination defaults + caps
//   - parseOptionalBody empty/malformed/oversize/valid
//   - parseRequiredBody mandates a body
//   - paginatedResponse computes totalPages correctly
//   - paginatedListResponse argument-flatten variant

// Stub the logger so api-utils.ts doesn't try to load the real one.
vi.mock('@/lib/logger', () => ({
  logger: {
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}));

// Stub Sentry — instrumentation-client pulls it in transitively in dev.
vi.mock('@sentry/nextjs', () => ({
  captureException: vi.fn(),
  withScope: (fn: (scope: { setTag: () => void }) => void) => fn({ setTag: vi.fn() }),
}));

import {
  successResponse,
  errorResponse,
  paginatedResponse,
  paginatedListResponse,
  parsePagination,
  validateInput,
  validateUuidParam,
  parseOptionalBody,
  parseRequiredBody,
  PayloadTooLargeError,
  ValidationError,
  MAX_REQUEST_BODY_BYTES,
} from './api-utils';
import { NextRequest } from 'next/server';

function makeJsonRequest(body: string | undefined, opts?: { contentLength?: number }): Request {
  const headers = new Headers({ 'content-type': 'application/json' });
  if (opts?.contentLength !== undefined) {
    headers.set('content-length', String(opts.contentLength));
  }
  return new Request('https://example.com/api/v1/x', {
    method: 'POST',
    headers,
    body,
  });
}

describe('successResponse', () => {
  it('wraps data in {success:true,data}, default 200', async () => {
    const res = successResponse({ id: 'abc' });
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ success: true, data: { id: 'abc' } });
  });

  it('honors a custom status code', () => {
    expect(successResponse({}, 201).status).toBe(201);
  });
});

describe('errorResponse', () => {
  it('wraps code+message in the standard envelope', async () => {
    const res = errorResponse('NOT_FOUND', 'Booking not found', 404);
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({
      success: false,
      error: { code: 'NOT_FOUND', message: 'Booking not found', details: undefined },
    });
  });

  it('passes details through unchanged', async () => {
    const res = errorResponse('VALIDATION_ERROR', 'Invalid', 400, { fieldErrors: {} });
    const body = await res.json();
    expect(body.error.details).toEqual({ fieldErrors: {} });
  });
});

describe('paginatedResponse', () => {
  it('computes totalPages = ceil(total / pageSize)', async () => {
    const res = paginatedResponse([1, 2, 3], { page: 1, pageSize: 25, total: 60 });
    const body = await res.json();
    expect(body.pagination.totalPages).toBe(3);
  });

  it('handles total < pageSize → 1 page', async () => {
    const res = paginatedResponse([], { page: 1, pageSize: 25, total: 5 });
    const body = await res.json();
    expect(body.pagination.totalPages).toBe(1);
  });

  it('handles total === 0 → 0 pages', async () => {
    const res = paginatedResponse([], { page: 1, pageSize: 25, total: 0 });
    const body = await res.json();
    expect(body.pagination.totalPages).toBe(0);
  });
});

describe('paginatedListResponse', () => {
  it('produces an envelope equivalent to paginatedResponse', async () => {
    const a = paginatedListResponse([1, 2], 2, 25, 60);
    const b = paginatedResponse([1, 2], { page: 2, pageSize: 25, total: 60 });
    await expect(a.json()).resolves.toEqual(await b.json());
  });
});

describe('parsePagination', () => {
  it('defaults to page=1, pageSize=25 when missing', () => {
    const req = new NextRequest('https://example.com/api/v1/x');
    expect(parsePagination(req)).toEqual({ page: 1, pageSize: 25 });
  });

  it('honors numeric query params', () => {
    const req = new NextRequest('https://example.com/api/v1/x?page=3&pageSize=10');
    expect(parsePagination(req)).toEqual({ page: 3, pageSize: 10 });
  });

  it('rejects pageSize over the server cap (50)', () => {
    const req = new NextRequest('https://example.com/api/v1/x?pageSize=999');
    expect(() => parsePagination(req)).toThrow(ValidationError);
  });

  it('rejects page < 1', () => {
    const req = new NextRequest('https://example.com/api/v1/x?page=0');
    expect(() => parsePagination(req)).toThrow(ValidationError);
  });
});

describe('validateInput', () => {
  const schema = z.object({ name: z.string().min(1) });

  it('returns the parsed output on valid input', () => {
    expect(validateInput(schema, { name: 'Bella' })).toEqual({ name: 'Bella' });
  });

  it('throws ValidationError with flattened details on failure', () => {
    let caught: ValidationError | null = null;
    try {
      validateInput(schema, { name: '' });
    } catch (e) {
      caught = e as ValidationError;
    }
    expect(caught).not.toBeNull();
    expect(caught?.code).toBe('VALIDATION_ERROR');
    expect(caught?.details).toBeDefined();
  });
});

describe('validateUuidParam', () => {
  const VALID_UUID = '11111111-1111-4111-8111-111111111111';

  it('returns the value unchanged for a valid v4 UUID', () => {
    expect(validateUuidParam('id', VALID_UUID)).toBe(VALID_UUID);
  });

  it('throws ValidationError for a non-UUID string', () => {
    expect(() => validateUuidParam('id', 'not-a-uuid')).toThrow(ValidationError);
  });

  it('attaches the param name to the error path', () => {
    try {
      validateUuidParam('bookingId', 'nope');
      expect.fail('expected throw');
    } catch (e) {
      const v = e as ValidationError;
      const details = v.details as { fieldErrors: Record<string, string[]> };
      expect(Object.keys(details.fieldErrors)).toContain('bookingId');
    }
  });
});

describe('parseOptionalBody', () => {
  const schema = z.object({ reason: z.string().min(1).optional() });

  it('treats an empty body as {}', async () => {
    const req = makeJsonRequest('');
    await expect(parseOptionalBody(req, schema)).resolves.toEqual({});
  });

  it('returns the parsed payload for a valid body', async () => {
    const req = makeJsonRequest(JSON.stringify({ reason: 'sick' }));
    await expect(parseOptionalBody(req, schema)).resolves.toEqual({ reason: 'sick' });
  });

  it('throws SyntaxError on malformed JSON (not silently {})', async () => {
    const req = makeJsonRequest('{not json');
    await expect(parseOptionalBody(req, schema)).rejects.toThrow(SyntaxError);
  });

  it('throws PayloadTooLargeError when content-length declares oversized body', async () => {
    const req = makeJsonRequest(undefined, { contentLength: MAX_REQUEST_BODY_BYTES + 1 });
    await expect(parseOptionalBody(req, schema)).rejects.toThrow(PayloadTooLargeError);
  });

  it('throws ValidationError on schema mismatch', async () => {
    const req = makeJsonRequest(JSON.stringify({ reason: '' }));
    await expect(parseOptionalBody(req, schema)).rejects.toThrow(ValidationError);
  });
});

describe('parseRequiredBody', () => {
  const schema = z.object({ name: z.string().min(1) });

  it('throws SyntaxError on malformed JSON', async () => {
    const req = makeJsonRequest('{not json');
    await expect(parseRequiredBody(req, schema)).rejects.toThrow(SyntaxError);
  });

  it('throws ValidationError on missing required field', async () => {
    const req = makeJsonRequest(JSON.stringify({}));
    await expect(parseRequiredBody(req, schema)).rejects.toThrow(ValidationError);
  });

  it('returns the parsed payload for a valid body', async () => {
    const req = makeJsonRequest(JSON.stringify({ name: 'Bella' }));
    await expect(parseRequiredBody(req, schema)).resolves.toEqual({ name: 'Bella' });
  });

  it('throws PayloadTooLargeError when content-length declares oversized body', async () => {
    const req = makeJsonRequest(undefined, { contentLength: MAX_REQUEST_BODY_BYTES + 1 });
    await expect(parseRequiredBody(req, schema)).rejects.toThrow(PayloadTooLargeError);
  });
});
