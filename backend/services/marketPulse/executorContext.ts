/**
 * Market Pulse — Executor Context.
 *
 * Compact, prompt-safe slice of the company profile that flows from the
 * Market Pulse run input → the BullMQ job's `context_payload` →
 * `generateMarketPulseForRegion` → the LLM system prompt and into
 * `scoringService.computeCompanyAlignment`.
 *
 * BEFORE Phase 1A:
 *   - `pages/api/market-pulse/run.ts` set context_payload = {
 *       context_mode, additional_direction, insight_source,
 *       selected_categories, objective, competitor_scope }
 *   - Competitors, growth priorities, regulatory sensitivity, business model,
 *     domain role, etc. were loaded into `marketPulseProfile` for the
 *     frontend but DROPPED before the executor saw them.
 *
 * AFTER Phase 1A:
 *   - `buildExecutorContext()` derives this typed block from a profile
 *     `MarketPulseProfileSettings` + the resolved run input.
 *   - The block is embedded in `context_payload.executor_context` so both
 *     the LLM prompt builder and the scoring service can read it.
 */

import type { MarketPulseObjective, MarketPulseProfileSettings, MarketPulseRunInput } from '../marketPulseV2Service';

export interface CompetitorRef {
  name: string;
  category?: string | null;
  tier?: string | null;
  score?: number | null;
  confidence?: number | null;
  rationale?: string | null;
}

export interface MarketAlternativeRef {
  name: string;
  category?: string | null;
  tier?: string | null;
  use_case?: string | null;
  business_model?: string | null;
  rationale?: string | null;
}

/**
 * Serializable, prompt-safe company context snapshot. Stored verbatim inside
 * `market_pulse_jobs_v1.context_payload.executor_context` and read back by
 * `generateMarketPulseForRegion` + `scoringService`.
 */
export interface MarketPulseExecutorContext {
  // Identity
  business_model?: string | null;
  provider_type?: string | null;
  domain_role?: string | null;
  operating_model?: string | null;

  // Markets
  primary_operating_markets?: string[];
  target_expansion_markets?: string[];
  preferred_regions?: string[];

  // Competitors & alternatives
  named_competitors?: string[];
  competitor_details?: CompetitorRef[];
  market_alternatives?: MarketAlternativeRef[];
  /** From run input — controls how prompt frames competitor coverage. */
  competitor_scope?: 'profile_only' | 'auto_discover' | 'combined';

  // Strategic frame
  solution_domains?: string[];
  core_offerings?: string[];
  growth_priorities?: string[];
  partnership_priorities?: string[];
  critical_hiring_functions?: string[];
  regulatory_policy_sensitivity?: string[];

  // Run-scoped
  objective?: MarketPulseObjective;
  selected_categories?: string[];
  exclusions?: string[];
  custom_direction?: string | null;
}

/** True when at least one company-context field is populated. */
export function hasExecutorContextSignal(ctx: MarketPulseExecutorContext | null | undefined): boolean {
  if (!ctx) return false;
  const lengths = [
    ctx.named_competitors,
    ctx.competitor_details,
    ctx.market_alternatives,
    ctx.solution_domains,
    ctx.core_offerings,
    ctx.growth_priorities,
    ctx.partnership_priorities,
    ctx.critical_hiring_functions,
    ctx.regulatory_policy_sensitivity,
    ctx.primary_operating_markets,
    ctx.target_expansion_markets,
  ];
  if (lengths.some((arr) => Array.isArray(arr) && arr.length > 0)) return true;
  return Boolean(
    ctx.business_model || ctx.provider_type || ctx.domain_role || ctx.operating_model ||
    ctx.objective || (ctx.custom_direction && ctx.custom_direction.trim()),
  );
}

function uniqueNonEmpty(values: Array<string | null | undefined>): string[] {
  const out = new Set<string>();
  for (const v of values) {
    const s = String(v ?? '').trim();
    if (s) out.add(s);
  }
  return Array.from(out);
}

function normalizeCompetitorList(
  raw: MarketPulseProfileSettings['competitor_details'],
): CompetitorRef[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((c) => c && typeof c.name === 'string' && c.name.trim().length > 0)
    .map((c) => ({
      name: String(c!.name).trim(),
      category: c!.category ?? null,
      tier: c!.tier ?? null,
      score: typeof c!.score === 'number' ? c!.score : null,
      confidence: typeof c!.confidence === 'number' ? c!.confidence : null,
      rationale: c!.rationale ?? null,
    }));
}

function normalizeAlternatives(
  raw: MarketPulseProfileSettings['market_alternatives'],
): MarketAlternativeRef[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((m) => m && typeof m.name === 'string' && m.name.trim().length > 0)
    .map((m) => ({
      name: String(m!.name).trim(),
      category: m!.category ?? null,
      tier: m!.tier ?? null,
      use_case: m!.use_case ?? null,
      business_model: m!.business_model ?? null,
      rationale: m!.rationale ?? null,
    }));
}

/**
 * Build the executor context from a profile settings block + the resolved run
 * input. This is the canonical wiring point — call from
 *   - `pages/api/market-pulse/run.ts` (user-triggered runs)
 *   - `pages/api/cron/market-pulse-automation.ts` (cron-triggered runs)
 * and embed the result under `context_payload.executor_context`.
 */
