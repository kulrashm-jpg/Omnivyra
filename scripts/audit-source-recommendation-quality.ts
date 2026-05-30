/**
 * Active Leads — recommendation quality audit (one-shot research artifact).
 *
 * Runs the PR-CAR engine pipeline against 40 synthetic CompanyContext
 * fixtures (10 SaaS, 10 Services, 10 Technology, 10 B2B), captures the
 * top 10 recommendations per company, and aggregates metrics that
 * measure the contribution (or absence) of persona enrichment.
 *
 * NOT a runtime test. NOT a unit test. Purpose: produce numbers that
 * answer "should we invest in PR-CAR-5 (seed persona enrichment)?".
 *
 * Usage:
 *   npx tsx scripts/audit-source-recommendation-quality.ts
 *
 * Output: structured JSON to stdout + a markdown summary at the end.
 * No DB access. No mutations. Pure in-process function calls.
 */

import { discoverCommunityCandidates } from '../backend/services/communityDiscoveryService';
import {
  scoreSourcesForOpportunities,
  type AbstractSource,
} from '../backend/services/sourceRecommendationEngine';
import {
  toDiscoveryItem,
  compositeSourceId,
} from '../backend/services/sourceRecommendationContract';
import type { CompanyContext, CompanyContextField } from '../backend/services/activeLeadsCompanyContext';

// ---------------------------------------------------------------------------
// Synthetic CompanyContext factory
// ---------------------------------------------------------------------------

type Fixture = {
  companyId: string;
  category: 'SaaS' | 'Services' | 'Technology' | 'B2B';
  industry: string[];
  products: string[];
  services: string[];
  icp: string[];
  geography: string[];
  revenueStage: string[];
  competitors: string[];
};

function field(values: string[], source: string): CompanyContextField {
  if (values.length === 0) {
    return { values: [], display: [], present: false, sources: [] };
  }
  return {
    values: values.map((v) => v.toLowerCase()),
    display: values,
    present: true,
    sources: [source],
  };
}

