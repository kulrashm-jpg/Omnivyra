type LogLevel = 'debug' | 'info' | 'warn' | 'error';

type LogPayload = {
  event: string;
  message?: string;
  [key: string]: unknown;
};

import { getRequestContext } from './requestContext';
import { redact } from '../security/logRedaction';

// HARDEN-001: structured level filtering. Existing info/warn/error behavior is
// unchanged (default threshold 'info'); DEBUG is opt-in via LOG_LEVEL=debug so
// it is silent in production unless explicitly enabled.
const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };
function resolveThreshold(): number {
  const raw = String(process.env.LOG_LEVEL ?? '').trim().toLowerCase();
  if (raw && raw in LEVEL_ORDER) return LEVEL_ORDER[raw as LogLevel];
  return LEVEL_ORDER.info;
}
const THRESHOLD = resolveThreshold();

function write(level: LogLevel, payload: LogPayload): void {
  if (LEVEL_ORDER[level] < THRESHOLD) return;
  const ctx = getRequestContext();
  // SEC log-redaction: every message and structured field passes through the central
  // redactor (credential key names + token shapes; deep, cycle-safe, bounded). The
  // request context fields are identifiers, not credentials, and are written as-is.
  const safePayload = redact(payload) as LogPayload;
  const entry = JSON.stringify({
    level,
    ts: new Date().toISOString(),
    request_id: ctx.requestId,
    correlation_id: ctx.correlationId,
    user_id: ctx.userId,
    org_id: ctx.orgId,
    idempotency_key: ctx.idempotencyKey,
    ...safePayload,
  });

  if (level === 'error') {
    console.error(entry);
    return;
  }

  if (level === 'warn') {
    console.warn(entry);
    return;
  }

  if (level === 'debug') {
    console.debug(entry);
    return;
  }

  console.info(entry);
}

export const logger = {
  debug(event: string, payload: Omit<LogPayload, 'event'> = {}) {
    write('debug', { event, ...payload });
  },
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
