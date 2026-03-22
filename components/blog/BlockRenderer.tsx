'use client';

import React from 'react';
import Link from 'next/link';
import type {
  ContentBlock,
  ParagraphBlock,
  HeadingBlock,
  KeyInsightsBlock,
  CalloutBlock,
  QuoteBlock,
  ImageBlock,
  MediaBlock,
  DividerBlock,
  ListBlock,
  ListItem,
  ReferencesBlock,
  InternalLinkBlock,
  SummaryBlock,
} from '../../lib/blog/blockTypes';
import { BlogMediaBlock } from './BlogMediaBlock';
import type { MediaBlockItem } from './BlogMediaBlock';

// ── Prose class (matches existing [slug].tsx proseClass) ─────────────────────

const proseClass = `prose prose-lg prose-slate max-w-none
  prose-headings:font-bold prose-headings:tracking-tight prose-headings:text-[#0B1F33]
  prose-h2:mt-14 prose-h2:mb-6 prose-h2:border-b prose-h2:border-gray-100 prose-h2:pb-3 prose-h2:text-2xl
  prose-h3:mt-10 prose-h3:text-xl prose-h3:text-[#0B1F33]
  prose-p:leading-[1.8] prose-p:text-[#3D4F61] prose-p:text-[1.0625rem]
  prose-a:text-[#0A66C2] prose-a:no-underline prose-a:font-medium hover:prose-a:underline
  prose-img:rounded-2xl prose-img:shadow-lg
  prose-ul:my-5 prose-ol:my-5 prose-li:my-1.5 prose-li:text-[#3D4F61]
  prose-blockquote:border-l-4 prose-blockquote:border-[#0A66C2] prose-blockquote:bg-[#F5F9FF]/80
  prose-blockquote:py-2 prose-blockquote:pl-6 prose-blockquote:italic prose-blockquote:text-[#3D4F61]
  prose-blockquote:rounded-r-xl prose-blockquote:not-italic
  prose-strong:text-[#0B1F33] prose-strong:font-bold
  prose-pre:rounded-xl prose-pre:bg-slate-900
  prose-code:rounded prose-code:bg-slate-100 prose-code:px-1.5 prose-code:py-0.5
  prose-code:text-slate-800 prose-code:before:content-none prose-code:after:content-none`;

// ── Individual block renderers ────────────────────────────────────────────────

function RenderParagraph({ block }: { block: ParagraphBlock }) {
  return (
    <div
      className={proseClass}
      dangerouslySetInnerHTML={{ __html: block.html }}
    />
  );
}

function RenderHeading({ block }: { block: HeadingBlock }) {
  const Tag = `h${block.level}` as 'h2' | 'h3';
  const classes = block.level === 2
    ? 'mt-14 mb-6 border-b border-gray-100 pb-3 text-2xl font-bold tracking-tight text-[#0B1F33]'
    : 'mt-10 mb-4 text-xl font-semibold text-[#0B1F33]';
  return (
    <Tag id={block.anchor || undefined} className={classes}>
      {block.text}
    </Tag>
  );
}

