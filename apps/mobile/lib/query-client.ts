import { QueryClient } from '@tanstack/react-query';
import { STALE_TIME_FREQUENT } from '@equestrian/shared/constants';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: STALE_TIME_FREQUENT,
      retry: 1,
    },
  },
});
