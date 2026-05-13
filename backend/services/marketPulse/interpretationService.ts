/**
 * Market Pulse — Interpretation Service.
 *
 * Phase 1B: turns raw scored findings into company-aware strategic
 * intelligence. Two surfaces:
 *
 *   1. generateFindingInterpretation(input)
 *        Per-finding deterministic interpretation that ANSWERS the question
 *        "why does this matter to THIS company?". Uses executor_context to
 *        substitute named competitors, growth priorities, regulatory
 *        sensitivity, business model, etc. into the output.
 *
 *   2. generateExecutiveSummary(scoredFindings, runMeta, executorContext)
 *        Run-level synthesis: dominant patterns, momentum direction, risk vs
 *        opportunity pressure, top takeaways, immediate-attention items.
 *
 * Both are deterministic (no LLM call) so they:
 *   - Cost nothing per run.
 *   - Are testable without mocking model output.
 *   - Cannot hallucinate competitor names or sensitivities — they only
 *     reference fields actually present in the company profile.
 *
 * Phase 2 may swap a portion of these to LLM-augmented prose; the function
 * shape is the boundary that lets that swap happen without touching callers.
 */

import type { MarketPulseExecutorContext } from './executorContext';
import type { ImpactType, PriorityTier, ScoreFindingOutput } from './scoringService';

// ─── Per-finding interpretation ──────────────────────────────────────────────

export interface FindingInterpretationInput {
  title: string;
  summary: string;
  category: string;
  impactType: ImpactType;
  regions: string[];
  /** From the LLM topic — narrative phase informs window estimation. */
  narrativePhase?: string | null;
  shelfLifeDays?: number | null;
  /** Score outputs flow in so we can quote the actual confidence/relevance. */
  score: ScoreFindingOutput;
  executorContext: MarketPulseExecutorContext | null;
  /** For "this is the Nth time we've seen this" recurrence framing. */
  timesSeenPrior?: number | null;
}

export interface FindingInterpretation {
  interpretation_text: string;
  strategic_implication: string;
  urgency_reason: string;
  operational_impact: string;
  opportunity_window: string;
  affected_business_areas: string[];
}

const CATEGORY_OPERATIONAL_AREAS: Record<string, string[]> = {
  competitor_moves: ['Product', 'Marketing', 'Sales', 'Pricing'],
  product_positioning: ['Product', 'Marketing', 'Brand'],
  partnerships_alliances: ['Partnerships', 'BD', 'Marketing'],
  growth_expansion: ['GTM', 'Sales', 'Marketing'],
  hiring_talent: ['People', 'Recruiting', 'Engineering Leadership'],
  regulatory_policy: ['Legal', 'Compliance', 'Product'],
  capital_business_health: ['Finance', 'Strategy', 'Investor Relations'],
  demand_category_momentum: ['Marketing', 'Product', 'Sales'],
  technology_platform_shifts: ['Engineering', 'Product', 'Architecture'],
};

function lowercaseTokens(text: string): Set<string> {
  return new Set(
    String(text ?? '')
      .toLowerCase()
      .replace(/[^a-z0-9 ]+/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length > 2),
  );
}

/** Find context terms (from competitors, priorities, etc.) actually mentioned in the text. */
function extractMentionedTerms(text: string, candidates: string[]): string[] {
  const tokens = lowercaseTokens(text);
  const out: string[] = [];
  for (const candidate of candidates) {
    const candidateTokens = lowercaseTokens(candidate);
    let match = 0;
    for (const t of candidateTokens) if (tokens.has(t)) match++;
    // require at least half the candidate's tokens to appear (handles
    // "DataDog" vs "Datadog Cloud" gracefully)
    if (candidateTokens.size > 0 && match / candidateTokens.size >= 0.5) {
      out.push(candidate);
    }
  }
  return Array.from(new Set(out));
}

/**
 * Derive affected_business_areas from category + which company-context terms
 * actually appear in the finding text. Always returns at least one area so
 * the UI never shows an empty list.
 */
