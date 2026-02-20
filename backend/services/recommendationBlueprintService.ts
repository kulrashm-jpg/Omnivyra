/**
 * Campaign Blueprint Synthesis.
 * Converts strategy_sequence into a deterministic campaign blueprint.
 * No ranking, sequencing, or enrichment changes.
 */

import type {
  ExecutionStage,
  SequencedRecommendation,
  StrategySequence,
} from './recommendationSequencingService';

export type WeeklyBlueprintEntry = {
  week_number: number;
  stage: ExecutionStage;
  stage_objective: string;
  psychological_goal: string;
  momentum_level: string;
  primary_recommendations: Array<{ topic: string; [key: string]: unknown }>;
  supporting_recommendations: Array<{ topic: string; [key: string]: unknown }>;
  week_goal?: string;
  topics_to_cover?: string[];
  execution_intent?: {
    primary_psychology: string;
    trust_goal: string;
    conversion_pressure: 'low' | 'medium' | 'high';
  };
  content_mix?: Record<string, number>;
  diamond_focus?: boolean;
};

export type CampaignBlueprint = {
  duration_weeks: number;
  weekly_plan: WeeklyBlueprintEntry[];
  progression_summary: string;
};

function pickTopic(rec: SequencedRecommendation): string {
  return String(rec.topic ?? '').trim();
}

function toMinimalRec(rec: SequencedRecommendation): { topic: string; [key: string]: unknown } {
  return { topic: pickTopic(rec), ...rec };
}

type StageMapping = {
  stage: ExecutionStage;
  objective: string;
  psychological_goal: string;
  momentum_level: string;
};

/**
 * Builds week-to-stage mapping for given duration.
 * Returns array of length durationWeeks.
 */
function buildWeekStageMapping(
  ladder: StrategySequence['ladder'],
  durationWeeks: number
): StageMapping[] {
  if (ladder.length === 0) {
    return Array.from({ length: durationWeeks }, () => ({
      stage: 'awareness' as ExecutionStage,
      objective: 'Problem awareness',
      psychological_goal: 'Attention',
      momentum_level: 'low',
    }));
  }

  const toMapping = (e: (typeof ladder)[0]): StageMapping => ({
    stage: e.stage,
    objective: e.objective,
    psychological_goal: e.psychological_goal,
    momentum_level: e.momentum_level,
  });

  const result: StageMapping[] = [];

  if (durationWeeks === 2) {
    const first = toMapping(ladder[0]);
    const last = ladder.length > 1 ? toMapping(ladder[ladder.length - 1]) : first;
    result.push(first, last);
    return result;
  }

  if (durationWeeks === 4) {
    const perStage = Math.max(1, Math.floor(4 / ladder.length));
    for (const entry of ladder) {
      for (let i = 0; i < perStage && result.length < 4; i++) {
        result.push(toMapping(entry));
      }
    }
    while (result.length < 4) result.push(toMapping(ladder[ladder.length - 1]));
    return result.slice(0, 4);
  }

  if (durationWeeks === 8) {
    const perStage = Math.max(1, Math.floor(8 / ladder.length));
    for (const entry of ladder) {
      for (let i = 0; i < perStage && result.length < 8; i++) {
        result.push(toMapping(entry));
      }
    }
    while (result.length < 8) result.push(toMapping(ladder[ladder.length - 1]));
    return result.slice(0, 8);
  }

  if (durationWeeks === 12) {
    const perStage = Math.max(1, Math.floor(12 / ladder.length));
    for (const entry of ladder) {
      for (let i = 0; i < perStage && result.length < 12; i++) {
        result.push(toMapping(entry));
      }
    }
    while (result.length < 12) result.push(toMapping(ladder[ladder.length - 1]));
    return result.slice(0, 12);
  }

  const perStage = Math.max(1, Math.floor(durationWeeks / ladder.length));
  for (const entry of ladder) {
    for (let i = 0; i < perStage && result.length < durationWeeks; i++) {
      result.push(toMapping(entry));
    }
  }
  const last = ladder[ladder.length - 1];
  while (result.length < durationWeeks) result.push(toMapping(last));
  return result.slice(0, durationWeeks);
}

function buildProgressionSummary(ladder: StrategySequence['ladder']): string {
  if (ladder.length === 0) {
    return 'This campaign focuses on awareness and education.';
  }
  const phrases: Record<ExecutionStage, string> = {
    awareness: 'awareness to surface the core problem',
    education: 'education for clarity',
    authority: 'authority through differentiated insights',
    conversion: 'conversion-focused recommendations',
  };
  const seen = new Set<ExecutionStage>();
  const ordered: string[] = [];
  for (const s of ladder) {
    if (seen.has(s.stage)) continue;
    seen.add(s.stage);
    ordered.push(phrases[s.stage] ?? s.stage);
  }
  if (ordered.length === 1) {
    return `This campaign begins with ${ordered[0]}.`;
  }
  const first = ordered[0];
  const mid = ordered.slice(1, -1).map((p) => `moves into ${p}`);
  const last = ordered[ordered.length - 1];
  if (mid.length === 0) {
    return `This campaign begins with ${first} and culminates in ${last}.`;
  }
  return `This campaign begins with ${first}, ${mid.join(', ')}, and culminates in ${last}.`;
}

