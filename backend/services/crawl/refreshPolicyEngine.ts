/**
 * refreshPolicyEngine.ts — THE canonical Refresh Policy Engine (CKRE-002 §1;
 * completed by CKRE-002R).
 *
 * PURE. Deterministic. Retry-safe. Fully testable. Given the CKRE-001 change
 * decision plus refresh context (history, tier, cooldown, budgets, overrides),
 * it decides IF / WHEN / WHAT should be refreshed. NO I/O, NO AI, NO env — the
 * config is injected (refreshPolicyConfig).
 *
 * CKRE-002R additions (all additive — the original action/reason outputs are
 * preserved byte-for-byte): the decision is now produced by evaluating the
 * canonical rule registry (refreshPolicyRegistry) in priority order, and every
 * decision carries a full reason model (§2), an evaluation trace (§3),
 * section-level refresh scopes (§5), and a generalized budget abstraction (§4).
 *
 * DETERMINISM CONTRACT (§7): identical inputs → identical decision, trace,
 * sections, and explanation, independent of timezone/OS/Node/process/order:
 *   - no timestamps/random feed any output (the only clock is the injected
 *     input.now, used purely for cooldown arithmetic);
 *   - rules are evaluated in a fixed registry priority order;
 *   - all list outputs are sorted deterministically.
 */

import type { ChangeDecision } from './changeDetectionService';
import type { FingerprintTypeId } from './fingerprintRegistry';
import { cooldownForTier, type CompanyTier, type PlatformState, type RefreshPolicyConfig } from './refreshPolicyConfig';
import {
  REFRESH_RULE_ORDER,
  getRefreshRule,
  type RefreshRuleId,
} from './refreshPolicyRegistry';

export type RefreshAction =
  | 'EXECUTE_REFRESH'        // run the full refresh (gating disabled / manual)
  | 'SKIP_REFRESH'           // content unchanged — no AI, no work
  | 'REFRESH_METADATA_ONLY'  // cosmetic — deterministic metadata only, no AI
  | 'REFRESH_BUSINESS_ONLY'  // business fields changed — run AI
  | 'REFRESH_FULL'           // major / first-time — run full AI
  | 'DEFER'                  // cooldown / degraded / no budget — retry later
  | 'UNKNOWN';               // cannot decide

/** §5 — deterministic section-level refresh scopes. */
export type RefreshSection =
  | 'METADATA' | 'BRAND' | 'SEO' | 'SOCIAL' | 'PRODUCTS' | 'SERVICES'
  | 'AUDIENCE' | 'COMPETITORS' | 'MARKETING' | 'FULL';

/** §4 — generalized refresh budget (not token-only). */
export type BudgetType = 'ai' | 'network' | 'crawl' | 'time' | (string & {});
export interface RefreshBudget {
  type: BudgetType;
  /** Remaining budget; <= 0 means exhausted. */
  remaining: number;
}

export interface RefreshPolicyInput {
  changeDecision: ChangeDecision | null;
  hasPriorKnowledgeVersion: boolean;
  lastRefreshAt: string | null;
  refreshHistoryCount: number;
  manualRefresh: boolean;
  adminOverride?: RefreshAction | null;
  companyTier: CompanyTier;
  platformState: PlatformState;
  pendingRefresh: boolean;
  /** @deprecated Prefer `budgets`. Mapped to a { type:'ai' } budget for compat. */
  tokenBudgetRemaining?: number | null;
  /** §4 — generalized budgets. AI actions defer when any provided budget is exhausted. */
  budgets?: RefreshBudget[];
  config: RefreshPolicyConfig;
  now: number;
}

/** §3 — one canonical evaluation-trace entry per rule. */
export interface PolicyTraceEntry {
  ruleId: RefreshRuleId;
  order: number;
  priority: number;
  status: 'triggered' | 'passed' | 'skipped';
  detail: string;
}

export interface PolicyEvaluationTrace {
  entries: PolicyTraceEntry[];
  selectedRule: RefreshRuleId;
  finalAction: RefreshAction;
}

