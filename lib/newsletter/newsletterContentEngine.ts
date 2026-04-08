export type NewsletterDepth = 'light' | 'standard' | 'deep';

export type NewsletterEngineType =
  | 'insight-letter'
  | 'weekly-brief'
  | 'strategic-letter'
  | 'action-letter';

export type NewsletterEngineConfig = {
  value: NewsletterEngineType;
  uiLabel: string;
  title: string;
  shortLabel: string;
  description: string;
  thinkingMode: string;
  structure: string[];
  generationRules: string[];
};

export const NEWSLETTER_DEPTH_OPTIONS: Array<{
  value: NewsletterDepth;
  label: string;
  description: string;
}> = [
  { value: 'light', label: 'Light', description: 'Shorter, sharper, more concise.' },
  { value: 'standard', label: 'Standard', description: 'Balanced detail and readability.' },
  { value: 'deep', label: 'Deep', description: 'Longer, richer, and more layered.' },
];

export const NEWSLETTER_ENGINE_CONFIGS: NewsletterEngineConfig[] = [
  {
    value: 'insight-letter',
    uiLabel: 'Share a deep idea',
    title: 'Insight Letter',
    shortLabel: '1-2 deep ideas',
    description: 'Original thinking with a sharp point of view and a memorable close.',
    thinkingMode: 'First-principles / Philosophical',
    structure: ['Hook', 'Context', 'Insight', 'Expansion', 'Implication', 'Closing'],
    generationRules: [
      'Avoid summarization',
      'Focus on original thinking',
      'Use analogies and mental models',
      'No curation or links',
    ],
  },
  {
    value: 'weekly-brief',
    uiLabel: 'Break down the week',
    title: 'Weekly Brief',
    shortLabel: 'Curated + commentary',
    description: 'Signal-first weekly analysis with interpretation and pattern recognition.',
    thinkingMode: 'Curator + Analyst',
    structure: ['Week Summary', 'Top Signals', 'Pattern', 'Quick Takes', 'Closing'],
    generationRules: [
      'Prioritize signal over noise',
      'Always include interpretation',
      'Avoid raw dumping of information',
    ],
  },
  {
    value: 'strategic-letter',
    uiLabel: 'Analyze a market shift',
    title: 'Strategic Letter',
    shortLabel: 'Market + positioning',
    description: 'Market context, leverage, and positioning written like a strategy memo.',
    thinkingMode: 'Consultant / Strategist',
    structure: ['Situation', 'Shift', 'Analysis', 'Positioning', 'Strategic Moves', 'Thesis'],
    generationRules: [
      'Focus on leverage and positioning',
      'Avoid generic advice',
      'Write like a strategy consultant',
    ],
  },
  {
    value: 'action-letter',
    uiLabel: 'Teach something actionable',
    title: 'Action Letter',
    shortLabel: 'Steps / frameworks',
    description: 'Practical, operator-led execution with a clear path to immediate action.',
    thinkingMode: 'Operator / Executor',
    structure: ['Problem', 'Outcome', 'Framework', 'Breakdown', 'Mistakes', 'CTA'],
    generationRules: [
      'Highly practical',
      'Step-by-step clarity',
      'No abstract thinking',
    ],
  },
];

export function getNewsletterEngineConfig(value: string | null | undefined): NewsletterEngineConfig | null {
  if (!value) return null;
  return NEWSLETTER_ENGINE_CONFIGS.find((config) => config.value === value) ?? null;
}

export function isValidNewsletterDepth(value: unknown): value is NewsletterDepth {
  return typeof value === 'string' && ['light', 'standard', 'deep'].includes(value);
}

export function resolveNewsletterTargetWords(
  type: NewsletterEngineType,
  depth: NewsletterDepth,
): number {
  const matrix: Record<NewsletterEngineType, Record<NewsletterDepth, number>> = {
    'insight-letter': {
      light: 800,
      standard: 1200,
      deep: 1600,
    },
    'weekly-brief': {
      light: 800,
      standard: 1200,
      deep: 1600,
    },
    'strategic-letter': {
      light: 1200,
      standard: 1600,
      deep: 2000,
    },
    'action-letter': {
      light: 800,
      standard: 1200,
      deep: 1600,
    },
  };

  return matrix[type][depth];
}
