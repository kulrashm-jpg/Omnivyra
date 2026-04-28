'use client';

import React, { useEffect, useRef, useState } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import Link from 'next/link';
import ReactMarkdown from 'react-markdown';
import rehypeRaw from 'rehype-raw';
import Footer from '../../components/landing/Footer';
import { BlogMediaBlocks, type MediaBlockItem } from '../../components/blog/BlogMediaBlock';
import { BlogShareButtons } from '../../components/blog/BlogShareButtons';
import { BlogLikeButton } from '../../components/blog/BlogLikeButton';
import { BlogComments } from '../../components/blog/BlogComments';
import { ReadNextSection } from '../../components/blog/ReadNextSection';
import { ReadingProgressBar } from '../../components/blog/ReadingProgressBar';
import { BlogSeriesWidget } from '../../components/blog/BlogSeriesWidget';
import { BlogPerformanceTracker } from '../../components/blog/BlogPerformanceTracker';
import { TTSPlayer } from '../../components/blog/TTSPlayer';
import { ArrowLeft, Loader2, Calendar, Clock, Eye, Megaphone } from 'lucide-react';
import type { ContentBlock } from '../../lib/blog/blockTypes';
import { extractTextFromBlocks, estimateReadTimeFromBlocks } from '../../lib/blog/blockUtils';
import { BlockRenderer } from '../../components/blog/BlockRenderer';
import { useCompanyContext } from '../../components/CompanyContext';
import { CampaignPerformanceSignal } from '../../components/blog/CampaignPerformanceSignal';

// ── Helpers ───────────────────────────────────────────────────────────────────

function estimateReadTimeMarkdown(md: string): number {
  const words = md.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.ceil(words / 200));
}

function getContentHtml(post: { content_html: string | null; content_markdown: string }): string {
  return post.content_html || post.content_markdown || '';
}

// ── Inline engagement blocks ──────────────────────────────────────────────────

function KeyTakeawayBox() {
  return (
    <div className="my-10 overflow-hidden rounded-2xl border border-[#0A66C2]/20 bg-[#F5F9FF]">
      <div className="flex items-center gap-2 border-b border-[#0A66C2]/10 bg-[#0A66C2]/5 px-5 py-3">
        <span className="text-base">💡</span>
        <span className="text-xs font-bold uppercase tracking-widest text-[#0A66C2]">Key Takeaway</span>
      </div>
      <div className="px-5 py-4">
        <p className="text-sm font-semibold text-[#0B1F33] mb-1">What this means</p>
        <p className="text-sm text-[#6B7C93] leading-relaxed">
          AI is not about doing more — it's about seeing better before acting.
          Clarity at the planning stage prevents the majority of mid-campaign corrections.
        </p>
      </div>
    </div>
  );
}

function SoftProductInsert() {
  return (
    <div className="my-12 overflow-hidden rounded-2xl border border-[#0A66C2]/15 bg-gradient-to-br from-[#F5F9FF] to-white">
      <div className="px-7 py-7">
        <div className="inline-flex items-center gap-2 rounded-full bg-[#0A66C2]/10 px-3 py-1 text-xs font-semibold uppercase tracking-widest text-[#0A66C2] mb-4">
          From insight to action
        </div>
        <p className="text-base font-semibold text-[#0B1F33] leading-snug mb-2">
          Understanding is only useful if you can act on it.
        </p>
        <p className="text-sm text-[#6B7C93] leading-relaxed mb-5">
          Omnivyra helps you apply these insights directly — from campaign planning
          to execution and optimization, all in one structured system.
        </p>
        <Link
          href="/get-free-credits"
          className="inline-flex items-center gap-2 rounded-full bg-[#0A66C2] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#0A1F44] transition-colors"
        >
          👉 Try with Free Credits
        </Link>
      </div>
    </div>
  );
}

// ── Article body with injected blocks ─────────────────────────────────────────