export interface RefreshPolicyDecision {
  // ── original outputs (unchanged) ──────────────────────────────────────────
  action: RefreshAction;
  requiresAi: boolean;
  affectedFingerprints: FingerprintTypeId[];
  reason: string;
  // ── CKRE-002R §2 reason model ─────────────────────────────────────────────
  reasonCodes: string[];
  triggeredRules: RefreshRuleId[];
  suppressedRules: RefreshRuleId[];
  selectedRule: RefreshRuleId;
  decisionPriority: number;
  evaluationSummary: { evaluated: number; passed: number; triggered: number; skipped: number };
  explanation: string;
  // ── CKRE-002R §3 trace ────────────────────────────────────────────────────
  trace: PolicyEvaluationTrace;
  // ── CKRE-002R §5 section-level scope ──────────────────────────────────────
  refreshSections: RefreshSection[];
}

const AI_ACTIONS: ReadonlySet<RefreshAction> = new Set(['EXECUTE_REFRESH', 'REFRESH_BUSINESS_ONLY', 'REFRESH_FULL']);

/** True when an action requires the AI enrichment chain (§3). */
export function actionRequiresAi(action: RefreshAction): boolean {
  return AI_ACTIONS.has(action);
}

// ── §5 fingerprint → section map (reuses affectedFingerprints; no dep re-calc) ─
const FP_TO_SECTION: Record<FingerprintTypeId, RefreshSection> = {
  HTTP_METADATA: 'METADATA', HTML: 'METADATA', NAVIGATION: 'METADATA', CMS: 'METADATA',
  LOGO: 'BRAND', FAVICON: 'BRAND',
  OPENGRAPH: 'SEO', SITEMAP: 'SEO', ROBOTS: 'SEO', SEO: 'SEO',
  SOCIAL: 'SOCIAL',
  STRUCTURED_DATA: 'PRODUCTS',
  BUSINESS: 'FULL',
};
const METADATA_SECTIONS: ReadonlySet<RefreshSection> = new Set(['METADATA', 'BRAND', 'SEO', 'SOCIAL']);

function refreshSectionsFor(action: RefreshAction, affected: FingerprintTypeId[]): RefreshSection[] {
  if (action === 'REFRESH_FULL' || action === 'EXECUTE_REFRESH') return ['FULL'];
  if (action === 'SKIP_REFRESH' || action === 'DEFER' || action === 'UNKNOWN') return [];
  const sections = new Set<RefreshSection>();
  for (const fp of affected) sections.add(FP_TO_SECTION[fp] ?? 'METADATA');
  if (action === 'REFRESH_METADATA_ONLY') {
    const filtered = Array.from(sections).filter((s) => METADATA_SECTIONS.has(s)).sort();
    return filtered.length ? filtered : ['METADATA'];
  }
  // REFRESH_BUSINESS_ONLY
  return Array.from(sections).sort();
}

// ── §4 budget resolution ──────────────────────────────────────────────────────
const BUDGET_RULE_TYPE: Partial<Record<RefreshRuleId, BudgetType>> = {
  TOKEN_BUDGET: 'ai', NETWORK_BUDGET: 'network', CRAWL_BUDGET: 'crawl', TIME_BUDGET: 'time',
};
const BUDGET_EXHAUSTED_REASON: Partial<Record<RefreshRuleId, string>> = {
  TOKEN_BUDGET: 'token_budget_exhausted', // preserved from CKRE-002
  NETWORK_BUDGET: 'network_budget_exhausted',
  CRAWL_BUDGET: 'crawl_budget_exhausted',
  TIME_BUDGET: 'time_budget_exhausted',
};

function resolveBudgets(input: RefreshPolicyInput): RefreshBudget[] {
  const out = [...(input.budgets ?? [])];
  if (input.tokenBudgetRemaining !== null && input.tokenBudgetRemaining !== undefined && !out.some((b) => b.type === 'ai')) {
    out.push({ type: 'ai', remaining: input.tokenBudgetRemaining });
  }
  return out;
}

// ── Rule condition evaluation (preserves the original decision semantics) ─────

interface RuleOutcome { triggered: boolean; action?: RefreshAction; reason?: string; applicable: boolean }

