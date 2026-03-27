export type RecommendationStrategicCard = {
  source: {
    recommendation_id: string | null;
    snapshot_hash: string | null;
  };
  core: {
    topic: string | null;
    polished_title: string | null;
    summary: string | null;
    narrative_direction: string | null;
    estimated_reach: number | null;
    formats: string[];
    regions: string[];
  };
  strategic_context: {
    aspect: string | null;
    facets: string[];
    audience_personas: string[];
    messaging_hooks: string[];
  };
  intelligence: {
    problem_being_solved: string | null;
    gap_being_filled: string | null;
    why_now: string | null;
    authority_reason: string | null;
    expected_transformation: string | null;
    campaign_angle: string | null;
  };
  execution: {
    execution_stage: string | null;
    stage_objective: string | null;
    psychological_goal: string | null;
    momentum_level: string | null;
  };
  company_context_snapshot: {
    core_problem_statement: string | null;
    pain_symptoms: string[];
    desired_transformation: string | null;
    authority_domains: string[];
    brand_voice: string | null;
    brand_positioning: string | null;
    reader_emotion_target: string | null;
    narrative_flow_seed: string | null;
    recommended_cta_style: string | null;
  };
  signals: {
    diamond_type: string | null;
    strategy_mode: string | null;
    final_alignment_score: number | null;
    strategy_modifier: number | null;
  };
  blueprint: {
    duration_weeks: number | null;
    progression_summary: string | null;
    primary_recommendations: string[];
    supporting_recommendations: string[];
  };
};

export type RecommendationStrategicCardDraft = {
  core: {
    topic: string;
    polished_title: string;
    summary: string;
    narrative_direction: string;
    estimated_reach: string;
    formats: string;
    regions: string;
  };
  strategic_context: {
    aspect: string;
    facets: string;
    audience_personas: string;
    messaging_hooks: string;
  };
  intelligence: {
    problem_being_solved: string;
    gap_being_filled: string;
    why_now: string;
    authority_reason: string;
    expected_transformation: string;
    campaign_angle: string;
  };
  execution: {
    execution_stage: string;
    stage_objective: string;
    psychological_goal: string;
    momentum_level: string;
  };
  company_context_snapshot: {
    core_problem_statement: string;
    pain_symptoms: string;
    desired_transformation: string;
    authority_domains: string;
    brand_voice: string;
    brand_positioning: string;
    reader_emotion_target: string;
    narrative_flow_seed: string;
    recommended_cta_style: string;
  };
  blueprint: {
    duration_weeks: string;
    progression_summary: string;
    primary_recommendations: string;
    supporting_recommendations: string;
  };
};

export const RECOMMENDATION_STRATEGIC_THEME_SCHEMA_VERSION = 1;
export const RECOMMENDATION_STRATEGIC_THEME_SCHEMA_TYPE = 'recommendation_strategic_card';

const readText = (obj: Record<string, unknown> | null | undefined, key: string): string | null => {
  if (!obj) return null;
  const value = obj[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
};

const readNumber = (obj: Record<string, unknown> | null | undefined, key: string): number | null => {
  if (!obj) return null;
  const value = obj[key];
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
};

const readList = (obj: Record<string, unknown> | null | undefined, key: string): string[] => {
  if (!obj) return [];
  const value = obj[key];
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === 'string' ? item.trim() : String(item ?? '').trim()))
    .filter(Boolean);
};

const readTopicList = (obj: Record<string, unknown> | null | undefined, key: string): string[] => {
  if (!obj) return [];
  const value = obj[key];
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (typeof item === 'string') return item.trim();
      if (item && typeof item === 'object' && typeof (item as { topic?: unknown }).topic === 'string') {
        return (item as { topic: string }).topic.trim();
      }
      return '';
    })
    .filter(Boolean);
};

const readNestedObject = (
  obj: Record<string, unknown> | null | undefined,
  key: string
): Record<string, unknown> | null => {
  if (!obj) return null;
  const value = obj[key];
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
};

const toCsv = (values: string[]): string => values.join(', ');

const fromCsv = (value: string): string[] =>
  String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

const nullable = (value: string): string | null => {
  const trimmed = String(value ?? '').trim();
  return trimmed ? trimmed : null;
};

const nullableNumber = (value: string): number | null => {
  const trimmed = String(value ?? '').trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
};

