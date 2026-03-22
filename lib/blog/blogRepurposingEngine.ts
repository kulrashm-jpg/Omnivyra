/**
 * Blog Repurposing Engine (AI-powered)
 *
 * Takes structured blog context and generates platform-specific content
 * using the AI gateway. Every output is grounded strictly in the provided
 * blog content — no hallucination, no new claims, no invented examples.
 *
 * For a deterministic (no-AI) alternative see: repurposingEngine.ts
 */

// ── Input ─────────────────────────────────────────────────────────────────────

export interface BlogRepurposeInput {
  title:        string;
  summary:      string;
  key_insights: string[];
  headings:     string[];
  tone?:        'professional' | 'conversational' | 'bold' | 'educational';
}

// ── Output types ──────────────────────────────────────────────────────────────

export type LinkedInVariation = 'insight-led' | 'story-led' | 'contrarian';

export interface LinkedInPost {
  variation: LinkedInVariation;
  label:     string;
  content:   string;
}

export interface RepurposeOutput {
  linkedin_posts:     LinkedInPost[];
  twitter_thread:     string[];
  email:              {
    subject:         string;
    preview:         string;
    bullet_insights: string[];
    cta:             string;
  };
  instagram_caption?: string;
}

// ── Prompt construction ───────────────────────────────────────────────────────

export function buildRepurposeSystemPrompt(): string {
  return `You are a content repurposing assistant for B2B marketing teams.

CRITICAL RULES — MUST FOLLOW:
- Use ONLY information from the blog content provided by the user
- Do NOT invent statistics, facts, quotes, or examples not present in the blog
- Do NOT add arguments, claims, or angles absent from the provided content
- Every sentence must be traceable back to the provided title, summary, key_insights, or headings
- Keep brand tone consistent with the requested tone parameter
- Return ONLY valid JSON — no prose, no markdown fences

Your output must be JSON matching this exact schema:
{
  "linkedin_posts": [
    { "variation": "insight-led", "label": "Insight-Led", "content": "string" },
    { "variation": "story-led",   "label": "Story-Led",   "content": "string" },
    { "variation": "contrarian",  "label": "Contrarian",  "content": "string" }
  ],
  "twitter_thread": ["tweet1", "tweet2", ...],
  "email": {
    "subject": "string",
    "preview": "string",
    "bullet_insights": ["string", "string", "string", "string", "string"],
    "cta": "string"
  },
  "instagram_caption": "string"
}`;
}

export function buildRepurposeUserPrompt(input: BlogRepurposeInput): string {
  const tone   = input.tone ?? 'professional';
  const insights = input.key_insights.length > 0
    ? input.key_insights.map((i, n) => `${n + 1}. ${i}`).join('\n')
    : '(none provided)';
  const headings = input.headings.length > 0
    ? input.headings.map((h, n) => `${n + 1}. ${h}`).join('\n')
    : '(none provided)';

  return `Repurpose the following blog post. Use ONLY the content below — no invented claims.

BLOG TITLE: ${input.title}

SUMMARY:
${input.summary || '(no summary provided)'}

KEY INSIGHTS:
${insights}

MAIN HEADINGS / TOPICS:
${headings}

TONE: ${tone}

---

PLATFORM REQUIREMENTS:

LinkedIn (3 variations):
- insight-led: Open with a data point or key insight. Bullet the top takeaways. End with a soft CTA.
- story-led: Open with a relatable situation. Build to the insight. Close with a lesson.
- contrarian: Open with a counterintuitive angle from the blog. Challenge the conventional view. Back it with insights from the content.
- Each post: 150–300 words. Professional but human. No hollow buzzwords.

Twitter thread (7–9 tweets):
- Tweet 1: Hook that earns the scroll. Announce the thread.
- Tweets 2–7: One insight per tweet. Numbered (2/, 3/, etc.). Short, punchy, specific.
- Tweet 8: Common mistake or warning derived from the content.
- Tweet 9: CTA + summary.
- Each tweet: max 280 characters.

Email:
- Subject: concise, curiosity-driving, ≤60 characters
- Preview: 1 sentence that earns the open, ≤100 characters
- bullet_insights: exactly 5 bullet points from the key_insights / content
- cta: action-oriented label for the read-more button

Instagram caption:
- 1 punchy opening line
- 2–3 sentences distilling the core message
- 3–5 relevant hashtags at the end
- max 300 characters total`;
}

// ── Output validation ─────────────────────────────────────────────────────────

export function validateRepurposeOutput(raw: unknown): RepurposeOutput | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;

  const linkedin = Array.isArray(o['linkedin_posts'])
    ? (o['linkedin_posts'] as any[]).filter(
        (p) => p && typeof p.variation === 'string' && typeof p.content === 'string'
      ).slice(0, 3)
    : [];

  const twitter = Array.isArray(o['twitter_thread'])
    ? (o['twitter_thread'] as unknown[]).filter((t) => typeof t === 'string').slice(0, 9) as string[]
    : [];

  const emailRaw = o['email'] as Record<string, unknown> | null;
  const email = {
    subject:         typeof emailRaw?.['subject'] === 'string' ? emailRaw['subject'] : '',
    preview:         typeof emailRaw?.['preview'] === 'string' ? emailRaw['preview'] : '',
    bullet_insights: Array.isArray(emailRaw?.['bullet_insights'])
      ? (emailRaw['bullet_insights'] as unknown[]).filter((b) => typeof b === 'string').slice(0, 5) as string[]
      : [],
    cta:             typeof emailRaw?.['cta'] === 'string' ? emailRaw['cta'] : 'Read the full article →',
  };

  if (linkedin.length === 0 && twitter.length === 0 && !email.subject) return null;

  return {
    linkedin_posts: linkedin as LinkedInPost[],
    twitter_thread: twitter,
    email,
    instagram_caption: typeof o['instagram_caption'] === 'string' ? o['instagram_caption'] : undefined,
  };
}
