import { generateCampaignPlan, type LlmPoolName } from '../aiGateway';
import { canonicalJsonStringify } from '../viralitySnapshotBuilder';

export type AlignmentSuggestion = {
  weekNumber: number;
  suggestion: string;
};

export type AlignmentEvaluation = {
  alignmentScore: number;
  progressionScore: number;
  diversityScore: number;
  platformAlignmentScore: number;
  psychologicalFitScore: number;
  issues: string[];
  suggestedAdjustments: AlignmentSuggestion[];
  parseFailed?: boolean;
};

export type WeeklyAlignmentProfile = {
  score: number;
  progressionWeak: boolean;
  diversityWeak: boolean;
  platformWeak: boolean;
  psychologicalWeak: boolean;
};

export const ALIGNMENT_ACCEPT_THRESHOLD = 70;

function clampScore(n: unknown): number {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(100, Math.round(v)));
}

function tryParseJsonObject(raw: string): Record<string, unknown> | null {
  const trimmed = String(raw ?? '').trim();
  if (!trimmed) return null;
  try {
    const parsed = JSON.parse(trimmed);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        const parsed = JSON.parse(trimmed.slice(start, end + 1));
        return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
      } catch {
        return null;
      }
    }
    return null;
  }
}

export function parseAlignmentEvaluation(raw: string): AlignmentEvaluation {
  const parsedObj = tryParseJsonObject(raw);
  const obj = parsedObj ?? {};
  const parseFailed = parsedObj == null;
  const suggestionsRaw = Array.isArray(obj.suggestedAdjustments) ? obj.suggestedAdjustments : [];
  const suggestions: AlignmentSuggestion[] = suggestionsRaw
    .map((s: any) => ({
      weekNumber: Number(s?.weekNumber || 0),
      suggestion: String(s?.suggestion || '').trim(),
    }))
    .filter((s) => s.weekNumber > 0 && s.suggestion.length > 0);
  const issuesRaw = Array.isArray(obj.issues) ? obj.issues : [];
  const issues = issuesRaw.map((i) => String(i).trim()).filter(Boolean);

  return {
    alignmentScore: clampScore(obj.alignmentScore),
    progressionScore: clampScore(obj.progressionScore),
    diversityScore: clampScore(obj.diversityScore),
    platformAlignmentScore: clampScore(obj.platformAlignmentScore),
    psychologicalFitScore: clampScore(obj.psychologicalFitScore),
    issues,
    suggestedAdjustments: suggestions,
    parseFailed,
  };
}

export function buildAlignmentProfile(evaluation: AlignmentEvaluation | null | undefined): WeeklyAlignmentProfile {
  if (!evaluation || evaluation.parseFailed) {
    return {
      score: 50,
      progressionWeak: true,
      diversityWeak: true,
      platformWeak: true,
      psychologicalWeak: true,
    };
  }

  return {
    score: evaluation.alignmentScore,
    progressionWeak: evaluation.progressionScore < ALIGNMENT_ACCEPT_THRESHOLD,
    diversityWeak: evaluation.diversityScore < ALIGNMENT_ACCEPT_THRESHOLD,
    platformWeak: evaluation.platformAlignmentScore < ALIGNMENT_ACCEPT_THRESHOLD,
    psychologicalWeak: evaluation.psychologicalFitScore < ALIGNMENT_ACCEPT_THRESHOLD,
  };
}

export async function evaluateWeeklyAlignment(params: {
  campaignId?: string | null;
  recommendationContext?: { context_payload?: Record<string, unknown> | null } | null;
  campaignStage?: string | null;
  psychologicalGoal?: string | null;
  momentum?: string | null;
  normalizedWeeks: any[];
  signal?: AbortSignal;
  pool?: LlmPoolName;
}): Promise<AlignmentEvaluation> {
  const evaluationPrompt = {
    recommendation_context: params.recommendationContext ?? null,
    campaign_stage: params.campaignStage ?? null,
    psychological_goal: params.psychologicalGoal ?? null,
    momentum: params.momentum ?? null,
    weekly_plan: params.normalizedWeeks,
  };

  const completion = await generateCampaignPlan({
    companyId: null,
    campaignId: params.campaignId ?? null,
    model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
    temperature: 0,
    signal: params.signal,
    pool: params.pool ?? 'alignment',
    messages: [
      {
        role: 'system',
        content:
          'You are a campaign weekly-alignment evaluator. Evaluate alignment quality only. ' +
          'Do NOT rewrite plan structure, do NOT add/remove weeks, do NOT change deliverable counts.',
      },
      {
        role: 'user',
        content:
          'Evaluate the weekly plan and return JSON only with this shape:\n' +
          '{alignmentScore:number, progressionScore:number, diversityScore:number, platformAlignmentScore:number, psychologicalFitScore:number, issues:string[], suggestedAdjustments:[{weekNumber:number, suggestion:string}]}\n' +
          'Rules:\n' +
          '- Alignment only; suggestions must be intelligence-field adjustments.\n' +
          '- Do NOT propose structural or count changes.\n' +
          `Input:\n${canonicalJsonStringify(evaluationPrompt)}`,
      },
    ],
  });

  return parseAlignmentEvaluation(completion.output || '');
}
