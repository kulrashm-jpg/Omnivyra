export type ThreadFormatValue =
  | 'explainer-thread'
  | 'breakdown-thread'
  | 'narrative-thread';

export type ThreadIntentValue =
  | 'educate'
  | 'breakdown'
  | 'launch'
  | 'story'
  | 'lessons';

export type ThreadAnchorValue = 'market' | 'product' | 'identity';

export type ThreadCompanyProfile = {
  name?: string | null;
  industry?: string | null;
  category?: string | null;
  website_url?: string | null;
  target_audience?: string | null;
  goals?: string | null;
  content_themes?: string | null;
  brand_voice?: string | null;
  products_services?: string | null;
};

export type ThreadFormatOption = {
  value: ThreadFormatValue;
  label: string;
  description: string;
  hook: string;
  threadLength: string;
};

export type ThreadIntentOption = {
  value: ThreadIntentValue;
  label: string;
  description: string;
  objective: string;
};

export type ThreadAnchorOption = {
  value: ThreadAnchorValue;
  label: string;
  description: string;
  focusPrompt: string;
};

export type ThreadRecommendation = {
  topic: string;
  reason: string;
  intent: ThreadIntentValue;
  anchor: ThreadAnchorValue;
};

export type ThreadSessionPayload = {
  createdAt: string;
  executionMode: 'manual' | 'auto';
  topic: string;
  format: ThreadFormatValue;
  formatLabel: string;
  intent: ThreadIntentValue;
  intentLabel: string;
  platform: 'x' | 'linkedin';
  platformLabel: string;
  objective: string;
  audience: string;
  tone: string;
  cta: string;
  extraInstruction: string;
  companyName: string;
  anchor: ThreadAnchorValue;
  anchorLabel: string;
  anchorFocus: string;
  productsServices: string;
  brandVoice: string;
};

export type ThreadGenerationPayload = {
  output?: {
    success?: boolean;
    content_type?: 'thread';
    template_used?: string | null;
    master_content?: {
      content?: string;
      decision_trace?: {
        objective?: string;
        writing_angle?: string;
        tone_used?: string;
        outcome_promise?: string;
      };
    };
    platform_variant?: {
      platform?: string;
      generated_content?: string;
      discoverability_meta?: {
        hashtags?: string[];
      };
      adaptation_trace?: {
        style_strategy?: string;
        format_family?: string;
        actual_length_used?: number | null;
      };
    };
  };
  session: ThreadSessionPayload;
};

export const THREAD_FORMATS: readonly ThreadFormatOption[] = [
  {
    value: 'explainer-thread',
    label: 'Explainer Thread',
    description: 'Walk the reader through one important idea step by step without losing clarity.',
    hook: 'Best when you want to simplify something complex and keep the sequence easy to follow.',
    threadLength: '5-7 posts',
  },
  {
    value: 'breakdown-thread',
    label: 'Breakdown Thread',
    description: 'Deconstruct a strategy, market shift, or operating lesson with sharper point-by-point progression.',
    hook: 'Best when you want a stronger authority angle and a more analytical sequence.',
    threadLength: '6-8 posts',
  },
  {
    value: 'narrative-thread',
    label: 'Narrative Thread',
    description: 'Use tension, turning points, and payoff to keep each post earning the next one.',
    hook: 'Best when you want a founder, launch, or lesson-led story with stronger momentum.',
    threadLength: '5-6 posts',
  },
] as const;

export const THREAD_ANCHORS: readonly ThreadAnchorOption[] = [
  {
    value: 'market',
    label: 'Market',
    description: 'Anchor the thread to a shift, problem, or trend in the market the company plays in.',
    focusPrompt:
      'Anchor every post to the company market and industry context. The thread must read as a credible market point of view, not generic advice. Reference the shift, problem, or trend that makes this thread timely for that market.',
  },
  {
    value: 'product',
    label: 'Product & Services',
    description: 'Anchor the thread to what the company actually offers and the outcome it creates.',
    focusPrompt:
      'Anchor every post to the company products and services and the concrete outcome they create for the audience. Avoid generic claims; show why this offering changes the reader\'s situation. Do not turn the thread into an ad, but the offering must be the through-line.',
  },
  {
    value: 'identity',
    label: 'Identity & POV',
    description: 'Anchor the thread to the organization\'s stance, beliefs, or founding intent.',
    focusPrompt:
      'Anchor every post to the company identity, brand voice, and point of view. The thread should read as a thought-leadership statement from this specific organization, with conviction and a recognizable stance, not a neutral explainer.',
  },
] as const;

