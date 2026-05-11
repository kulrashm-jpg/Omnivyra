/**
 * correlationId — short, opaque per-request identifier used to correlate
 * auth-decision responses with their server-side audit rows and logs.
 *
 * Phase 1 — Session Integrity Diagnostics. The id is included in every
 * structured auth-denial response so a frustrated operator (or support)
 * can hand it to an engineer who can grep capability_audit_log.
 *
 * Format: 12 hex chars, prefixed with "auth_". Long enough to be
 * unambiguous in a small audit table, short enough to type into a search
 * box. NOT a UUID (we don't need 122 bits of entropy here, and shorter
 * ids stay readable in URL bars / log lines).
 *
 * NB: the id is opaque — never derive authority from it. It is a
 * diagnostic handle only.
 */
import type { NextApiRequest } from 'next';
import { randomBytes } from 'crypto';

const CORRELATION_HEADER = 'x-omnivyra-correlation-id';

/**
 * Read a correlation id from an inbound request header (if present),
 * otherwise mint a fresh one. Allows tools (curl, support scripts) to
 * pin a known id across a chain of calls.
 */
export function correlationIdFor(req: NextApiRequest): string {
  const incoming = req.headers[CORRELATION_HEADER];
  if (typeof incoming === 'string' && /^auth_[a-f0-9]{6,32}$/i.test(incoming)) {
    return incoming;
  }
  return mintCorrelationId();
}

export function mintCorrelationId(): string {
  return `auth_${randomBytes(6).toString('hex')}`;
}

export const CORRELATION_HEADER_NAME = CORRELATION_HEADER;
