/**
 * Campaign Planning Q&A State — domain layer for campaign plan chat.
 * Tracks: which questions answered, current question, whether to generate.
 * Used to enforce: don't repeat answered questions, don't change question until answered.
 */

import type { ChatMessage, QAState } from './types';

export interface GatherItem {
  key: string;
  question: string;
  /** If set, only ask when the condition key has a truthy value (e.g. has content) */
  contingentOn?: string;
}

const CONFIRMATION_PHRASES = [
  'would you like me to create',
  'create your plan now',
  'create your 12-week plan',
  'create your 6-week plan',
  'create your 24-week plan',
  'ready to create your plan',
];

const USER_CONFIRMATIONS = new Set([
  'yes', 'sure', 'ok', 'okay', 'please', 'yeah', 'yep',
  'create it', 'do it', 'go for it', 'go ahead', 'create my plan',
  'generate plan', "i'm ready", "that's all", 'create campaign', 'build the plan',
]);

function normalizeForMatch(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ');
}

function isConfirmationPrompt(aiMessage: string): boolean {
  const n = normalizeForMatch(aiMessage);
  return CONFIRMATION_PHRASES.some((p) => n.includes(p));
}

function isUserConfirmation(userMessage: string): boolean {
  const n = normalizeForMatch(userMessage);
  return USER_CONFIRMATIONS.has(n);
}

/** Check if user message defers to AI (e.g. "you define it") */
function isDeferral(userMessage: string): boolean {
  const n = normalizeForMatch(userMessage);
  return (
    n.includes('you define') ||
    n.includes('you make it') ||
    n.includes('you decide') ||
    n.includes('up to you') ||
    n.includes('your choice')
  );
}

/**
 * Compute Q&A state from conversation and prefilled data.
 */
export function computeCampaignPlanningQAState(params: {
  gatherOrder: GatherItem[];
  prefilledKeys: string[];
  conversationHistory: ChatMessage[];
}): QAState {
  const { gatherOrder, prefilledKeys, conversationHistory } = params;

  const answeredKeys = new Set<string>(prefilledKeys);
  const history = conversationHistory || [];
  const pairs: { ai: string; user: string }[] = [];

  for (let i = 0; i < history.length - 1; i++) {
    const curr = history[i];
    const next = history[i + 1];
    if (curr.type === 'ai' && next.type === 'user') {
      pairs.push({ ai: curr.message, user: next.message });
    }
  }

  // Assign answered keys by order (each pair = one question answered)
  let pairIndex = 0;
  for (const item of gatherOrder) {
    if (answeredKeys.has(item.key)) continue;
    if (item.contingentOn && !answeredKeys.has(item.contingentOn)) continue;
    if (pairIndex >= pairs.length) break;

    const pair = pairs[pairIndex];
    // User answer can be direct or a deferral — both count as "answered"
    if (pair.user.trim().length > 0 || isDeferral(pair.user)) {
      answeredKeys.add(item.key);
      pairIndex++;
    }
  }

  const lastAi = history.filter((m) => m.type === 'ai').pop()?.message ?? '';
  const lastUser = history.filter((m) => m.type === 'user').pop()?.message ?? '';

  const lastWasConfirmation = isConfirmationPrompt(lastAi);
  const userConfirmed = lastWasConfirmation && isUserConfirmation(lastUser);

  // If user confirmed, we're ready to generate
  if (userConfirmed) {
    return {
      answeredKeys: Array.from(answeredKeys),
      currentQuestionKey: null,
      lastWasConfirmation,
      userConfirmed,
      nextQuestion: null,
      readyToGenerate: true,
    };
  }

  // Find next question
  let nextQuestion: { key: string; question: string } | null = null;
  for (const item of gatherOrder) {
    if (answeredKeys.has(item.key)) continue;
    if (item.contingentOn && !answeredKeys.has(item.contingentOn)) continue;
    nextQuestion = { key: item.key, question: item.question };
    break;
  }

  const readyToGenerate =
    nextQuestion === null &&
    lastWasConfirmation === false &&
    answeredKeys.size >= 3; // minimal viable: audience, content, start

  return {
    answeredKeys: Array.from(answeredKeys),
    currentQuestionKey: pairs.length > 0 ? gatherOrder[Math.min(pairIndex, gatherOrder.length - 1)]?.key ?? null : null,
    lastWasConfirmation,
    userConfirmed,
    nextQuestion,
    readyToGenerate,
  };
}
