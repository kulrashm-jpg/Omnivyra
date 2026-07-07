/**
 * BlogArticleLayout — the ONE canonical publish-ready article shell.
 *
 * Every surface that shows a finished blog post renders through the two pieces
 * here, so the format is identical by construction:
 *   • the template picker's "Live Example"  (components/blog/TemplateCard.tsx)
 *   • the editor's "Preview — projected post" (components/blog/BlogEditorForm.tsx)
 *   • the published page                       (pages/blog/[slug].tsx)
 *
 * This is deliberately the reference styling extracted from the picker preview —
 * masthead (kicker/title/dek/byline), editorial drop-cap, `prose` typography, and
 * a full-width hero image. No surface may re-implement block styling: they all wrap
 * the production BlockRenderer via <BlogArticleBody/>. (preview == finalizing ==
 * published — the codebase's "no second renderer" rule, now enforced across all
 * three finished-post surfaces.)
 */

import React from 'react';
import type { ContentBlock } from '../../lib/blog/blockTypes';
import { BlockRenderer } from './BlockRenderer';

/** Templates that read better in a serif display face. Single source of truth. */
export const SERIF_TEMPLATES = ['Magazine', 'Visual Feature', 'Narrative Article', 'Opinion Piece', 'Investigative Deep Dive'];

export function isSerifTemplate(name?: string | null): boolean {
  return SERIF_TEMPLATES.includes(name || '');
}

export interface BlogArticleMeta {
  kicker?: string | null;
  title: string;
  subtitle?: string | null;
  author?: string | null;
  company?: string | null;
  date?: string | null;
  readMins?: number | null;
}

/** Editorial drop-cap on the opening paragraph — matches the picker reference exactly. */
const DROP_CAP =
  '[&>div:first-of-type_p]:first-letter:float-left [&>div:first-of-type_p]:first-letter:mr-3 [&>div:first-of-type_p]:first-letter:font-serif [&>div:first-of-type_p]:first-letter:text-[58px] [&>div:first-of-type_p]:first-letter:font-bold [&>div:first-of-type_p]:first-letter:leading-[0.8] [&>div:first-of-type_p]:first-letter:text-[#0B1F33]';

/** Rough read-time from block text (fallback when no explicit value is supplied). */
export function estimateReadMins(blocks: ContentBlock[]): number {
  const words = JSON.stringify(blocks ?? []).split(/\s+/).length;
  return Math.max(1, Math.round(words / 200));
}

/**
 * The canonical article typography shell. Wrapping BlockRenderer here guarantees
 * identical block styling everywhere a finished post is shown.
 */
export function BlogArticleBody({
  blocks,
  templateName,
  className,
  productInsertAfterIndex,
  ProductInsert,
}: {
  blocks: ContentBlock[];
  templateName?: string | null;
  className?: string;
  productInsertAfterIndex?: number;
  ProductInsert?: React.ReactNode;
}) {
  const serif = isSerifTemplate(templateName);
  return (
    <div
      className={[
        'prose max-w-none',
        serif ? 'prose-headings:font-serif prose-headings:tracking-tight' : 'prose-headings:font-sans',
        'prose-p:text-[16px] prose-p:leading-[1.8] prose-p:text-[#3D4F61]',
        'prose-img:my-7',
        'prose-li:text-[15.5px] prose-li:text-[#3D4F61]',
        DROP_CAP,
        className || '',
      ].join(' ')}
    >
      <BlockRenderer blocks={blocks} productInsertAfterIndex={productInsertAfterIndex} ProductInsert={ProductInsert} />
    </div>
  );
}

/** Full-width hero image, styled to match the in-flow prose images. */
export function BlogHeroImage({ src, alt }: { src?: string | null; alt?: string | null }) {
  const [err, setErr] = React.useState(false);
  if (!src || err) return null;
  return (
    <img
      src={src}
      alt={alt || ''}
      referrerPolicy="no-referrer"
      className="mb-8 w-full rounded-2xl shadow-lg"
      style={{ maxHeight: 520, objectFit: 'cover', background: '#f9fafb' }}
      onError={() => setErr(true)}
    />
  );
}

/** Publish-ready masthead: kicker, display title, dek, byline. */
export function BlogMasthead({ meta, templateName }: { meta: BlogArticleMeta; templateName?: string | null }) {
  const serif = isSerifTemplate(templateName);
  const hasByline = meta.author || meta.company || meta.date || meta.readMins;
  return (
    <header className="mb-9">
      {meta.kicker && (
        <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.22em] text-[#0A66C2]">{meta.kicker}</p>
      )}
      <h1 className={`${serif ? 'font-serif' : 'font-sans'} text-[46px] font-bold leading-[1.04] tracking-tight text-[#0B1F33]`}>
        {meta.title}
      </h1>
      {meta.subtitle && <p className="mt-4 text-[19px] leading-[1.6] text-[#5B6B7C]">{meta.subtitle}</p>}
      {hasByline && (
        <div className="mt-5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-[#6B7C93]">
          {meta.author && <span className="font-semibold text-[#0B1F33]">{meta.author}</span>}
          {meta.company && (<><span aria-hidden>·</span><span>{meta.company}</span></>)}
          {meta.date && (<><span aria-hidden>·</span><span>{meta.date}</span></>)}
          {meta.readMins ? (<><span aria-hidden>·</span><span>{meta.readMins} min read</span></>) : null}
        </div>
      )}
      <div className="mt-6 h-px w-full bg-gradient-to-r from-gray-200 to-transparent" />
    </header>
  );
}

/**
 * Complete publish-ready document: masthead → optional hero → article body.
 * Used where a surface renders the full post from scratch (editor preview, picker).
 * The published page composes the pieces itself (it already owns page chrome).
 */
export function BlogArticleLayout({
  meta,
  blocks,
  templateName,
  heroImageUrl,
  heroAlt,
  productInsertAfterIndex,
  ProductInsert,
}: {
  meta: BlogArticleMeta;
  blocks: ContentBlock[];
  templateName?: string | null;
  heroImageUrl?: string | null;
  heroAlt?: string | null;
  productInsertAfterIndex?: number;
  ProductInsert?: React.ReactNode;
}) {
  return (
    <>
      <BlogMasthead meta={meta} templateName={templateName} />
      <BlogHeroImage src={heroImageUrl} alt={heroAlt} />
      <BlogArticleBody
        blocks={blocks}
        templateName={templateName}
        productInsertAfterIndex={productInsertAfterIndex}
        ProductInsert={ProductInsert}
      />
    </>
  );
}
