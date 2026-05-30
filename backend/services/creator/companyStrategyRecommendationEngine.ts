/**
 * Company → Strategy Recommendation Engine (Creator Company-Context
 * Strategy Bridge — P0).
 *
 * Pure, deterministic helper that reads the EXISTING company-profile
 * signals already weighted by the platform's recommendation engine
 * (BASELINE_COMPANY_CONTEXT_KEYS in scoringHelpers.ts) and returns a
 * per-content-type ordering of the existing `PURPOSE_OPTIONS`.
 *
 * STRICT scope:
 *   - PURE function. No I/O. No mutations. No new analytics schema.
 *   - REORDERS the existing 5/5/6 options; does NOT add or remove any.
 *   - Does NOT touch the variant planner, winner engine, renderer,
 *     analytics recorder, publishing, or campaign execution.
 *   - Additive scoring + tie-breaks on the native PURPOSE_OPTIONS
 *     order so the output is always deterministic.
 *   - When no context signal applies, the native order is returned
 *     unchanged (back-compat).
 *
 * Cold-start prior contract (Phase 4): when analytics has insufficient
 * data, callers SHOULD honor this engine's order. Once analytics
 * produces a leaderboard for the org, callers SHOULD prefer the
 * leaderboard order and treat this engine's score as a tiebreaker.
 * Each returned option carries `applies_as_cold_start_prior: true` so
 * callers can express this preference explicitly.
 *
 * Explainability contract (Phase 5): each returned option includes a
 * `reasons` array — operator-readable strings derived from the
 * matched signals. Empty array means "native order, no context
 * signal applied".
 */

import { PURPOSE_OPTIONS, type PurposeOption } from '../../../lib/variants/purposeOptions';
import type { CreatorTypeForVariant } from '../../../lib/variants/creatorStrategyMapping';

/* ── Public types ────────────────────────────────────────────────── */

export type RecommendedPurposeOption = PurposeOption & {
  /** Additive score derived from matched context signals. */
  score: number;
  /** Operator-readable reasons (one per matched signal). */
  reasons: string[];
  /** True when this option's order reflects the cold-start prior and
   *  callers should swap to analytics-driven order once available. */
  applies_as_cold_start_prior: boolean;
};

export type RecommendedPurposeOptionsByType = Record<
  CreatorTypeForVariant,
  RecommendedPurposeOption[]
>;

/**
 * Input signals — superset of the platform's documented
 * `BASELINE_COMPANY_CONTEXT_KEYS`. Every field is optional so callers
 * can pass whatever they have without preprocessing.
 */
export type CompanyContextInput = {
  industry?: string | null;
  industry_list?: ReadonlyArray<string> | null;
  category?: string | null;
  category_list?: ReadonlyArray<string> | null;
  target_audience?: string | null;
  target_audience_list?: ReadonlyArray<string> | null;
  products_services?: string | null;
  products_services_list?: ReadonlyArray<string> | null;
  content_themes?: string | null;
  content_themes_list?: ReadonlyArray<string> | null;
  campaign_focus?: string | null;
  pain_symptoms?: ReadonlyArray<string> | null;
  desired_transformation?: string | null;
  core_problem_statement?: string | null;
  /** Operator-readable label used in `reasons` strings ("Acme Corp"). */
  company_name?: string | null;
};

/* ── Signal extraction ───────────────────────────────────────────── */

function tokens(text: string | null | undefined): string[] {
  if (!text) return [];
  return text
    .toLowerCase()
    .split(/[^a-z0-9+]+/g)
    .map((t) => t.trim())
    .filter((t) => t.length > 1);
}

function listTokens(list: ReadonlyArray<string> | null | undefined): string[] {
  if (!list) return [];
  const out: string[] = [];
  for (const item of list) out.push(...tokens(item));
  return out;
}

