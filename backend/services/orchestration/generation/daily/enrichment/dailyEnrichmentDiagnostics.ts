/**
 * Daily Enrichment Parity — observability (Phase-2 Step-17).
 */

const LOG = (tag: string, payload: Record<string, unknown>) =>
  // eslint-disable-next-line no-console
  console.log(`[${tag}]`, JSON.stringify(payload));

export const dailyEnrichmentDiagnostics = {
  aiReady: (c: Record<string, unknown>) => LOG('DAILY_AI_READY', c),
  creatorVisible: (c: Record<string, unknown>) => LOG('DAILY_CREATOR_VISIBLE', c),
  assetOverride: (c: Record<string, unknown>) => LOG('DAILY_ASSET_OVERRIDE', c),
  workflowMode: (c: Record<string, unknown>) => LOG('DAILY_WORKFLOW_MODE', c),
  counterReclassify: (c: Record<string, unknown>) => LOG('DAILY_COUNTER_RECLASSIFY', c),
  enrichment: (c: Record<string, unknown>) => LOG('DAILY_ENRICHMENT', c),
};