function deriveAffectedBusinessAreas(
  text: string,
  category: string,
  ctx: MarketPulseExecutorContext | null,
): string[] {
  const baseline = CATEGORY_OPERATIONAL_AREAS[category] ?? ['Strategy'];
  if (!ctx) return baseline.slice(0, 3);

  const mentions = extractMentionedTerms(
    text,
    [
      ...(ctx.named_competitors ?? []),
      ...(ctx.solution_domains ?? []),
      ...(ctx.growth_priorities ?? []),
      ...(ctx.partnership_priorities ?? []),
      ...(ctx.regulatory_policy_sensitivity ?? []),
    ],
  );

  // Add "Strategy" when a competitor or growth priority is mentioned (cross-cutting).
  const competitorMentioned = mentions.some((m) =>
    (ctx.named_competitors ?? []).map((c) => c.toLowerCase()).includes(m.toLowerCase()),
  );
  const out = new Set<string>(baseline);
  if (competitorMentioned) out.add('Strategy');
  if (mentions.length > 0) out.add('GTM');
  return Array.from(out).slice(0, 5);
}

function urgencyPhraseFromTier(tier: PriorityTier, impact: ImpactType): string {
  if (tier === 'P0') {
    return impact === 'risk'
      ? 'requires this-week attention'
      : impact === 'opportunity'
        ? 'is a closing-window opportunity'
        : 'demands close monitoring';
  }
  if (tier === 'P1') {
    return impact === 'risk'
      ? 'should be addressed within the next 1–2 weeks'
      : impact === 'opportunity'
        ? 'is worth committing planning cycles to'
        : 'warrants weekly review';
  }
  return impact === 'risk'
    ? 'is on the watchlist; review at your normal cadence'
    : 'is informational and does not require immediate action';
}

function windowPhraseFromShelfLife(
  narrativePhase: string | null | undefined,
  shelfLifeDays: number | null | undefined,
): string {
  const phase = String(narrativePhase ?? '').toUpperCase();
  const days = Math.max(1, Math.min(60, Number(shelfLifeDays) || 7));
  if (phase === 'EMERGING') return `Acting in the next ${Math.min(days, 14)} days captures early-mover advantage.`;
  if (phase === 'ACCELERATING') return `~${Math.min(days, 21)} days before this moves out of "novel" framing.`;
  if (phase === 'PEAKING') return `~${Math.min(days, 14)} days before saturation reduces the opportunity.`;
  if (phase === 'DECLINING') return `Diminishing window — likely ~${days} days of remaining relevance.`;
  if (phase === 'STRUCTURAL') return `Structural shift — plan over the next 30–60 days, not days.`;
  return `Estimated ${days}-day window of relevance.`;
}

