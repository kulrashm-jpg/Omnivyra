/**
 * CKRE-002R §1/§2/§3/§4/§5 — rule registry, reason model, trace, budgets, sections.
 */
import {
  REFRESH_POLICY_REGISTRY,
  REFRESH_RULE_ORDER,
  getRefreshRule,
  rulesForPhase,
  type RefreshRuleId,
} from '../../services/crawl/refreshPolicyRegistry';
import { decideRefresh, type RefreshPolicyInput } from '../../services/crawl/refreshPolicyEngine';
import type { RefreshPolicyConfig } from '../../services/crawl/refreshPolicyConfig';
import type { ChangeDecision } from '../../services/crawl/changeDetectionService';
import type { FingerprintTypeId } from '../../services/crawl/fingerprintRegistry';

const CONFIG: RefreshPolicyConfig = {
  aiGatingEnabled: true, enrichmentCacheEnabled: false,
  cooldownMsByTier: { enterprise: 86_400_000, pro: 259_200_000, free: 604_800_000 }, historyLimit: 20,
};
const change = (verdict: ChangeDecision['verdict'], affected: FingerprintTypeId[] = []): ChangeDecision => ({
  verdict, score: 0, changedLevels: [], changedFields: [], reason: 't',
  changedFingerprints: affected, affectedFingerprints: affected, changedSections: [], reasonCodes: ['HTML_CHANGED'], recommendedAction: 'NO_ACTION',
});
const base = (over: Partial<RefreshPolicyInput> = {}): RefreshPolicyInput => ({
  changeDecision: change('MAJOR_CHANGE'), hasPriorKnowledgeVersion: true, lastRefreshAt: null, refreshHistoryCount: 1,
  manualRefresh: false, companyTier: 'free', platformState: 'normal', pendingRefresh: false, config: CONFIG, now: 10_000_000_000, ...over,
});

describe('CKRE-002R §1 — rule registry', () => {
  test('every rule has complete metadata', () => {
    for (const id of REFRESH_RULE_ORDER) {
      const r = REFRESH_POLICY_REGISTRY[id];
      expect(r.id).toBe(id);
      expect(typeof r.priority).toBe('number');
      expect(['pre', 'verdict', 'budget']).toContain(r.phase);
      expect(r.description.length).toBeGreaterThan(0);
      expect(r.configSource.length).toBeGreaterThan(0);
      expect(r.extensibility).toBeDefined();
    }
  });
  test('rule order is strictly ascending by priority + phase grouping', () => {
    const priorities = REFRESH_RULE_ORDER.map((id) => getRefreshRule(id).priority);
    expect(priorities).toEqual([...priorities].sort((a, b) => a - b));
    expect(rulesForPhase('pre')[0]).toBe('ADMIN_OVERRIDE');
    expect(rulesForPhase('budget')).toContain('TOKEN_BUDGET');
  });
  test('unknown rule throws', () => {
    expect(() => getRefreshRule('NOPE' as RefreshRuleId)).toThrow(/UNKNOWN_REFRESH_RULE/);
  });
});

describe('CKRE-002R §2/§3 — reason model + trace', () => {
  test('a major change selects MAJOR_CHANGE with full reason model + trace', () => {
    const d = decideRefresh(base({ changeDecision: change('MAJOR_CHANGE') }));
    expect(d.action).toBe('REFRESH_FULL');
    expect(d.selectedRule).toBe('MAJOR_CHANGE');
    expect(d.triggeredRules).toContain('MAJOR_CHANGE');
    expect(d.decisionPriority).toBe(getRefreshRule('MAJOR_CHANGE').priority);
    expect(d.reasonCodes).toEqual(expect.arrayContaining(['MAJOR_CHANGE', 'HTML_CHANGED']));
    expect(d.explanation).toContain('MAJOR_CHANGE');
    // trace covers every rule, in order, with a selected rule + final action
    expect(d.trace.entries.map((e) => e.ruleId)).toEqual([...REFRESH_RULE_ORDER]);
    expect(d.trace.selectedRule).toBe('MAJOR_CHANGE');
    expect(d.trace.finalAction).toBe('REFRESH_FULL');
    const triggered = d.trace.entries.filter((e) => e.status === 'triggered');
    expect(triggered.map((e) => e.ruleId)).toEqual(['MAJOR_CHANGE']);
    expect(d.evaluationSummary.evaluated).toBe(REFRESH_RULE_ORDER.length);
  });

  test('admin override selected first; later rules suppressed/skipped in the trace', () => {
    const d = decideRefresh(base({ adminOverride: 'SKIP_REFRESH', changeDecision: change('MAJOR_CHANGE') }));
    expect(d.selectedRule).toBe('ADMIN_OVERRIDE');
    const adminEntry = d.trace.entries.find((e) => e.ruleId === 'ADMIN_OVERRIDE')!;
    expect(adminEntry.status).toBe('triggered');
    // everything after ADMIN_OVERRIDE is skipped (a decision was made)
    expect(d.trace.entries.filter((e) => e.status === 'skipped').length).toBeGreaterThan(0);
  });

  test('budget override suppresses the verdict rule (both triggered, budget selected)', () => {
    const d = decideRefresh(base({ changeDecision: change('MAJOR_CHANGE'), budgets: [{ type: 'ai', remaining: 0 }] }));
    expect(d.action).toBe('DEFER');
    expect(d.reason).toBe('token_budget_exhausted'); // preserved reason
    expect(d.selectedRule).toBe('TOKEN_BUDGET');
    expect(d.triggeredRules).toEqual(expect.arrayContaining(['MAJOR_CHANGE', 'TOKEN_BUDGET']));
    expect(d.suppressedRules).toContain('MAJOR_CHANGE');
  });
});

