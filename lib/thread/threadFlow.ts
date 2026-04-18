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

export type ThreadRecommendation = {
  topic: string;
  reason: string;
  intent: ThreadIntentValue;
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

export function getThreadPlatformLabel(platform: 'x' | 'linkedin'): string {
  return platform === 'x' ? 'X' : 'LinkedIn';
}

function pickProfileText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
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

  const parts = [
    industry ? `${name} operates in ${industry}` : `${name} needs company-aware thread content`,
    category ? `category: ${category}` : '',
    audience ? `audience: ${audience}` : '',
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
  const industry = pickProfileText(profile?.industry);
  const audience = pickProfileText(profile?.target_audience);
  const themes = pickProfileText(profile?.content_themes);

  const marketAnchor = industry || 'your market';
  const audienceAnchor = audience || 'the people you want to reach';
  const themeAnchor = themes || 'the signal your brand should own';

  if (format.value === 'narrative-thread') {
    return [
      {
        topic: `Why ${companyName} is building now, not later`,
        reason: `A narrative thread should create momentum. This gives you a clear turning-point story tied to ${marketAnchor}.`,
        intent: 'launch',
      },
      {
        topic: `The lesson that changed how we think about ${themeAnchor}`,
        reason: 'This lets you move from tension to payoff without sounding like a generic announcement.',
        intent: 'story',
      },
      {
        topic: `What most teams miss before they try to solve this problem`,
        reason: `This sets up a strong sequence with tension first, then a clearer lesson for ${audienceAnchor}.`,
        intent: 'lessons',
      },
    ];
  }

  if (format.value === 'breakdown-thread') {
    return [
      {
        topic: `The operating shift happening in ${marketAnchor} right now`,
        reason: 'A breakdown thread works best when it dissects one timely change and gives readers a clean mental model.',
        intent: 'breakdown',
      },
      {
        topic: `A step-by-step breakdown of how to approach ${themeAnchor}`,
        reason: 'This keeps the structure concrete and makes each post carry one clear job in the sequence.',
        intent: 'educate',
      },
      {
        topic: `Why most teams still get this wrong and what to do instead`,
        reason: 'This creates stronger authority because it contrasts the common view against a clearer operating path.',
        intent: 'lessons',
      },
    ];
  }

  return [
    {
      topic: `The clearest way to explain ${themeAnchor}`,
      reason: 'An explainer thread should reduce confusion fast and make the full sequence easy to follow.',
      intent: 'educate',
    },
    {
      topic: `What ${audienceAnchor} should understand before acting`,
      reason: 'This gives the thread a strong educational arc without needing a heavy briefing flow first.',
      intent: 'breakdown',
    },
    {
      topic: `What makes this shift in ${marketAnchor} matter right now`,
      reason: 'This keeps the thread timely and lets the opener earn the rest of the sequence.',
      intent: 'launch',
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