function readText(obj: Record<string, unknown> | null | undefined, key: string): string | null {
  if (!obj) return null;
  const value = obj[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function readList(obj: Record<string, unknown> | null | undefined, key: string): string[] {
  if (!obj) return [];
  const value = obj[key];
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === 'string' ? item.trim() : String(item ?? '').trim()))
    .filter(Boolean);
}

function deriveAudience(rec: Record<string, unknown>): string {
  const explicit = readText(rec, 'target_audience');
  if (explicit) return explicit;
  const audience = rec.audience;
  if (typeof audience === 'string' && audience.trim()) return audience.trim();
  if (audience && typeof audience === 'object') {
    const persona = readText(audience as Record<string, unknown>, 'persona');
    if (persona) return persona;
    const segment = readText(audience as Record<string, unknown>, 'segment');
    if (segment) return segment;
  }
  return 'the target audience';
}

function buildContentMixByStage(stage: ExecutionStage): Record<string, number> {
  if (stage === 'awareness') {
    return { educational: 2, engagement: 2, discussion: 1, poll: 1 };
  }
  if (stage === 'education') {
    return { educational: 2, authority: 1, engagement: 1, discussion: 1, case_example: 1 };
  }
  if (stage === 'authority') {
    return { authority: 2, educational: 1, engagement: 1, proof_story: 1, discussion: 1 };
  }
  return { authority: 1, promotional: 2, case_example: 1, objection_handler: 1, engagement: 1 };
}

function buildExecutionIntent(input: {
  stage: ExecutionStage;
  stageObjective: string;
  psychologicalGoal: string;
}) {
  const conversion_pressure: 'low' | 'medium' | 'high' =
    input.stage === 'conversion'
      ? 'high'
      : input.stage === 'authority'
        ? 'medium'
        : 'low';
  return {
    primary_psychology: input.psychologicalGoal || 'Attention',
    trust_goal: input.stageObjective || 'Build confidence through relevant evidence.',
    conversion_pressure,
  };
}

function buildWeekTopics(
  rec: Record<string, unknown>,
  stage: ExecutionStage
): { topics: string[]; diamondFocus: boolean } {
  const topic = readText(rec, 'topic') ?? 'Strategic theme';
  const intelligence = (rec.intelligence as Record<string, unknown> | undefined) ?? {};
  const transformation =
    (rec.company_problem_transformation as Record<string, unknown> | undefined) ??
    (rec.company_context_snapshot as Record<string, unknown> | undefined) ??
    {};
  const painSymptoms = readList(transformation, 'pain_symptoms');
  const authorityDomains = readList(transformation, 'authority_domains');

  const painState =
    readText(intelligence, 'problem_being_solved') ??
    readText(transformation, 'core_problem_statement') ??
    painSymptoms[0] ??
    'current pain patterns';
  const awarenessGap =
    readText(transformation, 'awareness_gap') ??
    readText(intelligence, 'gap_being_filled') ??
    'common misconceptions blocking progress';
  const whyNow =
    readText(intelligence, 'why_now') ??
    'the current market shift makes this urgent';
  const authorityInsight =
    authorityDomains[0] ??
    readText(intelligence, 'authority_reason') ??
    'domain-backed execution evidence';
  const campaignAngle =
    readText(intelligence, 'campaign_angle') ??
    'an outcome-led strategic approach';
  const desiredOutcome =
    readText(intelligence, 'expected_transformation') ??
    readText(transformation, 'desired_transformation') ??
    'measurable progress';

  const topics: string[] = [
    `Pain-awareness signal: ${painState} is costing momentum in ${topic}.`,
    `Misconception-break: Why "${awarenessGap}" must be corrected before scale.`,
    `Authority insight: ${authorityInsight} applied to ${topic}.`,
    `Practical implementation: Execute ${campaignAngle} with week-level actions.`,
    `Engagement hook: ${whyNow}—invite audience response around ${topic}.`,
  ];

  if (stage === 'conversion') {
    topics.push(`Conversion support: Turn ${desiredOutcome} into committed next-step decisions.`);
  }

  const polishFlags = (rec.polish_flags as Record<string, unknown> | undefined) ?? {};
  const diamondFocus = polishFlags.diamond_candidate === true;
  if (diamondFocus) {
    topics.unshift(`Diamond priority: ${topic}`);
  }

  return { topics, diamondFocus };
}

