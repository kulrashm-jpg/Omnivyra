/**
 * Block type definitions for the Omnivyra blog content system.
 * This is the single source of truth for all block schemas.
 * Every block has a stable `id` (crypto.randomUUID()) and a `type` discriminant.
 */

// ── Base ──────────────────────────────────────────────────────────────────────

interface BlockBase {
  id: string;
  type: string;
  /** AI generation hint — describes what content should fill this block. Ephemeral: stripped before DB save. */
  hint?: string;
  /** Shared visual formatting metadata consumed by all content renderers. */
  format?: BlockFormat;
}

export type BlockTextAlign = 'left' | 'center' | 'right' | 'justify';
export type BlockWeight = 'regular' | 'medium' | 'semibold' | 'bold';
export type BlockTone = 'default' | 'brand' | 'muted' | 'accent' | 'success' | 'warning' | 'danger';
export type BlockSurface = 'none' | 'subtle' | 'soft' | 'strong';
export type BlockListStyle = 'default' | 'disc' | 'circle' | 'square' | 'decimal' | 'upper-roman';

export interface BlockFormat {
  align?: BlockTextAlign;
  weight?: BlockWeight;
  tone?: BlockTone;
  surface?: BlockSurface;
  indent?: 0 | 1 | 2 | 3;
  spacingTop?: 'none' | 'xs' | 'sm' | 'md' | 'lg';
  spacingBottom?: 'none' | 'xs' | 'sm' | 'md' | 'lg';
  listStyle?: BlockListStyle;
  lead?: boolean;
}

// ── 1. Paragraph ──────────────────────────────────────────────────────────────
// Rich text stored as TipTap HTML output. Allows bold, italic, underline,
// inline code, and hyperlinks. No font family, font size, or color overrides.

export interface ParagraphBlock extends BlockBase {
  type: 'paragraph';
  html: string; // TipTap getHTML() output
}

// ── 2. Heading ────────────────────────────────────────────────────────────────
// H2 and H3 only — H1 is reserved for the post title.
// anchor is auto-derived from text on save (slugified). Never editable by user.

export interface HeadingBlock extends BlockBase {
  type: 'heading';
  level: 2 | 3;
  text: string;
  anchor: string; // auto-generated, e.g. "why-ai-matters"
}

// ── 3. Key Insights ───────────────────────────────────────────────────────────
// Summary block placed at the top or as a section opener. Renders as a
// highlighted card with a numbered list of insight statements.

export interface KeyInsightsBlock extends BlockBase {
  type: 'key_insights';
  title?: string; // default: "Key Insights"
  items: string[];
}

// ── 4. Callout ────────────────────────────────────────────────────────────────
// Three variants: insight (blue), note (amber), warning (red).
// Used for emphasis, caveats, important notices.

export type CalloutVariant = 'insight' | 'note' | 'warning';

export interface CalloutBlock extends BlockBase {
  type: 'callout';
  variant: CalloutVariant;
  title?: string;
  body: string;
}

// ── 5. Quote ──────────────────────────────────────────────────────────────────
// Pull quote with optional attribution. Source may be a URL or plain text.

export interface QuoteBlock extends BlockBase {
  type: 'quote';
  text: string;
  author?: string;
  source?: string; // URL or plain citation text
}

// ── 6. Image ──────────────────────────────────────────────────────────────────
// Alt text is required for SEO and accessibility.
// Renders as <figure> with optional <figcaption>.

export interface ImageBlock extends BlockBase {
  type: 'image';
  url: string;
  alt: string;   // required — enforced in the editor
  caption?: string;
  attribution?: string;      // e.g. "Photo by John on Unsplash"
  attributionUrl?: string;   // link to photographer's page
}

// ── 7. Media ──────────────────────────────────────────────────────────────────
// Embeds YouTube, Spotify tracks/podcasts, or external link cards.
// Inline in content — not appended at the end.

