import * as Sentry from '@sentry/nextjs';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogEntry {
  level: LogLevel;
  event: string;
  timestamp: string;
  requestId?: string;
  clubId?: string;
  userId?: string;
  [key: string]: unknown;
}

const SENSITIVE_KEYS = new Set([
  'password',
  'token',
  'cardnumber',
  'secret',
  'authorization',
  'apikey',
  'api_key',
  'accesstoken',
  'access_token',
  'refreshtoken',
  'refresh_token',
  'creditcard',
  'credit_card',
  'ssn',
  'cvv',
]);

function sanitize(data: unknown, depth = 0): unknown {
  if (depth > 5) return '[nested]';

  if (Array.isArray(data)) {
    return data.map((item) => sanitize(item, depth + 1));
  }

  if (data !== null && typeof data === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data)) {
      if (SENSITIVE_KEYS.has(key.toLowerCase())) {
        result[key] = '[REDACTED]';
      } else {
        result[key] = sanitize(value, depth + 1);
      }
    }
    return result;
  }

  return data;
}

function log(level: LogLevel, event: string, data?: Record<string, unknown>) {
  const sanitized = data ? (sanitize(data) as Record<string, unknown>) : {};
  const entry: LogEntry = {
    level,
    event,
    timestamp: new Date().toISOString(),
    ...sanitized,
  };

  const output = JSON.stringify(entry);

  switch (level) {
    case 'error':
      console.error(output);
      forwardToSentry('error', event, sanitized);
      break;
    case 'warn':
      console.warn(output);
      forwardToSentry('warning', event, sanitized);
      break;
    default:
      // Using console methods intentionally for structured logging
      // eslint-disable-next-line no-console
      console.log(output);
  }
}

function forwardToSentry(
  level: 'error' | 'warning',
  event: string,
  data: Record<string, unknown>,
) {
  // Skip when Sentry isn't configured — avoids meaningless traffic in dev.
  if (!process.env.SENTRY_DSN && !process.env.NEXT_PUBLIC_SENTRY_DSN) return;

  // Pull the error object out if present so Sentry renders a real stack
  // trace instead of a one-line message.
  const errorValue = data.error;
  const errorInstance =
    errorValue instanceof Error
      ? errorValue
      : typeof errorValue === 'string'
        ? new Error(errorValue)
        : null;

  Sentry.withScope((scope) => {
    scope.setLevel(level);
    scope.setTag('logger.event', event);
    if (typeof data.clubId === 'string') scope.setTag('club_id', data.clubId);
    if (typeof data.userId === 'string') scope.setUser({ id: data.userId });
    if (typeof data.requestId === 'string') scope.setTag('request_id', data.requestId);
    // Full sanitized payload goes in extras so it's visible on the event page
    // without being promoted to searchable tags.
    scope.setContext('log_data', data);

    if (errorInstance) {
      Sentry.captureException(errorInstance);
    } else {
      Sentry.captureMessage(event, level);
    }
  });
}

export const logger = {
  info: (event: string, data?: Record<string, unknown>) => log('info', event, data),
  warn: (event: string, data?: Record<string, unknown>) => log('warn', event, data),
  error: (event: string, data?: Record<string, unknown>) => log('error', event, data),
  debug: (event: string, data?: Record<string, unknown>) => {
    if (process.env.NODE_ENV === 'development') {
      log('debug', event, data);
    }
  },
};