export function buildRecommendationStrategicCard(
  recommendation: Record<string, unknown> | null | undefined
): RecommendationStrategicCard {
  const rec = recommendation ?? {};
  const intelligence = (rec.intelligence as Record<string, unknown> | undefined) ?? null;
  const execution = (rec.execution as Record<string, unknown> | undefined) ?? null;
  const snapshot = (rec.company_context_snapshot as Record<string, unknown> | undefined) ?? null;

  return {
    source: {
      recommendation_id: readText(rec, 'id'),
      snapshot_hash: readText(rec, 'snapshot_hash'),
    },
    core: {
      topic: readText(rec, 'topic'),
      polished_title: readText(rec, 'polished_title'),
      summary: readText(rec, 'summary') ?? readText(rec, 'narrative_direction'),
      narrative_direction: readText(rec, 'narrative_direction'),
      estimated_reach: readNumber(rec, 'estimated_reach') ?? readNumber(rec, 'volume'),
      formats: readList(rec, 'formats'),
      regions: readList(rec, 'regions'),
    },
    strategic_context: {
      aspect: readText(rec, 'aspect') ?? readText(rec, 'selected_aspect'),
      facets: readList(rec, 'facets'),
      audience_personas: readList(rec, 'audience_personas'),
      messaging_hooks: readList(rec, 'messaging_hooks'),
    },
    intelligence: {
      problem_being_solved: readText(intelligence, 'problem_being_solved'),
      gap_being_filled: readText(intelligence, 'gap_being_filled'),
      why_now: readText(intelligence, 'why_now'),
      authority_reason: readText(intelligence, 'authority_reason'),
      expected_transformation: readText(intelligence, 'expected_transformation'),
      campaign_angle: readText(intelligence, 'campaign_angle'),
    },
    execution: {
      execution_stage: readText(execution, 'execution_stage') ?? readText(rec, 'execution_stage'),
      stage_objective: readText(execution, 'stage_objective') ?? readText(rec, 'stage_objective'),
      psychological_goal:
        readText(execution, 'psychological_goal') ?? readText(rec, 'psychological_goal'),
      momentum_level: readText(execution, 'momentum_level') ?? readText(rec, 'momentum_level'),
    },
    company_context_snapshot: {
      core_problem_statement: readText(snapshot, 'core_problem_statement'),
      pain_symptoms: readList(snapshot, 'pain_symptoms'),
      desired_transformation: readText(snapshot, 'desired_transformation'),
      authority_domains: readList(snapshot, 'authority_domains'),
      brand_voice: readText(snapshot, 'brand_voice'),
      brand_positioning: readText(snapshot, 'brand_positioning'),
      reader_emotion_target: readText(snapshot, 'reader_emotion_target'),
      narrative_flow_seed: readText(snapshot, 'narrative_flow_seed'),
      recommended_cta_style: readText(snapshot, 'recommended_cta_style'),
    },
    signals: {
      diamond_type: readText(rec, 'diamond_type'),
      strategy_mode: readText(rec, 'strategy_mode'),
      final_alignment_score:
        readNumber(rec, 'final_alignment_score') ?? readNumber(rec, 'finalAlignmentScore'),
      strategy_modifier: readNumber(rec, 'strategy_modifier'),
    },
    blueprint: {
      duration_weeks: readNumber(rec, 'duration_weeks'),
      progression_summary: readText(rec, 'progression_summary'),
      primary_recommendations: readTopicList(rec, 'primary_recommendations'),
      supporting_recommendations: readTopicList(rec, 'supporting_recommendations'),
    },
  };
}

