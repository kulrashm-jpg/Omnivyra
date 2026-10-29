// AI Citation Matrix builder.
//
// Composes per-provider × per-query-class results into the canonical matrix.
// No synthetic scores — when a provider is unavailable, the corresponding cell
// is `state: 'unavailable'`. The Matrix is the canonical surface for AI Surface
// Presence in the report.

import type {
  AIProviderId,
  AIQueryClass,
  AIVisibilityProbeResult,
  CitationMention,
  LLMVisibilityProvider,
} from './providerInterfaces';
import { AI_PROVIDERS, AI_QUERY_CLASSES, unavailableEvidence } from './providerInterfaces';
// D2 — the probe identity seam, shared with the adapters so "do we know whose
// visibility this is?" is answered the same way everywhere.
import { resolveProbeIdentity, type ProbeObservationOutcome } from './aiVisibilityGrounding';
import { getAllLLMProviders } from './providerRegistry';
// Phase B — repeated grounded runs, budget pre-flight, per-attempt observations.
import { withinBudget } from './costGovernance';
import { getActiveScanId } from './scanBudgetContext';
import {
  clampGroundedRuns,
  type KnownCompetitor,
  type ObservationRun,
  type VisibilityObservation,
} from './visibilityObservation';
import type {
  CanonicalScore,
  ConfidenceBand,
  EvidenceTrace,
  ScoreState,
} from '../canonicalReport/canonicalReportTypes';

export type AICitationMatrixCell = {
  provider: AIProviderId;
  query_class: AIQueryClass;
  state: ScoreState;
  /**
   * D2 — WHY the cell is in this state, at a finer grain than the four canonical
   * states can express. The cell used to DROP the probe's `observation_outcome`,
   * which collapsed distinct findings into one value: "we never asked" and "we
   * asked and it broke" both arrived as `unavailable` and nothing downstream
   * could tell them apart. Carried verbatim from the probe result.
   */
  observation_outcome: ProbeObservationOutcome;
  /**
   * D2 — true when nothing about the present configuration could make this cell
   * measurable: the provider is not retrieval-grounded, so by the D1 rule
   * `measured` is unreachable for it however often it answers. Distinct from
   * "not measured yet" — a grounded provider that merely lacks a credential
   * becomes measurable when the credential arrives and is NOT counted here.
   */
  structurally_unmeasurable: boolean;
  citation_rate: number | null;
  mean_prominence: number | null;
  observed_count: number;
  evidence: EvidenceTrace;
  reason_unavailable: string | null;
  /**
   * Phase B (additive, optional) — the probe's per-attempt records, verbatim.
   * Not read by any score; summarised by `summarizeVisibilityObservations`.
   */
  observations?: VisibilityObservation[];
};

export type AICitationMatrix = {
  cells: AICitationMatrixCell[];
  // Aggregate AI Surface Presence score derived from measured cells only.
  // Null when no cell is measured. Never synthesized.
  overall_score: CanonicalScore;
  // Per-provider summary (averaged across query classes that have measurements).
  by_provider: Array<{
    provider: AIProviderId;
    state: ScoreState;
    citation_rate: number | null;
    mean_prominence: number | null;
  }>;
  // Per-query-class summary (averaged across providers that have measurements).
  by_query_class: Array<{
    query_class: AIQueryClass;
    state: ScoreState;
    citation_rate: number | null;
    mean_prominence: number | null;
  }>;
  /**
   * D2 — the identity the whole matrix was measured FOR. A citation rate is a
   * statement about a named company, so the surface carries the subject it was
   * computed against and whether that subject existed at all. `resolved: false`
   * means every cell was refused for want of a subject — not that the company is
   * invisible to AI.
   */
  identity: { brand_name: string | null; domain: string | null; resolved: boolean };
  /**
   * Surface-level summary.
   *
   * D2 — `total_cells` is the ENUMERATED grid (providers × query classes) and is
   * preserved byte-for-byte for every existing consumer. It is the wrong
   * denominator for a coverage percentage, because it counts cells that can
   * never be measured as configured: with only one retrieval-grounded adapter in
   * the repo, 16 of the 20 enumerated cells belong to chat models for which D1
   * makes `measured` unreachable. Dividing by 20 therefore reports a shortfall
   * the operator cannot close and understates coverage by design.
   *
   * `measurable_cells` is the honest denominator: cells whose provider could
   * yield a measurement. It is 0 when no grounded adapter is active, which must
   * read as "no percentage exists", never as 0%.
   */
  coverage: {
    measured_cells: number;
    unavailable_cells: number;
    total_cells: number;
    measurable_cells: number;
    structurally_unmeasurable_cells: number;
  };
  /** Phase B (additive) — requested vs effective grounded runs and how they were planned. */
  observation_run?: ObservationRun;
  /** Phase B (additive) — the competitor list entities were matched against (as received). */
  known_competitors?: KnownCompetitor[];
};

