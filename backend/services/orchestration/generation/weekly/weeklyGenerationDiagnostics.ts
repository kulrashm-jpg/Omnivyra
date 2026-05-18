/**
 * Authoritative Weekly Generation — observability (Phase-2 Step-11).
 */

const LOG = (tag: string, payload: Record<string, unknown>) =>
  // eslint-disable-next-line no-console
  console.log(`[${tag}]`, JSON.stringify(payload));

export const weeklyDiagnostics = {
  generated: (c: Record<string, unknown>) => LOG('AUTHORITATIVE_WEEKLY_GENERATION', c),
  route: (c: Record<string, unknown>) => LOG('WEEKLY_GENERATION_ROUTE', c),
  readiness: (c: Record<string, unknown>) => LOG('WEEKLY_GENERATION_READINESS', c),
  ownedContent: (c: Record<string, unknown>) => LOG('WEEKLY_GENERATION_OWNED_CONTENT', c),
  diff: (c: Record<string, unknown>) => LOG('WEEKLY_GENERATION_DIFF', c),
  fallback: (c: Record<string, unknown>) => LOG('WEEKLY_GENERATION_FALLBACK', c),
  rollback: (c: Record<string, unknown>) => LOG('WEEKLY_GENERATION_ROLLBACK', c),
};