export function buildExecutorContext(
  profileSettings: MarketPulseProfileSettings | null | undefined,
  resolvedInput: MarketPulseRunInput,
): MarketPulseExecutorContext {
  const settings = profileSettings ?? ({} as MarketPulseProfileSettings);
  const competitorDetails = normalizeCompetitorList(settings.competitor_details);
  const namedCompetitors = uniqueNonEmpty([
    ...(settings.named_competitors ?? []),
    ...competitorDetails.map((c) => c.name),
  ]);

  return {
    business_model: settings.business_model ?? null,
    provider_type: settings.provider_type ?? null,
    domain_role: settings.domain_role ?? null,
    operating_model: settings.operating_model ?? null,

    primary_operating_markets: uniqueNonEmpty(settings.primary_operating_markets ?? []),
    target_expansion_markets: uniqueNonEmpty(settings.target_expansion_markets ?? []),
    preferred_regions: uniqueNonEmpty(settings.preferred_regions ?? []),

    named_competitors: namedCompetitors,
    competitor_details: competitorDetails,
    market_alternatives: normalizeAlternatives(settings.market_alternatives),
    competitor_scope: resolvedInput.competitor_scope,

    solution_domains: uniqueNonEmpty(settings.solution_domains ?? []),
    core_offerings: uniqueNonEmpty(settings.core_offerings ?? []),
    growth_priorities: uniqueNonEmpty(settings.growth_priorities ?? []),
    partnership_priorities: uniqueNonEmpty(settings.partnership_priorities ?? []),
    critical_hiring_functions: uniqueNonEmpty(settings.critical_hiring_functions ?? []),
    regulatory_policy_sensitivity: uniqueNonEmpty(settings.regulatory_policy_sensitivity ?? []),

    objective: resolvedInput.objective,
    selected_categories: resolvedInput.categories,
    exclusions: uniqueNonEmpty(settings.exclusions ?? []),
    custom_direction: resolvedInput.custom_direction ?? null,
  };
}

/**
 * Render an LLM-friendly textual block describing the company context. Used
 * by `generateMarketPulseForRegion` to make the system prompt company-aware.
 *
 * Keep terse — the LLM does not need section headers, just enough signal to
 * filter findings to what matters for THIS company. Truncated to the most
 * load-bearing fields so prompt token budget stays predictable.
 */
export function renderExecutorContextForPrompt(ctx: MarketPulseExecutorContext): string {
  if (!hasExecutorContextSignal(ctx)) return '';

  const lines: string[] = [];

  if (ctx.business_model || ctx.provider_type || ctx.domain_role || ctx.operating_model) {
    const parts: string[] = [];
    if (ctx.business_model) parts.push(`business: ${ctx.business_model}`);
    if (ctx.provider_type) parts.push(`provider: ${ctx.provider_type}`);
    if (ctx.domain_role) parts.push(`role: ${ctx.domain_role}`);
    if (ctx.operating_model) parts.push(`ops: ${ctx.operating_model}`);
    lines.push(`Company identity: ${parts.join(' · ')}`);
  }

  if ((ctx.solution_domains ?? []).length > 0) {
    lines.push(`Solution domains: ${ctx.solution_domains!.slice(0, 8).join(', ')}`);
  }
  if ((ctx.core_offerings ?? []).length > 0) {
    lines.push(`Core offerings: ${ctx.core_offerings!.slice(0, 8).join(', ')}`);
  }
  if ((ctx.named_competitors ?? []).length > 0) {
    lines.push(`Named competitors${ctx.competitor_scope ? ` (scope=${ctx.competitor_scope})` : ''}: ${ctx.named_competitors!.slice(0, 12).join(', ')}`);
  }
  if ((ctx.market_alternatives ?? []).length > 0) {
    const alts = ctx.market_alternatives!.slice(0, 6).map((m) => m.name);
    lines.push(`Adjacent alternatives: ${alts.join(', ')}`);
  }
  if ((ctx.growth_priorities ?? []).length > 0) {
    lines.push(`Growth priorities: ${ctx.growth_priorities!.slice(0, 8).join(', ')}`);
  }
  if ((ctx.partnership_priorities ?? []).length > 0) {
    lines.push(`Partnership priorities: ${ctx.partnership_priorities!.slice(0, 6).join(', ')}`);
  }
  if ((ctx.critical_hiring_functions ?? []).length > 0) {
    lines.push(`Critical hiring: ${ctx.critical_hiring_functions!.slice(0, 6).join(', ')}`);
  }
  if ((ctx.regulatory_policy_sensitivity ?? []).length > 0) {
    lines.push(`Regulatory sensitivity: ${ctx.regulatory_policy_sensitivity!.slice(0, 8).join(', ')}`);
  }
  if ((ctx.primary_operating_markets ?? []).length > 0) {
    lines.push(`Primary markets: ${ctx.primary_operating_markets!.join(', ')}`);
  }
  if ((ctx.target_expansion_markets ?? []).length > 0) {
    lines.push(`Expansion markets: ${ctx.target_expansion_markets!.join(', ')}`);
  }
  if (ctx.objective) lines.push(`Objective: ${ctx.objective}`);
  if (ctx.custom_direction && ctx.custom_direction.trim()) {
    lines.push(`Custom direction: ${ctx.custom_direction.trim()}`);
  }
  if ((ctx.exclusions ?? []).length > 0) {
    lines.push(`Exclude categories: ${ctx.exclusions!.join(', ')}`);
  }

  return [
    'COMPANY CONTEXT (use to filter, prioritize, and frame findings — do not echo verbatim):',
    ...lines,
  ].join('\n');
}