export type CitationMatrixInput = {
  brandName: string | null;
  domain: string | null;
  queries: Partial<Record<AIQueryClass, string[]>>;
  /**
   * Phase B — `ExecutionPolicy.groundedRunsPerQuery`. Absent / 1 = P0 exactly.
   * Applied to retrieval-grounded providers only; clamped 1..5.
   */
  runsPerQuery?: number;
  /** Phase B — the competitor list the caller already has; only used to label answer entities. */
  knownCompetitors?: KnownCompetitor[];
};

/**
 * Phase B — the run plan. At N = 1 nothing is reordered and no pre-flight runs
 * (P0 behaviour). At N > 1:
 *  • planned calls = grounded providers × queries × N + other providers × queries;
 *  • inside an active scan budget, N is lowered deterministically to the largest
 *    value whose plan fits, and the reduction is RECORDED (never silent);
 *  • retrieval-grounded providers are probed first, so budget exhaustion cannot
 *    starve the only providers able to produce a measurement.
 */
export function planObservationRun(params: {
  requested: unknown;
  providers: readonly Pick<LLMVisibilityProvider, 'retrieval_grounded'>[];
  queries: Partial<Record<AIQueryClass, string[]>>;
  scanId: string | null;
}): ObservationRun {
  const requested = clampGroundedRuns(params.requested ?? 1);
  if (requested === 1) {
    return { runs_requested: 1, runs_effective: 1, reduction_reason: null, planned_calls: null, grounded_first: false };
  }
  const perProvider = AI_QUERY_CLASSES.reduce((sum, c) => sum + (params.queries[c]?.length ?? 0), 0);
  const grounded = params.providers.filter((p) => p.retrieval_grounded).length;
  const others = params.providers.length - grounded;
  const plan = (n: number) => grounded * perProvider * n + others * perProvider;
  if (grounded === 0) {
    return { runs_requested: requested, runs_effective: 1, reduction_reason: 'no_retrieval_grounded_provider', planned_calls: plan(1), grounded_first: false };
  }
  let effective = requested;
  let reason: string | null = null;
  if (params.scanId) {
    while (effective > 1) {
      const gate = withinBudget(params.scanId, { requests: plan(effective), cost_usd: null });
      if (gate.ok) break;
      reason = gate.reason ?? 'budget_exceeded';
      effective -= 1;
    }
  }
  return { runs_requested: requested, runs_effective: effective, reduction_reason: reason, planned_calls: plan(effective), grounded_first: true };
}

function mergeEvidence(traces: EvidenceTrace[]): EvidenceTrace {
  const sources = new Set<string>();
  let count = 0;
  let lastObserved: string | null = null;
  const observations: EvidenceTrace['observations'] = [];
  for (const trace of traces) {
    count += trace.count;
    for (const s of trace.sources) sources.add(s);
    for (const o of trace.observations) observations.push(o);
    if (trace.freshness.last_observed_at) {
      lastObserved = trace.freshness.last_observed_at;
    }
  }
  return {
    count,
    sources: [...sources] as EvidenceTrace['sources'],
    freshness: { last_observed_at: lastObserved, age_hours: null },
    observations,
  };
}

function bandFromMeasuredCount(count: number, total: number): ConfidenceBand {
  if (count === 0) return 'low';
  if (count >= Math.ceil(total * 0.6)) return 'high';
  if (count >= Math.ceil(total * 0.25)) return 'medium';
  return 'low';
}

function buildAggregateCanonicalScore(cells: AICitationMatrixCell[]): CanonicalScore {
  const measured = cells.filter((cell) => cell.state === 'measured' && cell.citation_rate != null);
  if (measured.length === 0) {
    return {
      value: null,
      state: 'insufficient_signal',
      confidence: 'low',
      band: 'insufficient',
      evidence: unavailableEvidence('No AI provider has returned measurements yet.'),
      benchmark: { value: null, label: null },
    };
  }
  const value = Math.round(
    100 *
      measured.reduce((sum, cell) => sum + (cell.citation_rate ?? 0) * (cell.mean_prominence ?? 1), 0) /
      measured.length,
  );
  const evidence = mergeEvidence(cells.map((c) => c.evidence));
  return {
    value,
    state: measured.length === cells.length ? 'measured' : 'inferred',
    confidence: bandFromMeasuredCount(measured.length, cells.length),
    band: value >= 75 ? 'leading' : value >= 50 ? 'operational' : value >= 25 ? 'developing' : 'foundational',
    evidence,
    benchmark: { value: null, label: null },
  };
}