function collectAllTokens(input: CompanyContextInput): Set<string> {
  const merged = new Set<string>();
  for (const t of tokens(input.industry)) merged.add(t);
  for (const t of listTokens(input.industry_list)) merged.add(t);
  for (const t of tokens(input.category)) merged.add(t);
  for (const t of listTokens(input.category_list)) merged.add(t);
  for (const t of tokens(input.target_audience)) merged.add(t);
  for (const t of listTokens(input.target_audience_list)) merged.add(t);
  for (const t of tokens(input.products_services)) merged.add(t);
  for (const t of listTokens(input.products_services_list)) merged.add(t);
  for (const t of tokens(input.content_themes)) merged.add(t);
  for (const t of listTokens(input.content_themes_list)) merged.add(t);
  for (const t of tokens(input.campaign_focus)) merged.add(t);
  for (const t of listTokens(input.pain_symptoms)) merged.add(t);
  for (const t of tokens(input.desired_transformation)) merged.add(t);
  for (const t of tokens(input.core_problem_statement)) merged.add(t);
  return merged;
}

/* ── Signal → strategy weight rules ──────────────────────────────── */

/**
 * Per-rule weight applied additively to matching strategies. Tuned to
 * stay small (3–6 points per rule) so an option only floats to the
 * top when MULTIPLE rules independently support it — no single signal
 * can dominate.
 */
const W_INDUSTRY = 6;
const W_AUDIENCE = 4;
const W_PRODUCT = 4;
const W_THEME = 3;
const W_PAIN = 3;

type SignalMatch = {
  /** Strategy keys ("framework", "process", …) to boost. */
  strategies: ReadonlyArray<string>;
  /** Signal tokens that, when found, trigger the boost. */
  triggers: ReadonlyArray<string>;
  /** Score added per matched strategy when ANY trigger fires. */
  weight: number;
  /** Operator-readable reason injected into `reasons`. */
  reason: string;
};

/**
 * Industry → strategy affinities. Tokens are matched case-insensitive
 * against the merged context-token set. Multiple industries can match
 * a single company; matches stack additively.
 */
