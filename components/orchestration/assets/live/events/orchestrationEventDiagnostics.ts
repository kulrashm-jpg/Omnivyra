/**
 * orchestrationEventDiagnostics — Phase-2 Step-23 (client, read-only).
 * Never throws. Distinct from the server-side event diagnostics.
 */

function log(tag: string, payload: Record<string, unknown>): void {
  try {
    // eslint-disable-next-line no-console
    console.log(`[${tag}]`, JSON.stringify(payload));
  } catch {
    /* never throw from a UI log */
  }
}

export const orchestrationEventClientDiagnostics = {
  receive: (p: Record<string, unknown>) => log('ORCHESTRATION_EVENT_RECEIVE', p),
  hydrate: (p: Record<string, unknown>) => log('ORCHESTRATION_EVENT_HYDRATE', p),
  fail: (p: Record<string, unknown>) => log('ORCHESTRATION_EVENT_FAIL', p),
  fallback: (p: Record<string, unknown>) => log('ORCHESTRATION_EVENT_FALLBACK', p),
};
