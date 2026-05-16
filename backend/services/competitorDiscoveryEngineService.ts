import {
  buildCandidatesFromNames,
  extractCompetitiveContextFromProfile,
  getFinalCompetitors,
  splitCompetitorNames,
  type RankedCompetitor,
} from './competitorEngineService';
import { getProfile } from './companyProfileService';
import { upsertCompetitorDomain } from './externalCompetitiveIntelligenceService';
import type { GscSeoIntelligence } from './gscSeoIntelligenceService';

export type DiscoveredCompetitorDomain = {
  domain: string;
  label: string;
  relevance_score: number;
  confidence: 'high' | 'medium' | 'low';
  evidence: Record<string, unknown>;
};

export type CompetitorDiscoveryResult = {
  status: 'ready' | 'limited' | 'unavailable';
  discovered: DiscoveredCompetitorDomain[];
  suppressed: number;
};

function readProfileCompetitors(profile: any): string[] {
  return [
    ...splitCompetitorNames(profile?.competitors),
    ...splitCompetitorNames(profile?.competitors_list),
    ...splitCompetitorNames(profile?.report_settings?.default_inputs?.competitors),
    ...splitCompetitorNames(profile?.report_settings?.market_pulse?.named_competitors),
  ];
}

function confidenceFor(score: number): 'high' | 'medium' | 'low' {
  if (score >= 82) return 'high';
  if (score >= 65) return 'medium';
  return 'low';
}

function toDiscovery(row: RankedCompetitor, gsc: GscSeoIntelligence | null): DiscoveredCompetitorDomain | null {
  if (!row.domain || row.final_score < 55) return null;
  const nonBrandedQueries = (gsc?.top_queries ?? []).filter((query) => query.classification !== 'branded');
  return {
    domain: row.domain,
    label: row.name,
    relevance_score: row.final_score,
    confidence: confidenceFor(row.final_score),
    evidence: {
      source: row.source,
      classification: row.classification,
      final_score: row.final_score,
      problem_overlap: row.problem_overlap,
      market_overlap: row.market_overlap,
      authority_score: row.authority_score,
      observed_nonbranded_query_count: nonBrandedQueries.length,
      rationale: row.rationale,
    },
  };
}

export async function discoverAndPersistCompetitorDomains(params: {
  companyId: string;
  gsc: GscSeoIntelligence | null;
}): Promise<CompetitorDiscoveryResult> {
  const profile = await getProfile(params.companyId).catch(() => null);
  if (!profile) return { status: 'unavailable', discovered: [], suppressed: 0 };

  const context = extractCompetitiveContextFromProfile(profile);
  const profileNames = readProfileCompetitors(profile);
  const queryCandidates = (params.gsc?.top_queries ?? [])
    .filter((query) => query.classification === 'commercial' && query.impressions >= 10)
    .map((query) => query.query);
  const candidates = buildCandidatesFromNames([...profileNames, ...queryCandidates], 'profile_ai');

  const ranked = await getFinalCompetitors({
    candidates,
    context,
    max: 8,
    minScore: 55,
    useNetwork: false,
    useStoredCache: true,
    companyId: params.companyId,
    includeMarketSubstitutes: true,
  }).catch(() => []);

  const discovered = ranked
    .map((row) => toDiscovery(row, params.gsc))
    .filter((row): row is DiscoveredCompetitorDomain => Boolean(row && row.confidence !== 'low'))
    .slice(0, 10);

  await Promise.all(discovered.map((row) => upsertCompetitorDomain({
    company_id: params.companyId,
    domain: row.domain,
    label: row.label,
    source: 'market_intelligence',
    confidence: row.confidence,
    relevance_score: row.relevance_score,
    evidence: row.evidence,
    active: true,
  }).catch(() => undefined)));

  return {
    status: discovered.length ? 'ready' : ranked.length ? 'limited' : 'unavailable',
    discovered,
    suppressed: Math.max(0, ranked.length - discovered.length),
  };
}
