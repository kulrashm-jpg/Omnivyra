const FALLBACK_PATTERNS = [
  /available signals indicate limited data coverage/i,
  /available signals indicate limited decision coverage/i,
  /competitor benchmarking is limited in this report run/i,
  /re-run with richer/i,
  /seo-led snapshot/i,
  /limited competitor data/i,
  /limited in this report run/i,
  /limited data coverage/i,
  /^micro cta:/i,
];

export const BLOCKED = [
  'Summary is limited',
  'Not available',
  'Insufficient data',
];

const ARTIFACT_REPLACEMENTS: Array<[RegExp, string]> = [
  [/â€¢/g, '-'],
  [/â†“/g, '↓'],
  [/â†’/g, '->'],
  [/â€“/g, '-'],
  [/â€”/g, '-'],
  [/â€˜|â€™/g, "'"],
  [/â€œ|â€�/g, '"'],
  [/Â/g, ' '],
  [/\u00a0/g, ' '],
];

function normalizeWhitespace(value: string): string {
  return value
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function dedupeSentences(value: string): string {
  const sentences = value
    .split(/(?<=[.!?])\s+/)
    .map((item) => item.trim())
    .filter(Boolean);

  const seen = new Set<string>();
  const unique: string[] = [];
  for (const sentence of sentences) {
    const key = sentence.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    unique.push(sentence);
  }
  return unique.join(' ').trim();
}

function softenLongTokens(value: string): string {
  return value.replace(/[^\s]{25,}/g, (token) => {
    if (token.includes('/') || token.includes('_') || token.includes('-') || token.includes('.')) {
      return token.replace(/([/_\-.])/g, '$1 ');
    }
    return token;
  });
}

export function sanitizeTextArtifacts(value: string): string {
  let output = value;
  for (const [pattern, replacement] of ARTIFACT_REPLACEMENTS) {
    output = output.replace(pattern, replacement);
  }
  return normalizeWhitespace(output);
}

export function isFallbackRenderText(value: string | null | undefined): boolean {
  const text = sanitizeTextArtifacts(value ?? '');
  if (!text) return true;
  return BLOCKED.some((blocked) => text.includes(blocked)) || FALLBACK_PATTERNS.some((pattern) => pattern.test(text));
}

export function assertNoFallback(text: string): void {
  for (const blocked of BLOCKED) {
    if (text.includes(blocked)) {
      throw new Error('Fallback text leaked into final render');
    }
  }
}

export function sanitizeRenderText(
  value: string | null | undefined,
  options?: {
    maxChars?: number;
    maxSentences?: number;
  },
): string {
  const maxChars = options?.maxChars;
  const maxSentences = options?.maxSentences ?? 1;

  let text = sanitizeTextArtifacts(value ?? '');
  if (!text || isFallbackRenderText(text)) return '';

  text = dedupeSentences(text);
  text = softenLongTokens(text);

  const sentences = text
    .split(/(?<=[.!?])\s+/)
    .map((item) => item.trim())
    .filter(Boolean);
  if (sentences.length > maxSentences) {
    text = sentences.slice(0, maxSentences).join(' ');
  }

  if (typeof maxChars === 'number' && Number.isFinite(maxChars) && text.length > maxChars) {
    const sliced = text.slice(0, maxChars);
    const safeBreak = Math.max(sliced.lastIndexOf(' '), sliced.lastIndexOf('/'), sliced.lastIndexOf('-'));
    text = (safeBreak > maxChars * 0.65 ? sliced.slice(0, safeBreak) : sliced).trim();
  }

  return normalizeWhitespace(text);
}

export function sanitizeRenderLines(
  values: Array<string | null | undefined>,
  options?: {
    maxItems?: number;
    maxCharsPerLine?: number;
    maxSentencesPerLine?: number;
  },
): string[] {
  const maxItems = options?.maxItems ?? 3;
  const maxCharsPerLine = options?.maxCharsPerLine;
  const maxSentencesPerLine = options?.maxSentencesPerLine ?? 1;
  const seen = new Set<string>();
  const lines: string[] = [];

  for (const value of values) {
    const cleaned = sanitizeRenderText(value, {
      maxChars: maxCharsPerLine,
      maxSentences: maxSentencesPerLine,
    });
    if (!cleaned) continue;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    lines.push(cleaned);
    if (lines.length >= maxItems) break;
  }

  return lines;
}