export function buildRecommendationStrategicCardDraft(
  recommendation: Record<string, unknown> | null | undefined
): RecommendationStrategicCardDraft {
  const card = buildRecommendationStrategicCard(recommendation);
  return {
    core: {
      topic: card.core.topic ?? '',
      polished_title: card.core.polished_title ?? '',
      summary: card.core.summary ?? '',
      narrative_direction: card.core.narrative_direction ?? '',
      estimated_reach: card.core.estimated_reach != null ? String(card.core.estimated_reach) : '',
      formats: toCsv(card.core.formats),
      regions: toCsv(card.core.regions),
    },
    strategic_context: {
      aspect: card.strategic_context.aspect ?? '',
      facets: toCsv(card.strategic_context.facets),
      audience_personas: toCsv(card.strategic_context.audience_personas),
      messaging_hooks: toCsv(card.strategic_context.messaging_hooks),
    },
    intelligence: {
      problem_being_solved: card.intelligence.problem_being_solved ?? '',
      gap_being_filled: card.intelligence.gap_being_filled ?? '',
      why_now: card.intelligence.why_now ?? '',
      authority_reason: card.intelligence.authority_reason ?? '',
      expected_transformation: card.intelligence.expected_transformation ?? '',
      campaign_angle: card.intelligence.campaign_angle ?? '',
    },
    execution: {
      execution_stage: card.execution.execution_stage ?? '',
      stage_objective: card.execution.stage_objective ?? '',
      psychological_goal: card.execution.psychological_goal ?? '',
      momentum_level: card.execution.momentum_level ?? '',
    },
    company_context_snapshot: {
      core_problem_statement: card.company_context_snapshot.core_problem_statement ?? '',
      pain_symptoms: toCsv(card.company_context_snapshot.pain_symptoms),
      desired_transformation: card.company_context_snapshot.desired_transformation ?? '',
      authority_domains: toCsv(card.company_context_snapshot.authority_domains),
      brand_voice: card.company_context_snapshot.brand_voice ?? '',
      brand_positioning: card.company_context_snapshot.brand_positioning ?? '',
      reader_emotion_target: card.company_context_snapshot.reader_emotion_target ?? '',
      narrative_flow_seed: card.company_context_snapshot.narrative_flow_seed ?? '',
      recommended_cta_style: card.company_context_snapshot.recommended_cta_style ?? '',
    },
    blueprint: {
      duration_weeks: card.blueprint.duration_weeks != null ? String(card.blueprint.duration_weeks) : '',
      progression_summary: card.blueprint.progression_summary ?? '',
      primary_recommendations: toCsv(card.blueprint.primary_recommendations),
      supporting_recommendations: toCsv(card.blueprint.supporting_recommendations),
    },
  };
}

export function applyRecommendationStrategicCardDraft(
  recommendation: Record<string, unknown> | null | undefined,
  draft: RecommendationStrategicCardDraft
): Record<string, unknown> {
  const rec = { ...(recommendation ?? {}) };
  const nextIntelligence = {
    ...((rec.intelligence as Record<string, unknown> | undefined) ?? {}),
    problem_being_solved: nullable(draft.intelligence.problem_being_solved),
    gap_being_filled: nullable(draft.intelligence.gap_being_filled),
    why_now: nullable(draft.intelligence.why_now),
    authority_reason: nullable(draft.intelligence.authority_reason),
    expected_transformation: nullable(draft.intelligence.expected_transformation),
    campaign_angle: nullable(draft.intelligence.campaign_angle),
  };
  const nextExecution = {
    ...((rec.execution as Record<string, unknown> | undefined) ?? {}),
    execution_stage: nullable(draft.execution.execution_stage),
    stage_objective: nullable(draft.execution.stage_objective),
    psychological_goal: nullable(draft.execution.psychological_goal),
    momentum_level: nullable(draft.execution.momentum_level),
  };
  const nextSnapshot = {
    ...((rec.company_context_snapshot as Record<string, unknown> | undefined) ?? {}),
    core_problem_statement: nullable(draft.company_context_snapshot.core_problem_statement),
    pain_symptoms: fromCsv(draft.company_context_snapshot.pain_symptoms),
    desired_transformation: nullable(draft.company_context_snapshot.desired_transformation),
    authority_domains: fromCsv(draft.company_context_snapshot.authority_domains),
    brand_voice: nullable(draft.company_context_snapshot.brand_voice),
    brand_positioning: nullable(draft.company_context_snapshot.brand_positioning),
    reader_emotion_target: nullable(draft.company_context_snapshot.reader_emotion_target),
    narrative_flow_seed: nullable(draft.company_context_snapshot.narrative_flow_seed),
    recommended_cta_style: nullable(draft.company_context_snapshot.recommended_cta_style),
  };

  return {
    ...rec,
    topic: nullable(draft.core.topic),
    polished_title: nullable(draft.core.polished_title),
    summary: nullable(draft.core.summary),
    narrative_direction: nullable(draft.core.narrative_direction),
    estimated_reach: nullableNumber(draft.core.estimated_reach),
    formats: fromCsv(draft.core.formats),
    regions: fromCsv(draft.core.regions),
    aspect: nullable(draft.strategic_context.aspect),
    selected_aspect: nullable(draft.strategic_context.aspect),
    facets: fromCsv(draft.strategic_context.facets),
    audience_personas: fromCsv(draft.strategic_context.audience_personas),
    messaging_hooks: fromCsv(draft.strategic_context.messaging_hooks),
    intelligence: nextIntelligence,
    execution: nextExecution,
    company_context_snapshot: nextSnapshot,
    execution_stage: nullable(draft.execution.execution_stage),
    stage_objective: nullable(draft.execution.stage_objective),
    psychological_goal: nullable(draft.execution.psychological_goal),
    momentum_level: nullable(draft.execution.momentum_level),
    duration_weeks: nullableNumber(draft.blueprint.duration_weeks),
    progression_summary: nullable(draft.blueprint.progression_summary),
    primary_recommendations: fromCsv(draft.blueprint.primary_recommendations).map((topic) => ({ topic })),
    supporting_recommendations: fromCsv(draft.blueprint.supporting_recommendations).map((topic) => ({ topic })),
    strategic_card_refined: true,
    strategic_card_refined_at: new Date().toISOString(),
  };
}

