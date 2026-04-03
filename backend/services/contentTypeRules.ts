/**
 * Content Type Rules — structural constraints per content_type.
 * Single source of truth for per-type formatting and validation requirements.
 */

export type ContentTypeRules = {
  max_sentences_per_paragraph: number;
  requires_hook: boolean;
  requires_cta: boolean;
  structure_template: string;
  /** carousel / slides only */
  max_slide_words?: number;
  /** thread / tweetstorm: [min, max] tweet count */
  target_tweet_count?: [number, number];
  /** article / blog / newsletter: [min, max] word count */
  target_word_count?: [number, number];
};

const RULES: Record<string, ContentTypeRules> = {
  post: {
    max_sentences_per_paragraph: 2,
    requires_hook: true,
    requires_cta: true,
    structure_template: 'hook → body → cta',
  },
  carousel: {
    max_sentences_per_paragraph: 1,
    requires_hook: true,
    requires_cta: true,
    structure_template: 'cover_slide → key_point_slides → cta_slide',
    max_slide_words: 15,
  },
  slides: {
    max_sentences_per_paragraph: 1,
    requires_hook: true,
    requires_cta: true,
    structure_template: 'cover_slide → key_point_slides → cta_slide',
    max_slide_words: 15,
  },
  thread: {
    max_sentences_per_paragraph: 2,
    requires_hook: true,
    requires_cta: true,
    structure_template: 'hook_tweet → insight_tweets → closing_cta_tweet',
    target_tweet_count: [5, 7],
  },
  tweetstorm: {
    max_sentences_per_paragraph: 2,
    requires_hook: true,
    requires_cta: true,
    structure_template: 'hook_tweet → insight_tweets → closing_cta_tweet',
    target_tweet_count: [5, 7],
  },
  tweet: {
    max_sentences_per_paragraph: 1,
    requires_hook: true,
    requires_cta: false,
    structure_template: 'single_punchy_statement',
  },
  video: {
    max_sentences_per_paragraph: 2,
    requires_hook: true,
    requires_cta: true,
    structure_template: 'theme → hook_5s → key_points → b_roll → cta',
  },
  reel: {
    max_sentences_per_paragraph: 1,
    requires_hook: true,
    requires_cta: true,
    structure_template: 'hook_3s → value_delivery → cta',
  },
  short: {
    max_sentences_per_paragraph: 1,
    requires_hook: true,
    requires_cta: true,
    structure_template: 'hook_3s → value_delivery → cta',
  },
  article: {
    max_sentences_per_paragraph: 3,
    requires_hook: true,
    requires_cta: true,
    structure_template: 'headline → intro → body_sections → conclusion_cta',
    target_word_count: [500, 700],
  },
  blog: {
    max_sentences_per_paragraph: 3,
    requires_hook: true,
    requires_cta: true,
    structure_template: 'headline → intro → body_sections → conclusion_cta',
    target_word_count: [800, 1500],
  },
  newsletter: {
    max_sentences_per_paragraph: 3,
    requires_hook: true,
    requires_cta: true,
    structure_template: 'subject_hook → intro → body_sections → cta',
    target_word_count: [300, 600],
  },
  short_story: {
    max_sentences_per_paragraph: 4,
    requires_hook: true,
    requires_cta: false,
    structure_template: 'hook → rising_tension → resolution → optional_reflection',
    target_word_count: [300, 500],
  },
  white_paper: {
    max_sentences_per_paragraph: 4,
    requires_hook: true,
    requires_cta: true,
    structure_template: 'executive_summary → problem_statement → evidence_sections → solution_framework → conclusion',
    target_word_count: [700, 1000],
  },
  story: {
    max_sentences_per_paragraph: 1,
    requires_hook: false,
    requires_cta: false,
    structure_template: 'visual_moment → optional_text_overlay',
  },
  image: {
    max_sentences_per_paragraph: 2,
    requires_hook: true,
    requires_cta: false,
    structure_template: 'caption → optional_cta',
  },
  podcast: {
    max_sentences_per_paragraph: 3,
    requires_hook: true,
    requires_cta: true,
    structure_template: 'episode_hook → description → cta',
  },
};

const DEFAULT_RULES: ContentTypeRules = {
  max_sentences_per_paragraph: 2,
  requires_hook: true,
  requires_cta: true,
  structure_template: 'hook → body → cta',
};

export function getContentTypeRules(content_type: string): ContentTypeRules {
  const key = String(content_type || '').toLowerCase().trim();
  return RULES[key] ?? DEFAULT_RULES;
}