function evalPreOrVerdictRule(id: RefreshRuleId, input: RefreshPolicyInput): RuleOutcome {
  // Typed as string to compare against the ChangeVerdict literals without the
  // compiler over-narrowing across the rule switch (values are identical).
  const verdict: string | null = input.changeDecision?.verdict ?? null;
  const prior = input.hasPriorKnowledgeVersion;
  switch (id) {
    case 'ADMIN_OVERRIDE':
      return input.adminOverride
        ? { triggered: true, action: input.adminOverride, reason: 'admin_override', applicable: true }
        : { triggered: false, applicable: true };
    case 'PENDING_REFRESH':
      return input.pendingRefresh
        ? { triggered: true, action: 'DEFER', reason: 'refresh_already_pending', applicable: true }
        : { triggered: false, applicable: true };
    case 'PLATFORM_DEGRADED':
      return (input.platformState === 'degraded' && !input.manualRefresh)
        ? { triggered: true, action: 'DEFER', reason: 'platform_degraded', applicable: true }
        : { triggered: false, applicable: true };
    case 'GATING_DISABLED':
      return !input.config.aiGatingEnabled
        ? { triggered: true, action: 'EXECUTE_REFRESH', reason: 'gating_disabled', applicable: true }
        : { triggered: false, applicable: true };
    case 'MANUAL_REFRESH':
      return input.manualRefresh
        ? { triggered: true, action: 'REFRESH_FULL', reason: 'manual_refresh', applicable: true }
        : { triggered: false, applicable: true };
    case 'WITHIN_COOLDOWN': {
      if (input.lastRefreshAt) {
        const last = Date.parse(input.lastRefreshAt);
        if (Number.isFinite(last) && input.now - last < cooldownForTier(input.config, input.companyTier)) {
          return { triggered: true, action: 'DEFER', reason: 'within_cooldown', applicable: true };
        }
      }
      return { triggered: false, applicable: true };
    }
    case 'UNCHANGED_SITE':
      return (verdict === 'UNCHANGED' && prior)
        ? { triggered: true, action: 'SKIP_REFRESH', reason: 'unchanged_with_baseline', applicable: verdict === 'UNCHANGED' }
        : { triggered: false, applicable: verdict === 'UNCHANGED' };
    case 'FIRST_REFRESH': {
      // No baseline yet: UNCHANGED→'unchanged_but_no_baseline'; null/UNKNOWN→'first_enrichment'.
      if (!prior && (verdict === 'UNCHANGED' || verdict === 'UNKNOWN' || verdict === null)) {
        const reason = verdict === 'UNCHANGED' ? 'unchanged_but_no_baseline' : 'first_enrichment';
        return { triggered: true, action: 'REFRESH_FULL', reason, applicable: true };
      }
      return { triggered: false, applicable: !prior };
    }
    case 'COSMETIC_CHANGE':
      return verdict === 'COSMETIC_CHANGE'
        ? { triggered: true, action: 'REFRESH_METADATA_ONLY', reason: 'cosmetic_change', applicable: true }
        : { triggered: false, applicable: verdict === 'COSMETIC_CHANGE' };
    case 'BUSINESS_CHANGE':
      return verdict === 'BUSINESS_CHANGE'
        ? { triggered: true, action: 'REFRESH_BUSINESS_ONLY', reason: 'business_change', applicable: true }
        : { triggered: false, applicable: verdict === 'BUSINESS_CHANGE' };
    case 'MAJOR_CHANGE':
      return verdict === 'MAJOR_CHANGE'
        ? { triggered: true, action: 'REFRESH_FULL', reason: 'major_change', applicable: true }
        : { triggered: false, applicable: verdict === 'MAJOR_CHANGE' };
    case 'UNKNOWN':
      // Prior baseline + unprovable change → safe full refresh.
      return (prior && (verdict === 'UNKNOWN' || verdict === null))
        ? { triggered: true, action: 'REFRESH_FULL', reason: 'unknown_change_safe_refresh', applicable: true }
        : { triggered: false, applicable: prior && (verdict === 'UNKNOWN' || verdict === null) };
    default:
      return { triggered: false, applicable: false };
  }
}

/**
 * Decide the refresh action via the canonical rule registry. Pure and
 * deterministic. The returned `action`/`reason` are identical to CKRE-002; the
 * reason model, trace, sections, and budgets are additive.
 */
