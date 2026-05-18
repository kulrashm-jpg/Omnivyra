/**
 * Authoritative Weekly Enrichment — observability (Phase-2 Step-12).
 */

const LOG = (tag: string, payload: Record<string, unknown>) =>
  // eslint-disable-next-line no-console
  console.log(`[${tag}]`, JSON.stringify(payload));

export const enrichmentDiagnostics = {
  enrichment: (c: Record<string, unknown>) => LOG('WEEKLY_ENRICHMENT', c),
  platform: (c: Record<string, unknown>) => LOG('WEEKLY_PLATFORM_ENRICHMENT', c),
  creator: (c: Record<string, unknown>) => LOG('WEEKLY_CREATOR_PROJECTION', c),
  scheduling: (c: Record<string, unknown>) => LOG('WEEKLY_SCHEDULING_PROJECTION', c),
  diff: (c: Record<string, unknown>) => LOG('WEEKLY_ENRICHMENT_DIFF', c),
  rollback: (c: Record<string, unknown>) => LOG('WEEKLY_ENRICHMENT_ROLLBACK', c),
};
