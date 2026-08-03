/**
 * INT-001 Phase 6 — stable read models (DTOs).
 *
 * These are the ONLY shapes UI/API consumers see. They are decoupled from the
 * persistence schema on purpose: rows are normalized through the tolerant
 * mapper, so persistence/engine shape changes never leak to consumers. This
 * module is types-only — no logic, no I/O.
 */

import type { IntelligenceFreshness } from '../leadIntelligenceOrchestration/types';

export type { IntelligenceFreshness };

/** Version metadata, exactly as persisted. Read-only. */
export interface IntelligenceVersionDTO {
  engineVersion: string;
  schemaVersion: number;
  /** Per-lead generation counter (persisted `generationVersion`). */
  generation: number;
  /** SHA-256 input fingerprint, exactly as persisted. */
  fingerprint: string;
  generatedAt: string;
}

export interface IntentContributionDTO {
  signal: string;
  label: string;
  points: number;
  evidence: string;
}

export interface IntentDTO {
  score: number;
  band: string;
  contributions: IntentContributionDTO[];
}

export interface PersonaDTO {
  persona: string;
  confidence: number;
  reasons: string[];
}

export interface QualificationSectionDTO {
  key: string;
  score: number;
  weight: number;
  weightedScore: number;
  reason: string;
}

export interface QualificationDTO {
  totalScore: number;
  band: string;
  sections: QualificationSectionDTO[];
}

export interface SegmentDTO {
  segment: string;
  confidence: number;
  reasons: string[];
}

/** One recommendation, flattened into a stable list shape for rendering. */
export interface RecommendationItemDTO {
  key: string;
  label: string;
  value: string | string[] | number;
  confidence: number;
  explanation: string;
}

export interface TimelineEntryDTO {
  type: string;
  label: string;
  occurredAt: string;
  pageUrl: string | null;
  category: string | null;
  source: string;
}

// ── INT-002 Wave 2: qualification-planning + automation layers ──────────────

export interface PlanningDimensionDTO {
  key: string;
  score: number;
  weight: number;
  confidence: number;
  explanation: string;
}

export interface PlanningChannelDTO {
  channel: string;
  confidence: number;
  reasoning: string;
}

export interface OutreachPlanStepDTO {
  order: number;
  step: string;
  channel: string;
  detail: string;
}

export interface PlanningActionDTO {
  action: string;
  priority: string;
  rank: number;
  confidence: number;
  explanation: string;
}

/** Normalized Phase 3 qualification-planning layer (null on legacy records). */
export interface QualificationPlanningDTO {
  totalScore: number;
  band: string;
  confidence: number;
  dimensions: PlanningDimensionDTO[];
  reasoning: string[];
  channels: PlanningChannelDTO[];
  plan: {
    playbook: string;
    confidence: number;
    reasoning: string;
    steps: OutreachPlanStepDTO[];
  } | null;
  actions: PlanningActionDTO[];
}

export interface AutomationTaskDTO {
  id: string;
  order: number;
  dependsOn: string | null;
  kind: string;
  action: string;
  channel: string | null;
  estimatedDelayHours: number;
  confidence: number;
  explanation: string;
}

export interface AutomationTimelineEntryDTO {
  day: number;
  scheduledAt: string;
  taskId: string;
  action: string;
  channel: string | null;
}

/** Normalized Phase 5 automation-planning layer (null on legacy records). */
export interface AutomationPlanningDTO {
  status: string;
  statusReasons: string[];
  confidence: number;
  tasks: AutomationTaskDTO[];
  timeline: AutomationTimelineEntryDTO[];
  channelSequence: PlanningChannelDTO[];
  review: {
    reviewRequired: boolean;
    reasons: string[];
    missingInformation: string[];
  } | null;
}

/**
 * The canonical single-lead read model.
 * `status: 'never_generated'` ⇒ every intelligence section is null/empty and
 * `version` is null — exactly the persisted absence, never inferred content.
 */
export interface LeadIntelligenceViewDTO {
  companyId: string;
  leadId: string;
  status: 'available' | 'never_generated';
  /** fresh | stale | pending_regeneration | never_generated — as stored state. */
  freshness: IntelligenceFreshness;
  version: IntelligenceVersionDTO | null;
  overallConfidence: number | null;
  intent: IntentDTO | null;
  persona: PersonaDTO | null;
  qualification: QualificationDTO | null;
  segments: SegmentDTO[];
  recommendations: RecommendationItemDTO[];
  timeline: TimelineEntryDTO[];
  /** INT-002 Wave 2 — persisted Phase 3 layer; null on legacy/absent records. */
  qualificationPlanning: QualificationPlanningDTO | null;
  /** INT-002 Wave 2 — persisted Phase 5 layer; null on legacy/absent records. */
  automationPlanning: AutomationPlanningDTO | null;
}

/** Compact projection for Lead List consumers — pure selection from the view. */
export interface LeadIntelligenceListItemDTO {
  leadId: string;
  status: 'available' | 'never_generated';
  freshness: IntelligenceFreshness;
  overallScore: number | null;
  qualificationBand: string | null;
  intentBand: string | null;
  primaryPersona: string | null;
  primarySegment: string | null;
  topAction: string | null;
  confidence: number | null;
  generatedAt: string | null;
  engineVersion: string | null;
}

/** UI presentation of a freshness state (labeling only, no inference). */
export interface FreshnessPresentationDTO {
  state: IntelligenceFreshness;
  label: string;
  tone: 'positive' | 'warning' | 'info' | 'neutral';
  description: string;
}

/** Read-only aggregation over a set of views (counts/selection only). */
export interface IntelligenceAggregationDTO {
  total: number;
  available: number;
  byFreshness: Record<IntelligenceFreshness, number>;
  byBand: Record<string, number>;
  /** Mean of persisted total scores across available views (null when none). */
  averageScore: number | null;
}
