/**
 * Shared fetch wrapper used by every TanStack Query hook + form mutator.
 * Replaces the same 8-line block that was previously copy-pasted into 14
 * different hook/component files (use-horses, use-bookings, use-finances,
 * use-staff, use-competitions, use-riders, use-horse-health, use-settings,
 * use-dashboard, use-reports, use-payment-accounts, use-booking-payment,
 * audiences-tab, onboarding/page).
 *
 * Behaviour:
 *  - parses the response as JSON
 *  - throws on non-2xx (Error message = server's `error.message` if
 *    available, generic fallback otherwise)
 *  - throws when the body doesn't match the `{ success, data | error }`
 *    envelope contract — without this guard, a route accidentally
 *    returning bare data would silently propagate as `null`/`undefined`
 *    through TanStack Query and surface as an empty-state UI rather
 *    than a parseable error (audit C-5)
 *  - returns the parsed envelope typed as `T` on success
 */
export class ResponseShapeError extends Error {
  public readonly url: string;
  public readonly status: number;

  constructor(url: string, status: number) {
    super('Server returned a body that does not match the API envelope');
    this.name = 'ResponseShapeError';
    this.url = url;
    this.status = status;
  }
}

function looksLikeEnvelope(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  if (obj.success === true) return true;
  if (obj.success === false && typeof obj.error === 'object' && obj.error !== null) return true;
  return false;
}

export async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  // Audit F-6 (2026-05-06): every fetch carries a custom header that the
  // server-side CSRF guard checks for in addition to Origin. The header
  // is custom (browsers can't set it on a cross-site form post without
  // CORS preflight, which the server refuses), so a missing-Origin POST
  // from a malicious page can no longer reach the cookie-mutator.
  const initWithCsrf: RequestInit = {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      'x-cavaliq-csrf': '1',
    },
  };
  const res = await fetch(url, initWithCsrf);
  const data = (await res.json().catch(() => null)) as
    | { error?: { message?: string; code?: string } }
    | null;

  if (!res.ok) {
    throw new Error(data?.error?.message ?? 'Request failed');
  }

  // Routes returning HTML / a 502 gateway page / bare data fall through to
  // here. Surface as a typed throw so the caller's catch can react instead
  // of dereferencing `data.data?.foo` on undefined later.
  if (!looksLikeEnvelope(data)) {
    throw new ResponseShapeError(url, res.status);
  }

  return data as T;
}
