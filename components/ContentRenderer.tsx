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
import { getPlatformLimits } from '../backend/utils/contentFormatter';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type ContentRenderMode =
  | 'auto'       // Detect from platform + contentType (default)
  | 'rich'       // Full markdown: headings, bullets, blockquotes, code
  | 'social'     // Plain text + hashtag / mention / URL highlighting
  | 'carousel'   // Slide-by-slide navigation
  | 'youtube'    // Timestamp-aware description
  | 'comment'    // Preserves whitespace, renders **bold** / *italic* inline only
  | 'ai-message' // AI plan / response — delegates to FormattedAIMessage
  | 'compact';   // Single-line truncated preview (no interactivity)

export interface ContentRendererProps {
  content: string;
  /** Social platform key: 'linkedin' | 'x' | 'twitter' | 'instagram' | 'facebook' | 'youtube' | 'tiktok' | 'pinterest' */
  platform?: string;
  /** Content type: 'post' | 'article' | 'blog' | 'carousel' | 'reel' | 'story' | 'podcast' | 'newsletter' | … */
  contentType?: string;
  /** Override automatic mode detection */
  renderMode?: ContentRenderMode;
  /** For carousel slides: Tailwind bg class for active dot, e.g. 'bg-[#0A66C2]' */
  accentBg?: string;
  /** Show platform character-count bar (useful in editors / preview modals) */
  showCharCount?: boolean;
  /** Max characters before truncation in compact mode */
  maxLength?: number;
  /** Extra Tailwind classes on the outer wrapper */
  className?: string;
  /** Override placeholder shown when content is empty */
  emptyText?: string;
  /**
   * Text color class forwarded to CommentContent (comment/ai-message modes).
   * Use '' to inherit from the parent (e.g. inside colored chat bubbles).
   * Defaults to 'text-gray-700'.
   */
  textCls?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Platform colour tokens
// ─────────────────────────────────────────────────────────────────────────────

/** Tailwind classes for #hashtag / @mention highlights per platform */
export const PLATFORM_HIGHLIGHT: Record<string, string> = {
  linkedin:  'text-[#0A66C2] font-medium',
  x:         'text-sky-500 font-medium',
  twitter:   'text-sky-500 font-medium',
  instagram: 'text-blue-600 font-medium',
  facebook:  'text-[#1877F2] font-medium',
  youtube:   'text-blue-600 font-medium',
  tiktok:    'text-[#FE2C55] font-medium',
  pinterest: 'text-[#E60023] font-medium',
  reddit:    'text-[#FF4500] font-medium',
};
const DEFAULT_HIGHLIGHT = 'text-indigo-600 font-medium';

/** Tailwind classes for hyperlinks per platform */
export const PLATFORM_LINK: Record<string, string> = {
  linkedin:  'text-[#0A66C2] hover:underline',
  x:         'text-sky-500 hover:underline',
  twitter:   'text-sky-500 hover:underline',
  instagram: 'text-blue-600 hover:underline',
  facebook:  'text-[#1877F2] hover:underline',
  youtube:   'text-blue-600 hover:underline',
  tiktok:    'text-[#FE2C55] hover:underline',
  pinterest: 'text-[#E60023] hover:underline',
  reddit:    'text-[#FF4500] hover:underline',
};
const DEFAULT_LINK = 'text-indigo-600 hover:underline';

// ─────────────────────────────────────────────────────────────────────────────
// Content-type classification
// ─────────────────────────────────────────────────────────────────────────────

/** Content types that always render as full markdown */
export const RICH_CONTENT_TYPES = new Set([
  'article', 'blog', 'blog_post', 'newsletter', 'long_form',
  'podcast', 'show_notes', 'story', 'short_story',
]);

/** Derive render mode from platform + content type when `renderMode` is 'auto' */
function detectMode(platform: string, contentType: string): ContentRenderMode {
  const ct = contentType.toLowerCase().replace(/[\s-]/g, '_');
  const pl = platform.toLowerCase();
  if (ct === 'carousel') return 'carousel';
  if (pl === 'youtube') return 'youtube';
  if (RICH_CONTENT_TYPES.has(ct)) return 'rich';
  return 'social';
}

// ─────────────────────────────────────────────────────────────────────────────
// Platform + content-type context
// ─────────────────────────────────────────────────────────────────────────────

type PlatformContext = {
  platform: string;
  contentType: string;
  /** Platform renders inline **bold** / *italic* (LinkedIn, Facebook, Pinterest) */
  supportsInlineBold: boolean;
  /** Where hashtags live: inline vs separated block at the bottom */
  hashtagPlacement: 'inline' | 'bottom';
  /** Each sentence/thought on its own line (Twitter/X, TikTok) */
  sentencePerLine: boolean;
  /** First paragraph rendered with extra visual weight as a hook */
  hookLineProminent: boolean;
  /** Tighter line spacing for short-form captions */
  compactSpacing: boolean;
  /** Reddit: content starts with "Title: ..." — render it as a distinct headline */
  hasRedditTitle: boolean;
  /** Pinterest: keyword-dense — style hashtags as discovery tags */
  isKeywordDriven: boolean;
  /** Facebook: last paragraph is an engagement question — render distinctly */
  hasEngagementQuestion: boolean;
};

function getPlatformContext(platform: string, contentType: string): PlatformContext {
  const pl = platform.toLowerCase().trim();
  const ct = contentType.toLowerCase().replace(/[\s-]/g, '_');
  const isShortForm = pl === 'tiktok' || ct === 'reel' || ct === 'short' || ct === 'story';
  return {
    platform: pl,
    contentType: ct,
    supportsInlineBold: ['linkedin', 'facebook', 'pinterest'].includes(pl),
    hashtagPlacement: (pl === 'instagram' || pl === 'tiktok') ? 'bottom' : 'inline',
    sentencePerLine: pl === 'x' || pl === 'twitter' || pl === 'tiktok',
    hookLineProminent: ['instagram', 'tiktok', 'linkedin'].includes(pl),
    compactSpacing: isShortForm || pl === 'x' || pl === 'twitter' || pl === 'tiktok',
    hasRedditTitle: pl === 'reddit',
    isKeywordDriven: pl === 'pinterest',
    hasEngagementQuestion: pl === 'facebook',
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Content normalisation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Cleans AI-generation artifacts from social content before display:
 * - Removes markdown headings (## → plain text)
 * - Converts markdown bullet lists (- item / * item) to • item
 * - For platforms that don't support inline markdown, strips **bold** / *italic* markers
 * - Removes scheduler artifacts like [KPI Focus: ...]
 * - Separates trailing hashtag blocks for Instagram / TikTok
 * - Extracts Reddit title line ("Title: ...")
 * - Collapses excessive blank lines
 */
function normalizeForSocial(
  raw: string,
  ctx: PlatformContext
): { body: string; hashtagBlock: string; redditTitle?: string } {
  let text = raw
    // Scheduler artifacts
    .replace(/\[KPI Focus:[^\]]*\]/gi, '')
    // Markdown headings → plain (keep the text, drop the # symbols)
    .replace(/^#{1,6}\s+(.+)$/gm, '$1')
    // Markdown lists → unicode bullet (easier to display uniformly)
    .replace(/^[-*]\s+/gm, '• ')
    // Strip leading/trailing backtick fences
    .replace(/^```[\w]*\n?/gm, '').replace(/^```$/gm, '')
    .trim();

  // Extract Reddit title line ("Title: ..." on the first line)
  let redditTitle: string | undefined;
  if (ctx.hasRedditTitle) {
    const titleMatch = text.match(/^Title:\s*(.+?)(?:\n|$)/i);
    if (titleMatch) {
      redditTitle = titleMatch[1].trim();
      text = text.slice(titleMatch[0].length).trim();
    }
  }

  // Strip inline markdown markers on platforms that don't render them
  if (!ctx.supportsInlineBold) {
    text = text
      .replace(/\*\*([\s\S]+?)\*\*/g, '$1')
      .replace(/\*([\s\S]+?)\*/g, '$1')
      .replace(/__([\s\S]+?)__/g, '$1')
      .replace(/_([\s\S]+?)_/g, '$1');
  }

  // Separate trailing hashtag block for Instagram / TikTok
  let hashtagBlock = '';
  if (ctx.hashtagPlacement === 'bottom') {
    const paras = text.split(/\n{2,}/);
    // Walk backwards, collect paragraphs that are mostly hashtags
    const hashTagParas: string[] = [];
    while (paras.length > 1) {
      const last = paras[paras.length - 1].trim();
      const words = last.split(/\s+/);
      const tagCount = words.filter((w) => /^#\w+$/.test(w)).length;
      // Treat as hashtag block if ≥50% are hashtags or ≥3 hashtags
      if (tagCount >= 3 || (words.length > 0 && tagCount / words.length >= 0.5)) {
        hashTagParas.unshift(paras.pop()!);
      } else {
        break;
      }
    }
    // Also catch a final single line of hashtags (separated by single \n)
    const remaining = paras.join('\n\n');
    const lastLineMatch = remaining.match(/\n(#\w+(?:\s+#\w+){2,})\s*$/);
    if (lastLineMatch) {
      hashTagParas.unshift(lastLineMatch[1]);
      text = remaining.slice(0, remaining.length - lastLineMatch[0].length).trim();
    } else {
      text = remaining;
    }
    hashtagBlock = hashTagParas.join('\n');
  }

  // Collapse 3+ blank lines to 2
  text = text.replace(/\n{3,}/g, '\n\n').trim();

  return { body: text, hashtagBlock, redditTitle };
}

// ─────────────────────────────────────────────────────────────────────────────
// Inline renderers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Plain inline highlighter: #hashtags, @mentions, URLs only.
 * No bold/italic. Safe for platforms that don't render markdown (Instagram, TikTok, Twitter).
 */
export function HighlightText({
  text,
  highlightCls,
  linkCls,
}: {
  text: string;
  highlightCls: string;
  linkCls: string;
}) {
  const parts = text.split(/(https?:\/\/\S+|#\w+|@[\w.]+)/g);
  return (
    <>
      {parts.map((part, i) => {
        if (/^https?:\/\//.test(part))
          return (
            <a key={i} href={part} target="_blank" rel="noopener noreferrer" className={linkCls}>
              {part}
            </a>
          );
        if (/^[#@]/.test(part))
          return <span key={i} className={highlightCls}>{part}</span>;
        return <span key={i}>{part}</span>;
      })}
    </>
  );
}

/**
 * Rich inline renderer: **bold**, *italic*, #hashtags, @mentions, URLs.
 * For platforms that natively support inline emphasis (LinkedIn, Facebook, Pinterest).
 */
function InlineRich({
  text,
  highlightCls,
  linkCls,
}: {
  text: string;
  highlightCls: string;
  linkCls: string;
}) {
  // Split on **bold**, *italic*, URLs, #hashtags, @mentions — keep separators
  const parts = text.split(/(\*\*[^*\n]+?\*\*|\*[^*\n]+?\*|https?:\/\/\S+|#\w+|@[\w.]+)/g);
  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith('**') && part.endsWith('**') && part.length > 4)
          return <strong key={i} className="font-semibold">{part.slice(2, -2)}</strong>;
        if (part.startsWith('*') && part.endsWith('*') && part.length > 2)
          return <em key={i} className="italic text-gray-700">{part.slice(1, -1)}</em>;
        if (/^https?:\/\//.test(part))
          return <a key={i} href={part} target="_blank" rel="noopener noreferrer" className={linkCls}>{part}</a>;
        if (/^[#@]/.test(part))
          return <span key={i} className={highlightCls}>{part}</span>;
        return <span key={i}>{part}</span>;
      })}
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-renderers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Renders a single paragraph with proper inline highlighting.
 */
function ParagraphLine({
  para,
  isHook,
  ctx,
  highlightCls,
  linkCls,
  textSize,
  textAlign,
}: {
  para: string;
  isHook: boolean;
  ctx: PlatformContext;
  highlightCls: string;
  linkCls: string;
  textSize: string;
  textAlign: string;
}) {
  const isBullet = para.startsWith('• ');
  const lineText = isBullet ? para.slice(2) : para;

  return (
    <p
      className={[
        'leading-relaxed',
        textSize,
        textAlign,
        'text-gray-800',
        isHook ? 'font-semibold' : '',
        isBullet ? 'pl-4 relative' : '',
      ].filter(Boolean).join(' ')}
    >
      {isBullet && (
        <span className="absolute left-0 top-0 select-none text-gray-400">•</span>
      )}
      {para.split('\n').map((line, li) => {
        const lineContent = li === 0 && isBullet ? lineText : line;
        return (
          <React.Fragment key={li}>
            {li > 0 && <br />}
            {ctx.supportsInlineBold
              ? <InlineRich text={lineContent} highlightCls={highlightCls} linkCls={linkCls} />
              : <HighlightText text={lineContent} highlightCls={highlightCls} linkCls={linkCls} />
            }
          </React.Fragment>
        );
      })}
    </p>
  );
}

/** Detect if a line is a Twitter/X thread tweet number (e.g. "1/", "2/", "3/") */
function isThreadNumber(line: string): boolean {
  return /^\d+\/\s*$/.test(line.trim()) || /^\d+\/\s/.test(line.trim());
}

/** Detect TikTok section labels (HOOK, PATTERN INTERRUPT, PAYOFF, CTA) */
const TIKTOK_SECTION_RE = /^(HOOK|PATTERN INTERRUPT|PAYOFF|PAYOFF \/ VALUE|VALUE|CTA|HASHTAGS?)[\s:]/i;

/** Detect if a line is a "Slide N:" marker for carousels */
const SLIDE_RE = /^Slide\s+\d+\s*:/i;

/**
 * Context-aware social renderer.
 *
 * - Normalises AI markdown artifacts before display
 * - LinkedIn: prominent hook + inline bold/italic + short paragraphs + CTA
 * - Instagram: body + separated hashtag block
 * - Twitter/X: per-sentence lines + thread numbering
 * - TikTok: hook/payoff section labels + compact lines
 * - Facebook: friendly paragraphs + engagement question highlighted at end
 * - Pinterest: keyword-dense, hashtags styled as discovery tags
 * - Reddit: title rendered as headline + body paragraphs
 * - YouTube: handled by YouTubeContent (detectMode routes there)
 */
export function SocialContent({
  content,
  platform = '',
  contentType = 'post',
  highlightCls,
  linkCls,
}: {
  content: string;
  platform?: string;
  contentType?: string;
  highlightCls: string;
  linkCls: string;
}) {
  const ctx = getPlatformContext(platform, contentType);
  const { body, hashtagBlock, redditTitle } = normalizeForSocial(content, ctx);

  const textSize =
    ctx.platform === 'x' || ctx.platform === 'twitter' ? 'text-[15px]' :
    ctx.compactSpacing ? 'text-sm' : 'text-sm';

  const textAlign =
    ctx.sentencePerLine || ctx.compactSpacing || ctx.platform === 'reddit' ? '' : 'text-justify';

  // ── Reddit: title headline + body ──────────────────────────────────────────
  if (ctx.hasRedditTitle) {
    const paragraphs = body.split(/\n{2,}/).filter(Boolean);
    const lastPara = paragraphs[paragraphs.length - 1] ?? '';
    const isQuestion = lastPara.trim().endsWith('?');

    return (
      <div className="space-y-3">
        {redditTitle && (
          <p className="text-[15px] font-semibold text-gray-900 leading-snug">
            {redditTitle}
          </p>
        )}
        <div className="space-y-2">
          {paragraphs.map((para, i) => {
            const isLast = i === paragraphs.length - 1;
            const isDiscussionQ = isLast && isQuestion;
            return (
              <p
                key={i}
                className={[
                  'text-sm leading-relaxed',
                  isDiscussionQ
                    ? 'text-[#FF4500] font-medium mt-3 pt-3 border-t border-gray-100'
                    : 'text-gray-800',
                ].join(' ')}
              >
                {para.split('\n').map((line, li) => (
                  <React.Fragment key={li}>
                    {li > 0 && <br />}
                    <HighlightText text={line} highlightCls={highlightCls} linkCls={linkCls} />
                  </React.Fragment>
                ))}
              </p>
            );
          })}
        </div>
      </div>
    );
  }

  // ── TikTok: section-label aware rendering ──────────────────────────────────
  if (ctx.platform === 'tiktok') {
    const lines = body.split('\n');
    return (
      <div className="space-y-1.5">
        {lines.filter(Boolean).map((line, i) => {
          const isSectionLabel = TIKTOK_SECTION_RE.test(line);
          const isFirst = i === 0;
          return (
            <p
              key={i}
              className={[
                'text-sm leading-relaxed',
                isSectionLabel
                  ? 'text-[10px] font-bold uppercase tracking-widest text-gray-400 mt-3 first:mt-0'
                  : isFirst
                  ? 'font-semibold text-gray-900'
                  : 'text-gray-800',
              ].join(' ')}
            >
              <HighlightText text={line} highlightCls={highlightCls} linkCls={linkCls} />
            </p>
          );
        })}
        {hashtagBlock && (
          <div className="mt-3 pt-2 border-t border-gray-100">
            <p className="text-[13px] text-gray-400 leading-loose break-words">
              {hashtagBlock.split(/(\s+)/).map((word, i) =>
                /^#\w+$/.test(word)
                  ? <span key={i} className={highlightCls}>{word}</span>
                  : <span key={i}>{word}</span>
              )}
            </p>
          </div>
        )}
      </div>
    );
  }

  // ── Twitter/X: thread-aware rendering ─────────────────────────────────────
  if (ctx.sentencePerLine && (ctx.platform === 'x' || ctx.platform === 'twitter')) {
    const lines = body.split('\n').filter(Boolean);
    // Detect if this is a thread (has numbered tweets like "1/", "2/")
    const isThread = lines.some(isThreadNumber);

    if (isThread) {
      // Group lines under their tweet numbers
      const tweets: { number: string; lines: string[] }[] = [];
      let current: { number: string; lines: string[] } | null = null;
      for (const line of lines) {
        if (isThreadNumber(line)) {
          if (current) tweets.push(current);
          current = { number: line.trim(), lines: [] };
        } else if (current) {
          current.lines.push(line);
        } else {
          // Content before first number (intro tweet)
          tweets.push({ number: '', lines: [line] });
        }
      }
      if (current) tweets.push(current);

      return (
        <div className="space-y-3">
          {tweets.map((tweet, i) => (
            <div key={i} className={i > 0 ? 'border-l-2 border-sky-200 pl-3' : ''}>
              {tweet.number && (
                <span className="text-[11px] font-bold text-sky-500 block mb-1">{tweet.number}</span>
              )}
              {tweet.lines.map((line, li) => (
                <p key={li} className="text-[15px] text-gray-800 leading-relaxed">
                  <HighlightText text={line} highlightCls={highlightCls} linkCls={linkCls} />
                </p>
              ))}
            </div>
          ))}
        </div>
      );
    }

    // Single tweet
    return (
      <div className="space-y-1.5">
        {lines.map((line, i) => (
          <p key={i} className="text-[15px] text-gray-800 leading-relaxed">
            <HighlightText text={line} highlightCls={highlightCls} linkCls={linkCls} />
          </p>
        ))}
      </div>
    );
  }

  // ── Pinterest: keyword-tag styling ─────────────────────────────────────────
  if (ctx.isKeywordDriven) {
    const paragraphs = body.split(/\n{2,}/).filter(Boolean);
    return (
      <div className="space-y-2">
        {paragraphs.map((para, i) => (
          <p
            key={i}
            className={[
              'text-sm leading-relaxed',
              i === 0 ? 'font-semibold text-gray-900' : 'text-gray-700',
            ].join(' ')}
          >
            {para.split('\n').map((line, li) => (
              <React.Fragment key={li}>
                {li > 0 && <br />}
                <HighlightText text={line} highlightCls={highlightCls} linkCls={linkCls} />
              </React.Fragment>
            ))}
          </p>
        ))}
        {hashtagBlock && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {hashtagBlock.split(/\s+/).filter((w) => /^#\w+$/.test(w)).map((tag, i) => (
              <span
                key={i}
                className="inline-flex items-center px-2 py-0.5 rounded-full bg-red-50 text-[#E60023] text-[12px] font-medium"
              >
                {tag}
              </span>
            ))}
          </div>
        )}
      </div>
    );
  }

  // ── Facebook: engagement question highlighted at end ───────────────────────
  if (ctx.hasEngagementQuestion) {
    const paragraphs = body.split(/\n{2,}/).filter(Boolean);
    const lastPara = paragraphs[paragraphs.length - 1] ?? '';
    const isEngagementQ = lastPara.trim().endsWith('?') || /drop a|comment|let me know|tell me|agree|what do you/i.test(lastPara);
    const bodyParas = isEngagementQ ? paragraphs.slice(0, -1) : paragraphs;

    return (
      <div className="space-y-3">
        <div className="space-y-3">
          {bodyParas.map((para, i) => (
            <ParagraphLine
              key={i}
              para={para}
              isHook={i === 0}
              ctx={ctx}
              highlightCls={highlightCls}
              linkCls={linkCls}
              textSize={textSize}
              textAlign={textAlign}
            />
          ))}
        </div>
        {isEngagementQ && (
          <div className="mt-3 pt-3 border-t border-[#1877F2]/20 bg-blue-50/50 rounded-lg px-3 py-2">
            <p className="text-sm font-medium text-[#1877F2] leading-relaxed">
              <InlineRich text={lastPara} highlightCls={highlightCls} linkCls={linkCls} />
            </p>
          </div>
        )}
        {hashtagBlock && (
          <p className="text-[13px] text-gray-400 leading-loose">
            {hashtagBlock.split(/(\s+)/).map((word, i) =>
              /^#\w+$/.test(word)
                ? <span key={i} className={highlightCls}>{word}</span>
                : <span key={i}>{word}</span>
            )}
          </p>
        )}
      </div>
    );
  }

  // ── Default: LinkedIn, Instagram, generic ─────────────────────────────────
  const paragraphs = body.split(/\n{2,}/).filter(Boolean);
  const spacing = ctx.compactSpacing ? 'space-y-1.5' : 'space-y-3';

  return (
    <div>
      <div className={spacing}>
        {paragraphs.map((para, i) => (
          <ParagraphLine
            key={i}
            para={para}
            isHook={i === 0 && ctx.hookLineProminent}
            ctx={ctx}
            highlightCls={highlightCls}
            linkCls={linkCls}
            textSize={textSize}
            textAlign={textAlign}
          />
        ))}
      </div>

      {/* Instagram / TikTok: hashtag block separated and visually muted */}
      {hashtagBlock && (
        <div className="mt-4 pt-3 border-t border-gray-100">
          <p className="text-[13px] text-gray-400 leading-loose break-words">
            {hashtagBlock.split(/(\s+)/).map((word, i) =>
              /^#\w+$/.test(word)
                ? <span key={i} className={highlightCls}>{word}</span>
                : <span key={i}>{word}</span>
            )}
          </p>
        </div>
      )}
    </div>
  );
}

/**
 * Rich markdown renderer.
 * Used for: LinkedIn articles, blogs, newsletters, podcasts, short stories.
 * Full typographic treatment: h1-h3, ul/ol, blockquote, hr, code, pre.
 */
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
      // eslint-disable-next-line react/no-danger
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
