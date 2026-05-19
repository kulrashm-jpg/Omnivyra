/**
 * useOrchestrationDiagnostics — Phase-2 Step-15.
 * Client-side read-only orchestration UI observability. No mutation.
 */

export function logOrchestrationUi(tag: string, payload: Record<string, unknown>): void {
  try {
    // eslint-disable-next-line no-console
    console.log(`[${tag}]`, JSON.stringify(payload));
  } catch {
    /* never throw from a UI log */
  }
}

export const orchestrationUiDiagnostics = {
  planner: (p: Record<string, unknown>) => logOrchestrationUi('PLANNER_UI_ORCHESTRATION', p),
  calendar: (p: Record<string, unknown>) => logOrchestrationUi('CALENDAR_UI_ORCHESTRATION', p),
  fallback: (p: Record<string, unknown>) => logOrchestrationUi('ORCHESTRATION_UI_FALLBACK', p),
  blocker: (p: Record<string, unknown>) => logOrchestrationUi('ORCHESTRATION_UI_BLOCKER', p),
  mode: (p: Record<string, unknown>) => logOrchestrationUi('ORCHESTRATION_UI_MODE', p),
};
