/**
 * Execution Provenance — canonical traceability contract (Phase-2 Step-16).
 * Replaces heuristic authoritative detection with a real persisted record.
 */

export type ProvenanceGenerationSource = 'LEGACY' | 'AUTHORITATIVE' | 'HYBRID';
export type ProvenanceGenerationStage = 'WEEKLY' | 'DAILY' | 'PLANNER' | 'THEME' | 'AI_PLAN';
export type ProvenanceGenerationMode = 'STRATEGY_FIRST' | 'SKELETON_FIRST' | 'CONVERGED';
export type ProvenanceRoutingSource = 'LEGACY' | 'CENTRALIZED_ROUTING';
export type ProvenanceReadinessSource = 'LEGACY' | 'CANONICAL_READINESS';

export const ORCHESTRATION_VERSION = 'phase2-step16';

export interface ExecutionProvenanceLineage {
  parent_execution_id?: string;
  originating_strategy_id?: string;
  originating_week_id?: string;
  originating_theme?: string;
}

export interface ExecutionProvenance {
  execution_id: string;
  generation_source: ProvenanceGenerationSource;
  generation_stage: ProvenanceGenerationStage;
  generation_mode: ProvenanceGenerationMode;
  routing_source: ProvenanceRoutingSource;
  readiness_source: ProvenanceReadinessSource;
  orchestration_version: string;
  fallback_active: boolean;
  rollback_triggered: boolean;
  authoritative_confidence: number;
  generation_timestamp: string;
  lineage: ExecutionProvenanceLineage;
  metadata: Record<string, unknown>;
}

export interface CampaignProvenanceSummary {
  campaign_id: string;
  total: number;
  authoritative_coverage: number; // 0..1
  legacy_coverage: number;
  hybrid_coverage: number;
  fallback_coverage: number;
  rollback_coverage: number;
  generation_mode_distribution: Record<string, number>;
  generation_stage_distribution: Record<string, number>;
  resolved_at: string;
}

/** The content-blob key authoritative generators stamp provenance under. */
export const PROVENANCE_KEY = 'provenance';