export function decideRefresh(input: RefreshPolicyInput): RefreshPolicyDecision {
  const affected = input.changeDecision?.affectedFingerprints ?? [];
  const budgets = resolveBudgets(input);
  const entries: PolicyTraceEntry[] = [];
  const triggeredRules: RefreshRuleId[] = [];
  const suppressedRules: RefreshRuleId[] = [];

  let selected: { ruleId: RefreshRuleId; action: RefreshAction; reason: string } | null = null;

  for (const ruleId of REFRESH_RULE_ORDER) {
    const def = getRefreshRule(ruleId);
    const order = REFRESH_RULE_ORDER.indexOf(ruleId);

    // ── Budget phase ──────────────────────────────────────────────────────
    if (def.phase === 'budget') {
      const budgetType = BUDGET_RULE_TYPE[ruleId];
      const budget = budgets.find((b) => b.type === budgetType);
      // Budgets only apply to a chosen AI action.
      if (!selected || !AI_ACTIONS.has(selected.action) || !budget) {
        entries.push({ ruleId, order, priority: def.priority, status: 'skipped', detail: !budget ? 'no_budget_provided' : 'not_ai_action' });
        continue;
      }
      if (budget.remaining <= 0) {
        entries.push({ ruleId, order, priority: def.priority, status: 'triggered', detail: `${budgetType}_exhausted` });
        triggeredRules.push(ruleId);
        // The verdict/pre rule that chose the AI action is now suppressed.
        suppressedRules.push(selected.ruleId);
        selected = { ruleId, action: 'DEFER', reason: BUDGET_EXHAUSTED_REASON[ruleId] ?? 'budget_exhausted' };
      } else {
        entries.push({ ruleId, order, priority: def.priority, status: 'passed', detail: `${budgetType}_ok` });
      }
      continue;
    }

    // ── Pre / verdict phase ───────────────────────────────────────────────
    if (selected) {
      // A decision was already made — remaining pre/verdict rules are skipped.
      entries.push({ ruleId, order, priority: def.priority, status: 'skipped', detail: 'decision_already_selected' });
      continue;
    }
    const outcome = evalPreOrVerdictRule(ruleId, input);
    if (!outcome.applicable) {
      entries.push({ ruleId, order, priority: def.priority, status: 'skipped', detail: 'not_applicable' });
      continue;
    }
    if (outcome.triggered && outcome.action) {
      entries.push({ ruleId, order, priority: def.priority, status: 'triggered', detail: outcome.reason ?? 'triggered' });
      triggeredRules.push(ruleId);
      selected = { ruleId, action: outcome.action, reason: outcome.reason ?? 'triggered' };
    } else {
      entries.push({ ruleId, order, priority: def.priority, status: 'passed', detail: 'condition_not_met' });
    }
  }

  // Safety net (should never happen — a verdict rule always matches).
  if (!selected) {
    selected = { ruleId: 'UNKNOWN', action: 'REFRESH_FULL', reason: 'first_enrichment' };
    triggeredRules.push('UNKNOWN');
  }

  const priority = getRefreshRule(selected.ruleId).priority;
  const summary = {
    evaluated: entries.length,
    passed: entries.filter((e) => e.status === 'passed').length,
    triggered: entries.filter((e) => e.status === 'triggered').length,
    skipped: entries.filter((e) => e.status === 'skipped').length,
  };
  const reasonCodes = Array.from(new Set([selected.ruleId, ...(input.changeDecision?.reasonCodes ?? [])]));

  return {
    action: selected.action,
    requiresAi: AI_ACTIONS.has(selected.action),
    affectedFingerprints: affected,
    reason: selected.reason,
    reasonCodes,
    triggeredRules,
    suppressedRules,
    selectedRule: selected.ruleId,
    decisionPriority: priority,
    evaluationSummary: summary,
    explanation: `Selected ${selected.ruleId} (priority ${priority}): ${selected.reason}`,
    trace: { entries, selectedRule: selected.ruleId, finalAction: selected.action },
    refreshSections: refreshSectionsFor(selected.action, affected),
  };
}