const INDUSTRY_RULES: ReadonlyArray<SignalMatch> = [
  // Developer Tools
  {
    strategies: ['framework', 'process', 'educational', 'comparison'],
    triggers: ['developer', 'developers', 'devtools', 'devops', 'api', 'sdk', 'cli', 'opensource', 'engineering', 'infrastructure'],
    weight: W_INDUSTRY,
    reason: 'Developer audience',
  },
  // Marketing technology
  {
    strategies: ['product-showcase', 'story', 'framework'],
    triggers: ['marketing', 'martech', 'advertising', 'adtech', 'growth', 'crm', 'attribution'],
    weight: W_INDUSTRY,
    reason: 'Marketing technology focus',
  },
  // Healthcare
  {
    strategies: ['educational', 'stats', 'process'],
    triggers: [
      'healthcare', 'health', 'healthtech', 'medical', 'clinical',
      'pharma', 'biotech', 'patient', 'physician', 'hospital',
    ],
    weight: W_INDUSTRY,
    reason: 'Healthcare positioning',
  },
  // Insurance / Insurtech — distinct from Finance. Aligned with the
  // insurance governance policy: educational explainers + frameworks
  // for coverage decisions + comparisons of policy options + process
  // walkthroughs for claims/underwriting. Listed BEFORE Finance so
  // that an insurance-tagged company never double-fires through the
  // broader finance trigger set.
  {
    strategies: ['educational', 'framework', 'comparison', 'process'],
    triggers: [
      'insurance', 'insurtech', 'underwriting', 'reinsurance',
      'actuarial', 'claims', 'policy', 'policies', 'coverage', 'broker',
    ],
    weight: W_INDUSTRY,
    reason: 'Insurance positioning',
  },
  // Finance / Fintech
  {
    strategies: ['educational', 'comparison', 'stats'],
    triggers: ['finance', 'fintech', 'banking', 'lending', 'wealth', 'trading', 'payments', 'accounting'],
    weight: W_INDUSTRY,
    reason: 'Finance positioning',
  },
  // Ecommerce
  {
    strategies: ['product-showcase', 'promotional', 'story'],
    triggers: ['ecommerce', 'commerce', 'retail', 'shopify', 'dtc', 'd2c', 'marketplace', 'fashion'],
    weight: W_INDUSTRY,
    reason: 'Ecommerce positioning',
  },
  // Consulting
  {
    strategies: ['framework', 'story', 'process'],
    triggers: ['consulting', 'consultancy', 'advisory', 'strategy', 'transformation'],
    weight: W_INDUSTRY,
    reason: 'Consulting positioning',
  },
  // Legal / LegalTech — distinct from Finance and Consulting. Aligned
  // with the legal governance policy: educational explainers + frameworks
  // for legal reasoning + comparisons of legal options + process
  // walkthroughs (engagement, filings, discovery). Listed BEFORE
  // Consulting/Recruiting so the more specific industry wins in scoring
  // accounting (additive, but legal-specific reason carries first).
  {
    strategies: ['educational', 'framework', 'comparison', 'process'],
    triggers: [
      'law', 'legal', 'legaltech', 'lawyer', 'attorney', 'counsel',
      'litigation', 'paralegal', 'judicial', 'regulatory', 'lawfirm',
    ],
    weight: W_INDUSTRY,
    reason: 'Legal positioning',
  },
  // Recruiting / HRTech — single rule covers Recruiting agencies AND
  // HR-tech platforms (HRTech compound).
  {
    strategies: ['story', 'framework', 'comparison'],
    triggers: [
      'recruiting', 'recruitment', 'staffing', 'hiring', 'talent',
      'hr', 'hrtech', 'peopleops',
    ],
    weight: W_INDUSTRY,
    reason: 'Recruiting positioning',
  },
  // Manufacturing / Industrial — distinct from Operations Leaders
  // audience rule. Aligns with industrial buyers' preference for
  // systematic process, comparison of approaches, and frameworks.
  {
    strategies: ['process', 'framework', 'comparison'],
    triggers: [
      'manufacturing', 'industrial', 'factory', 'fabrication',
      'production-line', 'productionline',
    ],
    weight: W_INDUSTRY,
    reason: 'Manufacturing positioning',
  },
  // Generic SaaS / Tech overlay — fires for any SaaS / software / tech
  // company AND for compound vertical-tech terms (FinTech, InsurTech,
  // LegalTech, HRTech, HealthTech, EdTech, PropTech, ManufacturingTech).
  // This is what enables multi-industry resolution: a Healthcare SaaS
  // company gets BOTH the Healthcare rule AND the SaaS rule, with
  // explainability surfacing the combined influence.
  {
    strategies: ['product-showcase', 'educational', 'framework'],
    triggers: [
      'saas', 'software', 'platform', 'cloud',
      // Compound vertical-tech triggers — each *also* matches its own
      // vertical's industry rule above, producing additive multi-industry
      // scoring + explainability.
      'fintech', 'insurtech', 'legaltech', 'hrtech', 'healthtech',
      'edtech', 'proptech', 'martech', 'adtech', 'devtools',
    ],
    weight: W_INDUSTRY,
    reason: 'SaaS positioning',
  },
];

/**
 * Audience → strategy affinities. Same matching contract as industry.
 */
