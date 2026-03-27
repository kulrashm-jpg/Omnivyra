import type { StrategicThemeEntry, StrategyContext, IdeaSpine, TrendContext } from '../components/planner/plannerSessionStore';

export type PlannerStrategicSourceMode = 'ai' | 'trend' | 'both' | 'blog';

export interface PlannerStrategicCard {
  schema_type: 'planner_strategic_card';
  schema_version: 1;
  source_mode: PlannerStrategicSourceMode;
  source_label: string;
  core: {
    topic: string | null;
    polished_title: string | null;
    summary: string | null;
    narrative_direction: string | null;
  };
  strategic_context: {
    campaign_goal: string | null;
    target_audience: string[];
    key_message: string | null;
    selected_aspects: string[];
    selected_offerings: string[];
  };
  intelligence: {
    problem_being_solved: string | null;
    why_now: string | null;
    expected_transformation: string | null;
    campaign_angle: string | null;
  };
  execution: {
    execution_stage: string | null;
    stage_objective: string | null;
    psychological_goal: string | null;
    momentum_level: string | null;
  };
  blueprint: {
    duration_weeks: number | null;
    progression_summary: string | null;
    primary_recommendations: string[];
    supporting_recommendations: string[];
  };
  weekly_themes: StrategicThemeEntry[];
  trend_context?: TrendContext | null;
}

function toList(value: string | string[] | null | undefined): string[] {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.map((item) => String(item || '').trim()).filter(Boolean);
  }
  return String(value)
    .split(/[,;]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.map((value) => String(value || '').trim()).filter(Boolean)));
}

function summarizeThemeProgression(themes: StrategicThemeEntry[]): string | null {
  const titles = themes
    .slice(0, 4)
    .map((theme) => theme.title?.trim())
    .filter(Boolean);
  if (titles.length === 0) return null;
  if (titles.length === 1) return titles[0] ?? null;
  return titles.join(' -> ');
}

function summarizeSourceContext(sourceMode: PlannerStrategicSourceMode, trendTopic: string | null): string | null {
  if (sourceMode === 'both') {
    return trendTopic
      ? `Combines trend momentum from "${trendTopic}" with campaign-specific AI planning.`
      : 'Combines trend signals with AI reasoning to shape the campaign direction.';
  }
  if (sourceMode === 'trend') {
    return trendTopic
      ? `Built from the trend signal "${trendTopic}" to capture timely relevance.`
      : 'Built from external trend and market signals.';
  }
  if (sourceMode === 'blog') {
    return 'Uses blog intelligence as the strategic base and expands it into a campaign narrative.';
  }
  return 'Uses AI to shape the campaign direction from the supplied campaign inputs.';
}

function inferExecutionStage(goal: string | null): string | null {
  const normalized = String(goal || '').toLowerCase();
  if (!normalized) return null;
  if (normalized.includes('awareness') || normalized.includes('thought leadership')) {
    return 'Awareness and trust building';
  }
  if (normalized.includes('lead') || normalized.includes('launch')) {
    return 'Demand capture and conversion';
  }
  if (normalized.includes('retention') || normalized.includes('community')) {
    return 'Retention and relationship building';
  }
  if (normalized.includes('education')) {
    return 'Education and consideration';
  }
  return 'Strategic campaign development';
}

