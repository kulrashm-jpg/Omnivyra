import type { CapacityValidationResult } from '../capacityFrequencyValidationGateway';
import type { CampaignAiMode, CampaignAiPlanResult } from './publicTypes';
import type { DecisionResult } from '../omnivyreClient';

export const DEFAULT_PLATFORM_STRATEGIES = [
  { platform_type: 'social', supported_content_types: ['post', 'story', 'video'], name: 'LinkedIn' },
  { platform_type: 'social', supported_content_types: ['post', 'story', 'reel'], name: 'Instagram' },
  { platform_type: 'social', supported_content_types: ['post', 'thread'], name: 'X (Twitter)' },
  { platform_type: 'social', supported_content_types: ['video', 'short'], name: 'YouTube' },
  { platform_type: 'social', supported_content_types: ['post', 'video'], name: 'Facebook' },
  { platform_type: 'social', supported_content_types: ['video', 'post'], name: 'TikTok' },
];

export function isQuestionAligned(modelQuestion: string, expectedQuestion: string): boolean {
  const normalize = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  const a = normalize(modelQuestion);
  const b = normalize(expectedQuestion);
  if (!a || !b) return false;
  if (a.includes(b) || b.includes(a)) return true;

  const bTokens = b.split(' ').filter((t) => t.length >= 4);
  if (!bTokens.length) return false;
  const overlap = bTokens.filter((t) => a.includes(t)).length;
  return overlap >= Math.max(2, Math.floor(bTokens.length / 2));
}

export function extractDurationFromConversation(history: Array<{ type: string; message: string }>): number | null {
  const qKeywords = ['weeks', 'week', 'how many', 'campaign run', 'duration', '6, 12'];
  let lastFound: number | null = null;
  for (let i = 0; i < (history?.length ?? 0) - 1; i++) {
    const aiMsg = (history[i]?.message ?? '').toLowerCase();
    const userMsg = (history[i + 1]?.message ?? '').trim();
    if (history[i]?.type !== 'ai' || history[i + 1]?.type !== 'user') continue;
    const aiAsksDuration = qKeywords.some((k) => aiMsg.includes(k));
    if (!aiAsksDuration || !userMsg) continue;
    const match = userMsg.match(/\b(\d{1,2})\s*(?:week|weeks)?\b/i) ?? userMsg.match(/\b(\d{1,2})\b/);
    if (match) {
      const n = parseInt(match[1], 10);
      if (n >= 1 && n <= 52) lastFound = n;
    }
  }
  return lastFound;
}

export function buildCapacityValidationFailureResult(args: {
  mode: CampaignAiMode;
  snapshot_hash: string;
  omnivyreDecision: DecisionResult;
  validationResult: CapacityValidationResult;
}): CampaignAiPlanResult {
  const { mode, snapshot_hash, omnivyreDecision, validationResult } = args;
  const suggested = validationResult.suggested_requested_by_platform
    ? `\n\nSuggested weekly counts by platform (one possible adjustment):\n${JSON.stringify(
        validationResult.suggested_requested_by_platform,
        null,
        2
      )}`
    : '';
  return {
    mode,
    snapshot_hash,
    omnivyre_decision: omnivyreDecision,
    conversationalResponse: `Capacity validation failed.\n\n- requested_total: ${validationResult.requested_total}/week\n- available_content_total: ${validationResult.available_content_total}\n- weekly_capacity_total: ${validationResult.weekly_capacity_total}\n- exclusive_campaigns_total: ${validationResult.exclusive_campaigns_total}\n- effective_capacity_total: ${validationResult.effective_capacity_total}\n- supply_total (available + effective capacity): ${validationResult.supply_total}\n- deficit: ${validationResult.deficit}\n\n${validationResult.explanation}${suggested}\n\nReply with an updated request (reduce counts), or reply "override capacity" to proceed anyway.`,
    raw_plan_text: '',
    validation_result: validationResult,
  };
}

export function buildQaFallbackResult(args: {
  mode: CampaignAiMode;
  snapshot_hash: string;
  omnivyreDecision: DecisionResult;
  forcedNextQuestion?: string | null;
  waitingForConfirmation?: boolean;
  rawPlanText?: string;
}): CampaignAiPlanResult {
  const confirmationQuestion = 'I have everything I need. Would you like me to create your week plan now?';
  const conversationalResponse =
    args.forcedNextQuestion ??
    (args.waitingForConfirmation ? confirmationQuestion : 'I still need a few details to build your plan.');

  return {
    mode: args.mode,
    snapshot_hash: args.snapshot_hash,
    omnivyre_decision: args.omnivyreDecision,
    conversationalResponse,
    raw_plan_text: args.rawPlanText ?? '',
  };
}