const AUDIENCE_RULES: ReadonlyArray<SignalMatch> = [
  {
    strategies: ['framework', 'process', 'comparison'],
    triggers: ['developer', 'engineer', 'technical', 'cto', 'devops', 'architect'],
    weight: W_AUDIENCE,
    reason: 'Technical decision-maker audience',
  },
  {
    strategies: ['framework', 'presentation', 'roadmap'],
    triggers: ['executive', 'ceo', 'cfo', 'leadership', 'board', 'c-suite', 'csuite'],
    weight: W_AUDIENCE,
    reason: 'Executive audience',
  },
  {
    strategies: ['product-showcase', 'promotional', 'story'],
    triggers: ['consumer', 'buyer', 'shopper', 'customer', 'b2c'],
    weight: W_AUDIENCE,
    reason: 'Consumer audience',
  },
  {
    strategies: ['educational', 'framework', 'story'],
    triggers: ['marketer', 'marketing', 'growth', 'creator', 'content'],
    weight: W_AUDIENCE,
    reason: 'Marketing audience',
  },
  // HR Leaders — process clarity, frameworks for people decisions,
  // story-led case studies of culture / hiring outcomes. Triggers must
  // be SINGLE tokens (the tokenizer splits on non-alphanumeric chars).
  {
    strategies: ['process', 'framework', 'story'],
    triggers: [
      'hr', 'chro', 'people', 'talent', 'recruiter',
      'workforce', 'culture', 'onboarding', 'retention',
    ],
    weight: W_AUDIENCE,
    reason: 'HR leadership audience',
  },
  // Operations Leaders — process documentation, framework adoption,
  // comparison of operating approaches.
  {
    strategies: ['process', 'framework', 'comparison'],
    triggers: [
      'operations', 'ops', 'coo', 'supply', 'logistics', 'manufacturing',
      'procurement', 'fulfillment', 'efficiency',
    ],
    weight: W_AUDIENCE,
    reason: 'Operations leadership audience',
  },
  // Finance Leaders — distinct from generic 'executive': skews to
  // stats-led credibility, comparison of approaches, and frameworks
  // for capital / forecasting decisions. Single-token triggers only.
  {
    strategies: ['stats', 'comparison', 'framework'],
    triggers: [
      'controller', 'treasurer', 'fpa', 'budgeting', 'forecasting',
      'audit', 'compliance', 'reporting',
    ],
    weight: W_AUDIENCE,
    reason: 'Finance leadership audience',
  },
];

/**
 * Product / pain / theme keywords → strategy affinities.
 */
const PRODUCT_RULES: ReadonlyArray<SignalMatch> = [
  {
    strategies: ['product-showcase', 'framework'],
    triggers: ['integration', 'integrations', 'api', 'workflow', 'automation'],
    weight: W_PRODUCT,
    reason: 'Integration / API-centric product surface',
  },
  {
    strategies: ['stats', 'comparison'],
    triggers: ['analytics', 'metrics', 'dashboard', 'reporting', 'kpi'],
    weight: W_PRODUCT,
    reason: 'Analytics-centric product',
  },
  {
    strategies: ['educational', 'process'],
    triggers: ['onboarding', 'tutorial', 'documentation', 'enablement', 'training'],
    weight: W_PRODUCT,
    reason: 'Enablement-centric product',
  },
];

const THEME_RULES: ReadonlyArray<SignalMatch> = [
  {
    strategies: ['educational', 'framework'],
    triggers: ['education', 'learning', 'literacy', 'awareness'],
    weight: W_THEME,
    reason: 'Educational content theme',
  },
  {
    strategies: ['story', 'product-showcase'],
    triggers: ['casestudy', 'case', 'study', 'success', 'customer'],
    weight: W_THEME,
    reason: 'Case-study content theme',
  },
  {
    strategies: ['stats', 'roadmap'],
    triggers: ['data', 'research', 'benchmark', 'industry', 'report'],
    weight: W_THEME,
    reason: 'Data-driven content theme',
  },
];

const PAIN_RULES: ReadonlyArray<SignalMatch> = [
  {
    strategies: ['educational', 'process'],
    triggers: ['confusion', 'complexity', 'misunderstanding', 'unclear', 'manual'],
    weight: W_PAIN,
    reason: 'Pain: clarity / complexity',
  },
  {
    strategies: ['comparison', 'framework'],
    triggers: ['choice', 'decision', 'evaluation', 'options', 'compare'],
    weight: W_PAIN,
    reason: 'Pain: decision overload',
  },
  {
    strategies: ['stats', 'story'],
    triggers: ['trust', 'credibility', 'proof', 'evidence', 'validation'],
    weight: W_PAIN,
    reason: 'Pain: trust / proof',
  },
];

/* ── Strategy-key resolver ───────────────────────────────────────── */