export function normalizeStoredStrategicTheme(
  sourceTheme: Record<string, unknown> | null | undefined
): RecommendationStrategicCard | null {
  if (!sourceTheme || typeof sourceTheme !== 'object' || Array.isArray(sourceTheme)) return null;
  const strategicContextGroup = readNestedObject(sourceTheme, 'strategic_context');
  const sourceGroup = readNestedObject(sourceTheme, 'source');
  const signalsGroup = readNestedObject(sourceTheme, 'signals');
  const blueprint = {
    duration_weeks: readNumber(sourceTheme, 'duration_weeks'),
    progression_summary: readText(sourceTheme, 'progression_summary'),
    primary_recommendations: readTopicList(sourceTheme, 'primary_recommendations'),
    supporting_recommendations: readTopicList(sourceTheme, 'supporting_recommendations'),
  };

  return {
    source: {
      recommendation_id: readText(sourceGroup, 'recommendation_id') ?? readText(sourceTheme, 'recommendation_id'),
      snapshot_hash: readText(sourceGroup, 'snapshot_hash') ?? readText(sourceTheme, 'snapshot_hash'),
    },
    core: {
      topic: readText(sourceTheme, 'topic'),
      polished_title: readText(sourceTheme, 'polished_title'),
      summary: readText(sourceTheme, 'summary') ?? readText(sourceTheme, 'narrative_direction'),
      narrative_direction: readText(sourceTheme, 'narrative_direction'),
      estimated_reach: readNumber(sourceTheme, 'estimated_reach'),
      formats: readList(sourceTheme, 'formats'),
      regions: readList(sourceTheme, 'regions'),
    },
    strategic_context: {
      aspect: readText(strategicContextGroup, 'aspect') ?? readText(sourceTheme, 'aspect'),
      facets: readList(strategicContextGroup, 'facets').length > 0 ? readList(strategicContextGroup, 'facets') : readList(sourceTheme, 'facets'),
      audience_personas:
        readList(strategicContextGroup, 'audience_personas').length > 0
          ? readList(strategicContextGroup, 'audience_personas')
          : readList(sourceTheme, 'audience_personas'),
      messaging_hooks:
        readList(strategicContextGroup, 'messaging_hooks').length > 0
          ? readList(strategicContextGroup, 'messaging_hooks')
          : readList(sourceTheme, 'messaging_hooks'),
    },
    intelligence: {
      problem_being_solved: readText(readNestedObject(sourceTheme, 'intelligence'), 'problem_being_solved'),
      gap_being_filled: readText(readNestedObject(sourceTheme, 'intelligence'), 'gap_being_filled'),
      why_now: readText(readNestedObject(sourceTheme, 'intelligence'), 'why_now'),
      authority_reason: readText(readNestedObject(sourceTheme, 'intelligence'), 'authority_reason'),
      expected_transformation: readText(readNestedObject(sourceTheme, 'intelligence'), 'expected_transformation'),
      campaign_angle: readText(readNestedObject(sourceTheme, 'intelligence'), 'campaign_angle'),
    },
    execution: {
      execution_stage:
        readText(readNestedObject(sourceTheme, 'execution'), 'execution_stage') ??
        readText(sourceTheme, 'execution_stage'),
      stage_objective:
        readText(readNestedObject(sourceTheme, 'execution'), 'stage_objective') ??
        readText(sourceTheme, 'stage_objective'),
      psychological_goal:
        readText(readNestedObject(sourceTheme, 'execution'), 'psychological_goal') ??
        readText(sourceTheme, 'psychological_goal'),
      momentum_level:
        readText(readNestedObject(sourceTheme, 'execution'), 'momentum_level') ??
        readText(sourceTheme, 'momentum_level'),
    },
    company_context_snapshot: {
      core_problem_statement: readText(readNestedObject(sourceTheme, 'company_context_snapshot'), 'core_problem_statement'),
      pain_symptoms: readList(readNestedObject(sourceTheme, 'company_context_snapshot'), 'pain_symptoms'),
      desired_transformation: readText(readNestedObject(sourceTheme, 'company_context_snapshot'), 'desired_transformation'),
      authority_domains: readList(readNestedObject(sourceTheme, 'company_context_snapshot'), 'authority_domains'),
      brand_voice: readText(readNestedObject(sourceTheme, 'company_context_snapshot'), 'brand_voice'),
      brand_positioning: readText(readNestedObject(sourceTheme, 'company_context_snapshot'), 'brand_positioning'),
      reader_emotion_target: readText(readNestedObject(sourceTheme, 'company_context_snapshot'), 'reader_emotion_target'),
      narrative_flow_seed: readText(readNestedObject(sourceTheme, 'company_context_snapshot'), 'narrative_flow_seed'),
      recommended_cta_style: readText(readNestedObject(sourceTheme, 'company_context_snapshot'), 'recommended_cta_style'),
    },
    signals: {
      diamond_type: readText(signalsGroup, 'diamond_type') ?? readText(sourceTheme, 'diamond_type'),
      strategy_mode: readText(signalsGroup, 'strategy_mode') ?? readText(sourceTheme, 'strategy_mode'),
      final_alignment_score:
        readNumber(signalsGroup, 'final_alignment_score') ?? readNumber(sourceTheme, 'final_alignment_score'),
      strategy_modifier:
        readNumber(signalsGroup, 'strategy_modifier') ?? readNumber(sourceTheme, 'strategy_modifier'),
    },
    blueprint,
  };
}

