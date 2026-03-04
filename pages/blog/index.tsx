'use client';

import React, { useEffect, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import Footer from '../../components/landing/Footer';
import { Loader2 } from 'lucide-react';

type BlogPost = {
  id: string;
  title: string;
  slug: string;
  excerpt: string | null;
  featured_image_url: string | null;
  category: string | null;
  is_featured: boolean;
  published_at: string | null;
};

const EDITORIAL_INTRO = [
  'This journal explores how omnichannel workflows, technology, and hybrid intelligence can make marketing leadership more productive, structured, and conversion-focused.',
  'We publish for CMOs, marketing leaders, and serious practitioners who care about campaign architecture, execution intelligence, and momentum modeling—not hype.',
];

function estimateReadTime(post: BlogPost): number {
  const titleWords = (post.title || '').trim().split(/\s+/).length;
  const excerptWords = (post.excerpt || '').trim().split(/\s+/).length;
  return Math.max(2, Math.ceil((titleWords + excerptWords + 120) / 200));
}

function ArticlePlaceholder({ aspect = '16/9' }: { aspect?: string }) {
  return (
    <div
      className="w-full bg-neutral-100"
      style={{ aspectRatio: aspect }}
      aria-hidden
    >
      <div className="flex h-full w-full items-center justify-center text-neutral-300">
        <span className="text-sm font-medium tracking-wide">Image</span>
      </div>
    </div>
  );
}

export default function BlogListingPage() {
  const [featured, setFeatured] = useState<BlogPost | null>(null);
  const [supporting, setSupporting] = useState<BlogPost[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch('/api/blog?featured_only=1&limit=1').then((r) => (r.ok ? r.json() : { posts: [] })),
      fetch('/api/blog?limit=4').then((r) => (r.ok ? r.json() : { posts: [] })),
    ]).then(([featuredRes, listRes]) => {
      if (cancelled) return;
      const featuredPost = featuredRes.posts?.[0] || null;
      const all = listRes.posts || [];
      const featuredId = featuredPost?.id;
      const supportingList = all
        .filter((p: BlogPost) => p.id !== featuredId)
        .slice(0, 3);
      setFeatured(featuredPost || all[0] || null);
      setSupporting(
        featuredPost ? supportingList : (all.slice(1, 4) as BlogPost[])
      );
    }).catch(() => {
      if (!cancelled) setFeatured(null);
      if (!cancelled) setSupporting([]);
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, []);

  const siteUrl = typeof window !== 'undefined' ? window.location.origin : '';
  const metaTitle = 'The Marketing Intelligence Journal | Omnivera';
  const metaDesc = 'Strategic insight on campaign architecture, execution intelligence, and momentum modeling.';

  return (
    <>
      <Head>
        <title>{metaTitle}</title>
        <meta name="description" content={metaDesc} />
        <link rel="canonical" href={`${siteUrl}/blog`} />
        <meta property="og:title" content={metaTitle} />
        <meta property="og:description" content={metaDesc} />
        <meta property="og:url" content={`${siteUrl}/blog`} />
        <meta property="og:type" content="website" />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content={metaTitle} />
        <meta name="twitter:description" content={metaDesc} />
      </Head>
      <div className="min-h-screen journal-bg">
        {/* Hero */}
        <header className="border-b border-neutral-200/80 bg-white/60">
          <div className="mx-auto max-w-3xl px-6 py-16 text-center sm:py-20">
            <h1 className="journal-title text-4xl tracking-tight sm:text-5xl">
              The Marketing Intelligence Journal
            </h1>
            <p className="mt-4 text-lg journal-body text-neutral-600 sm:text-xl">
              Strategic insight on campaign architecture, execution intelligence, and momentum modeling.
            </p>
            <div className="mx-auto mt-8 max-w-2xl space-y-3 text-base journal-body text-neutral-500">
              {EDITORIAL_INTRO.map((line, i) => (
                <p key={i}>{line}</p>
              ))}
            </div>
          </div>
        </header>

        <main className="mx-auto max-w-5xl px-6 py-14 sm:py-20">
          {loading ? (
            <div className="flex justify-center py-24">
              <Loader2 className="h-8 w-8 animate-spin text-neutral-400" />
            </div>
          ) : (
            <>
              {/* Featured article */}
              {featured && (
                <article className="mb-16 sm:mb-20">
                  <Link
                    href={`/blog/${encodeURIComponent(featured.slug)}`}
                    className="group block"
                  >
                    <div className="overflow-hidden rounded-lg journal-card-shadow journal-card-hover bg-white">
                      <div className="aspect-[16/9] w-full overflow-hidden bg-neutral-100">
                        {featured.featured_image_url ? (
                          <img
                            src={featured.featured_image_url}
                            alt=""
                            className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.02]"
                          />
                        ) : (
                          <ArticlePlaceholder />
                        )}
                      </div>
                      <div className="px-8 py-8 sm:px-10 sm:py-10">
                        <h2 className="journal-title text-2xl leading-tight text-neutral-900 sm:text-3xl group-hover:text-neutral-700">
                          {featured.title}
                        </h2>
                        {featured.excerpt && (
                          <p className="mt-4 max-w-2xl text-base journal-body text-neutral-600 line-clamp-3">
                            {featured.excerpt}
                          </p>
                        )}
                        <div className="mt-5 flex flex-wrap items-center gap-x-6 gap-y-1 text-sm journal-muted">
                          <time dateTime={featured.published_at || ''}>
                            {featured.published_at
                              ? new Date(featured.published_at).toLocaleDateString('en-US', {
                                  year: 'numeric',
                                  month: 'long',
                                  day: 'numeric',
                                })
                              : ''}
                          </time>
                          <span>{estimateReadTime(featured)} min read</span>
                        </div>
                        <p className="mt-4 text-sm font-medium journal-link underline-offset-2 group-hover:underline">
                          Read Article →
                        </p>
                      </div>
                    </div>
                  </Link>
                </article>
              )}

              {/* Three supporting articles */}
              {supporting.length > 0 && (
                <section className="grid gap-10 sm:grid-cols-3">
                  {supporting.map((post) => (
                    <article key={post.id} className="flex flex-col">
                      <Link href={`/blog/${encodeURIComponent(post.slug)}`} className="group block flex flex-1 flex-col">
                        <div className="overflow-hidden rounded-lg journal-card-shadow journal-card-hover bg-white">
                          <div className="aspect-[16/9] w-full overflow-hidden bg-neutral-100">
                            {post.featured_image_url ? (
                              <img
                                src={post.featured_image_url}
                                alt=""
                                className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.02]"
                              />
                            ) : (
                              <ArticlePlaceholder />
                            )}
                          </div>
                          <div className="flex flex-1 flex-col p-6">
                            <h3 className="journal-title text-lg leading-snug text-neutral-900 group-hover:text-neutral-700">
                              {post.title}
                            </h3>
                            {post.excerpt && (
                              <p className="mt-3 line-clamp-2 text-sm journal-body text-neutral-600">
                                {post.excerpt}
                              </p>
                            )}
                            <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs journal-muted">
                              <time dateTime={post.published_at || ''}>
                                {post.published_at
                                  ? new Date(post.published_at).toLocaleDateString('en-US', {
                                      month: 'short',
                                      day: 'numeric',
                                      year: 'numeric',
                                    })
                                  : ''}
                              </time>
                              <span>{estimateReadTime(post)} min read</span>
                            </div>
                            <p className="mt-4 text-sm font-medium journal-link underline-offset-2 group-hover:underline">
                              Read Article →
                            </p>
                          </div>
                        </div>
                      </Link>
                    </article>
                  ))}
                </section>
              )}

              {!featured && supporting.length === 0 && (
                <div className="py-24 text-center">
                  <p className="journal-body text-neutral-500">
                    No articles yet. Check back soon.
                  </p>
                </div>
              )}
            </>
          )}

          {/* Subtle footer reinforcement */}
          <footer className="mt-20 border-t border-neutral-200/80 pt-10 text-center">
            <p className="text-sm journal-muted">
              <a href="/blog/rss.xml" className="hover:text-neutral-900">RSS</a>
              {' · '}
              <a href="/blog/sitemap.xml" className="hover:text-neutral-900">Sitemap</a>
            </p>
          </footer>
        </main>

        <Footer />
      </div>
    </>
  );
}
