/**
 * Authoritative Daily Generation — observability (Phase-2 Step-13).
 */

const LOG = (tag: string, payload: Record<string, unknown>) =>
  // eslint-disable-next-line no-console
  console.log(`[${tag}]`, JSON.stringify(payload));

export const dailyDiagnostics = {
  generated: (c: Record<string, unknown>) => LOG('AUTHORITATIVE_DAILY_GENERATION', c),
  route: (c: Record<string, unknown>) => LOG('DAILY_GENERATION_ROUTE', c),
  readiness: (c: Record<string, unknown>) => LOG('DAILY_GENERATION_READINESS', c),
  ownedContent: (c: Record<string, unknown>) => LOG('DAILY_GENERATION_OWNED_CONTENT', c),
  creator: (c: Record<string, unknown>) => LOG('DAILY_GENERATION_CREATOR', c),
  diff: (c: Record<string, unknown>) => LOG('DAILY_GENERATION_DIFF', c),
  rollback: (c: Record<string, unknown>) => LOG('DAILY_GENERATION_ROLLBACK', c),
};
