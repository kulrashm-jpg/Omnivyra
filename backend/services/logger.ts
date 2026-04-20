type LogLevel = 'info' | 'warn' | 'error';

type LogPayload = {
  event: string;
  message?: string;
  [key: string]: unknown;
};

import { getRequestContext } from './requestContext';

function write(level: LogLevel, payload: LogPayload): void {
  const ctx = getRequestContext();
  const entry = JSON.stringify({
    level,
    ts: new Date().toISOString(),
    request_id: ctx.requestId,
    correlation_id: ctx.correlationId,
    user_id: ctx.userId,
    org_id: ctx.orgId,
    idempotency_key: ctx.idempotencyKey,
    ...payload,
  });

  if (level === 'error') {
    console.error(entry);
    return;
  }

  if (level === 'warn') {
    console.warn(entry);
    return;
  }

  console.info(entry);
}

export const logger = {
  info(event: string, payload: Omit<LogPayload, 'event'> = {}) {
    write('info', { event, ...payload });
  },
  warn(event: string, payload: Omit<LogPayload, 'event'> = {}) {
    write('warn', { event, ...payload });
  },
  error(event: string, payload: Omit<LogPayload, 'event'> = {}) {
    write('error', { event, ...payload });
  },
};
