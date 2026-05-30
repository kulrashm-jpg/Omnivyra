/**
 * Strategy Governance Policy Registry (Creator Compliance-Aware
 * Strategy Governance — P1 + P2).
 *
 * GOVERNANCE LAYER ONLY. Sits ABOVE the company-context recommendation
 * engine and BELOW the picker. Reads industry signals and emits a
 * policy describing which strategies are suppressed (hidden by
 * default), deprioritized (pushed below recommended), or carry
 * required warnings — for compliance-sensitive verticals only.
 *
 * STRICT SCOPE:
 *   - PURE function. No I/O. No mutations.
 *   - Does NOT touch the recommendation engine.
 *   - Does NOT touch the variant planner, winner engine, renderer,
 *     analytics, publishing, campaign execution.
 *   - This is GUIDANCE, NOT ENFORCEMENT. Every restricted strategy is
 *     still selectable via the picker's `showRestrictedStrategies`
 *     toggle (operators can always override; selection is audited).
 *
 * Industries with explicit policies:
 *   - Healthcare      (clinical / patient-facing claim risk)
 *   - Finance         (suitability / outcome claim risk)
 *   - Insurance       (suitability / outcome claim risk)
 *   - Legal           (UPL / advisory framing risk)
 *
 * All other industries receive an empty policy (no suppression).
 */

import type { CreatorTypeForVariant } from '../../../lib/variants/creatorStrategyMapping';

/* ── Public types ────────────────────────────────────────────────── */

export type GovernanceRiskLevel = 'none' | 'low' | 'medium' | 'high';

export type GovernedIndustry =
  | 'healthcare'
  | 'finance'
  | 'insurance'
  | 'legal'
  | 'none';

/**
 * Reference to a strategy slug used by the policy. The slug matches
 * `PURPOSE_OPTIONS[].value` (e.g. 'promotional', 'product-showcase',
 * 'stats'). Each policy entry carries a `reason` so the UI + audit
 * log can surface why a strategy is suppressed.
 */
export type GovernedStrategyRule = {
  /** Strategy slug — matches PURPOSE_OPTIONS value. */
  strategy: string;
  /** Optional content-type scoping. When omitted, the rule applies
   *  across all three content types (image/carousel/infographic). */
  contentTypes?: ReadonlyArray<CreatorTypeForVariant>;
  /** Operator-readable reason. Stored on audit events when the
   *  strategy is selected anyway. */
  reason: string;
};

export type StrategyGovernancePolicy = {
  /** Resolved industry — 'none' when no governance rule applies. */
  industry: GovernedIndustry;
  /** Operator-facing risk band — drives badge color and audit severity. */
  riskLevel: GovernanceRiskLevel;
  /** Strategies hidden by default in the picker. */
  suppressedStrategies: ReadonlyArray<GovernedStrategyRule>;
  /** Strategies sorted below recommended/allowed but still visible. */
  deprioritizedStrategies: ReadonlyArray<GovernedStrategyRule>;
  /** Inline warning strings the UI MAY render alongside the picker. */
  requiredWarnings: ReadonlyArray<string>;
  /** When set, suggests a per-content-type default strategy slug the
   *  picker should pre-select on first render (operator can still
   *  change). Used for industries that have a "safer default" we want
   *  to anchor on. */
  defaultStrategyOverrides: Partial<Record<CreatorTypeForVariant, string>>;
  /**
   * Compliance directives — instructions injected into the LLM prompt
   * via the prompt composer's governance layer. Distinct from
   * `requiredWarnings` (operator-facing).
   *
   * Phase 3 (Creator Governance → Prompt Composer Integration): each
   * line is a single directive the LLM should follow when generating
   * content for this industry. Empty array for non-regulated industries.
   */
  compliancePromptDirectives: ReadonlyArray<string>;
};

export type GovernanceContextInput = {
  industry?: string | null;
  industry_list?: ReadonlyArray<string> | null;
  category?: string | null;
  category_list?: ReadonlyArray<string> | null;
};

/* ── Industry detection ──────────────────────────────────────────── */

function tokens(text: string | null | undefined): string[] {
  if (!text) return [];
  return text
    .toLowerCase()
    .split(/[^a-z0-9+]+/g)
    .map((t) => t.trim())
    .filter((t) => t.length > 1);
}

function collectTokens(input: GovernanceContextInput): Set<string> {
  const out = new Set<string>();
  for (const t of tokens(input.industry)) out.add(t);
  if (Array.isArray(input.industry_list)) {
    for (const e of input.industry_list) for (const t of tokens(e)) out.add(t);
  }
  for (const t of tokens(input.category)) out.add(t);
  if (Array.isArray(input.category_list)) {
    for (const e of input.category_list) for (const t of tokens(e)) out.add(t);
  }
  return out;
}

/**
 * Industry detection order matters — narrower verticals first so a
 * fintech-health combo lands on the stricter of the two rule sets.
 * The detection table is hand-tuned; future industries register a new
 * entry without affecting existing ones.
 */
