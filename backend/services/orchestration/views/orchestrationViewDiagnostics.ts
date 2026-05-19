/**
 * Orchestration Views — observability (Phase-2 Step-14).
 */

const LOG = (tag: string, payload: Record<string, unknown>) =>
  // eslint-disable-next-line no-console
  console.log(`[${tag}]`, JSON.stringify(payload));

export const viewDiagnostics = {
  planner: (c: Record<string, unknown>) => LOG('PLANNER_VIEW', c),
  calendar: (c: Record<string, unknown>) => LOG('CALENDAR_VIEW', c),
  view: (c: Record<string, unknown>) => LOG('ORCHESTRATION_VIEW', c),
  blocker: (c: Record<string, unknown>) => LOG('ORCHESTRATION_BLOCKER', c),
  fallbackVisibility: (c: Record<string, unknown>) => LOG('ORCHESTRATION_FALLBACK_VISIBILITY', c),
};
