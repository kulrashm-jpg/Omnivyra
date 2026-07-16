import { ownedDbTable } from '../db/writeOwner';
import { splitToList, type CompanyProfile } from './companyProfileService';
import { getCanonicalProfile as getProfile } from '@/backend/services/context/canonicalProfileAdapter';
import type { GscSeoIntelligence } from './gscSeoIntelligenceService';

export type UnifiedCompetitor = {
  name: string;
  domain: string | null;
  sources: Array<'company_profile' | 'market_engine' | 'serp_observed' | 'growth_market'>;
  confidence: 'high' | 'medium' | 'low';
  freshness: 'fresh' | 'aging' | 'stale' | 'unverified';
  latest_evidence_at: string | null;
  scores: {
    visibility_share: number;
    authority_gap: number;
    topic_dominance: number;
    search_intent_competition: number;
    commercial_overlap: number;
    discoverability_threat: number;
    growth_momentum: number;
    strategic_priority: number;
  };
  evidence_refs: string[];
  evidence: Record<string, unknown>;
};

export type CompetitorOpportunity = {
  id: string;
  type:
    | 'visibility_capture'
    | 'authority_gap'
    | 'content_gap'
    | 'search_territory_expansion'
    | 'organic_acquisition'
    | 'competitor_weakness';
  title: string;
  competitor_domain: string | null;
  priority_score: number;
  confidence: 'high' | 'medium' | 'low';
  recommendation: string;
  evidence_refs: string[];
  evidence: Record<string, unknown>;
};

export type UnifiedCompetitorIntelligence = {
  status: 'ready' | 'limited' | 'unavailable';
  generated_at: string;
  summary: string;
  competitors: UnifiedCompetitor[];
  opportunities: CompetitorOpportunity[];
  quality: {
    total_candidates: number;
    suppressed_low_confidence: number;
    stale_suppressed: number;
    duplicate_domains_consolidated: number;
    serp_evidence_rows: number;
  };
};

type SerpRow = {
  query: string | null;
  captured_at: string | null;
  position: number | null;
  domain: string | null;
  url: string | null;
  title: string | null;
};

type CompetitorDomainRow = {
  domain: string | null;
  label: string | null;
  source: string | null;
  confidence: string | null;
  relevance_score: number | null;
  evidence: Record<string, unknown> | null;
  last_discovered_at: string | null;
};

function normalizeDomain(value: unknown): string | null {
  const text = String(value ?? '').toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0].trim();
  return /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(text) ? text : null;
}

function normalizeName(value: unknown): string | null {
  const text = String(value ?? '').trim();
  return text.length ? text : null;
}