export type MediaType = 'youtube' | 'spotify_track' | 'spotify_podcast' | 'external_link';

export interface MediaBlock extends BlockBase {
  type: 'media';
  mediaType: MediaType;
  url: string;
  title?: string;
  description?: string;
}

// ── 8. Divider ────────────────────────────────────────────────────────────────
// section_break: styled divider with ornament, for major section transitions.
// subtle: thin line, for minor breaks within a section.

export type DividerVariant = 'subtle' | 'section_break';

export interface DividerBlock extends BlockBase {
  type: 'divider';
  variant: DividerVariant;
}

// ── 9. List ───────────────────────────────────────────────────────────────────
// Bullet or numbered lists with optional 2-level nesting.

export interface ListItem {
  id: string;
  text: string;
  children?: ListItem[];
}

export type ListType = 'bullet' | 'numbered';

export interface ListBlock extends BlockBase {
  type: 'list';
  listType: ListType;
  items: ListItem[];
}

// ── 10. References ────────────────────────────────────────────────────────────
// Numbered reference list rendered at the end of an article.
// Minimal, clean presentation — no decorative elements.

export interface ReferenceItem {
  id: string;
  title: string;
  url: string;
}

export interface ReferencesBlock extends BlockBase {
  type: 'references';
  items: ReferenceItem[];
}

// ── 11. Internal Link ─────────────────────────────────────────────────────────
// Link card to another Omnivyra blog post.
// title and excerpt are pre-resolved in the editor (fetch-on-blur) so the
// renderer needs no runtime fetch and handles renamed posts gracefully.

export interface InternalLinkBlock extends BlockBase {
  type: 'internal_link';
  slug: string;
  title?: string;   // resolved from /api/blog/[slug]
  excerpt?: string; // resolved from /api/blog/[slug]
}

// ── 12. Summary ───────────────────────────────────────────────────────────────
// End-of-article synthesis block. Styled card, plain text or lightly formatted.

export interface SummaryBlock extends BlockBase {
  type: 'summary';
  body: string;
}

// ── 13. Columns ──────────────────────────────────────────────────────────────
// 1, 2, or 3-column layout. Each column cell is a nested container holding
// any ContentBlock EXCEPT another columns block (enforced at UI/validation).

export interface ColumnCell {
  id: string;
  blocks: ContentBlock[];
}

export interface ColumnsBlock extends BlockBase {
  type: 'columns';
  columnCount: 1 | 2 | 3;
  columns: ColumnCell[];  // length === columnCount
}

export type CreatorAssetBlockType =
  | 'supporting_image'
  | 'banner'
  | 'infographic'
  | 'carousel'
  | 'slider'
  | 'brand_card';

/**
 * Variant collection — Writer multi-asset storage (PHASE 4 of the
 * final variant workflow activation phase). When the Writer generates
 * a Top-3 or Experiment-mode fan-out, the resulting variant assets
 * are persisted on the block as an array. The block still keeps the
 * single `assetId` / `url` / `files` fields to point at the
 * OPERATOR-SELECTED variant (the one that will actually publish);
 * the alternatives ride alongside as `variants[]`. Legacy blocks
 * with no `variants[]` field continue rendering as single-asset
 * blocks — backward compatibility preserved.
 */
export type CreatorAssetVariantEntry = {
  /** Renderer-resolved variant id (e.g. `image:quote-image:v2`). */
  variant_id: string;
  /** Variant family token. */
  variant_family: 'v1' | 'v2' | 'v3';
  /** Asset id returned by the generation endpoint. */
  asset_id: string | null;
  /** Primary preview URL — used by the Writer's variant preview grid. */
  url?: string;
  /** Additional file URLs (carousel slides). */
  files?: string[];
  /** Optional caption text. */
  caption?: string;
  /** Optional generation status — for in-progress / failed marks. */
  state?: 'generated' | 'failed' | 'pending';
  /** Optional inline metrics snapshot — populated when the dashboard
   *  has live winner data for the variant. */
  metrics?: {
    engagementRate?: number;
    saveRate?: number;
    shareRate?: number;
    sampleSize?: number;
  } | null;
};

