/**
 * orchestrationEventDiagnostics — Phase-2 Step-23 (server-side).
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

export const orchestrationEventDiagnostics = {
  event: (c: Record<string, unknown>) => LOG('ORCHESTRATION_EVENT', c),
  push: (c: Record<string, unknown>) => LOG('ORCHESTRATION_EVENT_PUSH', c),
  fail: (c: Record<string, unknown>) => LOG('ORCHESTRATION_EVENT_FAIL', c),
};
