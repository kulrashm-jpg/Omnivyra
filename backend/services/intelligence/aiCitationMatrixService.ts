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
import { getAllLLMProviders } from './providerRegistry';
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
  citation_rate: number | null;
  mean_prominence: number | null;
  observed_count: number;
  evidence: EvidenceTrace;
  reason_unavailable: string | null;
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
  // Surface-level summary: how many cells are measured vs. unavailable.
  coverage: { measured_cells: number; unavailable_cells: number; total_cells: number };
};

export type CitationMatrixInput = {
  brandName: string | null;
  domain: string | null;
  queries: Partial<Record<AIQueryClass, string[]>>;
};

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

  for (const provider of activeProviders) {
    for (const queryClass of AI_QUERY_CLASSES) {
      const queries = input.queries[queryClass] ?? [];
      const result = await provider.probe({
        provider: provider.id,
        query_class: queryClass,
        queries,
      });
      cells.push({
        provider: provider.id,
        query_class: queryClass,
        state: result.state,
        citation_rate: result.citation_rate,
        mean_prominence: result.mean_prominence,
        observed_count: citationMentionFromResult(result).filter((m) => m.appeared).length,
        evidence: result.evidence,
        reason_unavailable: result.reason_unavailable,
      });
    }
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
    coverage: {
      measured_cells: cells.filter((c) => c.state === 'measured').length,
      unavailable_cells: cells.filter((c) => c.state === 'unavailable').length,
      total_cells: cells.length,
    },
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
  if (params.productServices.length > 0) {
    queries.expertise = params.productServices.slice(0, 3).map(
      (service) => `What expertise does ${params.brandName ?? 'this company'} bring to ${service}?`,
    );
  }
  return queries;
}
