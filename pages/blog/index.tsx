import React from 'react';
import type { GetStaticProps } from 'next';
import Link from 'next/link';
import Footer from '../../components/landing/Footer';
import { getBlogCategoryImage } from '../../lib/blogImages';
import MarketingPageMeta from '../../components/seo/MarketingPageMeta';

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

const BLUE_FIELD = 'linear-gradient(150deg, #071D3A 0%, #0A3770 54%, #0A66C2 100%)';

const JOURNAL_SIGNALS = [
  'AI visibility movement',
  'Authority evidence',
  'Execution pressure',
  'Market context',
];

const PUBLICATION_FIELDS = [
  'Discoverability signals',
  'Operational blind spots',
  'Execution intelligence',
  'Market movement',
];

function estimateReadTime(post: BlogPost): number {
  const titleWords = (post.title || '').trim().split(/\s+/).filter(Boolean).length;
  const excerptWords = (post.excerpt || '').trim().split(/\s+/).filter(Boolean).length;
  return Math.max(2, Math.ceil((titleWords + excerptWords + 140) / 200));
}

function formatDate(date: string | null, long = false) {
  if (!date) return '';
  // timeZone pinned: with ISR this runs on the server AND during hydration —
  // without it, a client a timezone away could format a different calendar day
  // than the prerendered HTML (hydration mismatch).
  return new Date(date).toLocaleDateString('en-US', {
    year: 'numeric',
    month: long ? 'long' : 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

function SignalField({ dark = false }: { dark?: boolean }) {
  return (
    <div className="pointer-events-none absolute inset-0" aria-hidden="true">
      <div className={dark ? 'absolute inset-0 omnivyra-dark-grid opacity-35' : 'absolute inset-0 omnivyra-light-grid opacity-70'} />
      <svg className="absolute inset-0 h-full w-full opacity-70" viewBox="0 0 1200 620" preserveAspectRatio="none">
        <path
          d="M70 150 C 235 76, 380 214, 540 160 S 810 92, 1130 226"
          fill="none"
          stroke={dark ? 'rgba(169,218,255,0.16)' : 'rgba(10,102,194,0.08)'}
          strokeWidth="1"
          strokeDasharray="3 22"
          className="blog-signal-drift"
        />
        <path
          d="M120 486 C 280 390, 450 535, 635 438 S 900 356, 1120 492"
          fill="none"
          stroke={dark ? 'rgba(255,255,255,0.08)' : 'rgba(63,169,245,0.07)'}
          strokeWidth="1"
          className="blog-signal-breathe"
        />
      </svg>
    </div>
  );
}

function ArticleImage({ post, aspect = '16/10' }: { post: BlogPost; aspect?: string }) {
  const img = getBlogCategoryImage(post.category);
  return (
    <div className="relative w-full overflow-hidden bg-[#071D3A]" style={{ aspectRatio: aspect }} aria-hidden>
      <img
        src={post.featured_image_url || img.url}
        alt=""
        className="absolute inset-0 h-full w-full object-cover opacity-58 mix-blend-luminosity transition duration-500 group-hover:scale-[1.025]"
        loading="lazy"
      />
      <div className="absolute inset-0 bg-[linear-gradient(135deg,rgba(7,29,58,0.78),rgba(10,102,194,0.24))]" />
      <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(169,218,255,0.08)_1px,transparent_1px),linear-gradient(180deg,rgba(169,218,255,0.07)_1px,transparent_1px)] bg-[size:36px_36px] opacity-60" />
    </div>
  );
}

function JournalHero() {
  return (
    <header className="relative overflow-hidden text-white" style={{ background: BLUE_FIELD }}>
      <SignalField dark />
      <div className="absolute left-1/2 top-0 h-[420px] w-[68%] -translate-x-1/2 bg-[#3FA9F5]/[0.08] blur-3xl" />
      <div className="absolute bottom-0 left-1/2 h-px w-[82%] -translate-x-1/2 bg-gradient-to-r from-transparent via-[#A9DAFF]/35 to-transparent" />
      <div className="relative mx-auto flex max-w-[1120px] flex-col items-center px-6 py-16 text-center lg:px-8 lg:py-20">
        <p className="inline-flex rounded-full border border-[#A9DAFF]/26 bg-white/[0.10] px-4 py-2 text-xs font-black uppercase tracking-[0.24em] text-[#A9DAFF]">
            Omnivyra Journal
        </p>
        <h1 className="mt-6 max-w-5xl text-4xl font-black leading-[1.02] tracking-tight sm:text-6xl xl:text-[4.45rem]">
          The Marketing Intelligence Journal
        </h1>
        <p className="mt-6 max-w-3xl text-base leading-8 text-[#DDF1FF] sm:text-lg">
          A public observation layer for how visibility changes, authority compounds, execution pressure moves, and
          market context reshapes marketing decisions.
        </p>
        <div className="mt-9 flex max-w-4xl flex-wrap justify-center gap-3">
          {JOURNAL_SIGNALS.map((signal) => (
            <span key={signal} className="rounded-2xl border border-white/12 bg-white/[0.075] px-5 py-3 text-sm font-black text-[#EAF7FF] shadow-[0_18px_48px_rgba(2,22,58,0.16)] backdrop-blur">
              {signal}
            </span>
          ))}
        </div>
      </div>
    </header>
  );
}

function FeaturedEntry({ post }: { post: BlogPost }) {
  return (
    <article>
      <Link href={`/blog/${encodeURIComponent(post.slug)}`} className="group grid overflow-hidden rounded-[30px] border border-[#CBE2F7]/80 bg-white/[0.82] shadow-[0_22px_58px_rgba(8,68,138,0.08)] backdrop-blur lg:grid-cols-[0.96fr_1.04fr]">
        <ArticleImage post={post} aspect="4/3" />
        <div className="flex flex-col justify-center p-6 sm:p-8 lg:p-10">
          <p className="mb-4 text-xs font-black uppercase tracking-[0.22em] text-[#6B7C93]">Current intelligence note</p>
          <div className="flex flex-wrap items-center gap-3 text-xs font-black uppercase tracking-[0.18em] text-[#0A66C2]">
            <span>{post.category || 'Operational intelligence'}</span>
            <span className="h-1 w-1 rounded-full bg-[#0A66C2]/40" />
            <span>{estimateReadTime(post)} min read</span>
          </div>
          <h2 className="mt-4 text-2xl font-black leading-tight tracking-tight text-[#071D3A] transition group-hover:text-[#0A66C2] sm:text-4xl">
            {post.title}
          </h2>
          {post.excerpt && (
            <p className="mt-5 max-w-2xl text-base leading-8 text-[#496179] line-clamp-4">
              {post.excerpt}
            </p>
          )}
          <div className="mt-7 flex flex-wrap items-center justify-between gap-4 border-t border-[#D8E8F7] pt-5">
            <time className="text-sm font-semibold text-[#6B7C93]" dateTime={post.published_at || ''}>
              {formatDate(post.published_at, true)}
            </time>
            <span className="inline-flex items-center gap-2 text-sm font-black text-[#0A66C2]">
              Read intelligence note
              <span className="transition-transform group-hover:translate-x-1">-&gt;</span>
            </span>
          </div>
        </div>
      </Link>
    </article>
  );
}

function SupportingEntry({ post, index }: { post: BlogPost; index: number }) {
  return (
    <article className="h-full">
      <Link href={`/blog/${encodeURIComponent(post.slug)}`} className="group flex h-full flex-col overflow-hidden rounded-[26px] border border-[#CBE2F7]/70 bg-white/[0.68] shadow-[0_16px_42px_rgba(8,68,138,0.055)] backdrop-blur">
        <div className="relative">
          <ArticleImage post={post} aspect="18/10" />
          <span className="absolute left-4 top-4 rounded-full border border-white/18 bg-[#071D3A]/55 px-3 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-white backdrop-blur">
            Field {String(index + 1).padStart(2, '0')}
          </span>
        </div>
        <div className="flex flex-1 flex-col p-5">
          <div className="flex items-center gap-3">
            <span className="h-px flex-1 bg-[#CBE2F7]" />
            <p className="text-[11px] font-black uppercase tracking-[0.18em] text-[#0A66C2]">
              {post.category || 'Observation'}
            </p>
          </div>
          <h3 className="mt-4 text-xl font-black leading-tight tracking-tight text-[#071D3A] transition group-hover:text-[#0A66C2] line-clamp-3">
            {post.title}
          </h3>
          {post.excerpt && (
            <p className="mt-3 text-sm leading-7 text-[#5D6F83] line-clamp-3">
              {post.excerpt}
            </p>
          )}
          <div className="mt-auto flex flex-wrap items-center justify-between gap-3 border-t border-[#D8E8F7] pt-5 text-xs font-semibold text-[#6B7C93]">
            <time dateTime={post.published_at || ''}>{formatDate(post.published_at)}</time>
            <span>{estimateReadTime(post)} min read</span>
          </div>
        </div>
      </Link>
    </article>
  );
}

interface BlogListingProps {
  featured: BlogPost | null;
  supporting: BlogPost[];
}

/**
 * OPT-006 Phase B: ISR — posts are fetched at build/revalidate time so the
 * crawlable HTML contains real article links instead of a spinner. Selection
 * logic is identical to the previous client effect (featured_only=1&limit=1
 * plus limit=4, deduped). Regenerates at most every 5 minutes.
 */
export const getStaticProps: GetStaticProps<BlogListingProps> = async () => {
  // The read is fail-soft BY DESIGN. This is the only build-time data fetch in
  // the app, so an unreachable database here would otherwise abort `next build`
  // for the entire deploy — `Export encountered an error on /blog`. That is a
  // real deploy fragility (a transient DB blip fails an unrelated release) and
  // it also breaks the CI `Production build` job, which compiles with schema-
  // valid PLACEHOLDER credentials that intentionally connect to nothing.
  //
  // Falling back to empty props is safe because `revalidate` still applies: the
  // first request after deploy regenerates the page against the live database,
  // so a build-time miss costs at most one stale render, never a failed deploy.
  let featuredArr: unknown[] = [];
  let all: unknown[] = [];
  try {
    const { listPublishedBlogPosts } = await import('../../backend/services/blog/publicBlogRead');
    [featuredArr, all] = await Promise.all([
      listPublishedBlogPosts({ featuredOnly: true, limit: 1 }),
      listPublishedBlogPosts({ limit: 4 }),
    ]);
  } catch (err) {
    console.warn('[blog/getStaticProps] published-post read failed; ISR will backfill on first request:',
      err instanceof Error ? err.message : err);
  }
  const featuredPost = (featuredArr[0] as BlogPost | undefined) ?? null;
  const supporting = featuredPost
    ? (all as unknown as BlogPost[]).filter((p) => p.id !== featuredPost.id).slice(0, 3)
    : (all as unknown as BlogPost[]).slice(1, 4);
  return {
    props: { featured: featuredPost ?? ((all[0] as unknown as BlogPost) ?? null), supporting },
    revalidate: 300,
  };
};

export default function BlogListingPage({ featured, supporting }: BlogListingProps) {
  const metaTitle = 'The Marketing Intelligence Journal | Omnivyra';
  const metaDesc = 'Operational observations on discoverability, execution movement, authority formation, and market interpretation from Omnivyra.';

  return (
    <>
      <MarketingPageMeta title={metaTitle} description={metaDesc} path="/blog" />

      <div className="min-h-screen overflow-hidden bg-[#F7FBFF]" style={{ fontFamily: "'Inter', sans-serif" }}>
        <JournalHero />

        <main className="relative z-10">
          <section className="relative overflow-hidden px-6 pb-14 pt-10 lg:px-8 lg:pb-16">
            <SignalField />
            <div className="relative mx-auto max-w-[1180px]">
              <div className="-mt-2 mb-8 grid gap-3 rounded-[28px] border border-[#CBE2F7]/75 bg-white/[0.72] p-3 shadow-[0_18px_42px_rgba(8,68,138,0.055)] backdrop-blur sm:grid-cols-4">
                {PUBLICATION_FIELDS.map((field) => (
                  <div key={field} className="rounded-2xl border border-[#D8E8F7]/70 bg-[#F7FBFF]/70 px-4 py-3 text-xs font-black uppercase tracking-[0.16em] text-[#0A66C2]">
                    {field}
                  </div>
                ))}
              </div>

              <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <p className="text-xs font-black uppercase tracking-[0.24em] text-[#0A66C2]">Public intelligence record</p>
                  <h2 className="mt-3 max-w-3xl text-3xl font-black tracking-tight text-[#071D3A] sm:text-5xl">
                    Operational observations, published as evidence.
                  </h2>
                </div>
                <p className="max-w-sm text-sm leading-7 text-[#5D6F83]">
                  Each entry is a public signal of how Omnivyra interprets visibility, market movement, execution pressure,
                  and operational change.
                </p>
              </div>

              {featured && <FeaturedEntry post={featured} />}

              {supporting.length > 0 && (
                <section className="mt-8 grid gap-5 lg:grid-cols-3">
                  {supporting.map((post, index) => (
                    <SupportingEntry key={post.id} post={post} index={index} />
                  ))}
                </section>
              )}

              {!featured && supporting.length === 0 && (
                <div className="rounded-[28px] border border-[#CBE2F7]/80 bg-white/[0.76] px-6 py-20 text-center shadow-[0_18px_42px_rgba(8,68,138,0.06)] backdrop-blur">
                  <p className="text-base leading-8 text-[#5D6F83]">
                    No public intelligence notes are available yet.
                  </p>
                </div>
              )}
            </div>
          </section>

          <section className="relative overflow-hidden bg-[#F7FBFF] px-6 py-10 lg:px-8">
            <SignalField />
            <div className="relative mx-auto flex max-w-[1180px] items-center justify-between gap-4 border-t border-[#CBE2F7]/80 pt-8 text-sm text-[#6B7C93]">
              <p>Journal infrastructure</p>
              <div className="flex gap-4">
                <a href="/blog/rss.xml" className="font-semibold transition hover:text-[#0A66C2]">RSS</a>
                <a href="/blog/sitemap.xml" className="font-semibold transition hover:text-[#0A66C2]">Sitemap</a>
              </div>
            </div>
          </section>
        </main>

        <Footer />

        <style jsx global>{`
          @keyframes blogSignalDrift {
            0%,
            100% {
              stroke-dashoffset: 0;
              opacity: 0.45;
            }
            50% {
              stroke-dashoffset: -42;
              opacity: 0.84;
            }
          }

          @keyframes blogSignalBreathe {
            0%,
            100% {
              opacity: 0.28;
            }
            50% {
              opacity: 0.66;
            }
          }

          .blog-signal-drift {
            animation: blogSignalDrift 15s ease-in-out infinite;
          }

          .blog-signal-breathe {
            animation: blogSignalBreathe 9s ease-in-out infinite;
          }

          @media (prefers-reduced-motion: reduce) {
            .blog-signal-drift,
            .blog-signal-breathe {
              animation: none;
            }
          }
        `}</style>
      </div>
    </>
  );
}
