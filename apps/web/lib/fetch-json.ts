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
 *  - throws an `Error` whose message is the server's
 *    `{ error: { message } }` payload when the response is non-2xx
 *  - returns the parsed JSON typed as `T` on success
 *
 * The thrown `Error` is what `mutation.onError` and `query.error.message`
 * read; if a caller needs the structured error code/details, it can
 * upgrade to a custom error class. Today no caller needs that.
 */
export async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const data = (await res.json().catch(() => null)) as
    | { error?: { message?: string; code?: string } }
    | null;

  if (!res.ok) {
    throw new Error(data?.error?.message ?? 'Request failed');
  }

  return data as T;
}
