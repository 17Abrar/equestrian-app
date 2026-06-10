import { stripeAdapter } from './stripe';
import { nGeniusAdapter } from './n-genius';
import { ziinaAdapter } from './ziina';
import { type PaymentProviderAdapter, type ProviderName, PaymentProviderError } from './types';

const adapters: Record<ProviderName, PaymentProviderAdapter> = {
  stripe: stripeAdapter,
  n_genius: nGeniusAdapter,
  ziina: ziinaAdapter,
};

export function getAdapter(provider: ProviderName): PaymentProviderAdapter {
  const adapter = adapters[provider];
  if (!adapter) {
    throw new PaymentProviderError(
      'UNKNOWN_PROVIDER',
      `No adapter registered for provider "${provider}"`,
    );
  }
  return adapter;
}

export { PaymentProviderError } from './types';
export type { PaymentProviderAdapter, ProviderName } from './types';