export function getStoredStrategicThemeTitle(
  sourceTheme: Record<string, unknown> | null | undefined
): string | null {
  const card = normalizeStoredStrategicTheme(sourceTheme);
  if (!card) return null;
  return card.core.polished_title ?? card.core.topic ?? null;
}

export function buildSourceStrategicTheme(
  recommendation: Record<string, unknown> | null | undefined
): Record<string, unknown> {
  const card = buildRecommendationStrategicCard(recommendation);
  const fallbackTitle = card.core.polished_title ?? card.core.topic ?? 'Strategic recommendation';

  return {
    schema_type: RECOMMENDATION_STRATEGIC_THEME_SCHEMA_TYPE,
    schema_version: RECOMMENDATION_STRATEGIC_THEME_SCHEMA_VERSION,
    source: card.source,
    topic: card.core.topic ?? card.core.polished_title ?? fallbackTitle,
    polished_title: card.core.polished_title ?? card.core.topic ?? fallbackTitle,
    summary: card.core.summary,
    narrative_direction: card.core.narrative_direction,
    strategic_context: card.strategic_context,
    aspect: card.strategic_context.aspect,
    facets: card.strategic_context.facets,
    audience_personas: card.strategic_context.audience_personas,
    messaging_hooks: card.strategic_context.messaging_hooks,
    intelligence: card.intelligence,
    execution: card.execution,
    company_context_snapshot: card.company_context_snapshot,
    signals: card.signals,
    duration_weeks: card.blueprint.duration_weeks,
    progression_summary: card.blueprint.progression_summary,
    primary_recommendations: card.blueprint.primary_recommendations,
    supporting_recommendations: card.blueprint.supporting_recommendations,
    estimated_reach: card.core.estimated_reach,
    formats: card.core.formats,
    regions: card.core.regions,
  };
}
