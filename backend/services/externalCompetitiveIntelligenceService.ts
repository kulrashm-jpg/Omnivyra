import { createHash } from 'crypto';
import { ownedDbTable } from '../db/writeOwner';
import { assertAnalyticsMutationAllowed } from './analyticsEnvironmentGuardService';
import type { GscSeoIntelligence } from './gscSeoIntelligenceService';

export type CompetitorDomainRecord = {
  id?: string;
  company_id: string;
  domain: string;
  label: string | null;
  source: 'manual' | 'market_intelligence' | 'serp_observed';
  confidence: 'high' | 'medium' | 'low';
  relevance_score?: number | null;
  evidence?: Record<string, unknown>;
  active: boolean;
};

export type SerpResultInput = {
  position: number;
  url: string;
  domain: string;
  title?: string | null;
  result_type?: 'organic' | 'featured_snippet' | 'paid' | 'other';
};

export type SerpSnapshotInput = {
  companyId: string;
  query: string;
  geography?: string | null;
  device?: string | null;
  provider?: 'manual_import' | 'compliant_api' | 'dataforseo' | 'serpapi' | 'scaleserp' | 'synthetic_validation';
  capturedAt?: string;
  results: SerpResultInput[];
  provenance?: Record<string, unknown>;
};

export type ExternalCompetitiveSignal = {
  type: 'keyword_gap' | 'domain_overlap' | 'serp_opportunity' | 'search_share' | 'authority_gap' | 'landing_page_gap';
  title: string;
  score: number;
  confidence: 'high' | 'medium' | 'low' | 'none';
  evidence: Record<string, unknown>;
  provenance: 'external_serp_warehouse' | 'canonical_gsc_only' | 'insufficient_external_data';
};

export type ExternalCompetitiveIntelligence = {
  status: 'ready' | 'limited' | 'unavailable';
  summary: string;
  freshness: {
    latest_serp_snapshot_at: string | null;
    serp_snapshot_count: number;
    competitor_domain_count: number;
  };
  signals: ExternalCompetitiveSignal[];
};

type SerpRow = {
  query: string | null;
  captured_at: string | null;
  position: number | null;
  domain: string | null;
  url: string | null;
  result_type: string | null;
};

function normalizeDomain(value: string): string {
  return value.toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0].trim();
}

function snapshotFingerprint(input: SerpSnapshotInput): string {
  return createHash('sha256').update(JSON.stringify({
    companyId: input.companyId,
    query: input.query.trim().toLowerCase(),
    geography: input.geography ?? 'global',
    device: input.device ?? 'desktop',
    results: input.results.map((row) => ({ position: row.position, domain: normalizeDomain(row.domain), url: row.url })),
  })).digest('hex');
}

function confidenceFor(count: number): ExternalCompetitiveSignal['confidence'] {
  if (count >= 10) return 'high';
  if (count >= 3) return 'medium';
  if (count > 0) return 'low';
  return 'none';
}

export async function upsertCompetitorDomain(input: CompetitorDomainRecord): Promise<void> {
  assertAnalyticsMutationAllowed('competitor_bootstrap');
  await ownedDbTable('analytics_competitor_domains').upsert({
    company_id: input.company_id,
    domain: normalizeDomain(input.domain),
    label: input.label,
    source: input.source,
    confidence: input.confidence,
    relevance_score: input.relevance_score ?? null,
    evidence: input.evidence ?? {},
    last_discovered_at: new Date().toISOString(),
    active: input.active,
  }, { onConflict: 'company_id,domain' });
}

export async function ingestSerpSnapshot(input: SerpSnapshotInput): Promise<{ snapshot_id: string | null; result_count: number; deduped: boolean }> {
  assertAnalyticsMutationAllowed('serp_acquisition');
  const fingerprint = snapshotFingerprint(input);
  const capturedAt = input.capturedAt ?? new Date().toISOString();
  const snapshot = await ownedDbTable('analytics_serp_snapshots')
    .upsert({
      company_id: input.companyId,
      query: input.query.trim(),
      geography: input.geography ?? 'global',
      device: input.device ?? 'desktop',
      provider: input.provider ?? 'manual_import',
      captured_at: capturedAt,
      fingerprint,
      provenance: {
        source: input.provider ?? 'manual_import',
        fabricated: false,
        ...(input.provenance ?? {}),
      },
    }, { onConflict: 'company_id,fingerprint' })
    .select('id')
    .maybeSingle();

  if (snapshot.error) throw new Error(`Failed to upsert SERP snapshot: ${snapshot.error.message}`);
  const snapshotId = snapshot.data?.id ?? null;
  if (!snapshotId || input.results.length === 0) return { snapshot_id: snapshotId, result_count: 0, deduped: true };

  const rows = input.results
    .filter((row) => row.position > 0 && row.url && row.domain)
    .slice(0, 50)
    .map((row) => ({
      snapshot_id: snapshotId,
      company_id: input.companyId,
      query: input.query.trim(),
      captured_at: capturedAt,
      position: row.position,
      url: row.url,
      domain: normalizeDomain(row.domain),
      title: row.title ?? null,
      result_type: row.result_type ?? 'organic',
    }));

  const result = await ownedDbTable('analytics_serp_results')
    .upsert(rows, { onConflict: 'snapshot_id,position,domain,url' });
  if (result.error) throw new Error(`Failed to upsert SERP results: ${result.error.message}`);

  return { snapshot_id: snapshotId, result_count: rows.length, deduped: false };
}

