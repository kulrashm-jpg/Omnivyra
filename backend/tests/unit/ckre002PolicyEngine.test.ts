/**
 * CKRE-002 §1/§3/§8 — Refresh Policy Engine (pure, deterministic).
 */
import { decideRefresh, actionRequiresAi, type RefreshPolicyInput } from '../../services/crawl/refreshPolicyEngine';
import { getRefreshPolicyConfig, type RefreshPolicyConfig } from '../../services/crawl/refreshPolicyConfig';
import type { ChangeDecision } from '../../services/crawl/changeDetectionService';

const CONFIG: RefreshPolicyConfig = {
  aiGatingEnabled: true,
  enrichmentCacheEnabled: false,
  cooldownMsByTier: { enterprise: 86_400_000, pro: 259_200_000, free: 604_800_000 },
  historyLimit: 20,
};

const change = (verdict: ChangeDecision['verdict']): ChangeDecision => ({
  verdict, score: 0, changedLevels: [], changedFields: [], reason: 't',
  changedFingerprints: [], affectedFingerprints: [], changedSections: [], reasonCodes: [], recommendedAction: 'NO_ACTION',
});

const base = (over: Partial<RefreshPolicyInput> = {}): RefreshPolicyInput => ({
  changeDecision: change('UNCHANGED'),
  hasPriorKnowledgeVersion: true,
  lastRefreshAt: null,
  refreshHistoryCount: 1,
  manualRefresh: false,
  companyTier: 'free',
  platformState: 'normal',
  pendingRefresh: false,
  config: CONFIG,
  now: 10_000_000_000,
  ...over,
});

describe('CKRE-002 §3 — verdict → action mapping (AI gating)', () => {
  test('UNCHANGED + baseline → SKIP_REFRESH (never invoke AI)', () => {
    const d = decideRefresh(base({ changeDecision: change('UNCHANGED'), hasPriorKnowledgeVersion: true }));
    expect(d.action).toBe('SKIP_REFRESH');
    expect(d.requiresAi).toBe(false);
  });
  test('UNCHANGED + NO baseline → REFRESH_FULL (first enrichment must run)', () => {
    const d = decideRefresh(base({ changeDecision: change('UNCHANGED'), hasPriorKnowledgeVersion: false }));
    expect(d.action).toBe('REFRESH_FULL');
    expect(d.requiresAi).toBe(true);
  });
  test('COSMETIC → REFRESH_METADATA_ONLY (deterministic, no AI)', () => {
    const d = decideRefresh(base({ changeDecision: change('COSMETIC_CHANGE') }));
    expect(d.action).toBe('REFRESH_METADATA_ONLY');
    expect(d.requiresAi).toBe(false);
  });
  test('BUSINESS → REFRESH_BUSINESS_ONLY (AI)', () => {
    expect(decideRefresh(base({ changeDecision: change('BUSINESS_CHANGE') })).action).toBe('REFRESH_BUSINESS_ONLY');
    expect(actionRequiresAi('REFRESH_BUSINESS_ONLY')).toBe(true);
  });
  test('MAJOR → REFRESH_FULL (AI)', () => {
    expect(decideRefresh(base({ changeDecision: change('MAJOR_CHANGE') })).action).toBe('REFRESH_FULL');
  });
  test('UNKNOWN / null → safe REFRESH_FULL', () => {
    expect(decideRefresh(base({ changeDecision: change('UNKNOWN') })).action).toBe('REFRESH_FULL');
    expect(decideRefresh(base({ changeDecision: null, hasPriorKnowledgeVersion: false })).action).toBe('REFRESH_FULL');
  });
});