export const THREAD_INTENTS: readonly ThreadIntentOption[] = [
  {
    value: 'educate',
    label: 'Teach something clearly',
    description: 'Turn one important idea into a sequence readers can absorb fast.',
    objective: 'Teach a high-signal concept clearly and keep the reader moving through the full thread.',
  },
  {
    value: 'breakdown',
    label: 'Break down a strategy',
    description: 'Use the thread to unpack a market shift, operating principle, or tactical system.',
    objective: 'Break down one strategy or market shift with stronger authority and clearer sequencing.',
  },
  {
    value: 'launch',
    label: 'Support a launch',
    description: 'Frame the problem, why now, what changes, and what the launch means.',
    objective: 'Build launch momentum with a thread that explains the problem, relevance, and next action.',
  },
  {
    value: 'story',
    label: 'Tell a story',
    description: 'Use a thread to carry readers through tension, lesson, and payoff.',
    objective: 'Use a story-led sequence that creates retention and lands on one strong lesson.',
  },
  {
    value: 'lessons',
    label: 'Share lessons learned',
    description: 'Turn operating lessons, mistakes, or insights into a repeatable thread structure.',
    objective: 'Share practical lessons in a sequence that feels earned, useful, and highly shareable.',
  },
] as const;

export function getThreadFormat(value?: string): ThreadFormatOption {
  return THREAD_FORMATS.find((entry) => entry.value === value) ?? THREAD_FORMATS[0];
}

export function getThreadIntent(value?: string): ThreadIntentOption {
  return THREAD_INTENTS.find((entry) => entry.value === value) ?? THREAD_INTENTS[0];
}

export function getThreadAnchor(value?: string): ThreadAnchorOption {
  return THREAD_ANCHORS.find((entry) => entry.value === value) ?? THREAD_ANCHORS[0];
}

export function isThreadAnchor(value: unknown): value is ThreadAnchorValue {
  return typeof value === 'string' && THREAD_ANCHORS.some((entry) => entry.value === value);
}

export function getThreadPlatformLabel(platform: 'x' | 'linkedin'): string {
  return platform === 'x' ? 'X' : 'LinkedIn';
}

function pickProfileText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function shortenAnchorPhrase(value: string, maxChars = 48): string {
  if (!value) return '';
  const firstSegment = value.split(/[,;|·]| - /)[0]?.trim() ?? '';
  const candidate = firstSegment || value.trim();
  if (candidate.length <= maxChars) return candidate;
  const truncated = candidate.slice(0, maxChars).replace(/\s+\S*$/, '').trim();
  return truncated || candidate.slice(0, maxChars).trim();
}

export function buildThreadCompanySummary(
  companyName: string,
  profile: ThreadCompanyProfile | null,
): string {
  const name = pickProfileText(profile?.name) || companyName;
  const industry = pickProfileText(profile?.industry);
  const category = pickProfileText(profile?.category);
  const audience = pickProfileText(profile?.target_audience);
  const themes = pickProfileText(profile?.content_themes);
  const goals = pickProfileText(profile?.goals);
  const products = pickProfileText(profile?.products_services);
  const voice = pickProfileText(profile?.brand_voice);

  const parts = [
    industry ? `${name} operates in ${industry}` : `${name} needs company-aware thread content`,
    category ? `category: ${category}` : '',
    audience ? `audience: ${audience}` : '',
    products ? `products & services: ${products}` : '',
    voice ? `brand voice: ${voice}` : '',
    themes ? `themes: ${themes}` : '',
    goals ? `goals: ${goals}` : '',
  ].filter(Boolean);

  return parts.join(' | ');
}

