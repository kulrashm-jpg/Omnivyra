import type { EditorGradeResult } from '../../../lib/shared/editorGradeReadiness';
import type { GenerationAcceptanceResult } from '../../../lib/shared/generationAcceptanceEvaluator';
import type { PlannerGenerationInputSelection } from '../../../lib/shared/plannerGenerationInputSelector';

export type GenerationStatus = 'pending' | 'generated' | 'failed';

export type MasterContentPayload = {
  id: string;
  generated_at: string;
  content: string;
  generation_status: GenerationStatus;
  generation_source: 'ai';
  content_type_mode?: 'text' | 'media_blueprint';
  logical_content_type?: string;
  required_media?: boolean;
  media_status?: 'missing' | 'ready';
  decision_trace?: {
    source_topic: string;
    objective: string;
    pain_point: string;
    outcome_promise: string;
    writing_angle: string;
    tone_used: string;
    narrative_role: string;
    progression_step: number | null;
  };
  editor_grade_result?: EditorGradeResult;
  generation_acceptance?: GenerationAcceptanceResult;
  generation_input_selection?: PlannerGenerationInputSelection;
};

export type PlatformVariantPayload = {
  platform: string;
  content_type: string;
  logical_content_type?: string;
  generated_content: string;
  generation_status: GenerationStatus;
  locked_variant: boolean;
  adapted_from_master?: boolean;
  adaptation_style?: 'platform_specific';
  requires_media?: boolean;
  generation_overrides?: Record<string, unknown>;
  adaptation_trace?: {
    platform: string;
    style_strategy: string;
    character_limit_used: number | null;
    target_length_used?: number | null;
    actual_length_used?: number | null;
    format_family: string;
    media_constraints_applied: boolean;
    adaptation_reason: string;
  };
  discoverability_meta?: {
    optimized: boolean;
    strategy_source: 'ai' | 'deterministic';
    platform: string;
    content_type: string;
    hashtag_target: { min: number; max: number; recommended: number };
    keyword_clusters: {
      primary: string[];
      secondary: string[];
      intent_outcome: string[];
    };
    hashtags: string[];
    youtube_tags?: string[];
    generated_at: string;
  };
  algorithmic_formatting_meta?: {
    platform: string;
    formatting_applied: true;
  };
  media_intent?: {
    platform: string;
    recommended_type?: string;
    visual_goal?: string;
    visual_style?: string;
    text_overlay?: 'none' | 'optional' | 'recommended';
    aspect_ratio?: string;
    overlay_style?: string;
    thumbnail_style?: string;
    opening_scene_goal?: string;
    preview_frame_hint?: string;
  };
  media_search_intent?: {
    media_requirements: Array<{
      role: string;
      media_type: 'image' | 'video' | 'thumbnail' | 'illustration';
      required: boolean;
      orientation: 'portrait' | 'landscape' | 'square';
      primary_query: string;
      alternative_queries: string[];
      style_tags: string[];
      platform_reason: string;
    }>;
  };
  editor_grade_result?: EditorGradeResult;
  generation_acceptance?: GenerationAcceptanceResult;
  generation_input_selection?: PlannerGenerationInputSelection;
};

export type MediaAssetPayload = {
  id?: string;
  type: string;
  source_url: string;
  status: 'attached';
};

export type PlatformTarget = {
  platform: string;
  content_type: string;
  max_length?: number;
  generation_overrides?: Record<string, unknown>;
};

export type DailyExecutionItemLike = {
  execution_id?: string;
  platform?: string;
  content_type?: string;
  topic?: string;
  title?: string;
  original_topic?: string;
  original_title?: string;
  generation_input_topic?: string;
  generation_input_title?: string;
  intent?: Record<string, unknown>;
  writer_content_brief?: Record<string, unknown>;
  active_platform_targets?: unknown;
  planned_platform_targets?: unknown;
  selected_platforms?: unknown;
  media_assets?: MediaAssetPayload[];
  media_status?: 'missing' | 'ready';
  master_content?: MasterContentPayload;
  platform_variants?: PlatformVariantPayload[];
  progression_step?: number | null;
  global_progression_index?: number | null;
  execution_readiness?: {
    text_ready: boolean;
    media_ready: boolean;
    platform_ready: boolean;
    discoverability_ready: boolean;
    algorithm_ready: boolean;
    ready_to_schedule: boolean;
    blocking_reasons: string[];
  };
  execution_jobs?: Array<{
    job_id: string;
    platform: string;
    content_type: string;
    variant_ref: string;
    ready_to_schedule: boolean;
    status: 'ready' | 'blocked';
    blocking_reasons: string[];
  }>;
};
