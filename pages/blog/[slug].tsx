'use client';

import React, { useEffect, useState } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import Link from 'next/link';
import ReactMarkdown from 'react-markdown';
import Footer from '../../components/landing/Footer';
import { BlogMediaBlocks, type MediaBlockItem } from '../../components/blog/BlogMediaBlock';
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
      <div className="flex min-h-screen items-center justify-center bg-[#F5F9FF]">
        <Loader2 className="h-10 w-10 animate-spin text-[#0B5ED7]" />
      </div>
    );
  }

  if (notFound || !post) {
    return (
      <div className="min-h-screen bg-[#F5F9FF] px-4 py-16">
        <div className="mx-auto max-w-2xl text-center">
          <h1 className="text-2xl font-bold text-gray-900">Post not found</h1>
          <Link href="/blog" className="mt-4 inline-flex items-center gap-2 text-[#0B5ED7]">
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
      <div className="min-h-screen bg-[#F5F9FF]">
        <article className="mx-auto max-w-3xl px-4 py-12 sm:px-6 sm:py-16">
          <Link
            href="/blog"
            className="inline-flex items-center gap-2 text-sm font-medium text-gray-600 hover:text-[#0B5ED7]"
          >
            <ArrowLeft className="h-4 w-4" /> Back to Blog
          </Link>

          <header className="mt-8">
            {post.category && (
              <span className="text-sm font-medium uppercase tracking-wide text-[#0B5ED7]">
                {post.category}
              </span>
            )}
            <h1 className="mt-2 text-4xl font-bold text-gray-900 sm:text-5xl">
              {post.title}
            </h1>
            <div className="mt-4 flex flex-wrap items-center gap-4 text-sm text-gray-500">
              {publishedDate && (
                <span className="flex items-center gap-1">
                  <Calendar className="h-4 w-4" /> {publishedDate}
                </span>
              )}
              <span className="flex items-center gap-1">
                <Clock className="h-4 w-4" /> {readTime} min read
              </span>
              {post.views_count > 0 && (
                <span>{post.views_count} views</span>
              )}
            </div>
          </header>

          {post.featured_image_url && (
            <div className="mt-8 overflow-hidden rounded-2xl border border-gray-200">
              <img
                src={post.featured_image_url}
                alt=""
                className="w-full object-cover"
              />
            </div>
          )}

          <div className="prose prose-lg mt-10 max-w-none prose-headings:font-bold prose-a:text-[#0B5ED7 prose-img:rounded-xl">
            {post.content_html ? (
              <div dangerouslySetInnerHTML={{ __html: post.content_html }} />
            ) : (
              <ReactMarkdown>{post.content_markdown}</ReactMarkdown>
            )}
            <BlogMediaBlocks blocks={post.media_blocks} />
          </div>

          <section className="mt-16 rounded-2xl border border-gray-200 bg-white p-8 shadow-omnivyra">
            <h2 className="text-xl font-bold text-gray-900">
              Ready to build marketing systems with AI momentum intelligence?
            </h2>
            <p className="mt-2 text-gray-600">
              Omnivera helps you design, execute, and optimize campaigns with strategic automation and execution intelligence.
            </p>
            <div className="mt-6 flex flex-wrap gap-4">
              <Link
                href="/login"
                className="rounded-omnivyra landing-btn-primary inline-flex px-6 py-3 text-base font-semibold"
              >
                Launch Campaign
              </Link>
              <Link
                href="/pricing"
                className="rounded-omnivyra landing-btn-secondary inline-flex px-6 py-3 text-base font-semibold"
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