function buildWeekGoal(rec: Record<string, unknown>): string {
  const intelligence = (rec.intelligence as Record<string, unknown> | undefined) ?? {};
  const transformation =
    (rec.company_problem_transformation as Record<string, unknown> | undefined) ??
    (rec.company_context_snapshot as Record<string, unknown> | undefined) ??
    {};
  const audience = deriveAudience(rec);
  const painState =
    readText(intelligence, 'problem_being_solved') ??
    readText(transformation, 'core_problem_statement') ??
    'pain-state friction';
  const desiredOutcome =
    readText(intelligence, 'expected_transformation') ??
    readText(transformation, 'desired_transformation') ??
    'a stronger transformation outcome';
  const campaignAngle =
    readText(intelligence, 'campaign_angle') ??
    'a focused strategic angle';
  return `Help ${audience} move from ${painState} toward ${desiredOutcome} using ${campaignAngle}.`;
}

function ensureWeekReadiness(
  week: WeeklyBlueprintEntry,
  fallbackTopic: string
): WeeklyBlueprintEntry {
  const topics = Array.isArray(week.topics_to_cover)
    ? week.topics_to_cover.filter((item) => typeof item === 'string' && item.trim())
    : [];
  while (topics.length < 5) {
    topics.push(`Execution topic ${topics.length + 1}: ${fallbackTopic}`);
  }
  return {
    ...week,
    week_goal:
      typeof week.week_goal === 'string' && week.week_goal.trim()
        ? week.week_goal
        : 'Help the target audience move from friction toward transformation with a focused campaign angle.',
    topics_to_cover: topics,
    execution_intent:
      week.execution_intent ??
      buildExecutionIntent({
        stage: week.stage,
        stageObjective: week.stage_objective,
        psychologicalGoal: week.psychological_goal,
      }),
    content_mix:
      week.content_mix && Object.keys(week.content_mix).length > 0
        ? week.content_mix
        : buildContentMixByStage(week.stage),
  };
}

/**
 * Builds a deterministic campaign blueprint from strategy sequence.
 */
export function buildCampaignBlueprint(
  strategySequence: StrategySequence | null | undefined,
  campaignDurationWeeks: number
): CampaignBlueprint | null {
  if (!strategySequence) {
    return null;
  }

  const ladder = strategySequence.ladder ?? [];
  const durationWeeks = Math.max(1, Math.min(52, campaignDurationWeeks));
  const weekStageMapping = buildWeekStageMapping(ladder, durationWeeks);
  const stageToLadder = new Map(ladder.map((entry) => [entry.stage, entry]));

  const weekly_plan: WeeklyBlueprintEntry[] = [];

  for (let w = 1; w <= durationWeeks; w++) {
    const mapping = weekStageMapping[w - 1];
    const ladderEntry = stageToLadder.get(mapping.stage);
    const recs = ladderEntry?.recommendations ?? [];
    const ordered = [...recs];

    const primaryRecs = ordered.slice(0, 2);
    const supportingRecs = ordered.slice(2);

    let primary: Array<{ topic: string; [key: string]: unknown }>;
    let supporting: Array<{ topic: string; [key: string]: unknown }>;

    if (ordered.length <= 2 && ordered.length > 0) {
      const idx = (w - 1) % ordered.length;
      primary = [toMinimalRec(ordered[idx])];
      supporting = ordered.filter((_, i) => i !== idx).map(toMinimalRec);
    } else {
      primary = primaryRecs.map(toMinimalRec);
      const offset = (w - 1) % Math.max(1, supportingRecs.length);
      const rotated =
        supportingRecs.length > 0
          ? [...supportingRecs.slice(offset), ...supportingRecs.slice(0, offset)]
          : [];
      supporting = rotated.map(toMinimalRec);
    }

    const anchorRec = (primary[0] ?? supporting[0] ?? { topic: `Week ${w} theme` }) as Record<
      string,
      unknown
    >;
    const weekTopics = buildWeekTopics(anchorRec, mapping.stage);
    const weekEntry = ensureWeekReadiness(
      {
        week_number: w,
        stage: mapping.stage,
        stage_objective: mapping.objective,
        psychological_goal: mapping.psychological_goal,
        momentum_level: mapping.momentum_level,
        primary_recommendations: primary,
        supporting_recommendations: supporting,
        week_goal: buildWeekGoal(anchorRec),
        topics_to_cover: weekTopics.topics,
        execution_intent: buildExecutionIntent({
          stage: mapping.stage,
          stageObjective: mapping.objective,
          psychologicalGoal: mapping.psychological_goal,
        }),
        content_mix: buildContentMixByStage(mapping.stage),
        diamond_focus: weekTopics.diamondFocus,
      },
      pickTopic(anchorRec as SequencedRecommendation) || `Week ${w} strategic theme`
    );

    weekly_plan.push(weekEntry);
  }

  const progression_summary = buildProgressionSummary(ladder);

  return {
    duration_weeks: durationWeeks,
    weekly_plan,
    progression_summary,
  };
}
