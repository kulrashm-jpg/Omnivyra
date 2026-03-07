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
  'continue', // Use last stored info (e.g. duration) and generate — do not ask for duration again
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
  if (USER_CONFIRMATIONS.has(n)) return true;
  // Accept natural confirmation variants (e.g. "yes, proceed with 4 weeks", "use 8 weeks instead")
  if (/^(yes|sure|ok|okay|please|yeah|yep)\b/.test(n)) return true;
  if (/\b(proceed with|use)\s+\d{1,2}\s*weeks?\b/.test(n)) return true;
  // Bare duration after "create your week plan now?" (e.g. "4 weeks", "8 weeks") = confirm with that duration
  if (/^\s*\d{1,2}\s*weeks?\s*$/.test(n)) return true;
  if (/\bcreate\b.*\bplan\b/.test(n)) return true;
  return false;
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
  prefilledValues?: Record<string, unknown>;
  requiredKeys?: string[];
  conversationHistory: ChatMessage[];
  /** Trusted UTC "today" in YYYY-MM-DD (prefer internet time). */
  utcTodayISO?: string;
}): QAState {
  const { gatherOrder, prefilledKeys, prefilledValues, requiredKeys, conversationHistory, utcTodayISO } = params;

  const answeredKeys = new Set<string>(prefilledKeys);
  const requiredSet = new Set<string>(requiredKeys || []);
  const history = conversationHistory || [];
  const pairs: { ai: string; user: string }[] = [];
  const invalidReasonByKey = new Map<string, string>();
  let hasExistingContent: boolean | null = null;

  const parseYesNo = (v: string): boolean | null => {
    const n = normalizeForMatch(v);
    if (!n) return null;
    const noTokens = ['no', 'none', 'zero', "don't have", 'no content', 'not yet'];
    const yesTokens = ['yes', 'have', 'existing', 'i do', 'we have', 'available'];
    if (noTokens.some((t) => n.includes(t))) return false;
    if (yesTokens.some((t) => n.includes(t))) return true;
    return null;
  };
  const hasNumericQuantity = (v: string) => /\b\d+\b/.test(v);
  const hasSpelledNumber = (v: string) =>
    /\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen)\b/i.test(v);
  const hasContentArtifactHint = (v: string) =>
    /\b(video|videos|post|posts|blog|blogs|article|articles|carousel|carousels|reel|reels|story|stories|thread|threads|short|shorts|song|songs|audio|slide|slides|slideware|deck|decks|content)\b/i.test(v);
  const hasRecognizedPlatform = (v: string) =>
    /\b(linkedin|instagram|facebook|youtube|tiktok|twitter|x|blog)\b/i.test(v);
  const parseDurationWeeks = (v: string): number | null => {
    const match = v.match(/\b(\d{1,2})\s*(?:week|weeks)\b/i) ?? v.match(/\b(\d{1,2})\b/);
    if (!match) return null;
    const n = Number(match[1]);
    return Number.isFinite(n) && n >= 1 && n <= 52 ? n : null;
  };
  const isDateLike = (v: string) => {
    const t = v.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return !Number.isNaN(new Date(t).getTime());
    if (/^\d{2}-\d{2}-\d{2}$/.test(t)) return true; // legacy support
    return false;
  };
  const isFutureISODate = (v: string): boolean => {
    const t = v.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return false;
    if (!isDateLike(t)) return false;
    const now = String(utcTodayISO || '').trim();
    if (now && /^\d{4}-\d{2}-\d{2}$/.test(now)) return t > now;
    // Fallback: system UTC date (only if trusted date not provided).
    const d = new Date();
    const yyyy = String(d.getUTCFullYear()).padStart(4, '0');
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(d.getUTCDate()).padStart(2, '0');
    const today = `${yyyy}-${mm}-${dd}`;
    return t > today;
  };
  const validateAnswerForKey = (key: string, userMessage: string): boolean => {
    const text = userMessage.trim();
    if (!text) return false;
    if (isDeferral(text)) return true;
    switch (key) {
      case 'target_audience':
        return text.length >= 2;
      case 'key_messages':
        return text.length >= 2;
      case 'campaign_duration':
        return parseDurationWeeks(text) != null;
      case 'platforms':
        return hasRecognizedPlatform(text);
      case 'audience_professional_segment':
        return text.length >= 2;
      case 'communication_style':
        return text.length >= 2;
      case 'action_expectation':
        return text.length >= 2;
      case 'content_depth':
        return text.length >= 2;
      case 'topic_continuity':
        return text.length >= 2;
      case 'platform_content_types':
        // Accept either numeric selection ("1,3") or named formats ("post, video, blog").
        return hasNumericQuantity(text) || hasContentArtifactHint(text);
      case 'tentative_start':
        // Only accept future dates in YYYY-MM-DD (validated against trusted UTC "today").
        return isFutureISODate(text);
      case 'content_capacity':
        return (
          hasNumericQuantity(text) ||
          (hasSpelledNumber(text) && hasContentArtifactHint(text)) ||
          /week|per\s*week|manual|ai-assisted|full ai/i.test(text)
        );
      case 'available_content':
        // Guard against date-like answers (e.g., 2026-08-15) being misclassified as content inventory.
        return parseYesNo(text) != null || (hasNumericQuantity(text) && hasContentArtifactHint(text));
      default:
        return text.length > 0;
    }
  };
  const explainInvalidForKey = (key: string, userMessage: string): string => {
    const text = userMessage.trim();
    switch (key) {
      case 'tentative_start':
        return `I asked again because "${text}" is not a valid future start date. Please provide a future date in YYYY-MM-DD format (e.g., 2026-08-15).`;
      case 'campaign_duration':
        return `I asked again because "${text}" did not include a clear number of weeks. Please answer with a number (e.g., 6, 8, or 12 weeks).`;
      case 'platforms':
        return `I asked again because "${text}" did not clearly list platforms. Please name platforms like LinkedIn, Instagram, YouTube, X, Facebook, or TikTok.`;
      case 'platform_content_types':
        return `I asked again because "${text}" did not clearly indicate content types per platform. Please reply with the numbers and/or names of formats you plan to publish (e.g., "LinkedIn: 1,3; Facebook: 2" or "LinkedIn: post, blog; Facebook: video").`;
      case 'content_capacity':
        return `I asked again because "${text}" did not clearly show weekly content capacity. Please (1) say whether creation is Manual, AI-assisted, or Full AI, and (2) include quantities and formats (e.g., 2 videos/week, 5 posts/week, 1 blog/week).`;
      case 'available_content':
        return `I asked again because "${text}" did not clearly indicate existing content. Please answer yes/no, or provide counts like 3 videos and 10 posts.`;
      default:
        return `I asked again because "${text}" did not answer the requested field clearly. Please provide a direct, specific answer.`;
    }
  };

  const detectAskedKey = (aiMessage: string): string | null => {
    const n = normalizeForMatch(aiMessage);
    if (!n) return null;
    // Prefer key_messages / pain points before generic "target audience" so "What are your key messages..."
    // never matches target_audience (e.g. when "target" appears in "to address" or in required missing list).
    if (n.includes('key messages') || n.includes('pain points') || n.includes('one thing you want people to remember') || n.includes('core message') || n.includes('audience to remember')) return 'key_messages';
    if (n.includes('who is your primary target audience') || n.includes('primary target audience') || n.includes('who will see your content') || n.includes('target audience')) return 'target_audience';
    if ((n.includes('which professionals') && n.includes('mainly speaking')) || n.includes('which group fits')) return 'audience_professional_segment';
    if (n.includes('how do you want your content to sound') || n.includes('how should your posts sound')) return 'communication_style';
    if ((n.includes('after reading your content') && n.includes('what should people do')) || n.includes('what do you want people to do after')) return 'action_expectation';
    if (n.includes('short easy reads') || (n.includes('detailed insights') && n.includes('short')) || n.includes('short reads or longer') || n.includes('longer pieces')) return 'content_depth';
    if (n.includes('connected series') && n.includes('mostly independent')) return 'topic_continuity';
    if (n.includes('ongoing story') || n.includes('different topics each time')) return 'topic_continuity';
    if (n.includes('existing content') || n.includes('do you have any existing content')) return 'available_content';
    if (n.includes('which category') || n.includes('which specific week') || n.includes('should it serve')) return 'available_content_allocation';
    if ((n.includes('start') && n.includes('campaign')) || n.includes('yy-mm-dd') || (n.includes('start') && n.includes('date')) || n.includes('when do you want to start')) return 'tentative_start';
    if (n.includes('campaign types') || n.includes("what's the main goal")) return 'campaign_types';
    if (
      n.includes('produce per week') ||
      n.includes('produce each week') ||
      n.includes('production capacity') ||
      n.includes('weekly production capacity') ||
      n.includes('content capacity') ||
      n.includes('how much content') ||
      n.includes('how will you create') ||
      n.includes('how many pieces per week') ||
      n.includes('create per week') ||
      n.includes('creator-dependent pieces') ||
      n.includes('how many can you create per week') ||
      n.includes('how many can you and your team create every week')
    ) {
      return 'content_capacity';
    }
    if ((n.includes('how many') && n.includes('week')) || n.includes('campaign run') || n.includes('duration') || n.includes('how many weeks')) return 'campaign_duration';
    if (n.includes('which platforms') || n.includes('platforms will you focus') || n.includes('where will you post')) return 'platforms';
    if (n.includes('platform-exclusive campaigns') || n.includes('only for one platform') || n.includes('anything only for one platform')) return 'exclusive_campaigns';
    if (n.includes('content types') && n.includes('count per week')) return 'platform_content_requests';
    if (n.includes('how many of each type per week')) return 'platform_content_requests';
    if (n.includes('set how often') || n.includes('same topic across platforms') || n.includes('publish same day on all platforms') || n.includes('let AI decide')) return 'platform_content_requests';
    if ((n.includes('content types') && n.includes('platform')) || n.includes('what will you post on each') || n.includes('which content types will you use') || n.includes('for each platform you selected')) return 'platform_content_types';
    if (n.includes('success metrics') || (n.includes('metrics') && n.includes('track')) || n.includes('like to see improve')) return 'success_metrics';
    return null;
  };

  const prefilledAvailable = String(prefilledValues?.available_content ?? '');
  if (prefilledAvailable) {
    hasExistingContent = parseYesNo(prefilledAvailable);
  }

  for (let i = 0; i < history.length - 1; i++) {
    const curr = history[i];
    const next = history[i + 1];
    if (curr.type === 'ai' && next.type === 'user') {
      pairs.push({ ai: curr.message, user: next.message });
    }
  }

  // Assign answered keys by the ACTUAL AI question key, not by pair index.
  const gatherByKey = new Map(gatherOrder.map((g) => [g.key, g]));
  for (const pair of pairs) {
    const askedKey = detectAskedKey(pair.ai);
    if (!askedKey) continue;
    const item = gatherByKey.get(askedKey);
    if (!item || answeredKeys.has(item.key)) continue;
    if (item.contingentOn === 'available_content') {
      if (hasExistingContent !== true) continue;
    } else if (item.contingentOn && !answeredKeys.has(item.contingentOn)) {
      continue;
    }
    if (validateAnswerForKey(item.key, pair.user)) {
      answeredKeys.add(item.key);
      if (item.key === 'available_content') {
        hasExistingContent = parseYesNo(pair.user);
      }
      invalidReasonByKey.delete(item.key);
    } else if (pair.user.trim().length > 0) {
      invalidReasonByKey.set(item.key, explainInvalidForKey(item.key, pair.user));
    }
  }

  // Safeguard: if the very last exchange (last AI, last user) is a question we're about to re-ask,
  // treat the user's reply as the answer so we don't repeat the question (handles edge cases in pairing).
  const lastAi = history.filter((m) => m.type === 'ai').pop()?.message ?? '';
  const lastUser = history.filter((m) => m.type === 'user').pop()?.message ?? '';
  const lastAskedKey = lastAi ? detectAskedKey(lastAi) : null;
  if (lastAskedKey && lastUser.trim().length > 0 && requiredSet.has(lastAskedKey) && !answeredKeys.has(lastAskedKey)) {
    if (validateAnswerForKey(lastAskedKey, lastUser)) {
      answeredKeys.add(lastAskedKey);
      if (lastAskedKey === 'available_content') {
        hasExistingContent = parseYesNo(lastUser);
      }
      invalidReasonByKey.delete(lastAskedKey);
    }
  }

  const lastWasConfirmation = isConfirmationPrompt(lastAi);
  const explicitGenerateRequest = isUserConfirmation(lastUser);

  // Find next required question
  let nextQuestion: { key: string; question: string } | null = null;
  for (const item of gatherOrder) {
    if (!requiredSet.has(item.key)) continue;
    if (answeredKeys.has(item.key)) continue;
    if (item.contingentOn === 'available_content') {
      if (hasExistingContent !== true) continue;
    } else if (item.contingentOn && !answeredKeys.has(item.contingentOn)) {
      continue;
    }
    const invalidReason = invalidReasonByKey.get(item.key);
    nextQuestion = {
      key: item.key,
      question: invalidReason ? `${item.question}\n${invalidReason}` : item.question,
    };
    break;
  }

  const missingRequiredKeys = gatherOrder
    .filter((item) => requiredSet.has(item.key))
    .filter((item) => !answeredKeys.has(item.key))
    .filter((item) => {
      if (item.contingentOn === 'available_content') return hasExistingContent === true;
      if (item.contingentOn) return answeredKeys.has(item.contingentOn);
      return true;
    })
    .map((item) => item.key);

  const allRequiredAnswered = missingRequiredKeys.length === 0;
  // Generate when required fields are complete and user clearly requests generation,
  // even if the immediately previous AI turn was not the confirmation prompt.
  const userConfirmed = (lastWasConfirmation && explicitGenerateRequest) || (allRequiredAnswered && explicitGenerateRequest);
  const readyToGenerate = allRequiredAnswered && userConfirmed;

  if (typeof process !== 'undefined' && process.env?.NODE_ENV !== 'test') {
    console.info('[campaign-planning-qa]', {
      answeredKeys: Array.from(answeredKeys),
      nextQuestionKey: nextQuestion?.key ?? null,
      missingRequiredKeys,
      lastAskedKey,
      readyToGenerate,
    });
  }

  return {
    answeredKeys: Array.from(answeredKeys),
    currentQuestionKey: nextQuestion?.key ?? null,
    lastWasConfirmation,
    userConfirmed,
    nextQuestion,
    readyToGenerate,
    missingRequiredKeys,
    allRequiredAnswered,
    hasExistingContent,
  };
}