function clamp(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function confidenceFrom(score: number, evidenceRows: number): 'high' | 'medium' | 'low' {
  if (score >= 75 && evidenceRows >= 3) return 'high';
  if (score >= 50 || evidenceRows > 0) return 'medium';
  return 'low';
}

function freshness(latest: string | null): UnifiedCompetitor['freshness'] {
  if (!latest) return 'unverified';
  const ageDays = (Date.now() - new Date(latest).getTime()) / 86_400_000;
  if (ageDays <= 14) return 'fresh';
  if (ageDays <= 45) return 'aging';
  return 'stale';
}

function profileCompetitorNames(profile: CompanyProfile | null): string[] {
  return Array.from(new Set([
    ...(Array.isArray(profile?.competitors_list) ? profile?.competitors_list ?? [] : []),
    ...splitToList(profile?.competitors),
    ...(profile?.report_settings?.market_pulse?.named_competitors ?? []),
    ...(profile?.report_settings?.market_pulse?.competitor_details ?? []).map((row) => row.name),
  ].map((value) => String(value ?? '').trim()).filter(Boolean)));
}

function isOwnedDomain(domain: string | null): boolean {
  return Boolean(domain && /(^|\.)omnivyra\.com$/i.test(domain));
}

function queryCommercialScore(query: string): number {
  return /(pricing|price|cost|software|platform|tool|agency|service|alternative|competitor|best|vendor|solution)/i.test(query)
    ? 100
    : /(how|what|guide|example|template)/i.test(query)
      ? 45
      : 60;
}

function topicKey(query: string): string {
  return query.toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').split(/\s+/).filter(Boolean).slice(0, 3).join(' ');
}

export async function buildUnifiedCompetitorIntelligence(params: {
  companyId: string;
  profile?: CompanyProfile | null;
  gsc?: GscSeoIntelligence | null;
}): Promise<UnifiedCompetitorIntelligence> {
  const profile = params.profile ?? await getProfile(params.companyId, { autoRefine: false, languageRefine: false }).catch(() => null);
  const [domainRes, serpRes] = await Promise.all([
    ownedDbTable('analytics_competitor_domains')
      .select('domain, label, source, confidence, relevance_score, evidence, last_discovered_at')
      .eq('company_id', params.companyId)
      .eq('active', true)
      .limit(200),
    ownedDbTable('analytics_serp_results')
      .select('query, captured_at, position, domain, url, title')
      .eq('company_id', params.companyId)
      .order('captured_at', { ascending: false })
      .limit(1500),
  ]);

  const domainRows = (domainRes.data ?? []) as CompetitorDomainRow[];
  const serpRows = ((serpRes.data ?? []) as SerpRow[])
    .filter((row) => !isOwnedDomain(normalizeDomain(row.domain)));
  const profileNames = profileCompetitorNames(profile);

  const byKey = new Map<string, {
    name: string;
    domain: string | null;
    sources: Set<UnifiedCompetitor['sources'][number]>;
    relevance: number;
    profileOnly: boolean;
  }>();

  for (const name of profileNames) {
    const domain = normalizeDomain(name);
    const key = domain ?? name.toLowerCase();
    byKey.set(key, {
      name: domain ? domain : name,
      domain,
      sources: new Set(['company_profile']),
      relevance: 55,
      profileOnly: !domain,
    });
  }

  for (const row of domainRows) {
    const domain = normalizeDomain(row.domain);
    if (!domain || isOwnedDomain(domain)) continue;
    const existing = byKey.get(domain);
    const source = row.source === 'serp_observed' ? 'serp_observed' : 'market_engine';
    byKey.set(domain, {
      name: normalizeName(row.label) ?? domain,
      domain,
      sources: new Set([...(existing?.sources ?? []), source]),
      relevance: Math.max(existing?.relevance ?? 0, Number(row.relevance_score ?? 50)),
      profileOnly: false,
    });
  }

  const serpByDomain = new Map<string, SerpRow[]>();
  for (const row of serpRows) {
    const domain = normalizeDomain(row.domain);
    if (!domain) continue;
    const current = serpByDomain.get(domain) ?? [];
    current.push(row);
    serpByDomain.set(domain, current);
    if (!byKey.has(domain) && Number(row.position ?? 99) <= 10) {
      byKey.set(domain, {
        name: domain,
        domain,
        sources: new Set(['serp_observed']),
        relevance: Math.max(55, 95 - Number(row.position ?? 10) * 4),
        profileOnly: false,
      });
    }
  }

  let suppressed = 0;
  let staleSuppressed = 0;
  const competitors = [...byKey.values()].flatMap((candidate): UnifiedCompetitor[] => {
    const rows = candidate.domain ? serpByDomain.get(candidate.domain) ?? [] : [];
    const latest = rows.map((row) => row.captured_at).filter(Boolean).sort().at(-1) ?? null;
    const state = freshness(latest);
    if (state === 'stale' && !candidate.sources.has('company_profile')) {
      staleSuppressed += 1;
      return [];
    }
    const topTen = rows.filter((row) => Number(row.position ?? 99) <= 10);
    const topThree = rows.filter((row) => Number(row.position ?? 99) <= 3);
    const avgPosition = rows.length
      ? rows.reduce((sum, row) => sum + Number(row.position ?? 50), 0) / rows.length
      : 50;
    const queryCount = new Set(rows.map((row) => row.query).filter(Boolean)).size;
    const topicCount = new Set(rows.map((row) => topicKey(String(row.query ?? ''))).filter(Boolean)).size;
    const commercialOverlap = rows.length
      ? rows.reduce((sum, row) => sum + queryCommercialScore(String(row.query ?? '')), 0) / rows.length
      : candidate.profileOnly ? 20 : 35;
    const visibility = rows.length ? clamp((topTen.length / rows.length) * 85 + topThree.length * 4) : 0;
    const authorityGap = rows.length ? clamp(100 - avgPosition * 4 + topThree.length * 10) : clamp(candidate.relevance * 0.45);
    const topicDominance = rows.length ? clamp(topicCount * 12 + topTen.length * 6) : 0;
    const intentCompetition = rows.length ? clamp(commercialOverlap * 0.65 + queryCount * 8) : 0;
    const discoverabilityThreat = clamp(visibility * 0.45 + authorityGap * 0.3 + intentCompetition * 0.25);
    const growthMomentum = clamp((params.gsc?.rising_keywords.length ?? 0) * 5 + topTen.length * 5);
    const strategicPriority = clamp(candidate.relevance * 0.25 + discoverabilityThreat * 0.45 + commercialOverlap * 0.2 + growthMomentum * 0.1);
    const conf = confidenceFrom(strategicPriority, rows.length);
    if (conf === 'low' && !candidate.sources.has('company_profile')) {
      suppressed += 1;
      return [];
    }

    return [{
      name: candidate.name,
      domain: candidate.domain,
      sources: [...candidate.sources],
      confidence: conf,
      freshness: state,
      latest_evidence_at: latest,
      scores: {
        visibility_share: visibility,
        authority_gap: authorityGap,
        topic_dominance: topicDominance,
        search_intent_competition: intentCompetition,
        commercial_overlap: clamp(commercialOverlap),
        discoverability_threat: discoverabilityThreat,
        growth_momentum: growthMomentum,
        strategic_priority: strategicPriority,
      },
      evidence_refs: [
        ...(candidate.sources.has('company_profile') ? ['company_profile.competitors'] : []),
        ...(candidate.domain ? [`analytics_competitor_domains:${candidate.domain}`] : []),
        ...(rows.length ? [`analytics_serp_results:${candidate.domain}`] : []),
      ],
      evidence: {
        serp_rows: rows.length,
        top_10_results: topTen.length,
        top_3_results: topThree.length,
        avg_position: Number(avgPosition.toFixed(1)),
        query_count: queryCount,
        topic_count: topicCount,
        latest_seen_at: latest,
      },
    }];
  }).sort((a, b) => b.scores.strategic_priority - a.scores.strategic_priority).slice(0, 12);

  const opportunities: CompetitorOpportunity[] = competitors.flatMap((competitor) => {
    const items: CompetitorOpportunity[] = [];
    if (competitor.scores.discoverability_threat >= 60) {
      items.push({
        id: `visibility-capture:${competitor.domain ?? competitor.name}`,
        type: 'visibility_capture',
        title: `Capture visibility from ${competitor.name}`,
        competitor_domain: competitor.domain,
        priority_score: competitor.scores.discoverability_threat,
        confidence: competitor.confidence,
        recommendation: 'Prioritize pages and proof assets for the queries where this competitor is visibly outranking the brand.',
        evidence_refs: competitor.evidence_refs,
        evidence: competitor.evidence,
      });
    }
    if (competitor.scores.commercial_overlap >= 65) {
      items.push({
        id: `lead-gap:${competitor.domain ?? competitor.name}`,
        type: 'organic_acquisition',
        title: `High-intent lead acquisition gap vs ${competitor.name}`,
        competitor_domain: competitor.domain,
        priority_score: clamp(competitor.scores.commercial_overlap * 0.55 + competitor.scores.strategic_priority * 0.45),
        confidence: competitor.confidence,
        recommendation: 'Strengthen high-intent landing pages, comparisons, and conversion proof around overlapping commercial search territory.',
        evidence_refs: competitor.evidence_refs,
        evidence: competitor.evidence,
      });
    }
    if (competitor.scores.topic_dominance >= 55) {
      items.push({
        id: `topic-gap:${competitor.domain ?? competitor.name}`,
        type: 'content_gap',
        title: `Topic dominance gap vs ${competitor.name}`,
        competitor_domain: competitor.domain,
        priority_score: competitor.scores.topic_dominance,
        confidence: competitor.confidence,
        recommendation: 'Expand content depth on the topics where competitor SERP coverage is broader than current brand visibility.',
        evidence_refs: competitor.evidence_refs,
        evidence: competitor.evidence,
      });
    }
    return items;
  }).sort((a, b) => b.priority_score - a.priority_score).slice(0, 10);

  return {
    status: competitors.some((item) => item.domain && item.evidence.serp_rows) ? 'ready' : competitors.length ? 'limited' : 'unavailable',
    generated_at: new Date().toISOString(),
    summary: competitors.some((item) => item.domain && item.evidence.serp_rows)
      ? 'Unified competitor intelligence reconciles company profile competitors with live SERP-observed market evidence.'
      : 'Unified competitor intelligence is using profile and market-engine evidence; live SERP overlap is not populated yet.',
    competitors,
    opportunities,
    quality: {
      total_candidates: byKey.size,
      suppressed_low_confidence: suppressed,
      stale_suppressed: staleSuppressed,
      duplicate_domains_consolidated: Math.max(0, profileNames.length + domainRows.length + serpByDomain.size - byKey.size),
      serp_evidence_rows: serpRows.length,
    },
  };
}