/**
 * Map a `PurposeOption.value` to the canonical strategy key our rules
 * use. We normalize to a small token set: 'framework', 'process',
 * 'educational', 'comparison', 'product-showcase', 'story', 'stats',
 * 'roadmap', 'timeline', 'promotional', 'quote', 'brand-focus',
 * 'presentation'.
 *
 * The picker's PurposeOption.value already matches this set, so the
 * mapping is identity. Encoded explicitly so future option-value
 * renames don't silently break scoring.
 */
function strategyKeyFor(option: PurposeOption): string {
  return option.value.toLowerCase();
}

/* ── Scoring ─────────────────────────────────────────────────────── */

function applyRules(
  scored: Map<string, { score: number; reasons: Set<string> }>,
  contextTokens: Set<string>,
  rules: ReadonlyArray<SignalMatch>,
): void {
  for (const rule of rules) {
    const fired = rule.triggers.some((trig) => contextTokens.has(trig));
    if (!fired) continue;
    for (const strategy of rule.strategies) {
      const entry = scored.get(strategy);
      if (!entry) continue;
      entry.score += rule.weight;
      entry.reasons.add(rule.reason);
    }
  }
}

function scoreOptionsForType(
  contentType: CreatorTypeForVariant,
  contextTokens: Set<string>,
): RecommendedPurposeOption[] {
  const native = PURPOSE_OPTIONS[contentType];
  // Native-order index used as a stable tiebreaker so unscored runs
  // return the exact native order.
  const nativeIndex = new Map<string, number>();
  const scored = new Map<string, { score: number; reasons: Set<string> }>();
  native.forEach((opt, idx) => {
    nativeIndex.set(strategyKeyFor(opt), idx);
    scored.set(strategyKeyFor(opt), { score: 0, reasons: new Set<string>() });
  });

  applyRules(scored, contextTokens, INDUSTRY_RULES);
  applyRules(scored, contextTokens, AUDIENCE_RULES);
  applyRules(scored, contextTokens, PRODUCT_RULES);
  applyRules(scored, contextTokens, THEME_RULES);
  applyRules(scored, contextTokens, PAIN_RULES);

  const out: RecommendedPurposeOption[] = native.map((opt) => {
    const key = strategyKeyFor(opt);
    const entry = scored.get(key)!;
    return {
      ...opt,
      score: entry.score,
      reasons: [...entry.reasons],
      applies_as_cold_start_prior: entry.score > 0,
    };
  });

  // Sort: higher score first; ties broken by native order.
  out.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return (nativeIndex.get(strategyKeyFor(a))! - nativeIndex.get(strategyKeyFor(b))!);
  });
  return out;
}

/* ── Public API ──────────────────────────────────────────────────── */

/**
 * Returns the existing PURPOSE_OPTIONS reordered per content type
 * based on the company context. When `input` is null/undefined or
 * yields no signal matches, the native PURPOSE_OPTIONS order is
 * returned unchanged with `score=0, reasons=[]`.
 *
 * Suppression is OPT-IN: this engine never removes any option. Callers
 * that want to suppress (e.g., compliance gates for healthcare /
 * finance) can filter the returned array by `reasons` content or by
 * downstream rules.
 */
export function getRecommendedPurposeOptions(
  input: CompanyContextInput | null | undefined,
): RecommendedPurposeOptionsByType {
  const safeInput = input ?? {};
  const tokenSet = collectAllTokens(safeInput);
  return {
    image: scoreOptionsForType('image', tokenSet),
    carousel: scoreOptionsForType('carousel', tokenSet),
    infographic: scoreOptionsForType('infographic', tokenSet),
  };
}

/**
 * Returns the recommended options for a single content type. Thin
 * wrapper used by call sites that only need one lane (the Writer's
 * `creatorType` block, etc.).
 */
export function getRecommendedPurposeOptionsForType(
  contentType: CreatorTypeForVariant,
  input: CompanyContextInput | null | undefined,
): RecommendedPurposeOption[] {
  return getRecommendedPurposeOptions(input)[contentType];
}

