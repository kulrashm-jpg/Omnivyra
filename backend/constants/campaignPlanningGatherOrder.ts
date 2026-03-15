/**
 * Canonical campaign planning Q&A order.
 * Single source of truth for question text and order — backend and frontend must import this.
 */

export interface GatherItem {
  key: string;
  question: string;
  /** If set, only ask when the condition key has a truthy value */
  contingentOn?: string;
}

export const GATHER_ORDER: GatherItem[] = [
  {
    key: 'available_content',
    question: 'Do you have existing content (videos, posts, blogs) for this campaign? Answer "no", "none", or describe what you have.',
  },
  {
    key: 'content_capacity',
    question: 'How many can you and your team create every week? (e.g., 3 videos, 10 posts, 2 blogs)',
  },
  {
    key: 'exclusive_campaigns',
    question: 'Anything only for one platform? (e.g. a LinkedIn-only series, or no)',
  },
  {
    key: 'action_expectation',
    question: 'What do you want people to do after reading?',
  },
  {
    key: 'platforms',
    question: 'Where will you post? (e.g. LinkedIn, Instagram, YouTube, X) — show only configured platforms.',
  },
  {
    key: 'platform_content_requests',
    question: "Set how often you'll share each content type per platform (match or adjust to your capacity). Show all content types.",
    contingentOn: 'platforms',
  },
  { key: 'key_messages', question: 'What is the core message you want your audience to remember?' },
  {
    key: 'campaign_duration',
    question: 'Duration of the campaign (2, 4, 6, 8, or 12 weeks — 12 weeks maximum)',
  },
];

/** Archived: questions not in canonical order. Kept for reference. */
export const ARCHIVED_GATHER_ITEMS: GatherItem[] = [
  { key: 'cross_platform_sharing', question: 'Will you use the same content across all platforms (shared) or create unique content for each platform (unique)?' },
  { key: 'tentative_start', question: 'When do you want to start? (YYYY-MM-DD)' },
];

export const REQUIRED_EXECUTION_FIELDS = [
  'available_content',
  'content_capacity',
  'exclusive_campaigns',
  'action_expectation',
  'platforms',
  'platform_content_requests',
  'key_messages',
  'campaign_duration',
] as const;

/** First question text — use for welcome/first message. */
export const FIRST_QUESTION = GATHER_ORDER[0].question;
