/**
 * Weekly Angle Distribution Engine
 * Ensures campaigns distribute editorial angles strategically across weeks.
 * Topic-type aware: trend, operational, and thought-leadership topics get tailored sequences.
 * Rule-based, no LLM.
 */

export type TopicType = 'trend' | 'operational' | 'thought_leadership';

const TREND_KEYWORDS = ['ai', 'automation', 'future', 'emerging', 'innovation', 'technology'];
const OPERATIONAL_KEYWORDS = ['workflow', 'process', 'execution', 'planning', 'optimization'];
const THOUGHT_LEADERSHIP_KEYWORDS = ['strategy', 'leadership', 'mindset', 'culture'];

function classifyTopic(topic: string): TopicType {
  const lower = (topic ?? '').toLowerCase().trim();
  if (!lower) return 'trend';
  const hasKeyword = (kws: string[]) =>
    kws.some((kw) => new RegExp(`\\b${kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(lower));
  if (hasKeyword(TREND_KEYWORDS)) return 'trend';
  if (hasKeyword(OPERATIONAL_KEYWORDS)) return 'operational';
  if (hasKeyword(THOUGHT_LEADERSHIP_KEYWORDS)) return 'thought_leadership';
  return 'thought_leadership';
}

const ANGLE_SEQUENCES: Record<TopicType, readonly string[]> = {
  trend: ['trend', 'future', 'opportunity', 'strategy', 'problem', 'contrarian'],
  operational: ['problem', 'strategy', 'opportunity', 'future', 'trend', 'contrarian'],
  thought_leadership: ['contrarian', 'problem', 'strategy', 'future', 'opportunity', 'trend'],
};

export type AngleName = 'trend' | 'problem' | 'opportunity' | 'contrarian' | 'future' | 'strategy';

/** Deterministic hash for diversity offset (0–2) */
function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

/**
 * Produce deterministic offset (0–2) so similar campaigns start with different angles.
 * Preserves narrative order while improving diversity across topics.
 */
function getAngleOffset(topic: string): number {
  const hash = hashString((topic ?? '').trim().toLowerCase());
  return hash % 3;
}

/**
 * Generate angle names for each week. When topic is provided, uses topic-type-aware sequence
 * plus a diversity offset so related topics do not always start with the same angle.
 *
 * @example
 * generateWeeklyAngles(4, "AI marketing") — offset may shift: ["future","opportunity","strategy","problem"]
 * generateWeeklyAngles(4, "marketing automation") — different offset: ["opportunity","strategy","problem","contrarian"]
 */
export function generateWeeklyAngles(weeks: number, topic?: string): string[] {
  const topicType = topic ? classifyTopic(topic) : 'trend';
  const sequence = ANGLE_SEQUENCES[topicType];
  const offset = topic ? getAngleOffset(topic) : 0;
  const result: string[] = [];
  for (let i = 0; i < weeks; i++) {
    const index = (i + offset) % sequence.length;
    result.push(sequence[index]);
  }
  return result;
}

/** Export for tests */
export { classifyTopic, getAngleOffset };