export function buildThreadRecommendations(
  companyName: string,
  format: ThreadFormatOption,
  profile: ThreadCompanyProfile | null,
): ThreadRecommendation[] {
  const industry = shortenAnchorPhrase(pickProfileText(profile?.industry));
  const audience = shortenAnchorPhrase(pickProfileText(profile?.target_audience));
  const themes = shortenAnchorPhrase(pickProfileText(profile?.content_themes));
  const products = shortenAnchorPhrase(pickProfileText(profile?.products_services));
  const voice = shortenAnchorPhrase(pickProfileText(profile?.brand_voice), 32);

  const marketAnchor = industry || 'your market';
  const audienceAnchor = audience || 'the people you want to reach';
  const themeAnchor = themes || 'the signal your brand should own';
  const productAnchor = products || `what ${companyName} actually offers`;
  const identityAnchor = voice || `how ${companyName} sees the work`;

  if (format.value === 'narrative-thread') {
    return [
      {
        topic: `The shift in ${marketAnchor} we keep seeing play out`,
        reason: `Anchors the narrative to a real movement in ${marketAnchor}, so the thread reads as a credible market point of view.`,
        intent: 'story',
        anchor: 'market',
      },
      {
        topic: `Why ${companyName} built ${productAnchor} the way we did`,
        reason: 'Anchors the narrative to the product decisions, so the sequence carries momentum and purpose without becoming an ad.',
        intent: 'launch',
        anchor: 'product',
      },
      {
        topic: `The belief behind ${identityAnchor} — and why we will not move off it`,
        reason: `Anchors the narrative to ${companyName}'s stance, so the thread lands as a thought-leadership statement, not generic storytelling.`,
        intent: 'lessons',
        anchor: 'identity',
      },
    ];
  }

  if (format.value === 'breakdown-thread') {
    return [
      {
        topic: `The operating shift happening in ${marketAnchor} right now`,
        reason: `Anchors the breakdown to a timely change in ${marketAnchor} and gives ${audienceAnchor} a clean mental model.`,
        intent: 'breakdown',
        anchor: 'market',
      },
      {
        topic: `A breakdown of how ${productAnchor} actually changes the workflow`,
        reason: 'Anchors the breakdown to product mechanics, so each post earns the next while staying tied to a real outcome.',
        intent: 'educate',
        anchor: 'product',
      },
      {
        topic: `What most teams get wrong about ${themeAnchor} — and how we think about it`,
        reason: `Anchors the breakdown to ${companyName}'s point of view, contrasting the common take with the company's operating belief.`,
        intent: 'lessons',
        anchor: 'identity',
      },
    ];
  }

  return [
    {
      topic: `What is actually shifting in ${marketAnchor} right now`,
      reason: `Anchors the explainer to ${marketAnchor}, so the thread reads as timely market intelligence rather than generic education.`,
      intent: 'launch',
      anchor: 'market',
    },
    {
      topic: `The clearest way to explain how ${productAnchor} works`,
      reason: `Anchors the explainer to the product, so ${audienceAnchor} understands the offering without needing a sales call.`,
      intent: 'educate',
      anchor: 'product',
    },
    {
      topic: `How ${companyName} thinks about ${themeAnchor}`,
      reason: `Anchors the explainer to ${companyName}'s stance, so the thread carries voice and conviction.`,
      intent: 'breakdown',
      anchor: 'identity',
    },
  ];
}

export function splitThreadIntoSegments(rawContent: string): string[] {
  const normalized = rawContent.replace(/\r\n/g, '\n').trim();
  if (!normalized) return [];

  const numbered = normalized
    .split(/\n{2,}(?=(?:\d+[\/.)-]\s*|post\s*\d+\s*[:.-]?))/i)
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (numbered.length >= 3) return numbered;

  const blankSeparated = normalized
    .split(/\n{2,}/)
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (blankSeparated.length >= 3) return blankSeparated;

  const lineGroups = normalized
    .split('\n')
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (lineGroups.length >= 3) return lineGroups;

  return [normalized];
}

export function joinThreadSegments(segments: string[]): string {
  return segments.map((entry) => entry.trim()).filter(Boolean).join('\n\n');
}
