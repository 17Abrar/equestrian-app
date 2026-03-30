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
  const entry: LogEntry = {
    level,
    event,
    timestamp: new Date().toISOString(),
    ...(data ? (sanitize(data) as Record<string, unknown>) : {}),
  };

  const output = JSON.stringify(entry);

  switch (level) {
    case 'error':
      console.error(output);
      break;
    case 'warn':
      console.warn(output);
      break;
    default:
      // Using console methods intentionally for structured logging
      // eslint-disable-next-line no-console
      console.log(output);
  }
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