function summarizeAxis<K extends string>(
  cells: AICitationMatrixCell[],
  groupKey: keyof AICitationMatrixCell,
  groupValues: readonly K[],
): Array<{
  [P in keyof Pick<AICitationMatrixCell, 'state' | 'citation_rate' | 'mean_prominence'>]: AICitationMatrixCell[P];
} & { [G in typeof groupKey & string]: K }> {
  return groupValues.map((groupValue) => {
    const slice = cells.filter((cell) => cell[groupKey] === groupValue && cell.state === 'measured');
    if (slice.length === 0) {
      return {
        [groupKey]: groupValue,
        state: 'unavailable',
        citation_rate: null,
        mean_prominence: null,
      } as any;
    }
    const citationRate = slice.reduce((sum, c) => sum + (c.citation_rate ?? 0), 0) / slice.length;
    const meanProminence = slice.reduce((sum, c) => sum + (c.mean_prominence ?? 0), 0) / slice.length;
    return {
      [groupKey]: groupValue,
      state: 'measured',
      citation_rate: Number(citationRate.toFixed(3)),
      mean_prominence: Number(meanProminence.toFixed(3)),
    } as any;
  });
}

function citationMentionFromResult(result: AIVisibilityProbeResult): CitationMention[] {
  return result.mentions;
}

export async function buildAICitationMatrix(
  input: CitationMatrixInput,
  providers?: LLMVisibilityProvider[],
): Promise<AICitationMatrix> {
  const activeProviders = providers ?? getAllLLMProviders();
  const cells: AICitationMatrixCell[] = [];
  // D2 — the subject of the whole matrix, decided once, by the same seam the
  // adapters use. Whitespace-only input is not identity.
  const identity = resolveProbeIdentity(input);
  const run = planObservationRun({ requested: input.runsPerQuery, providers: activeProviders, queries: input.queries, scanId: getActiveScanId() });
  const knownCompetitors = (input.knownCompetitors ?? []).filter((c) => (c?.name ?? '').trim().length > 0);
  // Phase B — grounded-first ONLY when N > 1; at N = 1 the P0 order is kept.
  const probeOrder = run.grounded_first
    ? [...activeProviders.filter((p) => p.retrieval_grounded), ...activeProviders.filter((p) => !p.retrieval_grounded)]
    : activeProviders;

  for (const provider of probeOrder) {
    for (const queryClass of AI_QUERY_CLASSES) {
      const queries = input.queries[queryClass] ?? [];
      const result = await provider.probe({
        provider: provider.id,
        query_class: queryClass,
        queries,
        // Phase B — added only when they carry information, so the default probe
        // object is exactly P0's.
        ...(run.runs_effective > 1 && provider.retrieval_grounded ? { runs_per_query: run.runs_effective } : {}),
        ...(knownCompetitors.length > 0 ? { known_competitors: knownCompetitors } : {}),
        // D2 — THE DEFECT, FIXED. This producer received `{ brandName, domain }`
        // and forwarded neither, so both adapters fell back to `''` / `null`,
        // `extractCitation` built an empty candidate set, and every mention came
        // back `appeared: false`. The first grounded run would therefore have
        // published `citation_rate: 0` in state `measured` for every cell — a
        // false measured zero, stamped `answer_engine`, about a company the
        // probes never actually named.
        brandName: identity.brandName.length > 0 ? identity.brandName : null,
        domain: identity.domain,
      });
      cells.push({
        provider: provider.id,
        query_class: queryClass,
        state: result.state,
        observation_outcome: result.observation_outcome,
        // D2 — a fixed property of the ADAPTER, read from the provider rather
        // than inferred from its answer, exactly as the D1 rule requires.
        structurally_unmeasurable: !provider.retrieval_grounded,
        citation_rate: result.citation_rate,
        mean_prominence: result.mean_prominence,
        observed_count: citationMentionFromResult(result).filter((m) => m.appeared).length,
        evidence: result.evidence,
        reason_unavailable: result.reason_unavailable,
        ...(Array.isArray(result.observations) ? { observations: result.observations } : {}),
      });
    }
  }
  // Phase B — cells are always reported in the enumerated provider order, even
  // when grounded providers were probed first.
  if (run.grounded_first) {
    const rank = new Map(activeProviders.map((p, i) => [p.id, i]));
    const classRank = new Map(AI_QUERY_CLASSES.map((c, i) => [c, i]));
    cells.sort((a, b) => (rank.get(a.provider)! - rank.get(b.provider)!) || (classRank.get(a.query_class)! - classRank.get(b.query_class)!));
  }

  const overallScore = buildAggregateCanonicalScore(cells);

  const byProvider = AI_PROVIDERS.map((provider) => {
    const slice = cells.filter((c) => c.provider === provider && c.state === 'measured');
    if (slice.length === 0) {
      return {
        provider,
        state: 'unavailable' as ScoreState,
        citation_rate: null,
        mean_prominence: null,
      };
    }
    return {
      provider,
      state: 'measured' as ScoreState,
      citation_rate: Number((slice.reduce((s, c) => s + (c.citation_rate ?? 0), 0) / slice.length).toFixed(3)),
      mean_prominence: Number((slice.reduce((s, c) => s + (c.mean_prominence ?? 0), 0) / slice.length).toFixed(3)),
    };
  });

  const byQueryClass = AI_QUERY_CLASSES.map((queryClass) => {
    const slice = cells.filter((c) => c.query_class === queryClass && c.state === 'measured');
    if (slice.length === 0) {
      return {
        query_class: queryClass,
        state: 'unavailable' as ScoreState,
        citation_rate: null,
        mean_prominence: null,
      };
    }
    return {
      query_class: queryClass,
      state: 'measured' as ScoreState,
      citation_rate: Number((slice.reduce((s, c) => s + (c.citation_rate ?? 0), 0) / slice.length).toFixed(3)),
      mean_prominence: Number((slice.reduce((s, c) => s + (c.mean_prominence ?? 0), 0) / slice.length).toFixed(3)),
    };
  });

  return {
    cells,
    overall_score: overallScore,
    by_provider: byProvider,
    by_query_class: byQueryClass,
    identity: {
      brand_name: identity.brandName.length > 0 ? identity.brandName : null,
      domain: identity.domain,
      resolved: identity.resolved,
    },
    coverage: {
      measured_cells: cells.filter((c) => c.state === 'measured').length,
      unavailable_cells: cells.filter((c) => c.state === 'unavailable').length,
      // Preserved exactly: the enumerated grid every existing consumer reads.
      total_cells: cells.length,
      // D2 — the honest denominator. With no subject NOTHING is measurable, so
      // identity gates this too: a matrix with no company attached must not
      // report a coverage percentage of any kind.
      measurable_cells: identity.resolved
        ? cells.filter((c) => !c.structurally_unmeasurable).length
        : 0,
      structurally_unmeasurable_cells: identity.resolved
        ? cells.filter((c) => c.structurally_unmeasurable).length
        : cells.length,
    },
    observation_run: run,
    known_competitors: knownCompetitors,
  };
}