export function generateFindingInterpretation(
  input: FindingInterpretationInput,
): FindingInterpretation {
  const ctx = input.executorContext;
  const text = `${input.title} ${input.summary}`;

  // Pull the actual context terms mentioned in the finding text. These drive
  // the company-specific phrasing — no terms means no fabricated names.
  const mentionedCompetitors = ctx
    ? extractMentionedTerms(text, ctx.named_competitors ?? [])
    : [];
  const mentionedGrowthPriorities = ctx
    ? extractMentionedTerms(text, ctx.growth_priorities ?? [])
    : [];
  const mentionedRegulatory = ctx
    ? extractMentionedTerms(text, ctx.regulatory_policy_sensitivity ?? [])
    : [];
  const mentionedSolutionDomains = ctx
    ? extractMentionedTerms(text, ctx.solution_domains ?? [])
    : [];
  const mentionedPartnerships = ctx
    ? extractMentionedTerms(text, ctx.partnership_priorities ?? [])
    : [];

  const objective = ctx?.objective ?? 'growth';

  // Region-overlap framing — primary markets get strongest call-out.
  const primaryMarkets = (ctx?.primary_operating_markets ?? []).map((m) => m.toLowerCase());
  const findingRegions = input.regions.map((r) => r.toLowerCase());
  const overlapsPrimary = findingRegions.some((r) => primaryMarkets.includes(r));
  const overlapsExpansion = findingRegions.some((r) =>
    (ctx?.target_expansion_markets ?? []).map((m) => m.toLowerCase()).includes(r),
  );

  // ── interpretation_text — the full "why this matters to THIS company" line ──
  const interpretationParts: string[] = [];
  if (mentionedCompetitors.length > 0) {
    interpretationParts.push(
      `Direct movement by named competitor${mentionedCompetitors.length > 1 ? 's' : ''} ${mentionedCompetitors.slice(0, 2).join(' and ')} `
      + `intersects your ${objective} agenda`,
    );
  } else if (mentionedGrowthPriorities.length > 0) {
    interpretationParts.push(
      `Touches your declared growth priority "${mentionedGrowthPriorities[0]}"`,
    );
  } else if (mentionedRegulatory.length > 0) {
    interpretationParts.push(
      `Falls inside your declared regulatory-sensitive area "${mentionedRegulatory[0]}"`,
    );
  } else if (mentionedSolutionDomains.length > 0) {
    interpretationParts.push(
      `Affects your solution domain "${mentionedSolutionDomains[0]}"`,
    );
  } else {
    // Nothing mentioned — fall back to category + region framing rather than a
    // generic "this matters to your company" string.
    const cat = input.category.replace(/_/g, ' ');
    interpretationParts.push(
      `${cat.charAt(0).toUpperCase() + cat.slice(1)} signal`,
    );
  }

  if (overlapsPrimary) {
    interpretationParts.push(`in your primary market${input.regions.length > 1 ? 's' : ''} (${input.regions.join(', ')})`);
  } else if (overlapsExpansion) {
    interpretationParts.push(`in your expansion market${input.regions.length > 1 ? 's' : ''} (${input.regions.join(', ')})`);
  } else if (input.regions.length > 0) {
    interpretationParts.push(`in ${input.regions.join(', ')}`);
  }

  if ((input.timesSeenPrior ?? 0) >= 2) {
    interpretationParts.push(`(observed ${input.timesSeenPrior} prior runs — recurring, not noise)`);
  } else if ((input.timesSeenPrior ?? 0) === 0) {
    interpretationParts.push(`(first observation — verify before acting)`);
  }

  const interpretation_text = `${interpretationParts.join(' ')}.`;

  // ── strategic_implication — short single sentence ───────────────────────────
  let strategic_implication: string;
  if (input.impactType === 'risk') {
    strategic_implication = mentionedCompetitors.length > 0
      ? `${mentionedCompetitors[0]}'s position in this space directly threatens your ${objective} thesis if unaddressed.`
      : `Left unaddressed, this could erode your ${objective} positioning over the coming weeks.`;
  } else if (input.impactType === 'opportunity') {
    strategic_implication = mentionedCompetitors.length > 0
      ? `Acting before ${mentionedCompetitors[0]} owns this narrative compounds your ${objective} leverage.`
      : `Captured early, this strengthens your ${objective} positioning relative to the category.`;
  } else {
    strategic_implication = `Watch — confirms the trajectory of your ${objective} thesis without yet demanding action.`;
  }

  // ── urgency_reason — what makes this time-bound ─────────────────────────────
  const urgencyDriver = mentionedRegulatory.length > 0
    ? `regulatory exposure in ${mentionedRegulatory[0]}`
    : mentionedCompetitors.length > 0
      ? `competitor action by ${mentionedCompetitors[0]}`
      : overlapsPrimary
        ? 'concentration in your primary market'
        : input.score.priority_tier === 'P0'
          ? 'composite priority score in P0 range'
          : 'evolving narrative phase';
  const urgency_reason = `${urgencyPhraseFromTier(input.score.priority_tier, input.impactType).charAt(0).toUpperCase() + urgencyPhraseFromTier(input.score.priority_tier, input.impactType).slice(1)} — driven by ${urgencyDriver}.`;

  // ── operational_impact — which functions need to act ─────────────────────────
  const areas = deriveAffectedBusinessAreas(text, input.category, ctx);
  const operational_impact = areas.length === 1
    ? `Primary owner: ${areas[0]}.`
    : `Coordination needed across ${areas.slice(0, 3).join(', ')}.`;

  // ── opportunity_window — phase-aware time bound ─────────────────────────────
  const opportunity_window = windowPhraseFromShelfLife(input.narrativePhase, input.shelfLifeDays);

  // ── affected_business_areas (typed array; persisted as TEXT[]) ───────────────
  const affected_business_areas = areas;

  // Append partnership opportunity hint when relevant (purely additive — does
  // not replace primary phrasing).
  if (mentionedPartnerships.length > 0 && input.impactType === 'opportunity') {
    return {
      interpretation_text: `${interpretation_text} Aligns with partnership priority "${mentionedPartnerships[0]}".`,
      strategic_implication,
      urgency_reason,
      operational_impact,
      opportunity_window,
      affected_business_areas,
    };
  }

  return {
    interpretation_text,
    strategic_implication,
    urgency_reason,
    operational_impact,
    opportunity_window,
    affected_business_areas,
  };
}

// ─── Run-level executive summary ─────────────────────────────────────────────

