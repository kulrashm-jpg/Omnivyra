/** Part 2/2 of ContentRenderer.tsx — verbatim split (barrel preserved; importers unchanged). */
/**
 * ContentRenderer — central formatting layer for all content in Virality.
 *
 * EVERY piece of user-facing text (social posts, articles, blogs, carousel slides,
 * YouTube descriptions, comments, chat messages, AI responses) passes through
 * this component. No other component should render raw content strings.
 *
 * Rendering is decided by:
 *   1. Explicit `renderMode` prop (override)
 *   2. Content type  (article/blog → rich markdown; carousel → slides; etc.)
 *   3. Platform       (youtube → timestamp highlights; twitter → char count; etc.)
 *
 * Context-aware formatting applies WITHIN each mode:
 *   - Social mode normalises AI markdown artifacts, then applies platform structure:
 *       LinkedIn: hook prominence + inline bold/italic
 *       Instagram: body + hashtag block separation
 *       Twitter/X: per-sentence lines, compact spacing
 *       TikTok: hook prominence, compact
 *       Facebook/Pinterest: inline bold, paragraph blocks
 *   - Rich mode respects platform link colours
 *   - YouTube mode highlights timestamps + chapter markers
 */

import React, { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import rehypeRaw from 'rehype-raw';
import { FormattedAIMessage } from './campaign-ai/FormattedAIMessage';
import { getPlatformLimits } from '../lib/shared/contentFormatter';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

import { type ContentRenderMode, type ContentRendererProps, PLATFORM_HIGHLIGHT, DEFAULT_HIGHLIGHT, PLATFORM_LINK, DEFAULT_LINK, detectMode, SocialContent } from './ContentRendererBlocks';

export function RichContent({
  content,
  linkCls,
}: {
  content: string;
  linkCls: string;
}) {
  return (
    <ReactMarkdown
      rehypePlugins={[rehypeRaw]}
      components={{
        h1: ({ children }) => (
          <h1 className="text-xl font-bold text-gray-900 mb-3 mt-4 first:mt-0 border-b border-gray-200 pb-1">
            {children}
          </h1>
        ),
        h2: ({ children }) => (
          <h2 className="text-base font-bold text-gray-900 mb-2 mt-4 first:mt-0">{children}</h2>
        ),
        h3: ({ children }) => (
          <h3 className="text-sm font-semibold text-gray-800 mb-1 mt-3 first:mt-0">{children}</h3>
        ),
        p: ({ children }) => (
          <p className="text-sm text-gray-700 leading-relaxed mb-3 last:mb-0 text-justify">{children}</p>
        ),
        ul: ({ children }) => (
          <ul className="list-disc list-outside ml-5 mb-3 space-y-1 text-sm text-gray-700">{children}</ul>
        ),
        ol: ({ children }) => (
          <ol className="list-decimal list-outside ml-5 mb-3 space-y-1 text-sm text-gray-700">{children}</ol>
        ),
        li: ({ children }) => <li className="leading-relaxed">{children}</li>,
        strong: ({ children }) => <strong className="font-semibold text-gray-900">{children}</strong>,
        em: ({ children }) => <em className="italic text-gray-600">{children}</em>,
        blockquote: ({ children }) => (
          <blockquote className="border-l-4 border-gray-300 pl-4 italic text-gray-500 my-3 text-sm">
            {children}
          </blockquote>
        ),
        hr: () => <hr className="my-4 border-gray-200" />,
        a: ({ href, children }) => (
          <a href={href} target="_blank" rel="noopener noreferrer" className={linkCls}>
            {children}
          </a>
        ),
        code: ({ children }) => (
          <code className="bg-gray-100 text-gray-800 rounded px-1 py-0.5 text-xs font-mono">
            {children}
          </code>
        ),
        pre: ({ children }) => (
          <pre className="bg-gray-100 rounded-lg p-3 overflow-x-auto text-xs font-mono my-3">
            {children}
          </pre>
        ),
      }}
    >
      {content}
    </ReactMarkdown>
  );
}

/**
 * Carousel slide renderer.
 * Detects "Slide N:" markers, "---" dividers, or falls back to double-newline paragraphs.
 * Interactive: prev/next navigation + dot indicators.
 */
export function CarouselContent({
  content,
  accentBg = 'bg-indigo-600',
}: {
  content: string;
  accentBg?: string;
}) {
  const [activeSlide, setActiveSlide] = useState(0);

  const rawSlides = content
    .split(/(?:^|\n)(?:slide\s*\d+\s*[:\-]?|[-─]{3,}|\*{3,})/i)
    .map((s) => s.trim())
    .filter(Boolean);
  const slides = rawSlides.length > 1 ? rawSlides : content.split(/\n{2,}/).filter(Boolean);
  const total = slides.length;

  return (
    <div>
      {/* Dot indicators */}
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium text-gray-500">
          Slide {activeSlide + 1} / {total}
        </span>
        <div className="flex gap-1 items-center">
          {slides.map((_, i) => (
            <button
              key={i}
              onClick={() => setActiveSlide(i)}
              aria-label={`Go to slide ${i + 1}`}
              className={`rounded-full transition-all ${
                i === activeSlide ? `${accentBg} w-5 h-2` : 'bg-gray-300 w-2 h-2'
              }`}
            />
          ))}
        </div>
      </div>

      {/* Slide content */}
      <div className="bg-white border border-gray-200 rounded-xl p-5 min-h-[120px] flex flex-col justify-center">
        <p className="text-sm text-gray-800 leading-relaxed text-center whitespace-pre-wrap">
          {slides[activeSlide]}
        </p>
      </div>

      {/* Prev / Next */}
      <div className="flex justify-between mt-2">
        <button
          onClick={() => setActiveSlide((i) => Math.max(0, i - 1))}
          disabled={activeSlide === 0}
          className="text-xs px-3 py-1 rounded-lg bg-gray-100 text-gray-600 hover:bg-gray-200 disabled:opacity-30 transition-colors"
        >
          ← Prev
        </button>
        <button
          onClick={() => setActiveSlide((i) => Math.min(total - 1, i + 1))}
          disabled={activeSlide === total - 1}
          className="text-xs px-3 py-1 rounded-lg bg-gray-100 text-gray-600 hover:bg-gray-200 disabled:opacity-30 transition-colors"
        >
          Next →
        </button>
      </div>
    </div>
  );
}

/**
 * YouTube description renderer.
 * Highlights timestamps (0:00 / 00:00 / 0:00:00) in blue.
 * Chapter lines (starting with a timestamp) rendered as a distinct chapter list.
 * Separates sections by blank lines with paragraph spacing.
 */
export function YouTubeContent({ content }: { content: string }) {
  const TIMESTAMP_LINE = /^(\d{1,2}:\d{2}(?::\d{2})?)\s+(.+)$/;
  const TIMESTAMP_INLINE = /(\d{1,2}:\d{2}(?::\d{2})?)/g;

  const paras = content.split(/\n{2,}/);

  return (
    <div className="space-y-3">
      {paras.map((para, i) => {
        const lines = para.split('\n');
        // Detect chapter block: most lines start with timestamps
        const chapterLines = lines.filter((l) => TIMESTAMP_LINE.test(l));
        if (chapterLines.length >= 2 && chapterLines.length >= lines.length * 0.6) {
          return (
            <div key={i} className="bg-gray-50 rounded-lg p-3 space-y-1">
              {lines.map((line, li) => {
                const m = line.match(TIMESTAMP_LINE);
                if (m) {
                  return (
                    <div key={li} className="flex gap-3 text-[13px]">
                      <span className="text-blue-600 font-medium tabular-nums shrink-0">{m[1]}</span>
                      <span className="text-gray-700">{m[2]}</span>
                    </div>
                  );
                }
                return <p key={li} className="text-[13px] text-gray-500">{line}</p>;
              })}
            </div>
          );
        }

        // Regular paragraph with inline timestamp highlighting
        return (
          <p key={i} className="text-[13px] text-gray-700 leading-relaxed whitespace-pre-wrap">
            {para.split(TIMESTAMP_INLINE).map((part, j) =>
              TIMESTAMP_INLINE.test(part) ? (
                <span key={j} className="text-blue-600 font-medium">{part}</span>
              ) : (
                <span key={j}>{part}</span>
              )
            )}
          </p>
        );
      })}
    </div>
  );
}

/**
 * Comment / chat message renderer.
 * Preserves all line breaks and whitespace.
 * Renders **bold** and *italic* inline markdown only — no headings or lists.
 * Safe for user-generated content (no HTML passthrough).
 */
export function CommentContent({ content, textCls = 'text-gray-700' }: { content: string; textCls?: string }) {
  function renderInline(line: string): React.ReactNode {
    const nodes: React.ReactNode[] = [];
    let s = line;
    let k = 0;
    while (s) {
      const bi = s.indexOf('**');
      const ii = s.indexOf('*');
      const nextBold = bi >= 0 ? bi : s.length;
      const nextItalic = ii >= 0 && !(ii === 0 && s[1] === '*') ? ii : s.length;
      const next = Math.min(nextBold, nextItalic);
      if (next >= s.length) { nodes.push(<span key={k++}>{s}</span>); break; }
      if (next > 0) nodes.push(<span key={k++}>{s.slice(0, next)}</span>);
      if (s[next] === '*') {
        if (s[next + 1] === '*') {
          const end = s.indexOf('**', next + 2);
          if (end >= 0) {
            nodes.push(<strong key={k++} className="font-semibold">{s.slice(next + 2, end)}</strong>);
            s = s.slice(end + 2);
            continue;
          }
        } else {
          const end = s.indexOf('*', next + 1);
          if (end >= 0 && end !== next + 1) {
            nodes.push(<em key={k++} className="italic">{s.slice(next + 1, end)}</em>);
            s = s.slice(end + 1);
            continue;
          }
        }
      }
      nodes.push(<span key={k++}>{s[next]}</span>);
      s = s.slice(next + 1);
    }
    return nodes;
  }

  return (
    <div className="space-y-2">
      {content.split(/\n{2,}/).map((para, i) => (
        <p key={i} className={`text-sm leading-relaxed ${textCls}`}>
          {para.split('\n').map((line, li) => (
            <React.Fragment key={li}>
              {li > 0 && <br />}
              {renderInline(line)}
            </React.Fragment>
          ))}
        </p>
      ))}
    </div>
  );
}

/**
 * Compact single-line preview.
 * Strips markdown symbols, collapses whitespace, truncates at `maxLength`.
 * Used for: calendar event labels, card subtitles, notification text, search results.
 */
export function CompactContent({
  content,
  maxLength = 120,
}: {
  content: string;
  maxLength?: number;
}) {
  const stripped = content
    .replace(/\[KPI Focus:[^\]]*\]/gi, '')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/[*_`\[\]>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const preview = stripped.length > maxLength ? stripped.slice(0, maxLength) + '…' : stripped;
  return <span className="text-sm text-gray-600">{preview}</span>;
}

// ─────────────────────────────────────────────────────────────────────────────
// HTML content renderer (for content edited via RichTextEditor)
// ─────────────────────────────────────────────────────────────────────────────

/** True when content was produced by TipTap (contains HTML tags). */
function isHtmlContent(content: string): boolean {
  return /^<[a-z][\s\S]*>/i.test(content.trim()) || /<\/p>|<\/li>|<\/h[1-6]>|<br\s*\/?>/.test(content);
}

/**
 * Renders HTML content produced by RichTextEditor inside a scoped prose wrapper.
 * Uses dangerouslySetInnerHTML — content comes from the user's own editor, not external input.
 */
function HtmlContent({ content, linkCls }: { content: string; linkCls: string }) {
  return (
    <div
      className="html-content-renderer prose prose-sm max-w-none text-gray-800"
      dangerouslySetInnerHTML={{ __html: content }}
    />
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────────────────────────

export default function ContentRenderer({
  content,
  platform = '',
  contentType = 'post',
  renderMode,
  accentBg = 'bg-indigo-600',
  showCharCount = false,
  maxLength = 120,
  className = '',
  emptyText = 'No content available.',
  textCls,
}: ContentRendererProps) {
  const pl = platform.toLowerCase().trim();
  const ct = contentType.toLowerCase().replace(/[\s-]/g, '_');
  const mode: ContentRenderMode = renderMode ?? detectMode(pl, ct);

  const highlightCls = PLATFORM_HIGHLIGHT[pl] ?? DEFAULT_HIGHLIGHT;
  const linkCls = PLATFORM_LINK[pl] ?? DEFAULT_LINK;

  const charCount = showCharCount ? content.length : 0;
  const charLimit = showCharCount ? getPlatformLimits(pl).maxChars : 0;
  const isOverLimit = showCharCount && charCount > charLimit;

  if (!content?.trim()) {
    return <p className={`text-sm italic text-gray-400 ${className}`}>{emptyText}</p>;
  }

  // HTML content (from RichTextEditor) renders directly — no markdown parsing needed
  const htmlMode = mode !== 'compact' && mode !== 'carousel' && mode !== 'youtube' && isHtmlContent(content);

  return (
    <div className={className}>
      {mode === 'compact' && (
        <CompactContent content={content} maxLength={maxLength} />
      )}

      {htmlMode && (
        <HtmlContent content={content} linkCls={linkCls} />
      )}

      {!htmlMode && mode === 'rich' && (
        <RichContent content={content} linkCls={linkCls} />
      )}

      {mode === 'carousel' && (
        <CarouselContent content={content} accentBg={accentBg} />
      )}

      {mode === 'youtube' && (
        <YouTubeContent content={content} />
      )}

      {!htmlMode && mode === 'comment' && (
        <CommentContent content={content} textCls={textCls ?? 'text-gray-700'} />
      )}

      {!htmlMode && mode === 'ai-message' && (
        <FormattedAIMessage message={content} className={textCls} />
      )}

      {!htmlMode && (mode === 'social' || mode === 'auto') && (
        <SocialContent
          content={content}
          platform={pl}
          contentType={ct}
          highlightCls={highlightCls}
          linkCls={linkCls}
        />
      )}

      {/* Character count bar */}
      {showCharCount && (
        <div
          className={`mt-2 text-xs font-medium text-right ${
            isOverLimit ? 'text-red-500' : 'text-gray-400'
          }`}
        >
          {charCount.toLocaleString()} / {charLimit.toLocaleString()} chars
          {isOverLimit && ' — over limit'}
        </div>
      )}
    </div>
  );
}


