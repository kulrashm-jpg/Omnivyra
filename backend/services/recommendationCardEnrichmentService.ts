/**
 * Recommendation Card Enrichment Service.
 * Enriches recommendation card output shape only (no scoring/ranking/sequence/blueprint logic).
 */

type CardLike = Record<string, unknown> & { topic: string };

type SequenceLike = {
  ladder?: Array<{
    stage: string;
    objective: string;
    psychological_goal: string;
    momentum_level: string;
    recommendations: Array<{ topic: string } & Record<string, unknown>>;
  }>;
} | null | undefined;

type ResultLike = {
  trends_used: CardLike[];
  strategy_dna?: { mode?: string | null } | null;
  strategy_sequence?: SequenceLike;
  company_context?: {
    brand?: {
      brand_voice?: string | null;
      brand_positioning?: string | null;
    } | null;
    problem_transformation?: {
      core_problem_statement?: string | null;
      pain_symptoms?: string[] | null;
      desired_transformation?: string | null;
      authority_domains?: string[] | null;
    } | null;
    campaign?: {
      reader_emotion_target?: string | null;
      narrative_flow_seed?: unknown;
      recommended_cta_style?: string | null;
    } | null;
  } | null;
  campaign_blueprint_validated?: {
    duration_weeks?: number | null;
    progression_summary?: string | null;
    weekly_plan?: Array<{
      primary_recommendations?: Array<{ topic?: string } & Record<string, unknown>>;
      supporting_recommendations?: Array<{ topic?: string } & Record<string, unknown>>;
    }>;
  } | null;
} & Record<string, unknown>;

function toStageMetaByTopic(sequence: SequenceLike) {
  const map = new Map<
    string,
    {
      execution_stage: string;
      stage_objective: string;
      psychological_goal: string;
      momentum_level: string;
    }
  >();
  for (const stage of sequence?.ladder ?? []) {
    for (const rec of stage.recommendations ?? []) {
      const key = String(rec.topic || '').trim().toLowerCase();
      if (!key || map.has(key)) continue;
      map.set(key, {
        execution_stage: stage.stage,
        stage_objective: stage.objective,
        psychological_goal: stage.psychological_goal,
        momentum_level: stage.momentum_level,
      });
    }
  }
  return map;
}

function deriveDiamondType(polishFlags: {
  authority_elevated?: boolean;
  diamond_candidate?: boolean;
  is_generic_reframed?: boolean;
}): 'authority_elevated' | 'diamond_candidate' | 'generic_reframed' | null {
  if (polishFlags.authority_elevated === true) return 'authority_elevated';
  if (polishFlags.diamond_candidate === true) return 'diamond_candidate';
  if (polishFlags.is_generic_reframed === true) return 'generic_reframed';
  return null;
}