export interface CreatorAssetBlock extends BlockBase {
  type: 'creator_asset';
  assetId?: string;
  creatorType?: CreatorAssetBlockType;
  title?: string;
  url?: string;
  files?: string[];
  previewKind?: string;
  caption?: string;
  blockTemplateId?: string;
  metadata?: Record<string, unknown>;
  /** Variant collection (PHASE 4). Empty / absent on legacy blocks
   *  and on blocks attached via single-variant mode. */
  variants?: CreatorAssetVariantEntry[];
  /** When `variants[]` is non-empty, this points at the variant the
   *  operator selected as the primary publish target. The block's
   *  `assetId` / `url` / `files` mirror that variant's fields. */
  selectedVariantId?: string;
  /** P3-5 — when true, the publisher should iterate every
   *  successfully-generated variant in `variants[]` and publish each
   *  as its own asset attachment. When false (default), only the
   *  `selectedVariantId` publishes. Backward compatible — absent /
   *  `undefined` matches the legacy single-variant publish path. */
  publishAllVariants?: boolean;
}

// ── Union ─────────────────────────────────────────────────────────────────────

export type ContentBlock =
  | ParagraphBlock
  | HeadingBlock
  | KeyInsightsBlock
  | CalloutBlock
  | QuoteBlock
  | ImageBlock
  | MediaBlock
  | DividerBlock
  | ListBlock
  | ReferencesBlock
  | InternalLinkBlock
  | SummaryBlock
  | ColumnsBlock
  | CreatorAssetBlock;

export type BlockType = ContentBlock['type'];

/** Block types allowed inside a ColumnsBlock cell (prevents nesting). */
export type InnerBlockType = Exclude<BlockType, 'columns'>;

// ── Block group labels (for BlockPicker UI) ───────────────────────────────────

export const BLOCK_GROUPS: { label: string; types: BlockType[] }[] = [
  {
    label: 'Content',
    types: ['paragraph', 'heading', 'list'],
  },
  {
    label: 'Structure',
    types: ['key_insights', 'callout', 'quote', 'divider', 'summary', 'columns'],
  },
  {
    label: 'Media',
    types: ['image', 'media', 'creator_asset'],
  },
  {
    label: 'Enrichment',
    types: ['references', 'internal_link'],
  },
];

export const BLOCK_LABELS: Record<BlockType, string> = {
  paragraph:     'Paragraph',
  heading:       'Heading',
  key_insights:  'Key Insights',
  callout:       'Callout',
  quote:         'Quote',
  image:         'Image',
  media:         'Media Embed',
  divider:       'Divider',
  list:          'List',
  references:    'References',
  internal_link: 'Internal Link',
  summary:       'Article Summary',
  columns:       'Columns',
  creator_asset: 'Asset',
};

export const BLOCK_DESCRIPTIONS: Record<BlockType, string> = {
  paragraph:     'Rich text with bold, italic, and links.',
  heading:       'Section heading (H2 or H3).',
  key_insights:  'Top-level summary list for readers who skim.',
  callout:       'Highlighted box: Insight, Note, or Warning.',
  quote:         'Pull quote with optional attribution.',
  image:         'Inline image with alt text and caption.',
  media:         'YouTube, Spotify, or external link embed.',
  divider:       'Visual separator between sections.',
  list:          'Bullet or numbered list with nesting.',
  references:    'Source citations listed at the end.',
  internal_link: 'Link card to another Omnivyra article.',
  summary:       'End-of-article synthesis and key points.',
  columns:       '1, 2, or 3-column layout container.',
  creator_asset: 'Embed a saved Creator Content asset.',
};