export interface ExecutiveSummaryFinding {
  id?: string;
  title: string;
  category: string;
  impactType: ImpactType;
  priority_tier: PriorityTier;
  confidence_score: number;
  relevance_score: number;
  evidence_strength?: number | null;
  company_alignment_score?: number | null;
  change_status?: 'new' | 'updated' | 'unchanged' | 'resolved' | null;
  regions?: string[];
}

export interface ExecutiveSummaryRunMeta {
  objective?: string | null;
  region_divergence_score?: number | null;
}

export interface ExecutiveSummary {
  executive_summary: string;
  top_takeaways: string[];
  immediate_attention_items: Array<{
    finding_id: string | null;
    title: string;
    reason: string;
    priority_tier: PriorityTier;
  }>;
  strategic_shift_assessment: string;
  market_direction: 'expanding' | 'contracting' | 'mixed' | 'stable';
  opportunity_pressure: number;   // 0..1
  risk_pressure: number;          // 0..1
}

function rankCategoriesByCount(findings: ExecutiveSummaryFinding[]): Array<[string, number]> {
  const counts = new Map<string, number>();
  for (const f of findings) counts.set(f.category, (counts.get(f.category) ?? 0) + 1);
  return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
}

export function generateExecutiveSummary(
  findings: ExecutiveSummaryFinding[],
  runMeta: ExecutiveSummaryRunMeta,
  executorContext: MarketPulseExecutorContext | null,
): ExecutiveSummary {
  const total = findings.length;
  const objective = executorContext?.objective ?? runMeta.objective ?? 'growth';

  if (total === 0) {
    return {
      executive_summary: `No actionable Market Pulse findings surfaced this run. Nothing requires attention right now.`,
      top_takeaways: [],
      immediate_attention_items: [],
      strategic_shift_assessment: 'No basis for assessment — empty result set.',
      market_direction: 'stable',
      opportunity_pressure: 0,
      risk_pressure: 0,
    };
  }

  const p0 = findings.filter((f) => f.priority_tier === 'P0');
  const p1 = findings.filter((f) => f.priority_tier === 'P1');
  const risks = findings.filter((f) => f.impactType === 'risk');
  const opportunities = findings.filter((f) => f.impactType === 'opportunity');
  const watch = findings.filter((f) => f.impactType === 'watch');
  const newFindings = findings.filter((f) => f.change_status === 'new');
  const updatedFindings = findings.filter((f) => f.change_status === 'updated');

  // ── pressure = mass of risk vs opportunity, weighted by priority ────────────
  const pressureWeight = (f: ExecutiveSummaryFinding) =>
    f.priority_tier === 'P0' ? 1.0 : f.priority_tier === 'P1' ? 0.5 : 0.2;
  const totalPressureMass = findings.reduce((s, f) => s + pressureWeight(f), 0) || 1;
  const risk_pressure = Math.round((risks.reduce((s, f) => s + pressureWeight(f), 0) / totalPressureMass) * 1000) / 1000;
  const opportunity_pressure = Math.round((opportunities.reduce((s, f) => s + pressureWeight(f), 0) / totalPressureMass) * 1000) / 1000;

  // ── market_direction — derived from opp/risk balance + watch share ──────────
  const market_direction: ExecutiveSummary['market_direction'] =
    opportunity_pressure > risk_pressure + 0.2 ? 'expanding'
    : risk_pressure > opportunity_pressure + 0.2 ? 'contracting'
    : watch.length / total > 0.5 ? 'stable'
    : 'mixed';

  // ── dominant categories ─────────────────────────────────────────────────────
  const topCategories = rankCategoriesByCount(findings).slice(0, 3);
  const topCategoryNames = topCategories.map(([c]) => c.replace(/_/g, ' '));

  // ── executive_summary ───────────────────────────────────────────────────────
  const tierPhrase = p0.length > 0
    ? `${p0.length} P0 ${p0.length === 1 ? 'item demands' : 'items demand'} attention this week`
    : p1.length > 0
      ? `${p1.length} P1 ${p1.length === 1 ? 'item warrants' : 'items warrant'} review this cycle`
      : 'no priority escalations';

  const directionPhrase = {
    expanding: 'opportunity-leaning posture',
    contracting: 'risk-leaning posture',
    mixed: 'mixed signal landscape',
    stable: 'steady-state with watchlist activity',
  }[market_direction];

  const categoryPhrase = topCategoryNames.length > 0
    ? `Dominant themes: ${topCategoryNames.join(', ')}.`
    : '';

  const changePhrase = (newFindings.length + updatedFindings.length) > 0
    ? `${newFindings.length} new and ${updatedFindings.length} updated since the last run.`
    : 'No new or updated signals since the last run.';

  const executive_summary = `${total} signals across ${objective} — ${tierPhrase}. ${categoryPhrase} ${directionPhrase}. ${changePhrase}`.replace(/\s+/g, ' ').trim();

  // ── top_takeaways — at most 4 declarative bullets ───────────────────────────
  const top_takeaways: string[] = [];
  if (p0.length > 0) {
    top_takeaways.push(`${p0.length} P0 ${p0.length === 1 ? 'finding' : 'findings'} — review before any other planning work.`);
  }
  if (risks.length > 0 && opportunities.length > 0) {
    const ratio = (opportunities.length / risks.length).toFixed(1);
    top_takeaways.push(`Opportunity-to-risk ratio is ${ratio}; ${market_direction === 'expanding' ? 'lean into capture' : market_direction === 'contracting' ? 'allocate defensive capacity' : 'maintain balanced posture'}.`);
  }
  if (topCategoryNames.length > 0 && topCategories[0][1] >= 3) {
    top_takeaways.push(`Concentration in "${topCategoryNames[0]}" (${topCategories[0][1]} findings) — pattern, not noise.`);
  }
  // If executor_context names competitors and any P0/P1 finding mentions them,
  // surface that as a takeaway. This is high-value for executive scanning.
  if (executorContext?.named_competitors?.length) {
    const namedCompetitorMentions = findings
      .filter((f) => f.priority_tier !== 'P2')
      .flatMap((f) => extractMentionedTerms(`${f.title}`, executorContext.named_competitors!))
      .filter(Boolean);
    const distinctCompetitors = Array.from(new Set(namedCompetitorMentions));
    if (distinctCompetitors.length > 0) {
      top_takeaways.push(`Competitor activity in P0/P1 tier from: ${distinctCompetitors.slice(0, 3).join(', ')}.`);
    }
  }
  if (newFindings.length >= 3) {
    top_takeaways.push(`${newFindings.length} new findings this run — net signal is increasing.`);
  }

  // ── immediate_attention_items — P0 risks + P0 opportunities, capped at 5 ────
  const immediate_attention_items = findings
    .filter((f) => f.priority_tier === 'P0' && (f.change_status === 'new' || f.change_status === 'updated'))
    .slice(0, 5)
    .map((f) => ({
      finding_id: f.id ?? null,
      title: f.title,
      reason: `${f.impactType.toUpperCase()} · confidence ${Math.round(f.confidence_score)}${
        typeof f.evidence_strength === 'number' ? ` · trust ${Math.round(f.evidence_strength * 100)}` : ''
      }`,
      priority_tier: f.priority_tier,
    }));

  // ── strategic_shift_assessment — narrative paragraph ────────────────────────
  let strategic_shift_assessment: string;
  if (p0.length === 0 && p1.length === 0) {
    strategic_shift_assessment = `No tier-elevated movement detected. Continue executing the current ${objective} plan; revisit at the next scheduled run.`;
  } else if (market_direction === 'expanding') {
    strategic_shift_assessment = `Net opportunity pressure exceeds risk pressure by ${Math.round((opportunity_pressure - risk_pressure) * 100)} points — capacity should bias toward capture, especially in: ${topCategoryNames.slice(0, 2).join(', ')}.`;
  } else if (market_direction === 'contracting') {
    strategic_shift_assessment = `Risk pressure exceeds opportunity pressure by ${Math.round((risk_pressure - opportunity_pressure) * 100)} points — allocate defensive capacity to ${topCategoryNames.slice(0, 2).join(', ')} this cycle.`;
  } else if (market_direction === 'mixed') {
    strategic_shift_assessment = `Signal landscape is mixed; ${p0.length + p1.length} tier-elevated items span both directions. Sequencing matters more than scale this cycle.`;
  } else {
    strategic_shift_assessment = `Steady-state with a populated watchlist. No immediate reposition needed; preserve optionality.`;
  }

  return {
    executive_summary,
    top_takeaways,
    immediate_attention_items,
    strategic_shift_assessment,
    market_direction,
    opportunity_pressure,
    risk_pressure,
  };
}
