/**
 * Centralized content type taxonomy.
 * Single source of truth for execution mode, badge color, and label.
 */

export type ExecutionMode =
  | 'AI_AUTOMATED'
  | 'CREATOR_REQUIRED'
  | 'CONDITIONAL_AI';

export interface ContentTypeMeta {
  execution: ExecutionMode;
  badgeColor: string;
  label: string;
}

export const CONTENT_TAXONOMY: Record<string, ContentTypeMeta> = {
  post: {
    execution: 'AI_AUTOMATED',
    badgeColor: 'emerald',
    label: 'Post',
  },
  blog: {
    execution: 'AI_AUTOMATED',
    badgeColor: 'blue',
    label: 'Blog',
  },
  article: {
    execution: 'AI_AUTOMATED',
    badgeColor: 'blue',
    label: 'Article',
  },
  newsletter: {
    execution: 'AI_AUTOMATED',
    badgeColor: 'blue',
    label: 'Newsletter',
  },
  short_story: {
    execution: 'AI_AUTOMATED',
    badgeColor: 'violet',
    label: 'Short Story',
  },
  white_paper: {
    execution: 'AI_AUTOMATED',
    badgeColor: 'blue',
    label: 'White Paper',
  },
  thread: {
    execution: 'AI_AUTOMATED',
    badgeColor: 'amber',
    label: 'Thread',
  },
  video: {
    execution: 'CREATOR_REQUIRED',
    badgeColor: 'red',
    label: 'Video',
  },
  carousel: {
    execution: 'CONDITIONAL_AI',
    badgeColor: 'fuchsia',
    label: 'Carousel',
  },
  image: {
    execution: 'CONDITIONAL_AI',
    badgeColor: 'sky',
    label: 'Image',
  },
};

const BADGE_CLASSES: Record<string, string> = {
  emerald: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  blue: 'bg-blue-100 text-blue-700 border-blue-200',
  amber: 'bg-amber-100 text-amber-700 border-amber-200',
  red: 'bg-red-100 text-red-700 border-red-200',
  fuchsia: 'bg-fuchsia-100 text-fuchsia-700 border-fuchsia-200',
  sky: 'bg-sky-100 text-sky-700 border-sky-200',
  violet: 'bg-violet-100 text-violet-700 border-violet-200',
};

function normalizeContentType(contentType?: string | null): string {
  return (contentType ?? '').trim().toLowerCase().replace(/[\s_-]+/g, '');
}

/**
 * Returns metadata for a content type. Unknown types default to AI_AUTOMATED, emerald, capitalize(label).
 */
export function getContentTypeMeta(contentType?: string | null): ContentTypeMeta {
  const key = normalizeContentType(contentType);
  if (!key) {
    return { execution: 'AI_AUTOMATED', badgeColor: 'emerald', label: 'Post' };
  }
  const exact = CONTENT_TAXONOMY[key];
  if (exact) return exact;
  for (const [k, meta] of Object.entries(CONTENT_TAXONOMY)) {
    if (key.includes(k) || k.includes(key)) return meta;
  }
  const label =
    (contentType ?? '').trim()
      ? (contentType ?? '').trim().charAt(0).toUpperCase() + (contentType ?? '').trim().slice(1).toLowerCase()
      : 'Post';
  return {
    execution: 'AI_AUTOMATED',
    badgeColor: 'emerald',
    label,
  };
}

/**
 * Returns Tailwind badge classes for a content type (for use with content-type badge only).
 */
export function getContentTypeBadgeClasses(contentType?: string | null): string {
  const meta = getContentTypeMeta(contentType);
  return BADGE_CLASSES[meta.badgeColor] ?? BADGE_CLASSES.emerald;
}

/**
 * Creator-dependent content types (require human creation: video, carousel, reel, etc.).
 * Aligns with platform_rules.creator_dependent and CREATOR_DEPENDENT_PLANNING_LABELS.
 * Use when filtering options in content creation UI.
 */
const CREATOR_DEPENDENT_IDS = new Set([
  'video', 'videos', 'longvideo', 'longvideos', 'carousel', 'carousels', 'image', 'images',
  'short', 'shorts', 'reel', 'reels', 'song', 'songs', 'audio', 'podcast', 'podcasts',
  'slides', 'slideware', 'igtv', 'live', 'story', 'stories', 'premiere', 'space', 'spaces',
]);

/**
 * Returns true if the content type requires creator/human input (video, carousel, reel, etc.).
 * Use in content creation UI to show only creator-dependent options.
 */
export function isCreatorDependentContentType(contentType?: string | null): boolean {
  const key = (contentType ?? '').trim().toLowerCase().replace(/[\s_-]+/g, '');
  if (!key) return false;
  if (CREATOR_DEPENDENT_IDS.has(key)) return true;
  for (const id of CREATOR_DEPENDENT_IDS) {
    if (key.includes(id) || id.includes(key)) return true;
  }
  const meta = getContentTypeMeta(contentType);
  return meta.execution === 'CREATOR_REQUIRED' || meta.execution === 'CONDITIONAL_AI';
}