const INDUSTRY_DETECTION: ReadonlyArray<{
  industry: Exclude<GovernedIndustry, 'none'>;
  triggers: ReadonlyArray<string>;
}> = [
  {
    industry: 'healthcare',
    triggers: [
      'healthcare', 'health', 'medical', 'medicine', 'clinical',
      'pharma', 'pharmaceutical', 'biotech', 'patient', 'patients',
      'physician', 'physicians', 'hospital', 'hospitals', 'clinic',
      'clinics', 'wellness', 'therapy', 'therapeutic',
    ],
  },
  {
    industry: 'finance',
    triggers: [
      'finance', 'financial', 'fintech', 'banking', 'bank',
      'lending', 'wealth', 'investment', 'trading', 'brokerage',
      'payments', 'accounting', 'tax',
    ],
  },
  {
    industry: 'insurance',
    triggers: [
      'insurance', 'insurtech', 'underwriting', 'reinsurance',
      'actuarial', 'claims',
    ],
  },
  {
    industry: 'legal',
    triggers: [
      'legal', 'law', 'lawfirm', 'attorney', 'counsel', 'litigation',
      'compliance', 'paralegal', 'legaltech',
    ],
  },
];

function detectIndustry(tokenSet: Set<string>): GovernedIndustry {
  for (const entry of INDUSTRY_DETECTION) {
    for (const trigger of entry.triggers) {
      if (tokenSet.has(trigger)) return entry.industry;
    }
  }
  return 'none';
}

/* ── Policy definitions ──────────────────────────────────────────── */

const HEALTHCARE_POLICY: StrategyGovernancePolicy = {
  industry: 'healthcare',
  riskLevel: 'high',
  suppressedStrategies: [
    {
      strategy: 'promotional',
      contentTypes: ['image'],
      reason: 'Healthcare industry policy — aggressive promotional framing carries clinical claim risk',
    },
    {
      strategy: 'quote',
      contentTypes: ['image'],
      reason: 'Healthcare industry policy — unsupported quote framing risks endorsement / claim issues',
    },
  ],
  deprioritizedStrategies: [
    {
      strategy: 'product-showcase',
      contentTypes: ['image', 'carousel'],
      reason: 'Healthcare industry policy — pure product showcase deprioritized for patient-facing content',
    },
  ],
  requiredWarnings: [
    'Healthcare content should reference clinical evidence and avoid unsupported claims.',
  ],
  defaultStrategyOverrides: {
    image: 'educational',
    carousel: 'educational',
    infographic: 'stats',
  },
  compliancePromptDirectives: [
    'Avoid unsupported clinical claims — language must remain general, educational, and non-diagnostic.',
    'Avoid treatment guarantees or implied cures — never frame an outcome as certain or universal.',
    'Avoid outcome guarantees for specific patients, providers, or therapies.',
    'Frame any statistic or efficacy mention as observed in a study context (when applicable) — not as a promise.',
    'Avoid imagery or copy that could be read as a personal medical recommendation.',
  ],
};

const FINANCE_POLICY: StrategyGovernancePolicy = {
  industry: 'finance',
  riskLevel: 'high',
  suppressedStrategies: [
    {
      strategy: 'promotional',
      contentTypes: ['image'],
      reason: 'Financial services compliance policy — aggressive promotional framing risks unsupported outcome claims',
    },
    {
      strategy: 'quote',
      contentTypes: ['image'],
      reason: 'Financial services compliance policy — endorsement / guaranteed-outcome framing risk',
    },
  ],
  deprioritizedStrategies: [
    {
      strategy: 'product-showcase',
      contentTypes: ['image', 'carousel'],
      reason: 'Financial services compliance policy — direct product showcase deprioritized; lead with comparison / education',
    },
    {
      strategy: 'story',
      contentTypes: ['carousel'],
      reason: 'Financial services compliance policy — customer success story framing risks implied guarantees',
    },
  ],
  requiredWarnings: [
    'Financial content must avoid guaranteed-outcome framing and include required disclosures where applicable.',
  ],
  defaultStrategyOverrides: {
    image: 'educational',
    carousel: 'educational',
    infographic: 'comparison',
  },
  compliancePromptDirectives: [
    'Avoid guaranteed return language — never promise specific yields, gains, or outperformance.',
    'Avoid guaranteed outcome framing — investing carries risk; copy must remain conditional and educational.',
    'Avoid unsupported financial claims — only describe what is empirically observable or generally accepted.',
    'Avoid endorsement framing or testimonial language that could imply a personal recommendation.',
    'Frame comparisons as informational, not advisory; do not recommend any specific product or transaction.',
  ],
};

