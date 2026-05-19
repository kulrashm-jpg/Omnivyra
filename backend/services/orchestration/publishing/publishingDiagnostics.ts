/**
 * publishingDiagnostics — Phase-2 Step-31 (server-side).
 * Structured single-line logs. Never throws.
 */

const LOG = (tag: string, payload: Record<string, unknown>) => {
  try {
    // eslint-disable-next-line no-console
    console.log(`[${tag}]`, JSON.stringify(payload));
  } catch {
    /* never throw from a diagnostic */
  }
};

export const publishingDiagnostics = {
  authoritative: (c: Record<string, unknown>) => LOG('AUTHORITATIVE_PUBLISHING', c),
  projection: (c: Record<string, unknown>) => LOG('PUBLISHING_PROJECTION', c),
  fallback: (c: Record<string, unknown>) => LOG('PUBLISHING_FALLBACK', c),
  blocked: (c: Record<string, unknown>) => LOG('PUBLISHING_BLOCKED', c),
  scheduler: (c: Record<string, unknown>) => LOG('PUBLISHING_SCHEDULER', c),
  executionDiff: (c: Record<string, unknown>) => LOG('PUBLISHING_EXECUTION_DIFF', c),
};