function RenderKeyInsights({ block }: { block: KeyInsightsBlock }) {
  return (
    <div className="my-10 overflow-hidden rounded-2xl border border-[#0A66C2]/20 bg-[#F5F9FF]">
      <div className="flex items-center gap-2 border-b border-[#0A66C2]/10 bg-[#0A66C2]/5 px-5 py-3">
        <span className="text-base">💡</span>
        <span className="text-xs font-bold uppercase tracking-widest text-[#0A66C2]">
          {block.title || 'Key Insights'}
        </span>
      </div>
      <ol className="px-5 py-4 space-y-2 list-none m-0">
        {block.items.filter(Boolean).map((item, i) => (
          <li key={i} className="flex items-start gap-3 text-sm text-[#3D4F61] leading-relaxed">
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#0A66C2]/10 text-xs font-bold text-[#0A66C2] mt-0.5">
              {i + 1}
            </span>
            <span>{item}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

const CALLOUT_STYLES: Record<string, { wrapper: string; accent: string; icon: string }> = {
  insight: {
    wrapper: 'border-[#0A66C2]/20 bg-[#F5F9FF]',
    accent:  'border-[#0A66C2]/10 bg-[#0A66C2]/5 text-[#0A66C2]',
    icon:    '💡',
  },
  note: {
    wrapper: 'border-amber-200 bg-amber-50',
    accent:  'border-amber-100 bg-amber-100/60 text-amber-700',
    icon:    '📝',
  },
  warning: {
    wrapper: 'border-red-200 bg-red-50',
    accent:  'border-red-100 bg-red-100/60 text-red-700',
    icon:    '⚠️',
  },
};

function RenderCallout({ block }: { block: CalloutBlock }) {
  const s = CALLOUT_STYLES[block.variant] ?? CALLOUT_STYLES.insight;
  return (
    <div className={`my-8 overflow-hidden rounded-2xl border ${s.wrapper}`}>
      {block.title && (
        <div className={`flex items-center gap-2 border-b px-5 py-3 ${s.accent}`}>
          <span className="text-base">{s.icon}</span>
          <span className="text-xs font-bold uppercase tracking-widest">{block.title}</span>
        </div>
      )}
      <p className="px-5 py-4 text-sm leading-relaxed text-[#3D4F61]">{block.body}</p>
    </div>
  );
}

function RenderQuote({ block }: { block: QuoteBlock }) {
  const isUrl = block.source?.startsWith('http');
  return (
    <blockquote className="my-8 border-l-4 border-[#0A66C2] bg-[#F5F9FF]/80 py-4 pl-6 pr-4 rounded-r-xl">
      <p className="text-lg leading-relaxed text-[#3D4F61] italic">{block.text}</p>
      {(block.author || block.source) && (
        <footer className="mt-3 text-sm text-[#6B7C93] not-italic">
          {block.author && <span className="font-medium text-[#0B1F33]">{block.author}</span>}
          {block.author && block.source && <span className="mx-1">·</span>}
          {block.source && (
            isUrl
              ? <a href={block.source} target="_blank" rel="noopener noreferrer" className="text-[#0A66C2] hover:underline">{block.source}</a>
              : <span>{block.source}</span>
          )}
        </footer>
      )}
    </blockquote>
  );
}

function RenderImage({ block }: { block: ImageBlock }) {
  return (
    <figure className="my-8">
      <img
        src={block.url}
        alt={block.alt}
        loading="lazy"
        className="w-full rounded-2xl shadow-lg"
      />
      {block.caption && (
        <figcaption className="mt-3 text-center text-sm text-[#6B7C93] italic">
          {block.caption}
        </figcaption>
      )}
    </figure>
  );
}

function RenderMedia({ block }: { block: MediaBlock }) {
  const legacyItem: MediaBlockItem = { type: block.mediaType, url: block.url };
  return (
    <div className="my-8">
      {block.title && (
        <p className="mb-2 text-sm font-semibold text-[#0B1F33]">{block.title}</p>
      )}
      <BlogMediaBlock block={legacyItem} />
      {block.description && (
        <p className="mt-2 text-xs text-[#6B7C93]">{block.description}</p>
      )}
    </div>
  );
}

function RenderDivider({ block }: { block: DividerBlock }) {
  if (block.variant === 'subtle') {
    return <hr className="my-8 border-t border-gray-200" />;
  }
  return (
    <div className="my-12 flex items-center gap-4">
      <div className="flex-1 border-t border-gray-300" />
      <div className="flex gap-1.5">
        <span className="h-1.5 w-1.5 rounded-full bg-[#0A66C2]/40" />
        <span className="h-1.5 w-1.5 rounded-full bg-[#0A66C2]/40" />
        <span className="h-1.5 w-1.5 rounded-full bg-[#0A66C2]/40" />
      </div>
      <div className="flex-1 border-t border-gray-300" />
    </div>
  );
}

function RenderListItems({ items, type, depth = 0 }: { items: ListItem[]; type: string; depth?: number }) {
  const Tag = type === 'numbered' ? 'ol' : 'ul';
  const cls = type === 'numbered'
    ? `list-decimal pl-6 space-y-1.5 text-[#3D4F61]${depth > 0 ? ' mt-1.5' : ''}`
    : `list-disc pl-6 space-y-1.5 text-[#3D4F61]${depth > 0 ? ' mt-1.5' : ''}`;
  return (
    <Tag className={cls}>
      {items.map((item) => (
        <li key={item.id} className="leading-relaxed text-[1.0625rem]">
          <span dangerouslySetInnerHTML={{ __html: item.text }} />
          {item.children && item.children.length > 0 && (
            <RenderListItems items={item.children} type={type} depth={depth + 1} />
          )}
        </li>
      ))}
    </Tag>
  );
}

function RenderList({ block }: { block: ListBlock }) {
  return (
    <div className="my-6">
      <RenderListItems items={block.items} type={block.listType} />
    </div>
  );
}

function RenderReferences({ block }: { block: ReferencesBlock }) {
  const validItems = block.items.filter((r) => r.title || r.url);
  if (validItems.length === 0) return null;
  return (
    <section className="my-10 rounded-xl border border-gray-200 bg-gray-50 px-6 py-5">
      <h4 className="mb-4 text-xs font-bold uppercase tracking-widest text-gray-500">References</h4>
      <ol className="space-y-2 list-none m-0 p-0">
        {validItems.map((ref, i) => (
          <li key={ref.id} className="flex items-start gap-3 text-sm text-[#3D4F61]">
            <span className="text-xs text-gray-400 font-mono mt-0.5 shrink-0">[{i + 1}]</span>
            {ref.url ? (
              <a
                href={ref.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[#0A66C2] hover:underline leading-relaxed"
              >
                {ref.title || ref.url}
              </a>
            ) : (
              <span className="leading-relaxed">{ref.title}</span>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}

function RenderInternalLink({ block }: { block: InternalLinkBlock }) {
  if (!block.slug) return null;
  return (
    <Link
      href={`/blog/${block.slug}`}
      className="my-8 flex items-start gap-4 rounded-2xl border border-[#0A66C2]/15 bg-gradient-to-br from-[#F5F9FF] to-white p-5 no-underline transition-shadow hover:shadow-md group"
    >
      <div className="flex-1 min-w-0">
        <p className="text-xs font-bold uppercase tracking-widest text-[#0A66C2] mb-1">Read also</p>
        <p className="text-base font-semibold text-[#0B1F33] group-hover:text-[#0A66C2] transition-colors leading-snug">
          {block.title || block.slug}
        </p>
        {block.excerpt && (
          <p className="mt-1 text-sm text-[#6B7C93] leading-relaxed line-clamp-2">{block.excerpt}</p>
        )}
      </div>
      <span className="shrink-0 text-[#0A66C2] font-bold text-sm mt-1 group-hover:translate-x-0.5 transition-transform">→</span>
    </Link>
  );
}

function RenderSummary({ block }: { block: SummaryBlock }) {
  if (!block.body) return null;
  return (
    <div className="my-12 overflow-hidden rounded-2xl border border-[#0A66C2]/15 bg-gradient-to-br from-[#F5F9FF] to-white">
      <div className="flex items-center gap-2 border-b border-[#0A66C2]/10 bg-[#0A66C2]/5 px-6 py-3">
        <span className="text-xs font-bold uppercase tracking-widest text-[#0A66C2]">✦ Summary</span>
      </div>
      <div className="px-6 py-5">
        <p className="text-sm leading-relaxed text-[#3D4F61] whitespace-pre-line">{block.body}</p>
      </div>
    </div>
  );
}

// ── Main renderer ─────────────────────────────────────────────────────────────

function renderBlock(block: ContentBlock): React.ReactNode {
  switch (block.type) {
    case 'paragraph':     return <RenderParagraph     key={block.id} block={block} />;
    case 'heading':       return <RenderHeading       key={block.id} block={block} />;
    case 'key_insights':  return <RenderKeyInsights   key={block.id} block={block} />;
    case 'callout':       return <RenderCallout       key={block.id} block={block} />;
    case 'quote':         return <RenderQuote         key={block.id} block={block} />;
    case 'image':         return <RenderImage         key={block.id} block={block} />;
    case 'media':         return <RenderMedia         key={block.id} block={block} />;
    case 'divider':       return <RenderDivider       key={block.id} block={block} />;
    case 'list':          return <RenderList          key={block.id} block={block} />;
    case 'references':    return <RenderReferences    key={block.id} block={block} />;
    case 'internal_link': return <RenderInternalLink  key={block.id} block={block} />;
    case 'summary':       return <RenderSummary       key={block.id} block={block} />;
  }
}

// ── Exported component ────────────────────────────────────────────────────────

type Props = {
  blocks: ContentBlock[];
  /** If provided, the SoftProductInsert is injected after this block index */
  productInsertAfterIndex?: number;
  ProductInsert?: React.ReactNode;
};

export function BlockRenderer({ blocks, productInsertAfterIndex, ProductInsert }: Props) {
  return (
    <div>
      {blocks.map((block, i) => (
        <React.Fragment key={block.id}>
          {renderBlock(block)}
          {productInsertAfterIndex !== undefined &&
           ProductInsert &&
           i === productInsertAfterIndex && ProductInsert}
        </React.Fragment>
      ))}
    </div>
  );
}