export function buildPlannerStrategicCard(params: {
  sourceMode: PlannerStrategicSourceMode;
  ideaSpine?: IdeaSpine | null;
  strategyContext?: StrategyContext | null;
  trendContext?: TrendContext | null;
  themes?: StrategicThemeEntry[];
}): PlannerStrategicCard {
  const { sourceMode, ideaSpine, strategyContext, trendContext, themes = [] } = params;
  const title =
    ideaSpine?.refined_title?.trim() ||
    ideaSpine?.title?.trim() ||
    themes[0]?.title?.trim() ||
    null;
  const summary =
    ideaSpine?.refined_description?.trim() ||
    ideaSpine?.description?.trim() ||
    null;
  const audience = toList(strategyContext?.target_audience);
  const goals = toList(strategyContext?.campaign_goal);
  const mainGoal = goals[0] ?? null;
  const keyMessage = strategyContext?.key_message?.trim() || null;
  const aspects = uniqueStrings(strategyContext?.selected_aspects ?? []);
  const offerings = uniqueStrings(strategyContext?.selected_offerings ?? []);
  const progressionSummary = summarizeThemeProgression(themes);
  const trendTopic = typeof trendContext?.trend_topic === 'string' ? trendContext.trend_topic.trim() : null;
  const sourceLabel =
    sourceMode === 'both'
      ? 'Hybrid Intelligence'
      : sourceMode === 'trend'
      ? 'Trend Intelligence'
      : sourceMode === 'blog'
      ? 'Blog Intelligence'
      : 'AI Strategic Engine';

  return {
    schema_type: 'planner_strategic_card',
    schema_version: 1,
    source_mode: sourceMode,
    source_label: sourceLabel,
    core: {
      topic: title,
      polished_title: title,
      summary,
      narrative_direction:
        keyMessage ||
        progressionSummary ||
        (mainGoal ? `Campaign focused on ${mainGoal.toLowerCase()}.` : summary),
    },
    strategic_context: {
      campaign_goal: mainGoal,
      target_audience: audience,
      key_message: keyMessage,
      selected_aspects: aspects,
      selected_offerings: offerings,
    },
    intelligence: {
      problem_being_solved: summary,
      why_now:
        trendTopic && sourceMode !== 'ai'
          ? `Built around the trend signal "${trendTopic}".`
          : mainGoal
          ? `Designed to support a ${mainGoal.toLowerCase()} campaign over the selected duration.`
          : null,
      expected_transformation:
        audience.length > 0 && mainGoal
          ? `Move ${audience.join(', ')} toward ${mainGoal.toLowerCase()}.`
          : audience.length > 0
          ? `Give ${audience.join(', ')} a clearer reason to engage with the campaign.`
          : null,
      campaign_angle:
        ideaSpine?.selected_angle?.trim() ||
        (goals.length > 0 ? goals.join(', ') : null),
    },
    execution: {
      execution_stage: inferExecutionStage(mainGoal),
      stage_objective:
        progressionSummary ||
        (goals.length > 0 ? `Guide the campaign through ${goals.join(', ')}.` : null),
      psychological_goal:
        mainGoal ? `Help the audience feel ready for ${mainGoal.toLowerCase()}.` : null,
      momentum_level: themes.length >= 4 ? 'Structured multi-week arc' : themes.length > 0 ? 'Early campaign arc' : null,
    },
    blueprint: {
      duration_weeks: strategyContext?.duration_weeks ?? (themes.length > 0 ? themes.length : null),
      progression_summary: progressionSummary ?? summarizeSourceContext(sourceMode, trendTopic),
      primary_recommendations: themes.slice(0, Math.min(themes.length, 4)).map((theme) => theme.title).filter(Boolean),
      supporting_recommendations: themes.slice(4).map((theme) => theme.title).filter(Boolean),
    },
    weekly_themes: themes,
    trend_context: trendContext ?? null,
  };
}

export function syncPlannerStrategicCardThemes(
  card: PlannerStrategicCard | null | undefined,
  themes: StrategicThemeEntry[]
): PlannerStrategicCard | null {
  if (!card) return null;
  const progressionSummary = summarizeThemeProgression(themes);
  return {
    ...card,
    weekly_themes: themes,
    blueprint: {
      ...card.blueprint,
      duration_weeks: card.blueprint.duration_weeks ?? (themes.length > 0 ? themes.length : null),
      progression_summary: progressionSummary,
      primary_recommendations: themes.slice(0, Math.min(themes.length, 4)).map((theme) => theme.title).filter(Boolean),
      supporting_recommendations: themes.slice(4).map((theme) => theme.title).filter(Boolean),
    },
    core: {
      ...card.core,
      narrative_direction: card.core.narrative_direction ?? progressionSummary,
    },
    execution: {
      ...card.execution,
      stage_objective: progressionSummary ?? card.execution.stage_objective,
    },
  };
}