describe('CKRE-002 §1 — overrides, cooldown, tier, budget, platform', () => {
  test('admin override wins over everything', () => {
    const d = decideRefresh(base({ adminOverride: 'SKIP_REFRESH', changeDecision: change('MAJOR_CHANGE') }));
    expect(d.action).toBe('SKIP_REFRESH');
    expect(d.reason).toBe('admin_override');
  });
  test('manual refresh bypasses the change gate → REFRESH_FULL', () => {
    const d = decideRefresh(base({ manualRefresh: true, changeDecision: change('UNCHANGED') }));
    expect(d.action).toBe('REFRESH_FULL');
    expect(d.reason).toBe('manual_refresh');
  });
  test('gating disabled → EXECUTE_REFRESH (pre-CKRE-002 behaviour)', () => {
    const d = decideRefresh(base({ config: { ...CONFIG, aiGatingEnabled: false }, changeDecision: change('UNCHANGED') }));
    expect(d.action).toBe('EXECUTE_REFRESH');
  });
  test('within cooldown → DEFER (non-manual)', () => {
    const now = 10_000_000_000;
    const d = decideRefresh(base({ now, lastRefreshAt: new Date(now - 1000).toISOString(), changeDecision: change('MAJOR_CHANGE') }));
    expect(d.action).toBe('DEFER');
    expect(d.reason).toBe('within_cooldown');
  });
  test('past cooldown → proceeds', () => {
    const now = 10_000_000_000;
    const d = decideRefresh(base({ now, lastRefreshAt: new Date(now - 8 * 86_400_000).toISOString(), changeDecision: change('MAJOR_CHANGE') }));
    expect(d.action).toBe('REFRESH_FULL');
  });
  test('enterprise tier has a shorter cooldown than free', () => {
    const now = 10_000_000_000;
    const twoDaysAgo = new Date(now - 2 * 86_400_000).toISOString();
    expect(decideRefresh(base({ now, lastRefreshAt: twoDaysAgo, companyTier: 'enterprise', changeDecision: change('MAJOR_CHANGE') })).action).toBe('REFRESH_FULL');
    expect(decideRefresh(base({ now, lastRefreshAt: twoDaysAgo, companyTier: 'free', changeDecision: change('MAJOR_CHANGE') })).action).toBe('DEFER');
  });
  test('pending refresh → DEFER', () => {
    expect(decideRefresh(base({ pendingRefresh: true })).action).toBe('DEFER');
  });
  test('degraded platform → DEFER non-manual, allow manual', () => {
    expect(decideRefresh(base({ platformState: 'degraded', changeDecision: change('MAJOR_CHANGE') })).action).toBe('DEFER');
    expect(decideRefresh(base({ platformState: 'degraded', manualRefresh: true })).action).toBe('REFRESH_FULL');
  });
  test('exhausted token budget defers AI actions', () => {
    const d = decideRefresh(base({ changeDecision: change('MAJOR_CHANGE'), tokenBudgetRemaining: 0 }));
    expect(d.action).toBe('DEFER');
    expect(d.reason).toBe('token_budget_exhausted');
  });
});

describe('CKRE-002 — determinism', () => {
  test('identical inputs → identical decision', () => {
    const input = base({ changeDecision: change('BUSINESS_CHANGE') });
    expect(decideRefresh(input)).toEqual(decideRefresh(input));
  });
});

describe('CKRE-002 §8 — config', () => {
  test('defaults: gating ON, enrichment cache OFF', () => {
    const cfg = getRefreshPolicyConfig();
    expect(cfg.aiGatingEnabled).toBe(true);
    expect(cfg.enrichmentCacheEnabled).toBe(false);
    expect(cfg.cooldownMsByTier.enterprise).toBeLessThan(cfg.cooldownMsByTier.free);
  });
  test('env override toggles the master switch', () => {
    const prev = process.env.CKRE_AI_GATING_ENABLED;
    try {
      process.env.CKRE_AI_GATING_ENABLED = 'false';
      expect(getRefreshPolicyConfig().aiGatingEnabled).toBe(false);
    } finally {
      if (prev === undefined) delete process.env.CKRE_AI_GATING_ENABLED; else process.env.CKRE_AI_GATING_ENABLED = prev;
    }
  });
});
