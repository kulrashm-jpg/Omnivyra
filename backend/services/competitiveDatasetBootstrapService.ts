import {
  buildCandidatesFromNames,
  extractCompetitiveContextFromProfile,
  getFinalCompetitors,
  splitCompetitorNames,
} from './competitorEngineService';
import { getProfile } from './companyProfileService';
import {
  upsertCompetitorDomain,
  type CompetitorDomainRecord,
} from './externalCompetitiveIntelligenceService';
import type { GscSeoIntelligence } from './gscSeoIntelligenceService';

export type CompetitorBootstrapCandidate = {
  domain: string;
  label: string;
  source: CompetitorDomainRecord['source'];
  confidence: CompetitorDomainRecord['confidence'];
  relevance_score: number;
  evidence: Record<string, unknown>;
};

export type CompetitorBootstrapResult = {
  status: 'ready' | 'limited' | 'skipped' | 'failed';
  persisted: CompetitorBootstrapCandidate[];
  suppressed: Array<{
    label: string;
    reason: string;
    evidence?: Record<string, unknown>;
  }>;
  errors: string[];
};

function normalizeDomain(value: string): string {
  return value.toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0].trim();
}

function isLikelyDomain(value: string): boolean {
  return /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(normalizeDomain(value));
}

function readProfileCompetitors(profile: any): string[] {
  return [
    ...splitCompetitorNames(profile?.competitors),
    ...splitCompetitorNames(profile?.competitors_list),
    ...splitCompetitorNames(profile?.report_settings?.default_inputs?.competitors),
    ...splitCompetitorNames(profile?.report_settings?.market_pulse?.named_competitors),
  ];
}

function configuredCompetitors(): string[] {
  return String(process.env.COMPETITOR_BOOTSTRAP_DOMAINS ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

function confidenceFor(score: number): CompetitorDomainRecord['confidence'] {
  if (score >= 82) return 'high';
  if (score >= 65) return 'medium';
  return 'low';
}

function gscEvidence(gsc: GscSeoIntelligence | null): Record<string, unknown> {
  const nonBranded = (gsc?.top_queries ?? []).filter((query) => query.classification !== 'branded');
  return {
    top_nonbranded_queries: nonBranded.slice(0, 5).map((query) => ({
      query: query.query,
      impressions: query.impressions,
      clicks: query.clicks,
      avg_position: query.avg_position,
      opportunity_score: query.opportunity_score,
    })),
    nonbranded_query_count: nonBranded.length,
  };
}

function candidateKey(candidate: CompetitorBootstrapCandidate): string {
  return normalizeDomain(candidate.domain);
}

export async function bootstrapCompetitorDataset(params: {
  companyId: string;
  gsc: GscSeoIntelligence | null;
}): Promise<CompetitorBootstrapResult> {
  const profile = await getProfile(params.companyId).catch(() => null);
  const suppressed: CompetitorBootstrapResult['suppressed'] = [];
  const errors: string[] = [];
  if (!profile) {
    return {
      status: 'skipped',
      persisted: [],
      suppressed: [{ label: params.companyId, reason: 'Company profile unavailable; no competitor source evidence to bootstrap.' }],
      errors,
    };
  }

  const context = extractCompetitiveContextFromProfile(profile);
  const profileCompetitors = readProfileCompetitors(profile);
  const explicitDomainCandidates = [...profileCompetitors, ...configuredCompetitors()]
    .filter(isLikelyDomain)
    .map((domain): CompetitorBootstrapCandidate => ({
      domain: normalizeDomain(domain),
      label: normalizeDomain(domain),
      source: configuredCompetitors().some((entry) => normalizeDomain(entry) === normalizeDomain(domain)) ? 'manual' : 'market_intelligence',
      confidence: 'medium',
      relevance_score: 68,
      evidence: {
        source: 'profile_or_environment_domain',
        profile_competitor_present: profileCompetitors.some((entry) => normalizeDomain(entry) === normalizeDomain(domain)),
        configured_competitor_present: configuredCompetitors().some((entry) => normalizeDomain(entry) === normalizeDomain(domain)),
        ...gscEvidence(params.gsc),
      },
    }));

  const ranked = await getFinalCompetitors({
    candidates: buildCandidatesFromNames(profileCompetitors, 'profile_ai'),
    context,
    max: 10,
    minScore: 55,
    useNetwork: false,
    useStoredCache: true,
    companyId: params.companyId,
    includeMarketSubstitutes: true,
  }).catch((error) => {
    errors.push(error instanceof Error ? error.message : String(error));
    return [];
  });

  const rankedDomainCandidates: CompetitorBootstrapCandidate[] = ranked.flatMap((row) => {
    if (!row.domain) {
      suppressed.push({
        label: row.name,
        reason: 'Ranked competitor did not include a verified domain; domain was not inferred.',
        evidence: {
          source: row.source,
          final_score: row.final_score,
          classification: row.classification,
        },
      });
      return [];
    }
    const confidence = confidenceFor(row.final_score);
    if (confidence === 'low') {
      suppressed.push({
        label: row.name,
        reason: 'Competitor relevance below medium-confidence persistence threshold.',
        evidence: {
          domain: row.domain,
          final_score: row.final_score,
        },
      });
      return [];
    }
    return [{
      domain: normalizeDomain(row.domain),
      label: row.name,
      source: 'market_intelligence' as const,
      confidence,
      relevance_score: row.final_score,
      evidence: {
        source: row.source,
        classification: row.classification,
        problem_overlap: row.problem_overlap,
        market_overlap: row.market_overlap,
        authority_score: row.authority_score,
        final_score: row.final_score,
        rationale: row.rationale,
        ...gscEvidence(params.gsc),
      },
    }];
  });

  for (const name of profileCompetitors.filter((entry) => !isLikelyDomain(entry))) {
    suppressed.push({
      label: name,
      reason: 'Named competitor was available, but no verified domain was present; persistence requires domain evidence.',
    });
  }

  const deduped = new Map<string, CompetitorBootstrapCandidate>();
  for (const candidate of [...explicitDomainCandidates, ...rankedDomainCandidates]) {
    const key = candidateKey(candidate);
    const current = deduped.get(key);
    if (!current || candidate.relevance_score > current.relevance_score) deduped.set(key, candidate);
  }

  const persisted: CompetitorBootstrapCandidate[] = [];
  for (const candidate of deduped.values()) {
    try {
      await upsertCompetitorDomain({
        company_id: params.companyId,
        domain: candidate.domain,
        label: candidate.label,
        source: candidate.source,
        confidence: candidate.confidence,
        relevance_score: candidate.relevance_score,
        evidence: candidate.evidence,
        active: true,
      });
      persisted.push(candidate);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  return {
    status: persisted.length ? 'ready' : errors.length ? 'failed' : suppressed.length ? 'limited' : 'skipped',
    persisted,
    suppressed: suppressed.slice(0, 20),
    errors: errors.slice(0, 5),
  };
}
