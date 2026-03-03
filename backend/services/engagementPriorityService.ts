/**
 * Engagement Priority Service
 *
 * Deterministic runtime priority scoring for community_ai_actions.
 * No DB changes; scores and labels are computed on read.
 *
 * @see docs/CANONICAL-SOCIAL-PLATFORM-OPERATIONS-DESIGN.md
 */

export type PriorityResult = {
  priority_score: number;
  priority_label: 'HIGH' | 'MEDIUM' | 'LOW';
  reasoning: string[];
};

const ACTION_TYPE_SCORES: Record<string, number> = {
  reply: 40,
  follow: 25,
  like: 10,
  share: 20,
  schedule: 5,
};

const NEGATIVE_WORDS = ['problem', 'bad', 'issue', 'not working'];
const MAX_SCORE = 100;

/**
 * Score a single action using only existing data (action + optional comment text).
 * Deterministic, cap at 100.
 */
export function scoreActionPriority(
  action: { action_type?: string; suggested_text?: string | null; [key: string]: any },
  options?: { commentText?: string | null }
): PriorityResult {
  const reasoning: string[] = [];
  let score = 0;

  const actionType = (action.action_type ?? '').toString().toLowerCase().trim();
  const typeScore = ACTION_TYPE_SCORES[actionType] ?? 0;
  if (typeScore > 0) {
    score += typeScore;
    reasoning.push(`${actionType}: +${typeScore}`);
  }

  const textForSignals = (action.suggested_text ?? options?.commentText ?? '').toString().trim();

  if (textForSignals.includes('?')) {
    score += 20;
    reasoning.push('contains question: +20');
  }

  const lower = textForSignals.toLowerCase();
  const hasNegative = NEGATIVE_WORDS.some((w) => lower.includes(w));
  if (hasNegative) {
    score += 25;
    reasoning.push('negative signal: +25');
  }

  if (textForSignals.length > 120) {
    score += 15;
    reasoning.push('long text (>120): +15');
  }

  const capped = Math.min(MAX_SCORE, Math.max(0, score));

  let priority_label: 'HIGH' | 'MEDIUM' | 'LOW' = 'LOW';
  if (capped >= 70) priority_label = 'HIGH';
  else if (capped >= 40) priority_label = 'MEDIUM';

  return {
    priority_score: capped,
    priority_label,
    reasoning: reasoning.length > 0 ? reasoning : ['base score'],
  };
}

/**
 * Attach priority_score, priority_label, priority_reasoning to each action (runtime only).
 * Optionally pass a map of action id → related comment text for better text signals.
 */
export function decorateActionsWithPriority(
  actions: any[],
  options?: { commentTextByActionId?: Record<string, string | null> }
): any[] {
  const commentByActionId = options?.commentTextByActionId ?? {};
  return actions.map((action) => {
    const commentText = commentByActionId[action.id] ?? null;
    const result = scoreActionPriority(action, { commentText });
    return {
      ...action,
      priority_score: result.priority_score,
      priority_label: result.priority_label,
      priority_reasoning: result.reasoning,
    };
  });
}