const INSURANCE_POLICY: StrategyGovernancePolicy = {
  industry: 'insurance',
  riskLevel: 'medium',
  suppressedStrategies: [
    {
      strategy: 'promotional',
      contentTypes: ['image'],
      reason: 'Insurance compliance policy — promotional framing risks suitability / coverage misrepresentation',
    },
  ],
  deprioritizedStrategies: [
    {
      strategy: 'product-showcase',
      contentTypes: ['image', 'carousel'],
      reason: 'Insurance compliance policy — product showcase deprioritized; lead with comparison / education / process',
    },
  ],
  requiredWarnings: [
    'Insurance content should clearly state coverage boundaries; avoid implied suitability without disclosure.',
  ],
  defaultStrategyOverrides: {
    image: 'educational',
    carousel: 'framework',
    infographic: 'comparison',
  },
  compliancePromptDirectives: [
    'Avoid coverage guarantees — never imply a policy will or will not pay in any specific situation.',
    'Avoid suitability claims — do not state that a product is appropriate for any individual without disclosure.',
    'Frame any policy detail as informational; the specifics depend on each contract.',
    'Avoid copy that could be read as binding advice on what to buy or how to claim.',
  ],
};

const LEGAL_POLICY: StrategyGovernancePolicy = {
  industry: 'legal',
  riskLevel: 'medium',
  suppressedStrategies: [
    {
      strategy: 'promotional',
      contentTypes: ['image'],
      reason: 'Legal industry policy — promotional framing risks unauthorized-practice-of-law (UPL) and outcome guarantee perception',
    },
    {
      strategy: 'quote',
      contentTypes: ['image'],
      reason: 'Legal industry policy — endorsement / client-testimonial framing carries ethical-rules risk',
    },
  ],
  deprioritizedStrategies: [
    {
      strategy: 'story',
      contentTypes: ['carousel'],
      reason: 'Legal industry policy — narrative client-story framing risks confidentiality / outcome implication',
    },
  ],
  requiredWarnings: [
    'Legal content must avoid outcome guarantees, advisory framing, or specific case results without proper disclosure.',
  ],
  defaultStrategyOverrides: {
    image: 'educational',
    carousel: 'framework',
    infographic: 'framework',
  },
  compliancePromptDirectives: [
    'Avoid legal guarantees — never promise a specific outcome or representation result.',
    'Avoid implied outcomes — frame examples as illustrative; results depend on facts and jurisdiction.',
    'Avoid client-result promises — do not reference past case results in a way that implies similar future outcomes.',
    'Avoid advisory framing — content is educational, not legal advice for any specific situation.',
  ],
};

const EMPTY_POLICY: StrategyGovernancePolicy = {
  industry: 'none',
  riskLevel: 'none',
  suppressedStrategies: [],
  deprioritizedStrategies: [],
  requiredWarnings: [],
  defaultStrategyOverrides: {},
  compliancePromptDirectives: [],
};

const POLICY_BY_INDUSTRY: Record<GovernedIndustry, StrategyGovernancePolicy> = {
  healthcare: HEALTHCARE_POLICY,
  finance: FINANCE_POLICY,
  insurance: INSURANCE_POLICY,
  legal: LEGAL_POLICY,
  none: EMPTY_POLICY,
};

/* ── Public API ──────────────────────────────────────────────────── */

/**
 * Resolves the governance policy for a company. Returns the empty
 * policy when the company is not in a regulated vertical OR no
 * industry signal is provided.
 *
 * Pure / deterministic / null-safe.
 */
export function resolveStrategyGovernancePolicy(
  input: GovernanceContextInput | null | undefined,
): StrategyGovernancePolicy {
  const safeInput = input ?? {};
  const tokenSet = collectTokens(safeInput);
  const industry = detectIndustry(tokenSet);
  return POLICY_BY_INDUSTRY[industry];
}

/**
 * Look up the policy by an explicit governed-industry slug. Used by
 * the admin diagnostics surface and tests.
 */
export function getPolicyForIndustry(industry: GovernedIndustry): StrategyGovernancePolicy {
  return POLICY_BY_INDUSTRY[industry];
}

export function listGovernanceIndustries(): ReadonlyArray<GovernedIndustry> {
  return ['healthcare', 'finance', 'insurance', 'legal'];
}

/**
 * Returns true when the policy carries any suppression / deprioritization
 * rule. Useful as a fast guard for the picker hook so it can skip
 * post-processing entirely for non-regulated companies.
 */
export function policyHasAnyRule(policy: StrategyGovernancePolicy): boolean {
  return (
    policy.suppressedStrategies.length > 0 ||
    policy.deprioritizedStrategies.length > 0 ||
    policy.requiredWarnings.length > 0 ||
    Object.keys(policy.defaultStrategyOverrides).length > 0
  );
}

/* ── Per-content-type rule resolver ──────────────────────────────── */

/**
 * Returns the strategy slugs that are suppressed for a given content
 * type under this policy. A rule with no `contentTypes` scope applies
 * to all three content types.
 */
export function suppressedStrategiesForContentType(
  policy: StrategyGovernancePolicy,
  contentType: CreatorTypeForVariant,
): ReadonlyArray<GovernedStrategyRule> {
  return policy.suppressedStrategies.filter(
    (r) => !r.contentTypes || r.contentTypes.includes(contentType),
  );
}

export function deprioritizedStrategiesForContentType(
  policy: StrategyGovernancePolicy,
  contentType: CreatorTypeForVariant,
): ReadonlyArray<GovernedStrategyRule> {
  return policy.deprioritizedStrategies.filter(
    (r) => !r.contentTypes || r.contentTypes.includes(contentType),
  );
}
