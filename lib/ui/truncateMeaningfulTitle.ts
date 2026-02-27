const FILLER_WORDS = new Set([
  'the',
  'a',
  'an',
  'of',
  'for',
  'to',
  'and',
  'in',
  'on',
  'with',
]);

const LEADING_PROMPT_WORDS = new Set(['how', 'what', 'why', 'when']);

function toDisplayWord(word: string): string {
  if (!word) return '';
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

export function truncateMeaningfulTitle(title: string): string {
  const raw = String(title ?? '').trim();
  if (!raw) return 'Untitled Topic';

  const originalWordCount = raw.split(/\s+/).filter(Boolean).length;
  if (originalWordCount <= 4) return raw;

  let tokens = raw
    .replace(/[^a-zA-Z0-9\s-]/g, ' ')
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean);

  if (tokens.length === 0) return 'Untitled Topic';

  tokens = tokens.filter((token, idx) => {
    const lowered = token.toLowerCase();
    if (FILLER_WORDS.has(lowered)) return false;
    if (idx === 0 && LEADING_PROMPT_WORDS.has(lowered)) return false;
    return true;
  });

  if (tokens.length === 0) return 'Untitled Topic';
  const limited = tokens.slice(0, 4).map(toDisplayWord);
  return limited.join(' ').trim() || 'Untitled Topic';
}

