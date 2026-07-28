/**
 * COMPANY-INTELLIGENCE-PROGRAM-002 / Phase C — company engine contract.
 * Every engine is a PURE, DETERMINISTIC evidence contributor into the Phase B canonical Company
 * contracts. An engine emits evidence / contributions / facet fragments / graph edges / reasoning —
 * it NEVER owns Company Understanding, the projection, the score, the graph, or persistence (the
 * assembly pipeline is the sole owner). Engines abstain when evidence is insufficient.
 */

import type { CompanyIdentityKey, CompanyFacets, CompanyContribution, EvidenceRef } from '../types';
import type { ReasoningTrace, GraphEdge } from '../../intelligence/canonical';
import type { CompanyProfileInput } from '../fromProfile';

export type CompanySignalType =
  | 'hiring' | 'exec_hire' | 'funding' | 'customer_announcement' | 'partnership' | 'expansion'
  | 'acquisition' | 'product_launch' | 'geo_expansion' | 'revenue' | 'market_activity';
export interface CompanySignal { type: CompanySignalType; detail?: string; source: string; observedAt: string; confidence?: number; }

export interface CompanyIntelligenceContext {
  key: CompanyIdentityKey;
  asOf: string;
  profile?: CompanyProfileInput;                 // baseline adoption facets (Phase B bridge)
  technology?: { stack?: string[]; cloud?: string[]; languages?: string[]; databases?: string[]; devops?: string[]; security?: string[]; ai?: string[]; integrations?: string[]; migrations?: string[]; source?: string; observedAt?: string };
  product?: { products?: string[]; services?: string[]; pricing?: string; positioning?: string; differentiators?: string[]; maturity?: string; roadmapSignals?: string[]; source?: string; observedAt?: string };
  signals?: CompanySignal[];                      // growth
  executives?: Array<{ name: string; role?: string; tenure?: string; influence?: string; change?: 'joined' | 'left' | 'promoted'; source: string; observedAt: string }>;
  customers?: Array<{ name: string; segment?: string; strategic?: boolean; source: string; observedAt: string }>;
  partners?: Array<{ name: string; type?: 'channel' | 'technology' | 'reseller' | 'alliance'; source: string; observedAt: string }>;
  financial?: { fundingStage?: string; totalRaised?: string; valuation?: string; revenueBand?: string; profitability?: string; runway?: string; source?: string; observedAt?: string };
  competitors?: Array<{ name: string; source: string; observedAt: string }>; // reference only — no ownership
  risks?: Array<{ type: string; detail?: string; impact?: 'low' | 'medium' | 'high'; source: string; observedAt: string }>;
}

export interface CompanyEngineOutput {
  engine: string;
  abstained: boolean;
  facets: Partial<CompanyFacets>;
  contributions: CompanyContribution[];
  evidence: EvidenceRef[];
  edges: GraphEdge[];
  reasoning: ReasoningTrace[];
}

export function emptyOutput(engine: string): CompanyEngineOutput {
  return { engine, abstained: true, facets: {}, contributions: [], evidence: [], edges: [], reasoning: [] };
}
