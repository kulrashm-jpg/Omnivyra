/**
 * Shared block-level helpers used by all newsletter format generators.
 * No format-specific logic lives here.
 */
import type {
  ContentBlock,
  ParagraphBlock,
  HeadingBlock,
  KeyInsightsBlock,
  CalloutBlock,
  QuoteBlock,
  SummaryBlock,
  ListBlock,
  ReferencesBlock,
  ColumnsBlock,
} from '../../content/blockTypes';

// ---------------------------------------------------------------------------
// HTML normalisation
// ---------------------------------------------------------------------------

export function normalizeParagraphHtml(value: unknown): string {
  const rawText = typeof value === 'string' ? value : '';
  const trimmed = rawText.trim();
  if (!trimmed) return '';
  if (/<p[\s>]/i.test(trimmed)) return trimmed;
  return trimmed
    .split(/\n\s*\n/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => `<p>${part}</p>`)
    .join('');
}

export function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

// ---------------------------------------------------------------------------
// Text utilities
// ---------------------------------------------------------------------------

export function countWords(text: string): number {
  const normalized = text.trim();
  return normalized ? normalized.split(/\s+/).filter(Boolean).length : 0;
}

// ---------------------------------------------------------------------------
// Common block-type mergers (shared across every format)
// ---------------------------------------------------------------------------

export function mergeKeyInsights(block: KeyInsightsBlock, items: unknown): KeyInsightsBlock {
  return {
    ...block,
    items: Array.isArray(items)
      ? items.map((item: unknown) => String(item ?? '').trim()).filter(Boolean)
      : block.items,
  };
}

export function mergeCallout(block: CalloutBlock, body: unknown): CalloutBlock {
  return {
    ...block,
    title: '',
    body: typeof body === 'string' ? body.trim() : block.body,
  };
}

export function mergeQuote(block: QuoteBlock, raw: { quote_text?: unknown; quote_author?: unknown; quote_source?: unknown }): QuoteBlock {
  return {
    ...block,
    text: typeof raw.quote_text === 'string' ? raw.quote_text.trim() : block.text,
    author: typeof raw.quote_author === 'string' ? raw.quote_author.trim() : block.author,
    source: typeof raw.quote_source === 'string' ? raw.quote_source.trim() : block.source,
  };
}

export function mergeSummary(block: SummaryBlock, body: unknown): SummaryBlock {
  return {
    ...block,
    body: typeof body === 'string' ? body.trim() : block.body,
  };
}

export function mergeList(
  block: ListBlock,
  items: unknown,
  idPrefix: string,
): ListBlock {
  return {
    ...block,
    items: Array.isArray(items)
      ? items.map((item: unknown, index: number) => ({
          id: block.items[index]?.id ?? `${idPrefix}-${index}`,
          text: typeof item === 'string' ? item : (item as any)?.text ?? '',
        }))
      : block.items,
  };
}

export function mergeReferences(block: ReferencesBlock, items: unknown): ReferencesBlock {
  return {
    ...block,
    items: Array.isArray(items)
      ? items.map((item: any, index: number) => ({
          id: block.items[index]?.id ?? `ref-${index}`,
          title: typeof item?.title === 'string' ? item.title.trim() : '',
          url: typeof item?.url === 'string' ? item.url.trim() : '',
        }))
      : block.items,
  };
}

export function mergeParagraph(block: ParagraphBlock, html: unknown): ParagraphBlock {
  return {
    ...block,
    html: normalizeParagraphHtml(html),
  };
}

export function mergeHeading(block: HeadingBlock, text: unknown): HeadingBlock {
  return {
    ...block,
    text: typeof text === 'string' ? text.trim() : block.text,
    anchor: '',
  };
}

/** Walk columns and apply a per-inner-block callback. */
export function mergeColumns(
  block: ColumnsBlock,
  getInnerHtml: (colIndex: number, innerBlock: ContentBlock) => string | undefined,
): ColumnsBlock {
  return {
    ...block,
    columns: block.columns.map((col, colIndex) => ({
      ...col,
      blocks: col.blocks.map((inner) => {
        if (inner.type !== 'paragraph') return inner;
        const nextHtml = getInnerHtml(colIndex, inner);
        if (!nextHtml) return inner;
        return mergeParagraph(inner as ParagraphBlock, nextHtml);
      }),
    })),
  };
}