function toContext(f: Fixture): CompanyContext {
  const present = [
    f.industry, f.products, f.services, f.icp, f.geography, f.revenueStage, f.competitors,
  ].filter((arr) => arr.length > 0).length;
  return {
    companyId: f.companyId,
    industry: field(f.industry, 'synthetic'),
    products: field(f.products, 'synthetic'),
    services: field(f.services, 'synthetic'),
    icp: field(f.icp, 'synthetic'),
    geography: field(f.geography, 'synthetic'),
    revenueStage: field(f.revenueStage, 'synthetic'),
    competitors: field(f.competitors, 'synthetic'),
    confidence: present / 7,
    missingFields: [],
    loadErrors: [],
    loadedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// 40 fixtures
// ---------------------------------------------------------------------------

const SAAS: Fixture[] = [
  {
    companyId: 'saas-001', category: 'SaaS',
    industry: ['saas', 'martech', 'marketing'],
    products: ['crm', 'pipeline', 'lead capture'],
    services: ['crm', 'lead capture'],
    icp: ['marketing leaders', 'cmo', 'demand gen'],
    geography: ['north america'],
    revenueStage: ['series a'],
    competitors: ['hubspot', 'pipedrive'],
  },
  {
    companyId: 'saas-002', category: 'SaaS',
    industry: ['saas', 'smb', 'accounting'],
    products: ['bookkeeping', 'invoicing'],
    services: ['bookkeeping'],
    icp: ['small business owners', 'bookkeepers'],
    geography: ['us'],
    revenueStage: ['bootstrapped'],
    competitors: ['quickbooks', 'xero'],
  },
  {
    companyId: 'saas-003', category: 'SaaS',
    industry: ['saas', 'hr', 'recruiting'],
    products: ['ats', 'sourcing'],
    services: ['ats', 'sourcing'],
    icp: ['recruiters', 'talent leaders'],
    geography: ['global'],
    revenueStage: ['mid-market'],
    competitors: ['greenhouse', 'lever'],
  },
  {
    companyId: 'saas-004', category: 'SaaS',
    industry: ['saas', 'sales', 'b2b'],
    products: ['outreach', 'crm', 'sequences'],
    services: ['outreach', 'sequences'],
    icp: ['sales leaders', 'sdrs'],
    geography: ['us', 'emea'],
    revenueStage: ['series b'],
    competitors: ['outreach', 'salesloft'],
  },
  {
    companyId: 'saas-005', category: 'SaaS',
    industry: ['saas', 'design'],
    products: ['figma plugin', 'design tokens'],
    services: ['design tokens'],
    icp: ['designers', 'design leaders'],
    geography: ['global'],
    revenueStage: ['seed'],
    competitors: ['figma'],
  },
  {
    companyId: 'saas-006', category: 'SaaS',
    industry: ['saas', 'analytics'],
    products: ['product analytics', 'event tracking'],
    services: ['analytics'],
    icp: ['product managers', 'growth'],
    geography: ['global'],
    revenueStage: ['growth'],
    competitors: ['mixpanel', 'amplitude'],
  },
  {
    companyId: 'saas-007', category: 'SaaS',
    industry: ['saas', 'customer success'],
    products: ['health score', 'retention'],
    services: ['retention'],
    icp: ['cs leaders', 'onboarding'],
    geography: ['us'],
    revenueStage: ['bootstrapped'],
    competitors: ['gainsight', 'totango'],
  },
  {
    companyId: 'saas-008', category: 'SaaS',
    industry: ['saas', 'fintech', 'accounting'],
    products: ['expense management', 'corporate cards'],
    services: ['expense management'],
    icp: ['finance leaders', 'controllers'],
    geography: ['us'],
    revenueStage: ['series b'],
    competitors: ['brex', 'ramp'],
  },
  {
    companyId: 'saas-009', category: 'SaaS',
    industry: ['saas', 'legaltech'],
    products: ['contract management', 'clm'],
    services: ['clm'],
    icp: ['general counsel', 'legal ops'],
    geography: ['us'],
    revenueStage: ['series a'],
    competitors: ['ironclad', 'docusign'],
  },
  {
    companyId: 'saas-010', category: 'SaaS',
    industry: ['saas', 'it', 'security'],
    products: ['endpoint management', 'mdm'],
    services: ['mdm'],
    icp: ['it admins', 'ciso'],
    geography: ['global'],
    revenueStage: ['series b'],
    competitors: ['jamf', 'kandji'],
  },
];

const SERVICES: Fixture[] = [
  {
    companyId: 'svc-001', category: 'Services',
    industry: ['marketing', 'agency'],
    products: [],
    services: ['campaign strategy', 'paid acquisition'],
    icp: ['cmos', 'marketing directors'],
    geography: ['us'],
    revenueStage: ['scale'],
    competitors: [],
  },
  {
    companyId: 'svc-002', category: 'Services',
    industry: ['web development', 'agency'],
    products: [],
    services: ['custom dev', 'react', 'next.js'],
    icp: ['ctos', 'product leaders'],
    geography: ['global'],
    revenueStage: ['growth'],
    competitors: [],
  },
  {
    companyId: 'svc-003', category: 'Services',
    industry: ['accounting', 'tax'],
    products: [],
    services: ['bookkeeping', 'tax filing'],
    icp: ['small business owners'],
    geography: ['us'],
    revenueStage: ['mid-market'],
    competitors: ['turbotax'],
  },
  {
    companyId: 'svc-004', category: 'Services',
    industry: ['legal services', 'law'],
    products: [],
    services: ['contract review', 'corporate counsel'],
    icp: ['general counsel', 'ceos'],
    geography: ['us'],
    revenueStage: ['established'],
    competitors: [],
  },
  {
    companyId: 'svc-005', category: 'Services',
    industry: ['hr', 'consulting'],
    products: [],
    services: ['comp planning', 'hr ops'],
    icp: ['heads of people'],
    geography: ['us'],
    revenueStage: ['scale'],
    competitors: [],
  },
  {
    companyId: 'svc-006', category: 'Services',
    industry: ['it services', 'msp'],
    products: [],
    services: ['managed it', 'support'],
    icp: ['it directors', 'office managers'],
    geography: ['us'],
    revenueStage: ['growth'],
    competitors: [],
  },
  {
    companyId: 'svc-007', category: 'Services',
    industry: ['design', 'agency'],
    products: [],
    services: ['brand identity', 'product design'],
    icp: ['founders', 'marketing leaders'],
    geography: ['global'],
    revenueStage: ['boutique'],
    competitors: [],
  },
  {
    companyId: 'svc-008', category: 'Services',
    industry: ['recruiting', 'staffing'],
    products: [],
    services: ['exec search', 'sourcing'],
    icp: ['heads of people', 'cto'],
    geography: ['us'],
    revenueStage: ['growth'],
    competitors: [],
  },
  {
    companyId: 'svc-009', category: 'Services',
    industry: ['financial advisory', 'wealth'],
    products: [],
    services: ['ria', 'planning'],
    icp: ['high net worth', 'founders'],
    geography: ['us'],
    revenueStage: ['established'],
    competitors: [],
  },
  {
    companyId: 'svc-010', category: 'Services',
    industry: ['operations consulting'],
    products: [],
    services: ['process design', 'rev ops'],
    icp: ['coo', 'rev ops leaders'],
    geography: ['us'],
    revenueStage: ['scale'],
    competitors: [],
  },
];

const TECHNOLOGY: Fixture[] = [
  {
    companyId: 'tech-001', category: 'Technology',
    industry: ['devtools', 'ci/cd'],
    products: ['build pipelines', 'ci'],
    services: ['build'],
    icp: ['devops engineers', 'platform leads'],
    geography: ['global'],
    revenueStage: ['series b'],
    competitors: ['circleci', 'github actions'],
  },
  {
    companyId: 'tech-002', category: 'Technology',
    industry: ['devtools', 'observability'],
    products: ['logs', 'metrics', 'traces'],
    services: ['observability'],
    icp: ['sre', 'devops'],
    geography: ['global'],
    revenueStage: ['growth'],
    competitors: ['datadog', 'newrelic'],
  },
  {
    companyId: 'tech-003', category: 'Technology',
    industry: ['devtools', 'feature flags'],
    products: ['flags', 'experimentation'],
    services: ['feature flags'],
    icp: ['engineering leaders', 'product engineers'],
    geography: ['global'],
    revenueStage: ['series a'],
    competitors: ['launchdarkly', 'split'],
  },
  {
    companyId: 'tech-004', category: 'Technology',
    industry: ['devtools', 'auth', 'security'],
    products: ['auth', 'sso', 'sdk'],
    services: ['authentication'],
    icp: ['developers', 'security engineers'],
    geography: ['global'],
    revenueStage: ['series b'],
    competitors: ['auth0', 'clerk'],
  },
  {
    companyId: 'tech-005', category: 'Technology',
    industry: ['ml', 'mlops', 'ai'],
    products: ['model serving', 'training infra'],
    services: ['mlops'],
    icp: ['ml engineers', 'data scientists'],
    geography: ['global'],
    revenueStage: ['series a'],
    competitors: ['weights and biases', 'sagemaker'],
  },
  {
    companyId: 'tech-006', category: 'Technology',
    industry: ['ai', 'llm'],
    products: ['llm api', 'fine-tuning', 'inference'],
    services: ['llm inference'],
    icp: ['ai engineers', 'cto'],
    geography: ['global'],
    revenueStage: ['seed'],
    competitors: ['openai', 'anthropic'],
  },
  {
    companyId: 'tech-007', category: 'Technology',
    industry: ['devtools', 'database', 'data'],
    products: ['serverless db', 'postgres', 'api'],
    services: ['database hosting'],
    icp: ['backend engineers', 'cto'],
    geography: ['global'],
    revenueStage: ['series a'],
    competitors: ['neon', 'planetscale'],
  },
  {
    companyId: 'tech-008', category: 'Technology',
    industry: ['devtools', 'edge', 'cdn'],
    products: ['edge functions', 'cdn', 'workers'],
    services: ['edge compute'],
    icp: ['platform engineers', 'devops'],
    geography: ['global'],
    revenueStage: ['series c'],
    competitors: ['cloudflare', 'fastly'],
  },
  {
    companyId: 'tech-009', category: 'Technology',
    industry: ['devtools', 'api management'],
    products: ['api gateway', 'sdk', 'webhooks'],
    services: ['api management'],
    icp: ['backend engineers', 'integration leads'],
    geography: ['global'],
    revenueStage: ['series b'],
    competitors: ['kong', 'apigee'],
  },
  {
    companyId: 'tech-010', category: 'Technology',
    industry: ['iot', 'hardware', 'embedded'],
    products: ['device firmware', 'ota updates'],
    services: ['iot connectivity'],
    icp: ['firmware engineers', 'embedded leads'],
    geography: ['global'],
    revenueStage: ['series a'],
    competitors: ['particle', 'balena'],
  },
];

const B2B: Fixture[] = [
  {
    companyId: 'b2b-001', category: 'B2B',
    industry: ['industrial', 'supply chain', 'manufacturing'],
    products: ['raw materials', 'wholesale supply'],
    services: ['logistics'],
    icp: ['supply chain managers', 'procurement'],
    geography: ['us', 'mexico'],
    revenueStage: ['established'],
    competitors: [],
  },
  {
    companyId: 'b2b-002', category: 'B2B',
    industry: ['wholesale', 'distribution'],
    products: ['durable goods'],
    services: ['distribution'],
    icp: ['retail buyers', 'distributors'],
    geography: ['us'],
    revenueStage: ['established'],
    competitors: [],
  },
  {
    companyId: 'b2b-003', category: 'B2B',
    industry: ['manufacturing', 'oem'],
    products: ['contract manufacturing'],
    services: ['fabrication'],
    icp: ['hardware founders', 'oems'],
    geography: ['us', 'china'],
    revenueStage: ['mid-market'],
    competitors: [],
  },
  {
    companyId: 'b2b-004', category: 'B2B',
    industry: ['logistics', 'shipping'],
    products: ['freight', 'last mile'],
    services: ['logistics'],
    icp: ['ecommerce ops', 'fulfillment leaders'],
    geography: ['us', 'global'],
    revenueStage: ['growth'],
    competitors: ['flexport'],
  },
  {
    companyId: 'b2b-005', category: 'B2B',
    industry: ['real estate', 'commercial'],
    products: ['leasing', 'commercial space'],
    services: ['brokerage'],
    icp: ['heads of facilities', 'coo'],
    geography: ['us'],
    revenueStage: ['established'],
    competitors: [],
  },
  {
    companyId: 'b2b-006', category: 'B2B',
    industry: ['enterprise', 'consulting', 'it'],
    products: [],
    services: ['enterprise it consulting', 'sap', 'salesforce'],
    icp: ['cio', 'enterprise architects'],
    geography: ['global'],
    revenueStage: ['established'],
    competitors: ['accenture', 'deloitte'],
  },
  {
    companyId: 'b2b-007', category: 'B2B',
    industry: ['procurement', 'b2b marketplace'],
    products: ['procurement platform'],
    services: ['sourcing'],
    icp: ['procurement leaders', 'cfo'],
    geography: ['us'],
    revenueStage: ['series c'],
    competitors: ['coupa', 'ariba'],
  },
  {
    companyId: 'b2b-008', category: 'B2B',
    industry: ['cybersecurity', 'enterprise security'],
    products: ['edr', 'siem', 'mdr'],
    services: ['security operations'],
    icp: ['ciso', 'security leaders'],
    geography: ['global'],
    revenueStage: ['series d'],
    competitors: ['crowdstrike', 'sentinelone'],
  },
  {
    companyId: 'b2b-009', category: 'B2B',
    industry: ['legaltech', 'enterprise'],
    products: ['ediscovery', 'compliance'],
    services: ['ediscovery'],
    icp: ['general counsel', 'compliance officers'],
    geography: ['us'],
    revenueStage: ['established'],
    competitors: ['relativity'],
  },
  {
    companyId: 'b2b-010', category: 'B2B',
    industry: ['grc', 'compliance', 'audit'],
    products: ['soc2 automation', 'iso 27001'],
    services: ['grc'],
    icp: ['ciso', 'security ops', 'compliance leaders'],
    geography: ['us'],
    revenueStage: ['series b'],
    competitors: ['vanta', 'drata'],
  },
];

const ALL_FIXTURES = [...SAAS, ...SERVICES, ...TECHNOLOGY, ...B2B];

// ---------------------------------------------------------------------------
// Run engine per company
// ---------------------------------------------------------------------------

type CapturedRecommendation = {
  source_id: string;
  source_name: string;
  source_type: string;
  tier: string;
  strength: string;
  overall_score: number;
  primary_opportunity: string | null;
  secondary_opportunity: string | null;
  best_for: string[];
  not_ideal_for: string[];
  fit_reasons: string[];
  persona_tags_count: number; // upstream engine output (always 0 today since seeds unenriched)
  yield: {
    lead_potential: string;
    signal_volume: string;
    signal_quality: string;
    discovery_efficiency: string;
  };
};

type CompanyResult = {
  companyId: string;
  category: string;
  recommendations: CapturedRecommendation[];
};

function runForFixture(fx: Fixture): CompanyResult {
  const ctx = toContext(fx);
  const discoveryProfile = {
    organizationId: ctx.companyId,
    industryCategory: ctx.industry.display.join(', ') || null,
    description: ctx.products.display.join(', ') || null,
    icp: ctx.icp.display.join(', ') || null,
    keywords: [...ctx.products.values, ...ctx.services.values],
    competitors: ctx.competitors.display,
    redditListeningReady: true,
  };
  const discovery = discoverCommunityCandidates(discoveryProfile);
  const abstractSources: AbstractSource[] = discovery.candidates.map((c) => ({
    source_type: c.source_type,
    source_identifier: c.source_identifier,
    display_name: c.display_name,
    strategic_relevance: c.strategic_relevance,
    matched_competitors: c.related_competitors,
    estimated_signal_quality: c.estimated_signal_quality,
    estimated_volume: c.estimated_volume,
    matched_verticals: (c.source_metadata as { matched_verticals?: string[] } | undefined)?.matched_verticals,
    matched_keywords: (c.source_metadata as { matched_keywords?: string[] } | undefined)?.matched_keywords,
  }));
  const scored = scoreSourcesForOpportunities(ctx, abstractSources);

  const top10 = scored
    .sort((a, b) => b.overall_score - a.overall_score)
    .slice(0, 10);

  const recommendations = top10.map((s) => {
    const sourceId = compositeSourceId(s.source_type, s.source_identifier);
    const candidate = discovery.candidates.find(
      (c) => compositeSourceId(c.source_type, c.source_identifier) === sourceId,
    );
    const item = toDiscoveryItem(s, ctx, sourceId, candidate?.recommendation_reason ?? null);
    return {
      source_id: sourceId,
      source_name: item.source_name,
      source_type: item.source_type,
      tier: item.tier,
      strength: item.strength,
      overall_score: item.overall_score,
      primary_opportunity: item.primary_opportunity,
      secondary_opportunity: item.secondary_opportunity,
      best_for: item.best_for,
      not_ideal_for: item.not_ideal_for,
      fit_reasons: item.fit_reasons,
      persona_tags_count: s.persona_tags.length,
      yield: {
        lead_potential: item.yield.lead_potential,
        signal_volume: item.yield.signal_volume,
        signal_quality: item.yield.signal_quality,
        discovery_efficiency: item.yield.discovery_efficiency,
      },
    };
  });

  return { companyId: ctx.companyId, category: fx.category, recommendations };
}

// ---------------------------------------------------------------------------
// Aggregate metrics
// ---------------------------------------------------------------------------

type Metrics = {
  total_recommendations: number;
  recommendations_with_empty_persona_tags: number;
  recommendations_with_persona_overlap_bullet: number;
  recommendations_with_industry_fallback_bullet: number;
  recommendations_with_no_fit_reasons: number;
  recommendations_with_only_generic_fit: number;
  avg_fit_reasons_per_rec: number;
  source_appearance_count: Map<string, number>;
  dominant_sources_above_50pct_companies: string[];
  per_category: Record<string, {
    rec_count: number;
    distinct_sources: number;
    avg_fit_reasons: number;
    pct_industry_fallback_bullet: number;
    pct_persona_overlap_bullet: number;
    pct_competitor_specific_bullet: number;
    pct_integration_footprint_bullet: number;
    tier_distribution: Record<string, number>;
    top_5_sources: Array<{ source_id: string; count: number }>;
  }>;
};

function isPersonaOverlapBullet(b: string): boolean {
  return /your icp overlaps with this source's typical audience/i.test(b)
    || /this source attracts/i.test(b);
}
function isIndustryFallbackBullet(b: string): boolean {
  return /your industry \(/i.test(b);
}
function isCompetitorSpecificBullet(b: string): boolean {
  return /discussions about your competitors/i.test(b);
}
function isIntegrationFootprintBullet(b: string): boolean {
  return /your product surface includes technical integrations/i.test(b);
}
function isGenericOpportunityBullet(b: string): boolean {
  return /conversations occur frequently here|are common\.$|posts surface here|chatter is regular|signals are common\.$/i.test(b);
}

function aggregate(results: CompanyResult[]): Metrics {
  let total = 0;
  let emptyPersona = 0;
  let personaOverlap = 0;
  let industryFallback = 0;
  let noFitReasons = 0;
  let onlyGeneric = 0;
  let fitReasonsSum = 0;

  const sourceAppearances = new Map<string, number>(); // source_id -> # companies containing it in top10
  const perCategory: Metrics['per_category'] = {};

  for (const company of results) {
    const seenSources = new Set<string>();
    perCategory[company.category] ??= {
      rec_count: 0,
      distinct_sources: 0,
      avg_fit_reasons: 0,
      pct_industry_fallback_bullet: 0,
      pct_persona_overlap_bullet: 0,
      pct_competitor_specific_bullet: 0,
      pct_integration_footprint_bullet: 0,
      tier_distribution: { highly_recommended: 0, recommended: 0, low_relevance: 0 },
      top_5_sources: [],
    };
    const cat = perCategory[company.category];

    for (const rec of company.recommendations) {
      total += 1;
      cat.rec_count += 1;
      cat.tier_distribution[rec.tier] = (cat.tier_distribution[rec.tier] ?? 0) + 1;

      if (rec.persona_tags_count === 0) emptyPersona += 1;
      const fr = rec.fit_reasons;
      fitReasonsSum += fr.length;
      cat.avg_fit_reasons += fr.length;

      if (fr.length === 0) noFitReasons += 1;
      else if (fr.every(isGenericOpportunityBullet)) onlyGeneric += 1;

      let hadPersonaOverlap = false;
      let hadIndustryFallback = false;
      let hadCompetitorSpecific = false;
      let hadIntegrationFootprint = false;
      for (const bullet of fr) {
        if (isPersonaOverlapBullet(bullet)) hadPersonaOverlap = true;
        if (isIndustryFallbackBullet(bullet)) hadIndustryFallback = true;
        if (isCompetitorSpecificBullet(bullet)) hadCompetitorSpecific = true;
        if (isIntegrationFootprintBullet(bullet)) hadIntegrationFootprint = true;
      }
      if (hadPersonaOverlap) personaOverlap += 1;
      if (hadIndustryFallback) industryFallback += 1;
      if (hadPersonaOverlap) cat.pct_persona_overlap_bullet += 1;
      if (hadIndustryFallback) cat.pct_industry_fallback_bullet += 1;
      if (hadCompetitorSpecific) cat.pct_competitor_specific_bullet += 1;
      if (hadIntegrationFootprint) cat.pct_integration_footprint_bullet += 1;

      seenSources.add(rec.source_id);
      sourceAppearances.set(rec.source_id, (sourceAppearances.get(rec.source_id) ?? 0) + 1);
    }
    cat.distinct_sources += seenSources.size;
  }

  // Normalize per-category percentages and averages.
  for (const cat of Object.values(perCategory)) {
    const denom = cat.rec_count || 1;
    cat.pct_industry_fallback_bullet = +(cat.pct_industry_fallback_bullet / denom * 100).toFixed(1);
    cat.pct_persona_overlap_bullet = +(cat.pct_persona_overlap_bullet / denom * 100).toFixed(1);
    cat.pct_competitor_specific_bullet = +(cat.pct_competitor_specific_bullet / denom * 100).toFixed(1);
    cat.pct_integration_footprint_bullet = +(cat.pct_integration_footprint_bullet / denom * 100).toFixed(1);
    cat.avg_fit_reasons = +(cat.avg_fit_reasons / denom).toFixed(2);
  }

  // Top-5 sources per category.
  for (const category of Object.keys(perCategory)) {
    const counts = new Map<string, number>();
    for (const company of results.filter((r) => r.category === category)) {
      const seen = new Set<string>();
      for (const rec of company.recommendations) seen.add(rec.source_id);
      for (const s of seen) counts.set(s, (counts.get(s) ?? 0) + 1);
    }
    perCategory[category].top_5_sources = [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([source_id, count]) => ({ source_id, count }));
  }

  // Sources appearing in > 50% of all companies.
  const halfThreshold = Math.ceil(results.length / 2);
  const dominantSources = [...sourceAppearances.entries()]
    .filter(([, count]) => count >= halfThreshold)
    .sort((a, b) => b[1] - a[1])
    .map(([source_id, count]) => `${source_id} (${count}/${results.length})`);

  return {
    total_recommendations: total,
    recommendations_with_empty_persona_tags: emptyPersona,
    recommendations_with_persona_overlap_bullet: personaOverlap,
    recommendations_with_industry_fallback_bullet: industryFallback,
    recommendations_with_no_fit_reasons: noFitReasons,
    recommendations_with_only_generic_fit: onlyGeneric,
    avg_fit_reasons_per_rec: +(fitReasonsSum / Math.max(1, total)).toFixed(2),
    source_appearance_count: sourceAppearances,
    dominant_sources_above_50pct_companies: dominantSources,
    per_category: perCategory,
  };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

function main() {
  console.log('================================================================');
  console.log('Active Leads — recommendation quality audit');
  console.log(`Fixtures: ${ALL_FIXTURES.length} synthetic companies`);
  console.log('================================================================\n');

  const results: CompanyResult[] = ALL_FIXTURES.map((fx) => runForFixture(fx));
  const metrics = aggregate(results);

  // Print compact per-company summary.
  console.log('--- Per-company top sources ---');
  for (const company of results) {
    const tops = company.recommendations.slice(0, 5).map((r) => r.source_name).join(', ');
    console.log(`  [${company.category.padEnd(11)}] ${company.companyId}: ${tops}`);
  }

  // Per-company highly_recommended count.
  console.log('\n--- Highly-Recommended count per company ---');
  for (const company of results) {
    const hr = company.recommendations.filter((r) => r.tier === 'highly_recommended').length;
    const hrSources = company.recommendations
      .filter((r) => r.tier === 'highly_recommended')
      .map((r) => r.source_name)
      .join(', ');
    console.log(`  [${company.category.padEnd(11)}] ${company.companyId}: ${hr} HR  (${hrSources || '—'})`);
  }

  console.log('\n--- Cohort-level metrics ---');
  const pct = (n: number, d: number) => `${((n / Math.max(1, d)) * 100).toFixed(1)}%`;
  console.log(`  Total recommendations:                       ${metrics.total_recommendations}`);
  console.log(`  Avg fit_reasons per recommendation:          ${metrics.avg_fit_reasons_per_rec}`);
  console.log(`  Empty persona_tags:                          ${metrics.recommendations_with_empty_persona_tags} (${pct(metrics.recommendations_with_empty_persona_tags, metrics.total_recommendations)})`);
  console.log(`  Bullet with persona-overlap form:            ${metrics.recommendations_with_persona_overlap_bullet} (${pct(metrics.recommendations_with_persona_overlap_bullet, metrics.total_recommendations)})`);
  console.log(`  Bullet with industry-fallback form:          ${metrics.recommendations_with_industry_fallback_bullet} (${pct(metrics.recommendations_with_industry_fallback_bullet, metrics.total_recommendations)})`);
  console.log(`  No fit_reasons at all:                       ${metrics.recommendations_with_no_fit_reasons} (${pct(metrics.recommendations_with_no_fit_reasons, metrics.total_recommendations)})`);
  console.log(`  Only-generic fit_reasons:                    ${metrics.recommendations_with_only_generic_fit} (${pct(metrics.recommendations_with_only_generic_fit, metrics.total_recommendations)})`);
  console.log(`  Sources dominating >=50% of companies:`);
  for (const line of metrics.dominant_sources_above_50pct_companies) console.log(`    - ${line}`);

  console.log('\n--- Per-category metrics ---');
  for (const [category, cat] of Object.entries(metrics.per_category)) {
    console.log(`\n  [${category}]`);
    console.log(`    recommendations:                   ${cat.rec_count}`);
    console.log(`    avg fit_reasons/rec:               ${cat.avg_fit_reasons}`);
    console.log(`    % with persona-overlap bullet:     ${cat.pct_persona_overlap_bullet}%`);
    console.log(`    % with industry-fallback bullet:   ${cat.pct_industry_fallback_bullet}%`);
    console.log(`    % with competitor-specific bullet: ${cat.pct_competitor_specific_bullet}%`);
    console.log(`    % with integration footprint:      ${cat.pct_integration_footprint_bullet}%`);
    console.log(`    tier distribution:                 highly=${cat.tier_distribution.highly_recommended} rec=${cat.tier_distribution.recommended} low=${cat.tier_distribution.low_relevance}`);
    console.log(`    top-5 sources in category:`);
    for (const s of cat.top_5_sources) console.log(`      - ${s.source_id} (${s.count} companies)`);
  }

  console.log('\n================================================================');
  console.log('Audit complete. See report for interpretation.');
  console.log('================================================================');
}

main();