// ── Query-set generator ──────────────────────────────────────────────────────
//
// Derives the query set per class from the brand context. No synthetic queries
// are added — when a context field is missing, that class returns an empty list
// (and every cell for that class will return state='unavailable' anyway).

export function deriveCitationQueries(params: {
  brandName: string | null;
  domain: string | null;
  category: string | null;
  competitors: string[];
  productServices: string[];
}): Partial<Record<AIQueryClass, string[]>> {
  const queries: Partial<Record<AIQueryClass, string[]>> = {};
  if (params.brandName) {
    queries.branded = [
      `What is ${params.brandName}?`,
      `Tell me about ${params.brandName}.`,
      `Who founded ${params.brandName}?`,
    ];
  }
  if (params.category) {
    queries.category = [
      `What are the best ${params.category} solutions?`,
      `Top ${params.category} companies in 2026.`,
      `How do I choose a ${params.category} provider?`,
    ];
  }
  if (params.competitors.length > 0 && params.brandName) {
    queries.competitive = params.competitors.slice(0, 3).map(
      (competitor) => `Compare ${params.brandName} vs ${competitor}.`,
    );
  }
  // D2 — the `expertise` class REQUIRES the brand label. It used to fall back to
  // "What expertise does this company bring to X?", a question that names nobody:
  // whatever an engine answered, the reply could not be scored for or against
  // this company, yet the cell would still have carried a citation rate. An
  // un-askable class is honestly `no_queries` instead.
  if (params.productServices.length > 0 && params.brandName) {
    queries.expertise = params.productServices.slice(0, 3).map(
      (service) => `What expertise does ${params.brandName} bring to ${service}?`,
    );
  }
  return queries;
}
