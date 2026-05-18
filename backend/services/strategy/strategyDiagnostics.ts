/**
 * Strategy orchestration — observability (Phase-2 Step-5).
 */

const LOG = (tag: string, payload: Record<string, unknown>) =>
  // eslint-disable-next-line no-console
  console.log(`[${tag}]`, JSON.stringify(payload));

interface StrategyLogCtx {
  campaign_id: string;
  strategy_id?: string;
  version?: number;
  source?: string;
  linkage_count?: number;
  owned_content_count?: number;
}

export const strategyDiagnostics = {
  created: (c: StrategyLogCtx) => LOG('STRATEGY_CREATE', { ...c }),
  updated: (c: StrategyLogCtx) => LOG('STRATEGY_UPDATE', { ...c }),
  versioned: (c: StrategyLogCtx) => LOG('STRATEGY_VERSION', { ...c }),
  hydrated: (c: StrategyLogCtx & { hydrated_from?: string }) => LOG('STRATEGY_HYDRATE', { ...c }),
  linked: (c: StrategyLogCtx) => LOG('STRATEGY_LINK', { ...c }),
  contextSync: (c: StrategyLogCtx) => LOG('STRATEGY_CONTEXT_SYNC', { ...c }),
};
