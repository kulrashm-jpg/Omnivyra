import { listContentTypes } from '../../lib/content/unifiedCreationModel';

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
    description: '5 text-first content types',
    summary: 'Draft, adapt, and publish text-led assets across owned and social channels.',
    badge: 'Text-first',
    href: '/command-center/writer-content',
    items: [
      { id: 'post', label: 'Post', route: '/posts/create', description: 'Short-form social copy' },
      { id: 'blog', label: 'Blog', route: '/blogs/create', description: 'Long-form authority article' },
      { id: 'article', label: 'Article', route: '/articles/create', description: 'Editorial, perspective-led piece' },
      { id: 'story', label: 'Story', route: '/stories/create', description: 'Narrative-driven brand content' },
      { id: 'thread', label: 'Thread', route: '/threads/create', description: 'Multi-part thought sequence' },
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
      { id: 'image', label: 'Image', route: '/command-center/creator-content/image/templates', description: 'Single-message static visual' },
      { id: 'carousel', label: 'Carousel', route: '/command-center/creator-content/carousel/templates', description: 'Multi-slide narrative asset' },
      { id: 'infographic', label: 'Infographic', route: '/command-center/creator-content/infographic/templates', description: 'Structured visual explanation' },
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

/**
 * CREATOR-062: the single Unified Marketing Workspace creation entry. Every
 * "Create" nav target routes here instead of opening Writer/Creator/Campaign
 * directly — the Workspace owns goal/brief/plan and then opens the editor.
 */
export const UNIFIED_CREATION_ENTRY = '/command-center/marketing-create';

/**
 * Single routing decision for a creation nav target. When the unified workspace
 * is enabled, every legacy creation route resolves to the Workspace; otherwise
 * the legacy route is returned unchanged (byte-identical legacy navigation).
 * Editing/review/result routes are NOT passed through this — only creation entries.
 */
export function resolveCreationEntry(legacyRoute: string, unifiedEnabled: boolean): string {
  return unifiedEnabled ? UNIFIED_CREATION_ENTRY : legacyRoute;
}

/* ── CREATOR-070: Canonical Marketing Information Architecture ────────────────
 * Users think in terms of Marketing, not Writer/Creator/Campaign modules. The
 * hierarchy below is the single source of truth; "Create Marketing" is the ONE
 * primary creation entry (→ the unified workspace). Writer/Creator/Campaign are
 * lanes INSIDE Create Marketing, not top-level navigation.                     */

export interface MarketingSection { id: string; label: string; route: string; primary?: boolean }

export const MARKETING_IA: MarketingSection[] = [
  { id: 'create', label: 'Create Marketing', route: UNIFIED_CREATION_ENTRY, primary: true },
  { id: 'library', label: 'Content Library', route: '/command-center/creator-content/collections' },
  { id: 'campaigns', label: 'Campaigns', route: '/command-center/campaigns' },
  { id: 'publish', label: 'Publish Center', route: '/multi-platform-scheduler' },
  { id: 'brand', label: 'Brand Assets', route: '/company-profile' },
  { id: 'analytics', label: 'Analytics', route: '/command-center/analytics' },
];

/** The four lanes organized INSIDE Create Marketing. Reuses the canonical
 *  content-type registry (no duplicate type lists). */
export interface MarketingLane { id: string; label: string; items: { id: string; label: string }[] }

export const CREATE_MARKETING_LANES: MarketingLane[] = [
  { id: 'writer', label: 'Writer', items: listContentTypes('writer').map((c) => ({ id: c.id, label: c.label })) },
  { id: 'creator', label: 'Creator', items: listContentTypes('creator').map((c) => ({ id: c.id, label: c.label })) },
  { id: 'campaigns', label: 'Campaigns', items: listContentTypes('campaign').map((c) => ({ id: c.id, label: c.label })) },
  { id: 'assets', label: 'Assets', items: [
    { id: 'brand-assets', label: 'Brand Assets' },
    { id: 'logos', label: 'Logos' },
    { id: 'product-images', label: 'Product Images' },
    { id: 'media-library', label: 'Media Library' },
    { id: 'uploaded-files', label: 'Uploaded Files' },
  ] },
];

/** The ONE primary creation entry. Flag-gated route: unified → Create Marketing
 *  workspace; legacy → the existing creator landing (back-compat, no broken link). */
export const CREATE_MARKETING_ENTRY: ContentNavItem = {
  id: 'create-marketing',
  label: 'Create Marketing',
  route: UNIFIED_CREATION_ENTRY,
  description: 'Start from your goal — we plan Writer, Creator and Campaign assets.',
};

export function primaryCreationEntry(unifiedEnabled: boolean): ContentNavItem {
  return { ...CREATE_MARKETING_ENTRY, route: resolveCreationEntry('/command-center/creator-content', unifiedEnabled) };
}
