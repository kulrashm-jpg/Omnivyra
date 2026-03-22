/**
 * /company-blog/[slug]
 *
 * Public-facing company blog post reader.
 * Resolves by slug (preferred) or id fallback.
 * Renders content_blocks using BlockRenderer (same as public_blogs reader).
 * Falls back to HTML/markdown content field for older posts.
 */

import React, { useEffect, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import ReactMarkdown from 'react-markdown';
import rehypeRaw from 'rehype-raw';
import { ArrowLeft, Loader2, Calendar, Clock } from 'lucide-react';
import LandingNavbar from '../../components/landing/LandingNavbar';
import { BlockRenderer } from '../../components/blog/BlockRenderer';
import type { ContentBlock } from '../../lib/blog/blockTypes';
import { estimateReadTimeFromBlocks } from '../../lib/blog/blockUtils';

interface BlogPost {
  id:                   string;
  title:                string;
  slug:                 string | null;
  excerpt:              string | null;
  content:              string | null;
  content_blocks:       ContentBlock[] | null;
  featured_image_url:   string | null;
  category:             string | null;
  tags:                 string[];
  seo_meta_title:       string | null;
  seo_meta_description: string | null;
  published_at:         string | null;
  created_at:           string;
}

function formatDate(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

function estimateReadTimeMarkdown(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.ceil(words / 200));
}

export default function CompanyBlogPost() {
  const router    = useRouter();
  const { slug }  = router.query;
  const companyId = typeof router.query.company_id === 'string' ? router.query.company_id : null;

  const [post,    setPost]    = useState<BlogPost | null>(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);

  useEffect(() => {
    if (!slug) return;

    const slugStr = typeof slug === 'string' ? slug : (slug as string[])[0];
    if (!slugStr) return;

    setLoading(true);
    setError(null);

    // Try slug+company_id first, then id fallback
    const qs = companyId
      ? `slug=${encodeURIComponent(slugStr)}&company_id=${encodeURIComponent(companyId)}`
      : `id=${encodeURIComponent(slugStr)}`;

    fetch(`/api/blogs/${slugStr}/public?${qs}`)
      .then((r) => r.ok ? r.json() : Promise.reject(new Error('Not found')))
      .then((d) => setPost(d.post ?? null))
      .catch(() => setError('This post could not be found.'))
      .finally(() => setLoading(false));
  }, [slug, companyId]);

  const hasBlocks  = Array.isArray(post?.content_blocks) && (post!.content_blocks!).length > 0;
  const readTime   = hasBlocks
    ? estimateReadTimeFromBlocks(post!.content_blocks!)
    : estimateReadTimeMarkdown(post?.content ?? '');

  const backHref = companyId
    ? `/company-blog?company_id=${companyId}`
    : '/company-blog';

  const pageTitle = post?.seo_meta_title ?? post?.title ?? 'Blog';
  const pageDesc  = post?.seo_meta_description ?? post?.excerpt ?? '';

  return (
    <>
      <Head>
        <title>{pageTitle}</title>
        {pageDesc && <meta name="description" content={pageDesc} />}
        {post?.featured_image_url && <meta property="og:image" content={post.featured_image_url} />}
      </Head>
      <LandingNavbar />

      <main className="min-h-screen bg-white">

        {/* Loading */}
        {loading && (
          <div className="flex items-center justify-center min-h-screen text-gray-400 gap-2">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span className="text-sm">Loading…</span>
          </div>
        )}

        {/* Error */}
        {!loading && error && (
          <div className="flex flex-col items-center justify-center min-h-screen gap-4 text-gray-500">
            <p className="text-sm">{error}</p>
            <Link href={backHref} className="text-xs text-[#0A66C2] hover:underline">
              ← Back to blog
            </Link>
          </div>
        )}

        {/* Post */}
        {!loading && !error && post && (
          <article>
            {/* Hero */}
            {post.featured_image_url && (
              <div className="h-64 sm:h-96 w-full overflow-hidden">
                <img
                  src={post.featured_image_url}
                  alt={post.title}
                  className="h-full w-full object-cover"
                />
              </div>
            )}

            <div className="max-w-3xl mx-auto px-4 sm:px-6 py-12">

              {/* Back */}
              <Link
                href={backHref}
                className="inline-flex items-center gap-1.5 text-xs text-gray-400 hover:text-[#0A66C2] mb-8 transition-colors"
              >
                <ArrowLeft className="h-3.5 w-3.5" /> Back to blog
              </Link>

              {/* Category */}
              {post.category && (
                <span className="mb-4 inline-block rounded-full bg-[#0A66C2]/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-[#0A66C2]">
                  {post.category}
                </span>
              )}

              {/* Title */}
              <h1 className="text-3xl sm:text-4xl font-bold text-gray-900 leading-tight mb-4">
                {post.title}
              </h1>

              {/* Meta */}
              <div className="flex items-center gap-4 text-xs text-gray-400 mb-8">
                <span className="flex items-center gap-1">
                  <Calendar className="h-3.5 w-3.5" />
                  {formatDate(post.published_at)}
                </span>
                <span className="flex items-center gap-1">
                  <Clock className="h-3.5 w-3.5" />
                  {readTime} min read
                </span>
              </div>

              {/* Tags */}
              {post.tags && post.tags.length > 0 && (
                <div className="flex flex-wrap gap-2 mb-8">
                  {post.tags.map((t) => (
                    <span key={t} className="rounded-full bg-gray-100 px-3 py-1 text-[11px] text-gray-500">
                      #{t}
                    </span>
                  ))}
                </div>
              )}

              {/* Excerpt */}
              {post.excerpt && (
                <p className="text-lg text-gray-600 leading-relaxed mb-8 font-medium border-l-4 border-[#0A66C2]/30 pl-4">
                  {post.excerpt}
                </p>
              )}

              {/* Content — blocks preferred, markdown/HTML fallback */}
              <div className="prose prose-gray max-w-none">
                {hasBlocks ? (
                  <BlockRenderer blocks={post.content_blocks!} />
                ) : post.content ? (
                  <ReactMarkdown rehypePlugins={[rehypeRaw]}>
                    {post.content}
                  </ReactMarkdown>
                ) : (
                  <p className="text-gray-400 text-sm">No content available.</p>
                )}
              </div>

            </div>
          </article>
        )}
      </main>
    </>
  );
}
