export const CONTENT_TYPES = {
  blog: {
    label: 'Blog',
    supports: ['seo', 'featuredImage', 'author'],
  },
  newsletter: {
    label: 'Newsletter',
    supports: ['email', 'cta'],
  },
  article: {
    label: 'Article',
    supports: ['longform', 'references'],
  },
  guide: {
    label: 'Guide',
    supports: ['steps', 'structuredSections'],
  },
} as const;

export type ContentType = keyof typeof CONTENT_TYPES;
export type ContentTypeSupport = (typeof CONTENT_TYPES)[ContentType]['supports'][number];

export function isContentType(value: unknown): value is ContentType {
  return typeof value === 'string' && value in CONTENT_TYPES;
}
