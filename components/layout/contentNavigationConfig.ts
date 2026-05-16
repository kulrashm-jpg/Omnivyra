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
      { id: 'thread', label: 'Thread', route: '/threads/create', description: 'Multi-part thought sequence' },
      { id: 'blog', label: 'Blog', route: '/blogs/create', description: 'Long-form authority article' },
      { id: 'newsletter', label: 'Newsletter', route: '/newsletters/create', description: 'Email-ready editorial asset' },
      { id: 'ad-copy', label: 'Ad Copy', route: '/command-center/writer-content?type=ad-copy', description: 'Campaign message variants' },
      { id: 'product-copy', label: 'Product Copy', route: '/command-center/writer-content?type=product-copy', description: 'Positioning and product language' },
      { id: 'landing-page', label: 'Landing Page', route: '/command-center/writer-content?type=landing-page', description: 'Conversion page structure' },
      { id: 'seo-content', label: 'SEO Content', route: '/command-center/writer-content?type=seo-content', description: 'Search-led content draft' },
      { id: 'script', label: 'Script', route: '/command-center/writer-content?type=script', description: 'Video or spoken narrative' },
    ],
  },
  {
    id: 'creator',
    label: 'Creator Content',
    description: '6 AI-supported creator content types',
    summary: 'Compose visual assets with governed layout, platform sizing, and render safety.',
    badge: 'Visual assets',
    href: '/command-center/creator-content',
    items: [
      { id: 'supporting-image', label: 'Supporting Image', route: '/command-center/creator-content/image', description: 'Complementary post visual' },
      { id: 'banner', label: 'Banner', route: '/command-center/creator-content/banner', description: 'High-clarity promo asset' },
      { id: 'infographic', label: 'Infographic', route: '/command-center/creator-content/infographic', description: 'Structured visual explanation' },
      { id: 'carousel', label: 'Carousel', route: '/command-center/creator-content/carousel', description: 'Multi-slide narrative asset' },
      { id: 'brand-card', label: 'Brand Card', route: '/command-center/creator-content/brand_card', description: 'Quote-led brand visual' },
      { id: 'pdf-slider', label: 'PDF/Slider', route: '/command-center/creator-content/pdf', description: 'Document or slide package' },
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
