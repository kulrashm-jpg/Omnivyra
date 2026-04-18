export const MEDIA_DEPENDENT_TYPES = new Set(['video', 'reel', 'short', 'carousel', 'slides', 'song']);
export const VIDEO_TYPES = new Set(['video', 'reel', 'short', 'podcast']);
export const CAROUSEL_TYPES = new Set(['carousel', 'slides']);
export const ARTICLE_TYPES = new Set(['article', 'newsletter', 'blog', 'short_story', 'white_paper']);
export const THREAD_TYPES = new Set(['thread', 'tweetstorm']);
export const POLL_TYPES = new Set(['poll']);

export function getContentTypeCategory(ct: string): 'video' | 'carousel' | 'article' | 'thread' | 'poll' | 'post' {
  const t = ct.toLowerCase();
  if (VIDEO_TYPES.has(t)) return 'video';
  if (CAROUSEL_TYPES.has(t)) return 'carousel';
  if (ARTICLE_TYPES.has(t)) return 'article';
  if (THREAD_TYPES.has(t)) return 'thread';
  if (POLL_TYPES.has(t)) return 'poll';
  return 'post';
}

export function getContentTypeSystemPrompt(category: 'video' | 'carousel' | 'article' | 'thread' | 'poll' | 'post'): string {
  const currentYear = new Date().getFullYear();
  const nextYear = currentYear + 1;
  switch (category) {
    case 'video':
      return `You are a video content strategist. Write a production guide for a creator to film. Output plain text structured as:
THEME: [1-sentence theme]
HOOK (opening 5 seconds): [punchy opening line or visual action]
KEY TALKING POINTS:
- [point 1]
- [point 2]
- [point 3]
B-ROLL SUGGESTIONS: [brief visual ideas]
CLOSING CTA: [what to say at the end]
Keep it concise and actionable for the creator.`;
    case 'carousel':
      return `You are a carousel content designer. Write slide-by-slide content. Output plain text structured as:
SLIDE 1 (Cover): [bold headline]
SLIDE 2: [key point]
SLIDE 3: [key point]
SLIDE 4: [key point]
SLIDE 5: [key point]
SLIDE 6 (optional): [key point]
SLIDE 7 (CTA): [call to action]
Each slide: max 15 words. Make each slide a standalone punchy statement.`;
    case 'article':
      return `You are a long-form content writer. Write a complete piece with proper structure. Follow these type-specific rules:
- article/blog: Compelling headline, brief intro, 3-4 sections with subheadings, conclusion with CTA. Target 500-700 words.
- newsletter: Subject line, warm opening, 2-3 sections with subheadings, key takeaway, and a clear CTA at the end. Target 400-600 words.
- short_story: Narrative arc with hook, rising tension, resolution. First-person or third-person. Conversational tone. Target 300-500 words.
- white_paper: Formal tone, executive summary, problem statement, evidence/data sections, solution framework, conclusion. Target 700-1000 words.
Output plain text with clear section breaks. Match the format to the exact content type requested.`;
    case 'thread':
      return `You are a Twitter/X thread writer. Write a thread of 5-7 tweets. Format as:
1/ [opening hook tweet - must stop the scroll]
2/ [key insight]
3/ [key insight]
4/ [key insight]
5/ [key insight]
6/ [optional insight]
7/ [closing with CTA]
Each tweet: max 270 characters. Output plain text.`;
    case 'poll':
      return `You are a social media engagement specialist. Create a poll post that sparks conversation. Output plain text structured as:
QUESTION: [A thought-provoking, debatable question related to the topic — max 140 characters]
OPTION 1: [First answer choice — max 25 characters]
OPTION 2: [Second answer choice — max 25 characters]
OPTION 3: [Third answer choice — max 25 characters]
OPTION 4: [Fourth answer choice — max 25 characters]
CONTEXT: [1-2 sentences of engaging context to post alongside the poll — encourage people to vote and explain their choice]

Rules:
- The question must be genuinely debatable — no obvious "right" answer
- Options should be distinct, not overlapping
- Make it relevant to the target audience's daily work
- Keep it professional but conversational`;
    default:
      return `Write publish-ready social media post content from the provided JSON context.

Non-negotiable rules:
- The current year is ${currentYear}. Write for the present or near future (${currentYear}-${nextYear}).
- Never introduce random past-year framing such as 2023 or 2024 unless the provided context explicitly requires that exact year.
- If the provided context includes a launch month, launch year, or explicit timing, preserve it exactly.
- Do not invent testimonials, customer quotes, case studies, adoption, traction, user outcomes, or proof claims unless the provided context explicitly includes them.
- Do not imply the company is already broadly adopted, proven, or used by customers unless the provided context explicitly says so.
- For launch-oriented posts, keep the framing upcoming/current and factual. Do not fabricate market history or social proof.

Writing rules:
- Keep it concise, specific, and credible.
- Avoid fluffy corporate language.
- Output plain text only.
- Max 180 words.`;
  }
}

export function getContentTypeMaxWords(category: 'video' | 'carousel' | 'article' | 'thread' | 'poll' | 'post', exactType?: string): number {
  switch (category) {
    case 'article': {
      const t = (exactType ?? '').toLowerCase();
      if (t === 'white_paper') return 1000;
      if (t === 'newsletter') return 600;
      if (t === 'short_story') return 500;
      return 700;
    }
    case 'thread': return 350;
    case 'carousel': return 120;
    case 'video': return 200;
    case 'poll': return 100;
    default: return 180;
  }
}

export const MAX_WORDS_MASTER = 180;
export const MAX_WORDS_VARIANT = 120;
export const X_CHAR_LIMIT = 280;
export const DISCOVERABILITY_STOPWORDS = new Set([
  'about',
  'after',
  'again',
  'because',
  'between',
  'could',
  'would',
  'their',
  'there',
  'these',
  'those',
  'where',
  'which',
  'while',
  'with',
  'without',
  'into',
  'from',
  'that',
  'this',
  'have',
  'will',
  'your',
  'you',
  'they',
  'them',
  'what',
  'when',
  'been',
  'were',
  'using',
  'used',
  'just',
  'more',
  'than',
  'make',
  'made',
  'over',
  'under',
  'across',
  'toward',
  'towards',
  'into',
  'onto',
  'through',
  'plan',
  'content',
  'campaign',
]);

export function nonEmpty(value: unknown): string {
  return String(value ?? '').trim();
}

export function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function sanitizeIdPart(value: unknown): string {
  const raw = nonEmpty(value).toLowerCase();
  return raw.replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'item';
}

export function toPositiveNumber(value: unknown): number | undefined {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return Math.floor(n);
}

export function uniqueLimited(values: string[], limit: number): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const normalized = nonEmpty(value).toLowerCase();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
    if (out.length >= limit) break;
  }
  return out;
}
