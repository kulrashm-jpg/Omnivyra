'use client';

import React, { useEffect, useState } from 'react';
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
import { ArrowLeft, Loader2, Calendar, Clock } from 'lucide-react';

function estimateReadTimeMarkdown(md: string): number {
  const words = md.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.ceil(words / 200));
}

export default function BlogDetailPage() {
  const router = useRouter();
  const slug = router.query.slug as string | undefined;
  const [post, setPost] = useState<{
    title: string;
    slug: string;
    excerpt: string | null;
    content_markdown: string;
    content_html: string | null;
    featured_image_url: string | null;
    category: string | null;
    tags: string[] | null;
    media_blocks: MediaBlockItem[] | null;
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
    setLoading(true);
    setNotFound(false);
    fetch(`/api/blog/${encodeURIComponent(slug)}`)
      .then((res) => {
        if (res.status === 404) {
          setNotFound(true);
          return null;
        }
        return res.json();
      })
      .then((data) => {
        if (!cancelled && data) setPost(data);
      })
      .catch(() => {
        if (!cancelled) setNotFound(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [slug]);

  if (!slug || loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-slate-50 to-slate-100">
        <Loader2 className="h-10 w-10 animate-spin text-[#0B5ED7]" />
      </div>
    );
  }

  if (notFound || !post) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-slate-50 to-slate-100 px-4 py-16">
        <div className="mx-auto max-w-2xl rounded-2xl border border-slate-200/80 bg-white p-12 text-center shadow-lg">
          <h1 className="text-2xl font-bold text-slate-900">Post not found</h1>
          <Link href="/blog" className="mt-6 inline-flex items-center gap-2 font-semibold text-[#0B5ED7] hover:text-[#094db8]">
            <ArrowLeft className="h-4 w-4" /> Back to Blog
          </Link>
        </div>
        <Footer />
      </div>
    );
  }

  const siteUrl = typeof window !== 'undefined' ? window.location.origin : '';
  const canonical = `${siteUrl}/blog/${encodeURIComponent(post.slug)}`;
  const metaTitle = post.seo_meta_title || post.title;
  const metaDesc = post.seo_meta_description || post.excerpt || post.title;
  const readTime = estimateReadTimeMarkdown(post.content_markdown);
  const publishedDate = post.published_at
    ? new Date(post.published_at).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })
    : '';

  return (
    <>
      <Head>
        <title>{metaTitle}</title>
        <meta name="description" content={metaDesc} />
        <link rel="canonical" href={canonical} />
        <meta property="og:title" content={metaTitle} />
        <meta property="og:description" content={metaDesc} />
        <meta property="og:url" content={canonical} />
        <meta property="og:type" content="article" />
        {post.featured_image_url && (
          <meta property="og:image" content={post.featured_image_url} />
        )}
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content={metaTitle} />
        <meta name="twitter:description" content={metaDesc} />
        {post.featured_image_url && (
          <meta name="twitter:image" content={post.featured_image_url} />
        )}
      </Head>
      <div className="min-h-screen bg-gradient-to-b from-slate-50 via-white to-slate-50">
        <article className="mx-auto max-w-3xl px-4 py-12 sm:px-6 sm:py-20">
          <Link
            href="/blog"
            className="inline-flex items-center gap-2 text-sm font-semibold text-slate-600 transition-colors hover:text-[#0B5ED7]"
          >
            <ArrowLeft className="h-4 w-4" /> Back to Blog
          </Link>

          <header className="mt-10">
            {post.category && (
              <span className="inline-block text-xs font-semibold uppercase tracking-[0.2em] text-[#0B5ED7]">
                {post.category}
              </span>
            )}
            <h1 className="mt-3 font-serif text-4xl font-bold tracking-tight text-slate-900 sm:text-5xl lg:text-[3rem] lg:leading-[1.2]">
              {post.title}
            </h1>
            {post.excerpt && (
              <p className="mt-5 text-lg leading-relaxed text-slate-600">
                {post.excerpt}
              </p>
            )}
            <div className="mt-6 flex flex-wrap items-center gap-5 text-sm text-slate-500">
              {publishedDate && (
                <span className="flex items-center gap-2 rounded-lg bg-slate-100/80 px-3 py-1.5">
                  <Calendar className="h-4 w-4 shrink-0 text-[#0B5ED7]" /> {publishedDate}
                </span>
              )}
              <span className="flex items-center gap-2 rounded-lg bg-slate-100/80 px-3 py-1.5">
                <Clock className="h-4 w-4 shrink-0 text-[#0B5ED7]" /> {readTime} min read
              </span>
              {post.views_count > 0 && (
                <span className="rounded-lg bg-slate-100/80 px-3 py-1.5">{post.views_count} views</span>
              )}
            </div>
            {post.tags && post.tags.length > 0 && (
              <div className="mt-5 flex flex-wrap gap-2">
                {post.tags.map((tag) => (
                  <span
                    key={tag}
                    className="rounded-full border border-slate-200/80 bg-white px-3.5 py-1.5 text-xs font-medium text-slate-600 shadow-sm"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            )}
          </header>

          {post.featured_image_url && (
            <figure className="mt-12">
              <div className="overflow-hidden rounded-2xl border border-slate-200/60 shadow-[0_8px_30px_rgba(0,0,0,0.08)]">
                <img
                  src={post.featured_image_url}
                  alt=""
                  className="aspect-[16/9] w-full object-cover"
                />
              </div>
            </figure>
          )}

          <div
            className="prose prose-lg prose-slate mt-12 max-w-none
              prose-headings:font-serif prose-headings:font-bold prose-headings:tracking-tight prose-headings:text-slate-900
              prose-h2:mt-14 prose-h2:mb-6 prose-h2:border-b prose-h2:border-slate-200 prose-h2:pb-3 prose-h2:text-2xl
              prose-h3:mt-10 prose-h3:text-xl
              prose-p:leading-[1.8] prose-p:text-slate-700
              prose-a:text-[#0B5ED7] prose-a:no-underline prose-a:font-medium hover:prose-a:underline
              prose-img:rounded-xl prose-img:shadow-lg prose-img:ring-1 prose-img:ring-slate-200/60
              prose-ul:my-6 prose-ol:my-6 prose-li:my-1.5 prose-li:text-slate-700
              prose-blockquote:border-l-4 prose-blockquote:border-[#0B5ED7] prose-blockquote:bg-slate-50/80 prose-blockquote:py-2 prose-blockquote:pl-6 prose-blockquote:italic prose-blockquote:text-slate-700 prose-blockquote:rounded-r-lg
              prose-pre:rounded-xl prose-pre:bg-slate-900 prose-pre:shadow-xl prose-code:rounded prose-code:bg-slate-100 prose-code:px-1.5 prose-code:py-0.5 prose-code:text-slate-800 prose-code:before:content-none prose-code:after:content-none"
          >
            {post.content_html ? (
              <div dangerouslySetInnerHTML={{ __html: post.content_html }} />
            ) : (
              <ReactMarkdown rehypePlugins={[rehypeRaw]}>{post.content_markdown}</ReactMarkdown>
            )}
            <BlogMediaBlocks blocks={post.media_blocks} />
          </div>

          <section className="mt-14 flex flex-wrap items-center justify-between gap-6 rounded-2xl border border-slate-200/60 bg-white px-6 py-6 shadow-[0_4px_20px_rgba(0,0,0,0.06)]">
            <BlogShareButtons
              url={canonical}
              title={post.title}
              excerpt={post.excerpt}
            />
            <BlogLikeButton
              slug={post.slug}
              initialCount={post.likes_count ?? 0}
            />
          </section>

          <BlogComments slug={post.slug} className="mt-14" />

          <ReadNextSection currentSlug={post.slug} className="mt-14" />

          <section className="mt-14 overflow-hidden rounded-2xl border border-slate-200/60 bg-gradient-to-br from-[#0B5ED7] to-[#1565c4] p-8 shadow-[0_8px_32px_rgba(11,94,215,0.25)]">
            <h2 className="text-xl font-bold text-white sm:text-2xl">
              Ready to build marketing systems with AI momentum intelligence?
            </h2>
            <p className="mt-3 text-white/90">
              Omnivyra helps you design, execute, and optimize campaigns with strategic automation and execution intelligence.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link
                href="/login"
                className="inline-flex rounded-xl bg-white px-6 py-3.5 text-base font-semibold text-[#0B5ED7] shadow-lg transition-all hover:-translate-y-0.5 hover:shadow-xl"
              >
                Launch Campaign
              </Link>
              <Link
                href="/pricing"
                className="inline-flex rounded-xl border-2 border-white/90 bg-white/10 px-6 py-3.5 text-base font-semibold text-white backdrop-blur-sm transition-all hover:bg-white/20"
              >
                Request Demo
              </Link>
            </div>
          </section>
        </article>
        <Footer />
      </div>
    </>
  );
}
