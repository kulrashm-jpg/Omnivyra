/**
 * OFFERING-INTELLIGENCE-PROGRAM-003 / Phase C — offering engine contract.
 * Every engine is a PURE, DETERMINISTIC evidence contributor into the Phase B canonical Offering
 * contracts. An engine emits evidence / contributions / facet fragments / graph edges / reasoning —
 * it NEVER owns Offering Understanding, the projection, the score, the graph, or persistence (the
 * assembly pipeline is the sole owner). Engines abstain when evidence is insufficient. Two layers:
 * Layer 1 intrinsic (what the offering IS), Layer 2 market (how it is perceived/adopted).
 */

import type { OfferingIdentityKey, OfferingFacets, OfferingContribution, EvidenceRef } from '../types';
import type { ReasoningTrace, GraphEdge } from '../../intelligence/canonical';
import type { OfferingSeedInput } from '../fromSeed';

export interface OfferingIntelligenceContext {
  key: OfferingIdentityKey;
  asOf: string;
  seed?: OfferingSeedInput;                        // baseline adoption facets (Phase B bridge)
  // Layer 1 — intrinsic
  features?: { features?: string[]; modules?: string[]; editions?: string[]; dependencies?: string[]; source?: string; observedAt?: string };
  pricing?: { model?: string; billing?: string; plans?: string[]; usageBased?: boolean; enterprise?: boolean; freemium?: boolean; trials?: boolean; discounting?: string; source?: string; observedAt?: string };
  packaging?: { plans?: string[]; bundles?: string[]; editions?: string[]; upgradePaths?: string[]; featureGating?: string[]; source?: string; observedAt?: string };
  positioning?: { statement?: string; messaging?: string[]; valueProposition?: string; category?: string; differentiation?: string[]; source?: string; observedAt?: string };
  integrations?: { apis?: string[]; integrations?: string[]; marketplaces?: string[]; partnerIntegrations?: string[]; extensibility?: string; source?: string; observedAt?: string };
  compliance?: { certifications?: string[]; standards?: string[]; security?: string; privacy?: string; source?: string; observedAt?: string };
  categoryCapability?: { primaryCategory?: string; secondaryCategories?: string[]; capabilities?: string[]; adjacents?: string[]; substitutes?: string[]; complements?: string[]; source?: string; observedAt?: string };
  // Layer 2 — market
  marketFit?: { icpFit?: string; sizeFit?: string; industryFit?: string[]; geoFit?: string[]; useCaseFit?: string[]; deploymentFit?: string[]; source?: string; observedAt?: string };
  personas?: Array<{ name: string; role?: 'buyer' | 'champion' | 'decision_maker' | 'evaluator' | 'influencer' | 'user'; source: string; observedAt: string }>;
  adoption?: { customers?: string; traction?: string; deploymentMaturity?: string; retention?: string; expansion?: string; usageMomentum?: string; source?: string; observedAt?: string };
  lifecycle?: { stage?: 'introduction' | 'growth' | 'maturity' | 'decline'; roadmap?: string[]; releaseCadence?: string; source?: string; observedAt?: string };
  competitors?: Array<{ name: string; overlap?: string[]; source: string; observedAt: string }>; // reference only
  enrichment?: OfferingEnrichmentInput;            // OI-D401 advanced enrichment
}

export interface OfferingEnrichmentInput {
  editions?: string[]; regionalAvailability?: string[]; releaseChannels?: string[]; featureFlags?: string[];
  ecosystemMaturity?: string; marketplacePresence?: string[]; developerAdoption?: string;
  customerSuccess?: string; implementationComplexity?: string; onboardingMaturity?: string;
  source?: string; observedAt?: string;
}

export interface OfferingEngineOutput {
  engine: string;
  layer: 'intrinsic' | 'market' | 'synthesis';
  abstained: boolean;
  facets: Partial<OfferingFacets>;
  contributions: OfferingContribution[];
  evidence: EvidenceRef[];
  edges: GraphEdge[];
  reasoning: ReasoningTrace[];
}

export function emptyOutput(engine: string, layer: OfferingEngineOutput['layer']): OfferingEngineOutput {
  return { engine, layer, abstained: true, facets: {}, contributions: [], evidence: [], edges: [], reasoning: [] };
}
