export type ContentNavItem = {
  id: string;
  label: string;
  route: string;
  description: string;
};

export type ContentNavSection = {
  id: 'writer' | 'creator';
  label: string;
  description: string;
  summary: string;
  badge: string;
  href: string;
  items: ContentNavItem[];
};

export const CONTENT_NAV_SECTIONS: ContentNavSection[] = [
  {
    id: 'writer',
    label: 'Writer Content',
    description: '9 text-first content types',
    summary: 'Draft, adapt, and publish text-led assets across owned and social channels.',
    badge: 'Text-first',
    href: '/command-center/writer-content',
    items: [
      { id: 'post', label: 'Post', route: '/posts/create', description: 'Short-form social copy' },
      { id: 'blog', label: 'Blog', route: '/blogs/create', description: 'Long-form authority article' },
      { id: 'story', label: 'Story', route: '/stories/create', description: 'Narrative-driven brand content' },
      { id: 'article', label: 'Article', route: '/articles/create', description: 'Editorial, perspective-led piece' },
      { id: 'whitepaper', label: 'Whitepaper', route: '/whitepapers/create', description: 'Premium authority asset' },
      { id: 'case-study', label: 'Case Study', route: '/case-studies/create', description: 'Proof-led customer story' },
      { id: 'thread', label: 'Thread', route: '/threads/create', description: 'Multi-part thought sequence' },
      { id: 'guide', label: 'Guide', route: '/guides/create', description: 'Evergreen pillar resource' },
      { id: 'newsletter', label: 'Newsletter', route: '/newsletters/create', description: 'Email-ready editorial asset' },
    ],
  },
  {
    id: 'creator',
    label: 'Creator Content',
    description: '3 AI-supported creator content types',
    summary: 'Compose visual assets with governed layout, platform sizing, and render safety.',
    badge: 'Visual assets',
    href: '/command-center/creator-content',
    items: [
      { id: 'image', label: 'Image', route: '/command-center/creator-content/image', description: 'Single-message static visual' },
      { id: 'carousel', label: 'Carousel', route: '/command-center/creator-content/carousel', description: 'Multi-slide narrative asset' },
      { id: 'infographic', label: 'Infographic', route: '/command-center/creator-content/infographic', description: 'Structured visual explanation' },
    ],
  },
];

export function getContentNavSection(sectionId: ContentNavSection['id']): ContentNavSection {
  return CONTENT_NAV_SECTIONS.find((section) => section.id === sectionId) ?? CONTENT_NAV_SECTIONS[0];
}

export function getContentNavRoutes(): string[] {
  return CONTENT_NAV_SECTIONS.flatMap((section) => [
    section.href,
    ...section.items.map((item) => item.route),
  ]);
}
