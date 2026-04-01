import { useAuth, useOrganization } from '@clerk/clerk-expo';
import { useMemo } from 'react';
import { createApiClient, type ApiClient } from '@equestrian/api-client';

const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000';

export function useApiClient(): ApiClient {
  const { getToken } = useAuth();
  const { organization } = useOrganization();

  return useMemo(
    () =>
      createApiClient({
        baseUrl: API_BASE_URL,
        getToken: () => getToken(),
        getOrganizationId: () => organization?.id ?? null,
      }),
    [getToken, organization?.id],
  );
}