function ArticleBody({
  post,
}: {
  post: {
    content_html: string | null;
    content_markdown: string;
    media_blocks: MediaBlockItem[] | null;
    content_blocks: ContentBlock[] | null;
  };
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  // ── Structured blocks path ────────────────────────────────────────────────
  if (post.content_blocks && post.content_blocks.length > 0) {
    const insertAfter = Math.floor(post.content_blocks.length * 0.6) - 1;
    return (
      <div ref={containerRef}>
        <BlockRenderer
          blocks={post.content_blocks}
          productInsertAfterIndex={insertAfter}
          ProductInsert={<SoftProductInsert />}
        />
      </div>
    );
  }

  // ── Legacy HTML path ──────────────────────────────────────────────────────
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

  if (post.content_html) {
    const parts = post.content_html.split(/(?<=<\/p>)/);
    const splitAt = Math.floor(parts.length * 0.6);
    const [firstHalf, secondHalf] =
      splitAt > 0 && splitAt < parts.length
        ? [parts.slice(0, splitAt).join(''), parts.slice(splitAt).join('')]
        : [post.content_html, ''];

    if (!secondHalf) {
      return (
        <div ref={containerRef} className={proseClass}>
          <div dangerouslySetInnerHTML={{ __html: post.content_html }} />
          <BlogMediaBlocks blocks={post.media_blocks} />
        </div>
      );
    }
    return (
      <div ref={containerRef}>
        <div className={proseClass}>
          <div dangerouslySetInnerHTML={{ __html: firstHalf }} />
        </div>
        <KeyTakeawayBox />
        <div className={proseClass}>
          <div dangerouslySetInnerHTML={{ __html: secondHalf }} />
        </div>
        <SoftProductInsert />
        <BlogMediaBlocks blocks={post.media_blocks} />
      </div>
    );
  }

  // Markdown fallback
  return (
    <div ref={containerRef}>
      <div className={proseClass}>
        <ReactMarkdown rehypePlugins={[rehypeRaw]}>{post.content_markdown}</ReactMarkdown>
      </div>
      <KeyTakeawayBox />
      <SoftProductInsert />
      <BlogMediaBlocks blocks={post.media_blocks} />
    </div>
  );
}

// ── Category colour ───────────────────────────────────────────────────────────

const CAT_COLOUR: Record<string, string> = {
  campaigns: 'bg-blue-100 text-blue-700',
  content:   'bg-violet-100 text-violet-700',
  seo:       'bg-emerald-100 text-emerald-700',
  growth:    'bg-orange-100 text-orange-700',
  insights:  'bg-indigo-100 text-indigo-700',
};
function categoryClass(cat: string) {
  return CAT_COLOUR[cat.toLowerCase()] ?? 'bg-[#0A66C2]/10 text-[#0A66C2]';
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function BlogDetailPage() {
  const router = useRouter();
  const slug = router.query.slug as string | undefined;
  const { userRole } = useCompanyContext();
  const isSuperAdmin = (userRole || '').toUpperCase() === 'SUPER_ADMIN';

  const [post, setPost] = useState<{
    id: string;
    title: string;
    slug: string;
    excerpt: string | null;
    content_markdown: string;
    content_html: string | null;
    featured_image_url: string | null;
    category: string | null;
    tags: string[] | null;
    media_blocks: MediaBlockItem[] | null;
    content_blocks: ContentBlock[] | null;
    seo_meta_title: string | null;
    seo_meta_description: string | null;
    published_at: string | null;
    views_count: number;
    likes_count?: number;
  } | null>(null);

  const [loading, setLoading] = useState(!!slug);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!slug) return;
    let cancelled = false;
    setLoading(true); setNotFound(false);
    fetch(`/api/blog/${encodeURIComponent(slug)}`)
      .then(res => { if (res.status === 404) { setNotFound(true); return null; } return res.json(); })
      .then(data => { if (!cancelled && data) setPost(data); })
      .catch(() => { if (!cancelled) setNotFound(true); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [slug]);

  // ── Loading ────────────────────────────────────────────────────────────────
  if (!slug || loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#F5F9FF]">
        <Loader2 className="h-10 w-10 animate-spin text-[#0A66C2]" />
      </div>
    );
  }

  // ── Not found ──────────────────────────────────────────────────────────────
  if (notFound || !post) {
    return (
      <div className="min-h-screen bg-[#F5F9FF] px-4 py-16">
        <div className="mx-auto max-w-xl rounded-2xl border border-gray-100 bg-white p-12 text-center shadow-sm">
          <h1 className="text-2xl font-bold text-[#0B1F33]">Article not found</h1>
          <Link href="/blog" className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-[#0A66C2] hover:underline">
            <ArrowLeft className="h-4 w-4" /> Back to Blog
          </Link>
        </div>
        <Footer />
      </div>
    );
  }

  // ── Derived values ────────────────────────────────────────────────────────
  const siteUrl = typeof window !== 'undefined' ? window.location.origin : (process.env.NEXT_PUBLIC_APP_URL || 'https://www.omnivyra.com');
  const canonical = `${siteUrl}/blog/${encodeURIComponent(post.slug)}`;
  const metaTitle = post.seo_meta_title || post.title;
  const metaDesc = post.seo_meta_description || post.excerpt || post.title;
  const readTime = post.content_blocks && post.content_blocks.length > 0
    ? estimateReadTimeFromBlocks(post.content_blocks)
    : estimateReadTimeMarkdown(post.content_markdown);
  const publishedDate = post.published_at
    ? new Date(post.published_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
    : '';

  const contentHtml = post.content_blocks && post.content_blocks.length > 0
    ? `<p>${extractTextFromBlocks(post.content_blocks)}</p>`
    : getContentHtml(post);

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <>
      <Head>
        <title>{metaTitle} — Omnivyra</title>
        <meta name="description" content={metaDesc} />
        <link rel="canonical" href={canonical} />
        <meta property="og:title" content={metaTitle} />
        <meta property="og:description" content={metaDesc} />
        <meta property="og:url" content={canonical} />
        <meta property="og:type" content="article" />
        {post.featured_image_url && <meta property="og:image" content={post.featured_image_url} />}
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content={metaTitle} />
        <meta name="twitter:description" content={metaDesc} />
        {post.featured_image_url && <meta name="twitter:image" content={post.featured_image_url} />}
        {/* Article structured data */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              '@context': 'https://schema.org',
              '@type': 'Article',
              headline: post.title,
              description: metaDesc,
              datePublished: post.published_at,
              image: post.featured_image_url,
              url: canonical,
              publisher: {
                '@type': 'Organization',
                name: 'Omnivyra',
                url: siteUrl,
              },
            }),
          }}
        />
      </Head>

      {/* Reading progress bar */}
      <ReadingProgressBar />

      <div className="min-h-screen bg-[#F5F9FF] pb-28">

        {/* ── ARTICLE ─────────────────────────────────────────────────────── */}
        <article className="mx-auto max-w-2xl px-4 py-12 sm:px-6 sm:py-16">

          {/* ── HEADER ────────────────────────────────────────────────────── */}
          <header>
            {/* Category tag */}
            {post.category && (
              <Link
                href={`/blog?category=${encodeURIComponent(post.category)}`}
                className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-bold uppercase tracking-widest ${categoryClass(post.category)}`}
              >
                {post.category}
              </Link>
            )}

            {/* Title */}
            <h1 className="mt-4 text-3xl font-bold leading-tight tracking-tight text-[#0B1F33] sm:text-4xl sm:leading-[1.2]">
              {post.title}
            </h1>

            {/* Subtitle / excerpt */}
            {post.excerpt && (
              <p className="mt-4 text-lg leading-relaxed text-[#6B7C93]">
                {post.excerpt}
              </p>
            )}

            {/* Meta row */}
            <div className="mt-6 flex flex-wrap items-center gap-3 text-sm text-[#6B7C93]">
              {publishedDate && (
                <span className="flex items-center gap-1.5 rounded-lg bg-white border border-gray-100 px-3 py-1.5 shadow-sm">
                  <Calendar className="h-3.5 w-3.5 text-[#0A66C2]" />
                  <time dateTime={post.published_at || ''}>{publishedDate}</time>
                </span>
              )}
              <span className="flex items-center gap-1.5 rounded-lg bg-white border border-gray-100 px-3 py-1.5 shadow-sm">
                <Clock className="h-3.5 w-3.5 text-[#0A66C2]" />
                {readTime} min read
              </span>
              {post.views_count > 0 && (
                <span className="flex items-center gap-1.5 rounded-lg bg-white border border-gray-100 px-3 py-1.5 shadow-sm">
                  <Eye className="h-3.5 w-3.5 text-[#0A66C2]" />
                  {post.views_count.toLocaleString()} views
                </span>
              )}
              {isSuperAdmin && (
                <button
                  onClick={() => router.push(`/recommendations?blog_id=${encodeURIComponent(post.id)}`)}
                  className="ml-auto flex items-center gap-1.5 rounded-lg bg-[#0A66C2] px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-[#0A1F44] transition-colors"
                >
                  <Megaphone className="h-3.5 w-3.5" />
                  Build Campaign
                </button>
              )}
            </div>

            {/* Tags */}
            {post.tags && post.tags.length > 0 && (
              <div className="mt-4 flex flex-wrap gap-2">
                {post.tags.map(tag => (
                  <span
                    key={tag}
                    className="rounded-full border border-gray-200 bg-white px-3 py-1 text-xs font-medium text-[#6B7C93] shadow-sm hover:border-[#0A66C2]/30 hover:text-[#0A66C2] transition-colors cursor-default"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            )}
          </header>

          {/* ── HERO IMAGE ────────────────────────────────────────────────── */}
          {post.featured_image_url && (
            <figure className="mt-10">
              <div className="overflow-hidden rounded-2xl shadow-lg">
                <img
                  src={post.featured_image_url}
                  alt={post.title}
                  className="aspect-[16/9] w-full object-cover"
                />
              </div>
            </figure>
          )}

          {/* ── ARTICLE BODY ──────────────────────────────────────────────── */}
          <div className="mt-10">
            <ArticleBody post={post} />
            {/* Sentinel for completion detection */}
            <div id="article-bottom-sentinel" aria-hidden />
          </div>

          {/* ── DIVIDER ───────────────────────────────────────────────────── */}
          <div className="my-12 flex items-center gap-4">
            <div className="flex-1 h-px bg-gradient-to-r from-transparent via-gray-200 to-transparent" />
            <div className="h-1.5 w-1.5 rounded-full bg-[#0A66C2]/30" />
            <div className="flex-1 h-px bg-gradient-to-r from-transparent via-gray-200 to-transparent" />
          </div>

          {/* ── SHARE + LIKE ──────────────────────────────────────────────── */}
          <section className="flex flex-wrap items-center justify-between gap-5 rounded-2xl border border-gray-100 bg-white px-6 py-5 shadow-sm">
            <BlogShareButtons url={canonical} title={post.title} excerpt={post.excerpt} />
            <BlogLikeButton slug={post.slug} initialCount={post.likes_count ?? 0} />
          </section>

          {/* ── SERIES WIDGET ─────────────────────────────────────────────── */}
          <BlogSeriesWidget currentSlug={post.slug} className="mt-10" />

          {/* ── CAMPAIGN PERFORMANCE SIGNAL (super admin only) ─────────────── */}
          {isSuperAdmin && (
            <CampaignPerformanceSignal slug={post.slug} className="mt-10" />
          )}

          {/* ── COMMENTS ──────────────────────────────────────────────────── */}
          <BlogComments slug={post.slug} className="mt-12" />

          {/* ── RELATED ARTICLES ──────────────────────────────────────────── */}
          <ReadNextSection currentSlug={post.slug} className="mt-12" />

          {/* ── FINAL CTA ─────────────────────────────────────────────────── */}
          <section className="mt-12 overflow-hidden rounded-2xl bg-gradient-to-br from-[#0A1F44] via-[#0A3060] to-[#0A66C2] p-8 shadow-xl">
            <p className="text-xs font-bold uppercase tracking-widest text-white/50 mb-3">
              Apply what you've learned
            </p>
            <h2 className="text-xl font-bold text-white sm:text-2xl leading-snug">
              Clarity shouldn't stop at reading
            </h2>
            <p className="mt-3 text-sm text-white/70 leading-relaxed">
              Apply what you've learned to your own marketing — from campaign structure
              to execution and optimization.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link
                href="/get-free-credits"
                className="inline-flex items-center gap-2 rounded-full bg-white px-6 py-3 text-sm font-bold text-[#0A1F44] shadow-lg hover:bg-white/90 hover:scale-105 transition-all"
              >
                👉 Get Free Credits
              </Link>
              <Link
                href="/solutions"
                className="inline-flex items-center gap-2 rounded-full border border-white/30 bg-white/10 px-6 py-3 text-sm font-semibold text-white backdrop-blur-sm hover:bg-white/20 transition-all"
              >
                Explore Platform
              </Link>
            </div>
          </section>
        </article>

        <Footer />
      </div>

      {/* ── TTS PLAYER (sticky bottom) ────────────────────────────────────── */}
      <TTSPlayer title={post.title} contentHtml={contentHtml} />

      {/* ── Performance tracker (invisible) ────────────────────────────────── */}
      <BlogPerformanceTracker slug={post.slug} />
    </>
  );
}
