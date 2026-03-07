/**
 * Weekly Plan Command Parser — Lightweight natural language to structured operations
 *
 * Parses user instructions like "Move A3 to Friday morning" into operations
 * for the weekly plan edit engine. Phase 4.
 */

export type EditOperationType = 'move' | 'swap' | 'delay' | 'advance' | 'delete' | 'add';

export interface MoveOperation {
  type: 'move';
  content_code: string;
  day: number;
  time: string;
}

export interface SwapOperation {
  type: 'swap';
  content_code_a: string;
  content_code_b: string;
}

export interface DelayAdvanceOperation {
  type: 'delay' | 'advance';
  content_code: string;
  days: number;
}

export interface DeleteOperation {
  type: 'delete';
  content_code: string;
}

export interface AddOperation {
  type: 'add';
  topic_code: string;
  platform?: string;
  content_type?: string;
}

export type EditOperation =
  | MoveOperation
  | SwapOperation
  | DelayAdvanceOperation
  | DeleteOperation
  | AddOperation;

const DAY_MAP: Record<string, number> = {
  mon: 1,
  monday: 1,
  tue: 2,
  tuesday: 2,
  wed: 3,
  wednesday: 3,
  thu: 4,
  thursday: 4,
  fri: 5,
  friday: 5,
  sat: 6,
  saturday: 6,
  sun: 7,
  sunday: 7,
};

const TIME_PATTERNS: Record<string, string> = {
  morning: '09:00',
  afternoon: '14:00',
  evening: '18:00',
  noon: '12:00',
  midday: '12:00',
};

function parseDay(s: string): number | null {
  const key = s.trim().toLowerCase();
  return DAY_MAP[key] ?? null;
}

function parseTime(s: string): string {
  const lower = s.trim().toLowerCase();
  const alias = TIME_PATTERNS[lower];
  if (alias) return alias;
  if (/^\d{1,2}(:\d{2})?$/.test(s)) {
    const [h, m = '0'] = s.split(':');
    const hour = Math.min(23, Math.max(0, parseInt(h!, 10)));
    const min = Math.min(59, Math.max(0, parseInt(m, 10)));
    return `${hour.toString().padStart(2, '0')}:${min.toString().padStart(2, '0')}`;
  }
  return '09:00';
}

function extractContentCode(text: string): string | null {
  const match = text.match(/\b([A-Z])(\d+)\b/i);
  if (match) return `${match[1].toUpperCase()}${match[2]}`;
  return null;
}

function extractTopicCode(text: string): string | null {
  const match = text.match(/\b(?:topic\s+)?([A-Z])\b/i);
  if (match) return match[1].toUpperCase();
  return null;
}

/**
 * Parse natural language into one or more structured edit operations.
 * Returns empty array if nothing could be parsed.
 */