/**
 * Diagnostics — returns the rule sets so the admin-facing surface can
 * render "why does industry X recommend strategy Y" tables without
 * forking the constants.
 */
export function listRecommendationRules(): {
  industry: ReadonlyArray<SignalMatch>;
  audience: ReadonlyArray<SignalMatch>;
  product: ReadonlyArray<SignalMatch>;
  theme: ReadonlyArray<SignalMatch>;
  pain: ReadonlyArray<SignalMatch>;
} {
  return {
    industry: INDUSTRY_RULES,
    audience: AUDIENCE_RULES,
    product: PRODUCT_RULES,
    theme: THEME_RULES,
    pain: PAIN_RULES,
  };
}

/* ── Phase 2 — Multi-Industry Resolution ────────────────────────── */

/**
 * Industry-level contribution surface used by the explainability
 * panel. Each entry corresponds to ONE industry rule that fired for
 * the supplied company context.
 */
export type IndustryContribution = {
  /** Short slug key derived from `reason` (e.g. 'healthcare', 'saas'). */
  industry: string;
  /** Operator-readable label (from rule.reason). */
  label: string;
  /** Subset of `rule.triggers` that actually matched the company's
   *  token set. Used by the picker to show "matched by: pharma,
   *  patient" style hints. */
  matched_triggers: string[];
  /** Strategy keys this rule boosts. */
  applies_to_strategies: string[];
  /** Per-strategy boost weight (always W_INDUSTRY here). */
  weight_per_strategy: number;
  /** Total influence injected by this rule = weight × |strategies|.
   *  Surfaced in the explainability panel as "Healthcare (+18)". */
  total_score: number;
};

export type IndustryAnalysis = {
  /** Highest-contributing industry (by total_score). */
  primary: IndustryContribution | null;
  /** Second-highest-contributing industry (when present). */
  secondary: IndustryContribution | null;
  /** All matched industry rules, sorted by total_score desc. */
  all: IndustryContribution[];
  /** Sum of total_score across all matched industries. */
  combined_influence: number;
  /** True when >= 2 industry rules matched (e.g. Healthcare SaaS). */
  is_multi_industry: boolean;
};

/**
 * Derive a stable lowercase slug from a rule's `reason` for use as the
 * `industry` field. `'Healthcare positioning'` → `'healthcare'`.
 * `'SaaS positioning'` → `'saas'`. `'Marketing technology focus'` →
 * `'marketing-technology'`.
 */
function industrySlugFromReason(reason: string): string {
  return reason
    .toLowerCase()
    .replace(/positioning|focus/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+$/g, '');
}

/**
 * Analyze which industry rules matched the supplied company context
 * and how strongly each contributed. Pure. Stable. Used by the
 * explainability panel (Phase 4).
 */
export function analyzeIndustryContributions(
  input: CompanyContextInput | null | undefined,
): IndustryAnalysis {
  const safeInput = input ?? {};
  const tokenSet = collectAllTokens(safeInput);

  const contributions: IndustryContribution[] = [];
  for (const rule of INDUSTRY_RULES) {
    const matched: string[] = [];
    for (const trig of rule.triggers) {
      if (tokenSet.has(trig)) matched.push(trig);
    }
    if (matched.length === 0) continue;
    contributions.push({
      industry: industrySlugFromReason(rule.reason),
      label: rule.reason,
      matched_triggers: matched,
      applies_to_strategies: [...rule.strategies],
      weight_per_strategy: rule.weight,
      total_score: rule.weight * rule.strategies.length,
    });
  }

  // Sort by total_score desc; ties broken alphabetically by industry
  // slug so the output is deterministic.
  contributions.sort((a, b) => {
    if (b.total_score !== a.total_score) return b.total_score - a.total_score;
    return a.industry.localeCompare(b.industry);
  });

  const combined_influence = contributions.reduce((sum, c) => sum + c.total_score, 0);
  return {
    primary: contributions[0] ?? null,
    secondary: contributions[1] ?? null,
    all: contributions,
    combined_influence,
    is_multi_industry: contributions.length >= 2,
  };
}