describe('CKRE-002R §4 — generalized budgets', () => {
  test('network / crawl / time budgets defer AI actions with distinct reasons', () => {
    expect(decideRefresh(base({ budgets: [{ type: 'network', remaining: 0 }] })).reason).toBe('network_budget_exhausted');
    expect(decideRefresh(base({ budgets: [{ type: 'crawl', remaining: 0 }] })).reason).toBe('crawl_budget_exhausted');
    expect(decideRefresh(base({ budgets: [{ type: 'time', remaining: 0 }] })).reason).toBe('time_budget_exhausted');
  });
  test('budgets do not affect non-AI actions', () => {
    const d = decideRefresh(base({ changeDecision: change('UNCHANGED'), budgets: [{ type: 'ai', remaining: 0 }] }));
    expect(d.action).toBe('SKIP_REFRESH'); // not deferred — SKIP needs no budget
  });
  test('legacy tokenBudgetRemaining maps to the ai budget', () => {
    expect(decideRefresh(base({ tokenBudgetRemaining: 0 })).reason).toBe('token_budget_exhausted');
  });
  test('available budgets pass', () => {
    expect(decideRefresh(base({ budgets: [{ type: 'ai', remaining: 100 }, { type: 'network', remaining: 100 }] })).action).toBe('REFRESH_FULL');
  });
});

describe('CKRE-002R §5 — section-level refresh scope', () => {
  test('metadata-only maps affected fingerprints to metadata/brand/seo/social sections', () => {
    const d = decideRefresh(base({ changeDecision: change('COSMETIC_CHANGE', ['LOGO', 'FAVICON', 'OPENGRAPH', 'SOCIAL']) }));
    expect(d.action).toBe('REFRESH_METADATA_ONLY');
    expect(d.refreshSections.sort()).toEqual(['BRAND', 'SEO', 'SOCIAL']);
  });
  test('full refresh → FULL scope; skip → none', () => {
    expect(decideRefresh(base({ changeDecision: change('MAJOR_CHANGE') })).refreshSections).toEqual(['FULL']);
    expect(decideRefresh(base({ changeDecision: change('UNCHANGED') })).refreshSections).toEqual([]);
  });
  test('business-only maps structured-data → PRODUCTS', () => {
    const d = decideRefresh(base({ changeDecision: change('BUSINESS_CHANGE', ['STRUCTURED_DATA']) }));
    expect(d.action).toBe('REFRESH_BUSINESS_ONLY');
    expect(d.refreshSections).toContain('PRODUCTS');
  });
});

describe('CKRE-002R §7 — determinism', () => {
  test('identical inputs → identical decision + trace + reason model', () => {
    const input = base({ changeDecision: change('BUSINESS_CHANGE', ['SOCIAL']) });
    expect(decideRefresh(input)).toEqual(decideRefresh(input));
  });
  test('backward compatibility: original fields unchanged from CKRE-002', () => {
    const d = decideRefresh(base({ changeDecision: change('MAJOR_CHANGE') }));
    expect(d.action).toBe('REFRESH_FULL');
    expect(d.requiresAi).toBe(true);
    expect(d.reason).toBe('major_change');
    expect(d.affectedFingerprints).toEqual([]);
  });
});
