/**
 * Card-to-Content Bridge — model layer.
 *
 * All public types for the bridge. Split from cardToContentBridge.ts (Agent-B
 * large-file modularization); the main module re-exports everything here, so
 * external importers keep using 'cardToContentBridge'.
 */

import type { RecommendationStrategicCard } from '../recommendationStrategicCard';
import type { PlannerStrategicCard } from '../plannerStrategicCard';
import type { BlogAngle, AngleType } from '../blog/blogGenerationEngine';

// ── Types ─────────────────────────────────────────────────────────────────────

export type ContentGoal = 'awareness' | 'authority' | 'conversion' | 'retention';
export type ContentType = 'blog' | 'article' | 'whitepaper' | 'post' | 'narrative';

export interface CardBridgeInput {
  strategic_card: RecommendationStrategicCard | PlannerStrategicCard;
  /** Optional: theme card for hook variants + emotional tone injection */
  theme_card?: ThemeCardInput | null;
  content_type?: ContentType;
  target_audience?: string;
  goal?: ContentGoal;
  /** Force a specific angle type; if omitted, derived from campaign_angle */
  override_angle_type?: AngleType;
}

/** Minimal theme card surface — accepts either a planner weekly theme or any object
 *  with the relevant fields. Intentionally loose for compatibility. */
export interface ThemeCardInput {
  title?: string | null;
  theme_angle?: string | null;
  narrative_direction?: string | null;
  hooks?: string[] | null;
  messaging_hooks?: string[] | null;
  emotional_tone?: string | null;
  reader_emotion_target?: string | null;
  stage_objective?: string | null;
}

// ── Depth map ─────────────────────────────────────────────────────────────────

export interface DepthMapEntry {
  pillar: string;
  key_point: string;
  why_it_matters: string;
  mechanism: string;
  example_direction: string;
  insight_angle: string;
  contrarian_take: string;
}

// ── Structure section ─────────────────────────────────────────────────────────

export interface StructureSection {
  section_title: string;
  intent: string;
  must_include_points: string[];
  depth_requirements: {
    explanation: string;
    mechanism: string;
    example: string;
    insight: string;
  };
}

// ── Decision layer ────────────────────────────────────────────────────────────

export interface DecisionBlock {
  topic: string;
  comparisons: string[];
  trade_offs: string[];
  when_to_use: string[];
  when_not_to_use: string[];
}

// ── Full bridge output ────────────────────────────────────────────────────────

export interface ContentGenerationInput {
  content_type: ContentType;
  audience: string;
  goal: ContentGoal;
  selected_angle: string;
  strategic_core: {
    core_problem: string;
    pain_points: string[];
    transformation_goal: string;
    authority_basis: string;
  };
  narrative_direction: string;
  must_include_points: string[];
  trend_context: string;
  uniqueness_directive: string;
  depth_map: DepthMapEntry[];
  structure: StructureSection[];
  decision_blocks: DecisionBlock[];
  tone: string;
  hook_variants: string[];
  differentiation: string;
  key_messages: string[];
  /** Pre-populated answers map ready for injection into BlogGenerationRequest.answers */
  answers: Record<string, string>;
  /** Derived BlogAngle ready for BlogGenerationRequest.selected_angle */
  derived_angle: BlogAngle | null;
  /** Mapped intent for BlogGenerationRequest.intent */
  intent: string;
  /** Core topic string for BlogGenerationRequest.topic */
  topic: string;
  /** Cluster tag for BlogGenerationRequest.cluster */
  cluster: string | null;
}

export interface CardBridgeOutput {
  content_generation_input: ContentGenerationInput;
  validation: CardBridgeValidation;
}

export interface CardBridgeValidation {
  card_to_content_transformation: {
    input_strategy_retention_score: number;
    theme_alignment_score: number;
    depth_map_quality_score: number;
    decision_layer_presence: boolean;
  };
  before_vs_after: {
    theme_to_content_score_before: 31;
    theme_to_content_score_after: number;
    strategic_card_integration_before: 34;
    strategic_card_integration_after: number;
  };
  quality_checks: {
    generic_output_reduction: string;
    insight_presence_improvement: string;
    structure_improvement: string;
  };
  integration_checks: {
    manual_input_removed: boolean;
    field_mapping_coverage: string;
    signal_loss_detected: boolean;
  };
}
