import { computeCampaignPlanningQAState } from '../../chatGovernance';
import { GATHER_ORDER, REQUIRED_EXECUTION_FIELDS } from '../../constants/campaignPlanningGatherOrder';
import {
  buildPrefilledPlanning,
  extractPlanningContextFromHistory,
  mapRecommendationContextToGatherKeys,
} from '../campaign-ai/campaignAiPlanningContext';

export async function runGatherPhaseGate(args: {
  input: any;
  campaignRow: any;
  versionRow: any;
}): Promise<any | null> {
  const { input, campaignRow, versionRow } = args;
  const isGatherPhase = input.mode === 'generate_plan' && (input.conversationHistory?.length ?? 0) > 0;
  if (!isGatherPhase) return null;

  const fromHistory = extractPlanningContextFromHistory(input.conversationHistory ?? []);
  const minimalPrefilled = {
    ...buildPrefilledPlanning({ campaign: campaignRow, versionRow }),
    ...mapRecommendationContextToGatherKeys(input.recommendationContext ?? null),
    ...fromHistory,
  };
  const minimalEc =
    (minimalPrefilled as Record<string, unknown>).execution_config &&
    typeof (minimalPrefilled as Record<string, unknown>).execution_config === 'object'
      ? ((minimalPrefilled as Record<string, unknown>).execution_config as Record<string, unknown>)
      : {};
  const hasExplicitCapacityAnswer = (v: unknown) =>
    v != null && (typeof v === 'object' || (typeof v === 'string' && String(v).trim().length > 0));
  const hasMeaningfulGatherValue = (key: string, value: unknown): boolean => {
    if (key === 'platforms') {
      if (Array.isArray(value)) return value.length > 0;
      return value != null && String(value).trim().length > 0;
    }
    if (key === 'platform_content_requests') {
      if (Array.isArray(value)) return value.length > 0;
      if (value && typeof value === 'object') return Object.keys(value as Record<string, unknown>).length > 0;
      return value != null && String(value).trim().length > 0;
    }
    if (key === 'exclusive_campaigns') {
      if (Array.isArray(value)) return true;
      return value != null && String(value).trim().length > 0;
    }
    if (key === 'available_content' || key === 'content_capacity' || key === 'weekly_capacity') {
      if (value && typeof value === 'object') {
        const obj = value as Record<string, unknown>;
        if (Boolean((obj as any)._declared_none || (obj as any).declared_none || (obj as any).declaredNone)) return true;
      }
      return value != null && (typeof value === 'object' || String(value).trim().length > 0);
    }
    return value != null && (typeof value !== 'string' || String(value).trim().length > 0);
  };

  const fromHistoryHasAvailable =
    fromHistory?.available_content != null &&
    (hasExplicitCapacityAnswer(fromHistory.available_content) ||
      /^(no|none|zero|don'?t have|do not have|no content|not yet)\b/i.test(String(fromHistory.available_content).trim()));
  const fromHistoryHasCapacity =
    fromHistory?.content_capacity != null && hasExplicitCapacityAnswer(fromHistory.content_capacity);
  const minimalPrefilledKeys = Array.from(
    new Set(
      (REQUIRED_EXECUTION_FIELDS as unknown as string[]).filter((k) => {
        if (k === 'available_content') return fromHistoryHasAvailable;
        if (k === 'content_capacity' || k === 'weekly_capacity') return fromHistoryHasCapacity;
        const v = (minimalPrefilled as Record<string, unknown>)[k] ?? minimalEc[k];
        return hasMeaningfulGatherValue(k, v);
      })
    )
  );

  const gatherOrderForQa = GATHER_ORDER.map((g) => ({
    key: g.key,
    question: g.question,
    contingentOn: (g as { contingentOn?: string }).contingentOn,
  }));
  const trustedUtcToday = new Date().toISOString().slice(0, 10);
  const qaState = computeCampaignPlanningQAState({
    gatherOrder: gatherOrderForQa,
    prefilledKeys: minimalPrefilledKeys,
    prefilledValues: minimalPrefilled,
    requiredKeys: REQUIRED_EXECUTION_FIELDS as unknown as string[],
    utcTodayISO: trustedUtcToday,
    conversationHistory: (input.conversationHistory ?? []).map((m: any) => ({
      type: m.type ?? 'user',
      message: m.message ?? '',
    })),
  });
  if (!qaState.readyToGenerate && qaState.nextQuestion) {
    const waitingForConfirmation = !!qaState.allRequiredAnswered && !qaState.userConfirmed;
    const response = waitingForConfirmation
      ? 'I have everything I need. Would you like me to create your week plan now?'
      : qaState.nextQuestion.question;
    return {
      mode: input.mode,
      snapshot_hash: 'gather-phase',
      omnivyre_decision: { status: 'ok', recommendation: 'proceed' as const },
      conversationalResponse: response,
      raw_plan_text: '',
    };
  }

  return null;
}
