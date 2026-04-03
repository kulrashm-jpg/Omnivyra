import { runInBackgroundJobContext } from './intelligenceExecutionContext';
import { generateAdvancedRevenueAttributionDecisions } from './advancedRevenueAttributionIntelligenceService';
import { generateAuthorityIntelligenceDecisions } from './authorityIntelligenceService';
import { generateBacklinkAuthorityDecisions } from './backlinkAuthorityIntelligenceService';
import { generateBrandTrustIntelligenceDecisions } from './brandTrustIntelligenceService';
import { persistCompetitiveIntelligenceDecisions } from './competitiveIntelligenceEngine';
import { aggregateCompanyIntelligence } from './companyIntelligenceAggregator';
import { generateCompetitorIntelligenceDecisionObjects } from './competitorIntelligenceService';
import { generateCompetitorNormalizationDecisions } from './competitorNormalizationIntelligenceService';
import { generateContentAuthorityDecisions } from './contentAuthorityService';
import { generateDistributionIntelligenceDecisions } from './distributionIntelligenceService';
import { generateFunnelIntelligenceDecisions } from './funnelIntelligenceService';
import { generateGeoIntelligenceDecisions } from './geoIntelligenceService';
import { generateGeoStrategyIntelligenceDecisions } from './geoStrategyIntelligenceService';
import { generateIntentIntelligenceDecisions } from './intentIntelligenceService';
import { generateLeadIntelligenceDecisions } from './leadIntelligenceService';
import { generatePortfolioDecisionObjects } from './portfolioDecisionEngine';
import { generateSeoIntelligenceDecisions } from './seoIntelligenceService';
import { generateTrafficIntelligenceDecisions } from './trafficIntelligenceService';
import { generateTrustIntelligenceDecisions } from './trustIntelligenceService';
import { generateVelocityIntelligenceDecisions } from './velocityIntelligenceService';

export type DataDrivenIntelligenceRunSummary = {
  traffic: number;
  funnel: number;
  seo: number;
  contentAuthority: number;
  lead: number;
  brandTrust: number;
  backlinkAuthority: number;
  competitorNormalization: number;
  competitorIntelligence: number;
  competitiveSignals: number;
  distribution: number;
  authority: number;
  geo: number;
  trust: number;
  intent: number;
  velocity: number;
  portfolio: number;
  geoStrategy: number;
  advancedRevenueAttribution: number;
  total: number;
};

export async function runDataDrivenIntelligenceForCompany(companyId: string): Promise<DataDrivenIntelligenceRunSummary> {
  const [
    traffic,
    funnel,
    seo,
    contentAuthority,
    lead,
    brandTrust,
    backlinkAuthority,
    competitorNormalization,
    competitorIntelligence,
    competitiveSignals,
    distribution,
    authority,
    geo,
    trust,
    intent,
    velocity,
    portfolio,
    geoStrategy,
    advancedRevenueAttribution,
  ] = await Promise.all([
    runInBackgroundJobContext('data_driven_intelligence:traffic', async () =>
      generateTrafficIntelligenceDecisions(companyId)
    ),
    runInBackgroundJobContext('data_driven_intelligence:funnel', async () =>
      generateFunnelIntelligenceDecisions(companyId)
    ),
    runInBackgroundJobContext('data_driven_intelligence:seo', async () =>
      generateSeoIntelligenceDecisions(companyId)
    ),
    runInBackgroundJobContext('data_driven_intelligence:content_authority', async () =>
      generateContentAuthorityDecisions(companyId)
    ),
    runInBackgroundJobContext('data_driven_intelligence:lead', async () =>
      generateLeadIntelligenceDecisions(companyId)
    ),
    runInBackgroundJobContext('data_driven_intelligence:brand_trust', async () =>
      generateBrandTrustIntelligenceDecisions(companyId)
    ),
    runInBackgroundJobContext('data_driven_intelligence:backlink_authority', async () =>
      generateBacklinkAuthorityDecisions(companyId)
    ),
    runInBackgroundJobContext('data_driven_intelligence:competitor_normalization', async () =>
      generateCompetitorNormalizationDecisions(companyId)
    ),
    runInBackgroundJobContext('data_driven_intelligence:competitor_intelligence', async () =>
      generateCompetitorIntelligenceDecisionObjects(companyId)
    ),
    runInBackgroundJobContext('data_driven_intelligence:competitive_signals', async () => {
      const insights = await aggregateCompanyIntelligence(companyId);
      return persistCompetitiveIntelligenceDecisions({ companyId, insights });
    }),
    runInBackgroundJobContext('data_driven_intelligence:distribution', async () =>
      generateDistributionIntelligenceDecisions(companyId)
    ),
    runInBackgroundJobContext('data_driven_intelligence:authority', async () =>
      generateAuthorityIntelligenceDecisions(companyId)
    ),
    runInBackgroundJobContext('data_driven_intelligence:geo', async () =>
      generateGeoIntelligenceDecisions(companyId)
    ),
    runInBackgroundJobContext('data_driven_intelligence:trust', async () =>
      generateTrustIntelligenceDecisions(companyId)
    ),
    runInBackgroundJobContext('data_driven_intelligence:intent', async () =>
      generateIntentIntelligenceDecisions(companyId)
    ),
    runInBackgroundJobContext('data_driven_intelligence:velocity', async () =>
      generateVelocityIntelligenceDecisions(companyId)
    ),
    runInBackgroundJobContext('data_driven_intelligence:portfolio', async () =>
      generatePortfolioDecisionObjects(companyId)
    ),
    runInBackgroundJobContext('data_driven_intelligence:geo_strategy', async () =>
      generateGeoStrategyIntelligenceDecisions(companyId)
    ),
    runInBackgroundJobContext('data_driven_intelligence:advanced_revenue_attribution', async () =>
      generateAdvancedRevenueAttributionDecisions(companyId)
    ),
  ]);

  return {
    traffic: traffic.length,
    funnel: funnel.length,
    seo: seo.length,
    contentAuthority: contentAuthority.length,
    lead: lead.length,
    brandTrust: brandTrust.length,
    backlinkAuthority: backlinkAuthority.length,
    competitorNormalization: competitorNormalization.length,
    competitorIntelligence: competitorIntelligence.length,
    competitiveSignals: competitiveSignals.length,
    distribution: distribution.length,
    authority: authority.length,
    geo: geo.length,
    trust: trust.length,
    intent: intent.length,
    velocity: velocity.length,
    portfolio: portfolio.length,
    geoStrategy: geoStrategy.length,
    advancedRevenueAttribution: advancedRevenueAttribution.length,
    total:
      traffic.length +
      funnel.length +
      seo.length +
      contentAuthority.length +
      lead.length +
      brandTrust.length +
      backlinkAuthority.length +
      competitorNormalization.length +
      competitorIntelligence.length +
      competitiveSignals.length +
      distribution.length +
      authority.length +
      geo.length +
      trust.length +
      intent.length +
      velocity.length +
      portfolio.length +
      geoStrategy.length +
      advancedRevenueAttribution.length,
  };
}
