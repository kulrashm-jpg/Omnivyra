/**
 * INT-001 Phase 3 — Qualification & Autonomous Planning: shared contracts.
 *
 * This layer CONSUMES the outputs of capture (lead/attribution/journey via the
 * Phase 2 snapshot) and of the Phase 2 intent/persona engines. It never
 * modifies how those values are generated, performs no I/O, reads no clock
 * (time is `snapshot.now`), and contains no randomness — identical input
 * always produces identical output.
 */

import type {
  LeadCaptureSnapshot,
  IntentIntelligence,
  PersonaIntelligence,
  Persona,
} from '../leadIntelligenceEngine/types';

export type { LeadCaptureSnapshot, IntentIntelligence, PersonaIntelligence, Persona };

/** The complete Phase 3 input: capture snapshot + upstream intelligence. */
export interface QualificationPlanningInput {
  snapshot: LeadCaptureSnapshot;
  intent: IntentIntelligence;
  persona: PersonaIntelligence;
  /** Optional enrichment known to the caller (used only when present). */
  context?: PlanningContext;
}

/** Optional, caller-supplied context. Every field is optional by design. */
export interface PlanningContext {
  existingCustomer?: boolean;
  knownIcpMatch?: boolean;
  organizationType?: 'company' | 'agency' | 'nonprofit' | 'education' | 'government' | 'individual';
  phoneNumber?: string | null;
}

// ---------------------------------------------------------------------------
// Dimensions
// ---------------------------------------------------------------------------

export type QualificationDimensionKey = 'intent' | 'persona' | 'companyFit' | 'behavioralFit' | 'urgency';

export interface DimensionAssessment {
  key: QualificationDimensionKey;
  /** 0..100 */
  score: number;
  /** 0..1 — static per-dimension weight; all five sum to 1. */
  weight: number;
  /** 0..1 — how much evidence backs the score. */
  confidence: number;
  explanation: string;
}

/** One explainable signal contribution inside an engine. */
export interface SignalContribution {
  signal: string;
  points: number;
  evidence: string;
}

export interface UrgencyAssessment {
  score: number; // 0..100
  confidence: number; // 0..1
  explanation: string;
  signals: SignalContribution[];
}

export interface CompanyFitAssessment {
  score: number; // 0..100
  confidence: number; // 0..1
  explanation: string;
  signals: SignalContribution[];
}

export interface BehavioralFitAssessment {
  score: number; // 0..100
  confidence: number; // 0..1
  explanation: string;
  signals: SignalContribution[];
}

// ---------------------------------------------------------------------------
// Qualification
// ---------------------------------------------------------------------------

export type QualificationBand = 'hot' | 'warm' | 'cool' | 'cold';

export interface QualificationResult {
  dimensions: DimensionAssessment[];
  /** 0..100 — sum of weighted dimension scores, rounded. */
  totalScore: number;
  /** 0..1 — totalScore / 100. */
  normalizedScore: number;
  band: QualificationBand;
  /** 0..1 — weight-averaged dimension confidence. */
  confidence: number;
  /** Deterministic, ordered human-readable reasoning lines. */
  reasoning: string[];
}

// ---------------------------------------------------------------------------
// Channel intelligence
// ---------------------------------------------------------------------------

export type OutreachChannel =
  | 'linkedin'
  | 'email'
  | 'phone'
  | 'whatsapp'
  | 'sms'
  | 'github'
  | 'discord'
  | 'slack'
  | 'community';

export interface ChannelRecommendation {
  channel: OutreachChannel;
  confidence: number; // 0..1
  reasoning: string;
}

// ---------------------------------------------------------------------------
// Autonomous planning
// ---------------------------------------------------------------------------

export interface OutreachPlanStep {
  order: number; // 1-based
  step: string;
  channel: OutreachChannel | 'content';
  detail: string;
}

export interface OutreachPlan {
  playbook: string;
  steps: OutreachPlanStep[];
  reasoning: string;
  confidence: number; // 0..1
}

export type ActionPriority = 'critical' | 'high' | 'medium' | 'low';

export interface RecommendedAction {
  action: string;
  priority: ActionPriority;
  /** Deterministic tiebreak-stable rank, 1-based. */
  rank: number;
  confidence: number; // 0..1
  explanation: string;
}

// ---------------------------------------------------------------------------
// Consolidated summary
// ---------------------------------------------------------------------------

export interface QualificationPlanningSummary {
  leadId: string | null;
  qualification: QualificationResult;
  urgency: UrgencyAssessment;
  companyFit: CompanyFitAssessment;
  behavioralFit: BehavioralFitAssessment;
  intent: IntentIntelligence;
  persona: PersonaIntelligence;
  overallScore: number; // === qualification.totalScore
  recommendedChannels: ChannelRecommendation[];
  recommendedPlan: OutreachPlan;
  recommendedActions: RecommendedAction[];
  confidence: number; // 0..1 — qualification confidence
  generatedAt: string; // === snapshot.now
}
