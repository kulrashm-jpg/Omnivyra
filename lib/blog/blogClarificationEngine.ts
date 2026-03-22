/**
 * Blog Clarification Engine
 *
 * Evaluates signal strength of a theme input and returns targeted
 * clarification questions — only when the input is too vague to generate
 * a high-quality, specific blog post without guessing.
 *
 * Rules:
 * - Strong signal (score ≥ 6) → 0 questions
 * - Weak signal → 1–5 questions, most important first
 * - Never ask what the prompt already answers
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ThemeInput {
  topic:          string;
  cluster?:       string;                // content cluster / tag from analytics
  intent?:        string;                // awareness | authority | conversion | retention
  related_blogs?: string[];              // titles of related posts in the same series/category
  series_context?: string;              // e.g. "Part 3 of a 5-part ABM series"
}

export interface ClarificationQuestion {
  id:          string;
  question:    string;
  placeholder: string;
  required:    boolean;
}

// ── Signal scoring ────────────────────────────────────────────────────────────

/**
 * Score the richness of the theme input.
 * Higher = more context = fewer questions needed.
 */
function scoreSignal(input: ThemeInput): number {
  let score = 0;

  const words = input.topic.trim().split(/\s+/).filter(Boolean);
  if (words.length >= 8)      score += 3;
  else if (words.length >= 5) score += 2;
  else if (words.length >= 3) score += 1;

  if (input.intent)                                      score += 2;
  if (input.cluster)                                     score += 1;
  if (input.related_blogs && input.related_blogs.length) score += 2;
  if (input.series_context)                              score += 1;

  return score;
}

// ── Question definitions ──────────────────────────────────────────────────────

const ALL_QUESTIONS: Record<string, ClarificationQuestion> = {
  audience: {
    id:          'audience',
    question:    'Who is the primary audience for this article?',
    placeholder: 'e.g. B2B marketing managers, SaaS founders, engineering leads',
    required:    false,
  },
  industry: {
    id:          'industry',
    question:    'What industry or business context should this focus on?',
    placeholder: 'e.g. B2B SaaS, e-commerce, fintech, professional services',
    required:    false,
  },
  depth: {
    id:          'depth',
    question:    'What depth level should this take?',
    placeholder: 'e.g. Strategic overview, Tactical how-to, Advanced deep-dive, Beginner explainer',
    required:    false,
  },
  tone: {
    id:          'tone',
    question:    'What tone and voice should this article have?',
    placeholder: 'e.g. Authoritative & data-driven, Conversational, Thought leadership, Practical & direct',
    required:    false,
  },
  examples: {
    id:          'examples',
    question:    'Any specific examples, data points, or case studies to weave in?',
    placeholder: 'e.g. Company names, statistics, research studies, real scenarios you\'ve seen',
    required:    false,
  },
};

// ── Main function ─────────────────────────────────────────────────────────────

/**
 * Returns clarification questions to ask the user before generating.
 * Returns an empty array when the input signal is strong enough.
 */
export function generateClarificationQuestions(input: ThemeInput): ClarificationQuestion[] {
  const strength = scoreSignal(input);

  // Strong enough signal → skip clarification entirely
  if (strength >= 6) return [];

  const questions: ClarificationQuestion[] = [];
  const words = input.topic.trim().split(/\s+/).filter(Boolean);

  // 1. Audience — ask unless intent already implies it (e.g. 'authority' suggests B2B leaders)
  if (!input.intent && !input.cluster) {
    questions.push(ALL_QUESTIONS.audience);
  }

  // 2. Industry — ask when topic is short/generic (no cluster to contextualise it)
  if (words.length < 5 && !input.cluster) {
    questions.push(ALL_QUESTIONS.industry);
  }

  // 3. Depth — ask when there are no related blogs to infer from
  if (!input.related_blogs || input.related_blogs.length === 0) {
    questions.push(ALL_QUESTIONS.depth);
  }

  // 4. Tone — ask when intent is absent (intent implies tone direction)
  if (!input.intent) {
    questions.push(ALL_QUESTIONS.tone);
  }

  // 5. Examples — only surface this if we already have some context (avoids overwhelming new users)
  if (strength >= 2 && questions.length < 4) {
    questions.push(ALL_QUESTIONS.examples);
  }

  return questions.slice(0, 5);
}