export function enrichRecommendationCards<T extends ResultLike>(result: T): T {
  if (!Array.isArray(result.trends_used) || result.trends_used.length === 0) return result;

  // Deduplicate by exact topic (normalized) so each trend has exactly one card
  const seenTopics = new Set<string>();
  const uniqueByTopic = result.trends_used.filter((card) => {
    const key = String(card.topic ?? '').trim().toLowerCase();
    if (!key || seenTopics.has(key)) return false;
    seenTopics.add(key);
    return true;
  });
  if (uniqueByTopic.length < result.trends_used.length) {
    result = { ...result, trends_used: uniqueByTopic } as T;
  }

  const stageByTopic = toStageMetaByTopic(result.strategy_sequence);
  const pt = result.company_context?.problem_transformation ?? null;
  const brand = result.company_context?.brand ?? null;
  const campaign = result.company_context?.campaign ?? null;

  const toCompactString = (value: unknown): string | null => {
    if (value == null) return null;
    if (typeof value === 'string') {
      const t = value.trim();
      return t ? t : null;
    }
    if (typeof value === 'object') {
      try {
        const s = JSON.stringify(value);
        return s && s !== '{}' ? s : null;
      } catch {
        return null;
      }
    }
    const t = String(value).trim();
    return t ? t : null;
  };

  const company_context_snapshot = {
    core_problem_statement: pt?.core_problem_statement ?? null,
    pain_symptoms: pt?.pain_symptoms ?? null,
    desired_transformation: pt?.desired_transformation ?? null,
    authority_domains: pt?.authority_domains ?? null,
    brand_voice: brand?.brand_voice ?? null,
    brand_positioning: brand?.brand_positioning ?? null,
    reader_emotion_target: campaign?.reader_emotion_target ?? null,
    narrative_flow_seed: toCompactString((campaign as any)?.narrative_flow_seed ?? null),
    recommended_cta_style: campaign?.recommended_cta_style ?? null,
    recommendation_notes: (result.company_context as { recommendation_notes?: string | null })?.recommendation_notes ?? null,
  };
  const blueprintByTopic = new Map<
    string,
    {
      primary_recommendations: Array<{ topic?: string } & Record<string, unknown>>;
      supporting_recommendations: Array<{ topic?: string } & Record<string, unknown>>;
      duration_weeks: number | null;
      progression_summary: string | null;
    }
  >();
  for (const week of result.campaign_blueprint_validated?.weekly_plan ?? []) {
    const primary = Array.isArray(week.primary_recommendations) ? week.primary_recommendations : [];
    const supporting = Array.isArray(week.supporting_recommendations) ? week.supporting_recommendations : [];
    for (const rec of [...primary, ...supporting]) {
      const recKey = String(rec?.topic ?? '').trim().toLowerCase();
      if (!recKey || blueprintByTopic.has(recKey)) continue;
      blueprintByTopic.set(recKey, {
        primary_recommendations: primary,
        supporting_recommendations: supporting,
        duration_weeks: result.campaign_blueprint_validated?.duration_weeks ?? null,
        progression_summary: result.campaign_blueprint_validated?.progression_summary ?? null,
      });
    }
  }

  const enrichedCards = result.trends_used.map((card) => {
    const key = String(card.topic || '').trim().toLowerCase();
    const stage = stageByTopic.get(key);
    const polish_flags = (card.polish_flags as {
      authority_elevated?: boolean;
      diamond_candidate?: boolean;
      is_generic_reframed?: boolean;
    }) ?? {};
    const existingIntelligence = (card.intelligence as Record<string, unknown> | undefined) ?? {};
    const intelligence = {
      problem_being_solved: (existingIntelligence.problem_being_solved as string | null | undefined) ?? null,
      gap_being_filled: (existingIntelligence.gap_being_filled as string | null | undefined) ?? null,
      why_now: (existingIntelligence.why_now as string | null | undefined) ?? null,
      authority_reason: (existingIntelligence.authority_reason as string | null | undefined) ?? null,
      expected_transformation: (existingIntelligence.expected_transformation as string | null | undefined) ?? null,
      campaign_angle: (existingIntelligence.campaign_angle as string | null | undefined) ?? null,
    };

    const alignment_score =
      (card.alignment_score as number | null | undefined) ??
      (card.alignmentScore as number | null | undefined) ??
      null;
    const final_alignment_score =
      (card.final_alignment_score as number | null | undefined) ??
      (card.finalAlignmentScore as number | null | undefined) ??
      null;
    const strategy_modifier =
      (card.strategy_modifier as number | null | undefined) ?? null;
    const bp = blueprintByTopic.get(key);
    const campaign_angle =
      (card.campaign_angle as string | null | undefined) ??
      (intelligence.campaign_angle as string | null | undefined) ??
      null;

    return {
      ...card,
      intelligence,
      alignment_score,
      final_alignment_score,
      strategy_modifier,
      strategy_mode:
        (card.strategy_mode as string | null | undefined) ??
        result.strategy_dna?.mode ??
        null,
      diamond_type:
        (card.diamond_type as 'authority_elevated' | 'diamond_candidate' | 'generic_reframed' | null | undefined) ??
        deriveDiamondType(polish_flags),
      execution: {
        execution_stage:
          stage?.execution_stage ??
          (card.execution_stage as string | null | undefined) ??
          null,
        stage_objective:
          stage?.stage_objective ??
          (card.stage_objective as string | null | undefined) ??
          null,
        psychological_goal:
          stage?.psychological_goal ??
          (card.psychological_goal as string | null | undefined) ??
          null,
        momentum_level:
          stage?.momentum_level ??
          (card.momentum_level as string | null | undefined) ??
          null,
      },
      // Backward-compatible top-level aliases from existing exposure.
      execution_stage:
        stage?.execution_stage ??
        (card.execution_stage as string | null | undefined) ??
        null,
      stage_objective:
        stage?.stage_objective ??
        (card.stage_objective as string | null | undefined) ??
        null,
      psychological_goal:
        stage?.psychological_goal ??
        (card.psychological_goal as string | null | undefined) ??
        null,
      momentum_level:
        stage?.momentum_level ??
        (card.momentum_level as string | null | undefined) ??
        null,
      campaign_angle,
      finalAlignmentScore:
        (card.finalAlignmentScore as number | null | undefined) ?? final_alignment_score,
      alignmentScore:
        (card.alignmentScore as number | null | undefined) ?? alignment_score,
      duration_weeks:
        (card.duration_weeks as number | null | undefined) ??
        bp?.duration_weeks ??
        result.campaign_blueprint_validated?.duration_weeks ??
        null,
      progression_summary:
        (card.progression_summary as string | null | undefined) ??
        bp?.progression_summary ??
        result.campaign_blueprint_validated?.progression_summary ??
        null,
      primary_recommendations:
        (card.primary_recommendations as Array<{ topic?: string } & Record<string, unknown>> | undefined) ??
        bp?.primary_recommendations ??
        [],
      supporting_recommendations:
        (card.supporting_recommendations as Array<{ topic?: string } & Record<string, unknown>> | undefined) ??
        bp?.supporting_recommendations ??
        [],
      company_problem_transformation:
        (card.company_problem_transformation as Record<string, unknown> | null | undefined) ??
        result.company_context?.problem_transformation ??
        null,
      company_context_snapshot,
    };
  });

  return {
    ...result,
    trends_used: enrichedCards,
  } as T;
}

