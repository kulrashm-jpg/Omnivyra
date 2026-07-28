/**
 * COMPANY-INTELLIGENCE-PROGRAM-002 / Phase B — canonical Company Understanding contracts.
 *
 * Company Understanding is the 2nd canonical Understanding entity (with Lead + Offering) on the
 * SHARED Product-Intelligence spine (`intelligence/canonical`) — it REUSES Program 1's Facet<T>,
 * EvidenceRef, ReasoningTrace, GraphNodeRef, and the dimension-generic scoring contract. It ADOPTS
 * the certified COMPANY-PROFILE-ONTOLOGY-001 domain design (world-view + single-owner projection +
 * "project from the AI-derived profile, never fabricate") — but expresses it on the shared Facet
 * contracts instead of the ontology branch's bespoke low/medium/high confidence band.
 */

import type { Facet, EvidenceRef, ReasoningTrace, ContradictionRef, GraphNodeRef, GraphEdge, ISOTimestamp } from '../intelligence/canonical';
import type { ScoreContribution, DimensionScore, CanonicalScore } from '../intelligence/canonical';

export type { EvidenceRef, ReasoningTrace, ContradictionRef, ISOTimestamp };

// ── Company score dimensions (shared generic scoring specialized to company) ────────────────────
export type CompanyScoreDimension = 'maturity' | 'momentum' | 'market_authority' | 'risk' | 'fit';
export const COMPANY_SCORE_DIMENSIONS: readonly CompanyScoreDimension[] = ['maturity', 'momentum', 'market_authority', 'risk', 'fit'];
export type CompanyContribution = ScoreContribution<CompanyScoreDimension>;
export type CompanyDimensionScore = DimensionScore<CompanyScoreDimension>;
export type CompanyScore = CanonicalScore<CompanyScoreDimension>;

// ── World view (adopted from the ontology canonical design) ─────────────────────────────────────
export interface CompanyWorldView { category?: string; businessModel?: string; primaryMotion?: string; marketPosition?: string; }

// ── Company facet domains (canonical ontology; every field abstains when unevidenced) ───────────
export interface IdentityValue { name?: string; domain?: string; legalName?: string; foundedYear?: string; geography?: string; }
export interface OrganizationValue { size?: string; headcount?: string; type?: string; }
export interface CorporateStructureValue { parent?: string; subsidiaries?: string[]; ownership?: string; }
export interface OfferingsValue { products?: string[]; services?: string[]; }
export interface TechnologyValue { stack?: string[]; adoption?: string[]; migrations?: string[]; }
export interface MarketPositionValue { segment?: string; positioning?: string; differentiators?: string[]; }
export interface CustomersValue { segments?: string[]; namedCustomers?: string[]; }
export interface PartnersValue { partners?: string[]; channelTypes?: string[]; }
export interface LeadershipValue { executives?: string[]; keyRoles?: string[]; }
export interface FinancialValue { revenueBand?: string; profitability?: string; }
export interface FundingValue { stage?: string; totalRaised?: string; lastRound?: string; }
export interface HiringValue { openRoles?: string[]; growthFunctions?: string[]; }
export interface GrowthValue { trajectory?: string; expansion?: string[]; }
export interface GeographyValue { hq?: string; markets?: string[]; }
export interface BrandValue { voice?: string; themes?: string[]; }
export interface DigitalPresenceValue { channels?: string[]; }
export interface CompetitiveValue { competitors?: string[]; pressures?: string[]; }
export interface RiskValue { risks?: string[]; complianceConcerns?: string[]; instability?: string; }
export interface StrategicInitiativesValue { initiatives?: string[]; transformation?: string[]; }
export interface RecommendationsValue { engagementStrategy?: string; nextBestAction?: string; }
export interface EvidenceSummaryValue { totalEvidence?: number; freshestAt?: ISOTimestamp; }

export interface CompanyFacets {
  worldView: Facet<CompanyWorldView>;
  identity: Facet<IdentityValue>;
  organization: Facet<OrganizationValue>;
  corporateStructure: Facet<CorporateStructureValue>;
  offerings: Facet<OfferingsValue>;
  technology: Facet<TechnologyValue>;
  marketPosition: Facet<MarketPositionValue>;
  customers: Facet<CustomersValue>;
  partners: Facet<PartnersValue>;
  leadership: Facet<LeadershipValue>;
  financial: Facet<FinancialValue>;
  funding: Facet<FundingValue>;
  hiring: Facet<HiringValue>;
  growth: Facet<GrowthValue>;
  geography: Facet<GeographyValue>;
  brand: Facet<BrandValue>;
  digitalPresence: Facet<DigitalPresenceValue>;
  competitive: Facet<CompetitiveValue>;
  risk: Facet<RiskValue>;
  strategicInitiatives: Facet<StrategicInitiativesValue>;
  recommendations: Facet<RecommendationsValue>;
  evidenceSummary: Facet<EvidenceSummaryValue>;
}
export type CompanyFacetName = keyof CompanyFacets;
export const COMPANY_FACET_NAMES: CompanyFacetName[] = [
  'worldView', 'identity', 'organization', 'corporateStructure', 'offerings', 'technology',
  'marketPosition', 'customers', 'partners', 'leadership', 'financial', 'funding', 'hiring',
  'growth', 'geography', 'brand', 'digitalPresence', 'competitive', 'risk', 'strategicInitiatives',
  'recommendations', 'evidenceSummary',
];

export interface CompanyIdentityKey { companyId: string; }

export interface CompanyUnderstanding {
  key: CompanyIdentityKey;
  facets: CompanyFacets;
  score: CompanyScore;
  reasoning: ReasoningTrace[];
  contradictions: ContradictionRef[];
  graph: { root: GraphNodeRef; edges: GraphEdge[] };
  version: number;
  builtAt: ISOTimestamp;      // passed in (deterministic — never Date.now)
}

// ── Projection (single owner; FIELD_OWNERS-style — adopted from the ontology projection design) ──
export interface CompanyProjection {
  key: CompanyIdentityKey;
  version: number;
  worldView: CompanyWorldView | null;
  identity: IdentityValue | null;
  scores: Record<CompanyScoreDimension, number | null>;
  overallScore: number | null;
  confidence: number;
  facetConfidence: Record<CompanyFacetName, number>;
  topContradictions: ContradictionRef[];
  projectedAt: ISOTimestamp;
}

// ── Persistence contract (shadow) ───────────────────────────────────────────────────────────────
export interface CompanyUnderstandingShadowRecord {
  company_id: string;
  version: number;
  understanding: CompanyUnderstanding;
  projection: CompanyProjection;
  parity: number | null;
  built_at: ISOTimestamp;
}

export type CompanyEvidence = EvidenceRef;