export async function buildExternalCompetitiveIntelligence(params: {
  companyId: string;
  gsc: GscSeoIntelligence | null;
}): Promise<ExternalCompetitiveIntelligence> {
  const [competitors, serp] = await Promise.all([
    ownedDbTable('analytics_competitor_domains')
      .select('domain, confidence, active')
      .eq('company_id', params.companyId)
      .eq('active', true)
      .limit(100),
    ownedDbTable('analytics_serp_results')
      .select('query, captured_at, position, domain, url, result_type')
      .eq('company_id', params.companyId)
      .order('captured_at', { ascending: false })
      .limit(1000),
  ]);

  const competitorDomains = new Set(((competitors.data ?? []) as Array<{ domain: string | null }>).map((row) => normalizeDomain(String(row.domain ?? ''))).filter(Boolean));
  const rows = (serp.data ?? []) as SerpRow[];
  const latest = rows.map((row) => row.captured_at).filter(Boolean).sort().at(-1) ?? null;

  if (!rows.length || competitorDomains.size === 0) {
    const gscQueries = params.gsc?.top_queries ?? [];
    return {
      status: gscQueries.length ? 'limited' : 'unavailable',
      summary: 'External SERP warehouse has insufficient competitor observations; only canonical GSC evidence can be used.',
      freshness: {
        latest_serp_snapshot_at: latest,
        serp_snapshot_count: new Set(rows.map((row) => `${row.query}|${row.captured_at}`)).size,
        competitor_domain_count: competitorDomains.size,
      },
      signals: gscQueries.slice(0, 3).map((query) => ({
        type: 'keyword_gap',
        title: `External validation needed for query: ${query.query}`,
        score: query.opportunity_score,
        confidence: 'low',
        evidence: {
          query: query.query,
          impressions: query.impressions,
          avg_position: query.avg_position,
          external_serp_rows: rows.length,
        },
        provenance: 'canonical_gsc_only',
      })),
    };
  }

  const competitorRows = rows.filter((row) => competitorDomains.has(normalizeDomain(String(row.domain ?? ''))));
  const ownedRows = rows.filter((row) => /omnivyra\.com$/i.test(normalizeDomain(String(row.domain ?? ''))));
  const queryCount = new Set(rows.map((row) => row.query).filter(Boolean)).size;
  const competitorTopTen = competitorRows.filter((row) => Number(row.position ?? 99) <= 10).length;
  const ownedTopTen = ownedRows.filter((row) => Number(row.position ?? 99) <= 10).length;
  const shareScore = Math.round((ownedTopTen / Math.max(1, ownedTopTen + competitorTopTen)) * 100);

  const signals: ExternalCompetitiveSignal[] = [{
    type: 'search_share',
    title: 'Observed SERP search-share benchmark',
    score: shareScore,
    confidence: confidenceFor(queryCount),
    evidence: {
      observed_queries: queryCount,
      owned_top_10_results: ownedTopTen,
      competitor_top_10_results: competitorTopTen,
      competitor_domains: competitorDomains.size,
    },
    provenance: 'external_serp_warehouse',
  }];

  for (const row of competitorRows.filter((item) => Number(item.position ?? 99) <= 10).slice(0, 8)) {
    signals.push({
      type: 'serp_opportunity',
      title: `Competitor ranking observed for ${row.query}`,
      score: Math.max(35, 100 - Number(row.position ?? 50) * 6),
      confidence: confidenceFor(queryCount),
      evidence: {
        query: row.query,
        competitor_domain: row.domain,
        position: row.position,
        url: row.url,
        captured_at: row.captured_at,
      },
      provenance: 'external_serp_warehouse',
    });
  }

  return {
    status: 'ready',
    summary: 'External competitive intelligence is based on canonical SERP warehouse observations.',
    freshness: {
      latest_serp_snapshot_at: latest,
      serp_snapshot_count: new Set(rows.map((row) => `${row.query}|${row.captured_at}`)).size,
      competitor_domain_count: competitorDomains.size,
    },
    signals: signals.sort((a, b) => b.score - a.score).slice(0, 12),
  };
}