export function parseWeeklyPlanCommands(instruction: string): EditOperation[] {
  const trimmed = String(instruction ?? '').trim();
  if (!trimmed) return [];

  const lower = trimmed.toLowerCase();
  const ops: EditOperation[] = [];

  // MOVE: "Move A3 to Friday morning" | "move a3 to fri 09:00" | "move A3 Friday"
  const moveMatch = lower.match(/move\s+([a-z]\d+)\s+to\s+(\w+)(?:\s+([\w:]+))?/i) ||
    lower.match(/move\s+([a-z]\d+)\s+(\w+)(?:\s+([\w:]+))?/i);
  if (moveMatch) {
    const contentCode = extractContentCode(moveMatch[1]!);
    const part2 = moveMatch[2] ?? '';
    const part3 = moveMatch[3] ?? '';
    const day = parseDay(part2) ?? parseDay(part3);
    if (contentCode && day != null) {
      const timeStr = parseDay(part2) != null ? part3 : part2;
      ops.push({
        type: 'move',
        content_code: contentCode,
        day,
        time: timeStr ? parseTime(timeStr) : '09:00',
      });
      return ops;
    }
  }

  // SWAP: "Swap A2 and B1" | "swap a2 and b1"
  const swapMatch = lower.match(/swap\s+([a-z]\d+)\s+and\s+([a-z]\d+)/i);
  if (swapMatch) {
    const a = extractContentCode(swapMatch[1]!);
    const b = extractContentCode(swapMatch[2]!);
    if (a && b) {
      ops.push({ type: 'swap', content_code_a: a, content_code_b: b });
      return ops;
    }
  }

  // DELAY: "Delay A1 by 1 day" | "delay a1 by 2 days"
  const delayMatch = lower.match(/delay\s+([a-z]\d+)\s+by\s+(\d+)\s*(?:day|days)?/i);
  if (delayMatch) {
    const contentCode = extractContentCode(trimmed);
    const days = parseInt(delayMatch[2]!, 10) || 1;
    if (contentCode) {
      ops.push({ type: 'delay', content_code: contentCode, days });
      return ops;
    }
  }

  // ADVANCE: "Advance A1 by 1 day" | "move a1 earlier by 1 day"
  const advanceMatch = lower.match(
    /(?:advance|move\s+[a-z]\d+\s+earlier)\s+([a-z]\d+)\s+by\s+(\d+)\s*(?:day|days)?/i
  );
  if (advanceMatch) {
    const contentCode = extractContentCode(trimmed) ?? extractContentCode(advanceMatch[1]!);
    const days = parseInt(advanceMatch[2]!, 10) || 1;
    if (contentCode) {
      ops.push({ type: 'advance', content_code: contentCode, days });
      return ops;
    }
  }
  const advanceMatch2 = lower.match(/advance\s+([a-z]\d+)\s+by\s+(\d+)\s*(?:day|days)?/i);
  if (advanceMatch2) {
    const contentCode = extractContentCode(trimmed);
    const days = parseInt(advanceMatch2[2]!, 10) || 1;
    if (contentCode) {
      ops.push({ type: 'advance', content_code: contentCode, days });
      return ops;
    }
  }

  // DELETE: "Delete B2" | "remove b2"
  const deleteMatch = lower.match(/(?:delete|remove)\s+([a-z]\d+)/i);
  if (deleteMatch) {
    const contentCode = extractContentCode(trimmed);
    if (contentCode) {
      ops.push({ type: 'delete', content_code: contentCode });
      return ops;
    }
  }

  // ADD: "Add Instagram post under topic B" | "add post under B"
  const addMatch = lower.match(
    /add\s+(?:(?:a\s+)?(\w+)\s+(?:post|article|video|carousel|thread|blog|podcast))?\s+under\s+(?:topic\s+)?([a-z])/i
  );
  if (addMatch) {
    const platformOrType = addMatch[1]?.toLowerCase();
    const topicCode = (addMatch[2] ?? '').toUpperCase();
    if (topicCode) {
      const platform =
        ['instagram', 'linkedin', 'twitter', 'facebook', 'youtube', 'tiktok'].find((p) =>
          (platformOrType ?? '').includes(p)
        ) ?? undefined;
      const content_type =
        ['post', 'article', 'video', 'carousel', 'thread', 'blog', 'podcast'].find((c) =>
          (platformOrType ?? '').includes(c)
        ) ?? 'post';
      ops.push({
        type: 'add',
        topic_code: topicCode,
        platform,
        content_type,
      });
      return ops;
    }
  }

  const addMatch2 = lower.match(/add\s+(?:a\s+)?(\w+)\s+(?:post|article|video)\s+to\s+(?:topic\s+)?([a-z])/i);
  if (addMatch2) {
    const topicCode = (addMatch2[2] ?? '').toUpperCase();
    if (topicCode) {
      ops.push({
        type: 'add',
        topic_code: topicCode,
        content_type: 'post',
      });
      return ops;
    }
  }

  // "add post under B" - simpler pattern
  const addMatch3 = lower.match(/add\s+(?:a\s+)?(post|article|video|carousel|thread|blog|podcast)\s+under\s+(?:topic\s+)?([a-z])/i);
  if (addMatch3) {
    const topicCode = (addMatch3[2] ?? '').toUpperCase();
    const contentType = (addMatch3[1] ?? 'post').toLowerCase();
    if (topicCode) {
      ops.push({
        type: 'add',
        topic_code: topicCode,
        content_type: contentType,
      });
      return ops;
    }
  }

  return ops;
}
