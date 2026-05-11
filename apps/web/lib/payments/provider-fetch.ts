import { PaymentProviderError } from './types';

const PROVIDER_FETCH_TIMEOUT_MS = 15_000;

export async function fetchProvider(
  input: RequestInfo | URL,
  init: RequestInit,
  context: { provider: string; operation: string },
): Promise<Response> {
  try {
    return await fetch(input, {
      ...init,
      signal: init.signal ?? AbortSignal.timeout(PROVIDER_FETCH_TIMEOUT_MS),
    });
  } catch (err) {
    throw new PaymentProviderError(
      'PROVIDER_REQUEST_FAILED',
      `${context.provider} ${context.operation} request failed or timed out`,
      { retryable: true, cause: err },
    );
  }
}
