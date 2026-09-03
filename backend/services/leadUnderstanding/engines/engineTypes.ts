/**
 * LEAD-INTELLIGENCE-PROGRAM-001 / Phase C — engine contract.
 *
 * Every engine is a PURE, DETERMINISTIC evidence contributor into the Phase B canonical contracts.
 * An engine emits evidence / contributions / facet fragments / graph edges / reasoning traces — it
 * NEVER owns the final score, the projection, the graph, or the Understanding (the assembly pipeline
 * is the sole owner). Engines abstain when evidence is insufficient.
 */

import type {
  LeadIdentityKey, LeadFacets, ScoreContribution, EvidenceRef, GraphEdge, ReasoningTrace, EvidenceKind,
} from '../types';
import { evidenceRef } from '../evidence';
import type { RatifiedIcp } from '../../prospectIcp/types';

// ── Raw structured inputs (from System A/B, enrichment, upstream Understandings) ────────────────
export interface RawObservation { label: string; value?: string | number | boolean | null; source: string; observedAt: string; kind?: EvidenceKind; weight?: number; }

export type BuyingSignalType =
  | 'hiring' | 'funding' | 'exec_change' | 'leadership' | 'product_launch' | 'pricing_change'
  | 'acquisition' | 'partnership' | 'tech_adoption' | 'tech_migration' | 'website_change'
  | 'social' | 'news' | 'community' | 'analyst' | 'filing' | 'customer_announcement' | 'expansion';
export interface RawSignal { type: BuyingSignalType; detail?: string; source: string; observedAt: string; confidence?: number; }

export type RelationshipRole = 'decision_maker' | 'champion' | 'influencer' | 'evaluator' | 'blocker' | 'procurement' | 'technical' | 'financial' | 'user';
export interface RawRelationship { personId: string; role?: RelationshipRole; reportsTo?: string; source: string; observedAt: string; }

export type QualificationDimension = 'budget' | 'authority' | 'need' | 'timing' | 'urgency' | 'procurement' | 'org_readiness' | 'competitive' | 'strategic' | 'maturity' | 'expansion' | 'implementation';
export interface QualificationInput { value?: string; known: boolean; source?: string; observedAt?: string; }

// ── Phase D inputs (all optional; engines abstain when absent → Phase C behavior preserved) ──────
export type BuyingStage = 'awareness' | 'consideration' | 'evaluation' | 'decision' | 'customer';
export interface EnrichmentInput {
  executiveProfile?: string; verifiedContact?: boolean; roleEvolution?: string[]; careerProgression?: string[];
  organizationHistory?: string[]; certifications?: string[]; skills?: string[]; publicInfluence?: string;
  speaking?: string[]; authoredContent?: string[]; patents?: string[]; publications?: string[]; advisoryRoles?: string[];
  source?: string; observedAt?: string;
}
export interface BehaviouralEvent { label: string; stage?: BuyingStage; source: string; observedAt: string; value?: number; }
export interface StrategicInput { initiatives?: string[]; transformation?: string[]; growthStrategy?: string[]; marketExpansion?: string[]; source?: string; observedAt?: string; }

export interface LeadIntelligenceContext {
  key: LeadIdentityKey;
  asOf: string;                                  // deterministic "now" (decay/freshness anchor)
  identity?: { title?: string; department?: string; seniority?: string; organization?: string; email?: string; geography?: string; source?: string; observedAt?: string };
  behaviour?: RawObservation[];                  // website/content/campaign/email/social engagement
  signals?: RawSignal[];                         // buying signals
  relationships?: RawRelationship[];
  qualification?: Partial<Record<QualificationDimension, QualificationInput>>;
  icp?: { industryMatch?: boolean; sizeMatch?: boolean; geoMatch?: boolean; source?: string; observedAt?: string };
  /**
   * PI-P1-W03 — the tenant's RATIFIED ICP, already resolved.
   *
   * Resolved ASYNCHRONOUSLY and tenant-scoped by the caller that builds this
   * context, through D1's own `getRatifiedIcp`. It arrives here already loaded
   * because `assembleLeadUnderstanding` is synchronous and no engine may
   * perform I/O.
   *
   * `null` is meaningful and must be preserved: it is "this tenant has ratified
   * nothing", which the evaluator turns into an abstention. Deliberately NOT
   * folded into the `icp` booleans above — those cannot carry criteria,
   * evidence or an abstention reason, and nothing populates them.
   */
  ratifiedIcp?: RatifiedIcp | null;
  companyId?: string;                            // upstream Company Understanding node (graph ref only)
  offeringId?: string;
  competitorId?: string;
  // Phase D (optional)
  enrichment?: EnrichmentInput;                  // LI-D301 advanced enrichment
  behaviouralHistory?: BehaviouralEvent[];       // LI-D303 longitudinal behaviour
  strategicInputs?: StrategicInput;              // LI-D305 strategic inputs
}

export interface EngineOutput {
  engine: string;
  abstained: boolean;
  facets: Partial<LeadFacets>;
  contributions: ScoreContribution[];
  evidence: EvidenceRef[];
  edges: GraphEdge[];
  reasoning: ReasoningTrace[];
}

export function emptyOutput(engine: string): EngineOutput {
  return { engine, abstained: true, facets: {}, contributions: [], evidence: [], edges: [] , reasoning: [] };
}

/** Deterministic evidence id: engine:label:source:observedAt (stable, collision-safe). */
export function mkEvidence(engine: string, o: RawObservation): EvidenceRef {
  return evidenceRef({
    id: `${engine}:${o.label}:${o.source}:${o.observedAt}`,
    kind: o.kind ?? 'observed', label: o.label, value: o.value ?? null,
    source: { system: o.source }, observedAt: o.observedAt, recordedAt: o.observedAt, weight: o.weight,
  });
}

/** Deterministic decay: 0.5 ^ (ageDays / halfLifeDays), clamped [0,1]. Timestamps passed in. */
export function decayFactor(observedAt: string, asOf: string, halfLifeDays: number): number {
  const ageMs = Math.max(0, Date.parse(asOf) - Date.parse(observedAt));
  const ageDays = ageMs / 86_400_000;
  return Number(Math.max(0, Math.min(1, Math.pow(0.5, ageDays / Math.max(1e-6, halfLifeDays)))).toFixed(4));
}

export const clamp01 = (n: number): number => Number(Math.max(0, Math.min(1, n)).toFixed(4));
