import React, { useState, useMemo } from 'react';
import Link from 'next/link';
import Head from 'next/head';
import Image from 'next/image';
import Footer from '../components/landing/Footer';
import { ARTICLE_IMAGES } from '../lib/blogImages';

// ── Types ─────────────────────────────────────────────────────────────────────

type Category = 'All' | 'Campaigns' | 'Content' | 'SEO' | 'Growth' | 'Insights';

interface Article {
  id: number;
  category: Exclude<Category, 'All'>;
  title: string;
  excerpt: string;
  readTime: number;
  featured?: boolean;
}

// ── Editorial article data ────────────────────────────────────────────────────

const ARTICLES: Article[] = [
  {
    id: 1,
    category: 'Campaigns',
    title: "Why your campaigns don't convert (and how to fix it)",
    excerpt:
      "Most conversion problems aren't execution issues. They're structural. Before you touch the budget, check these four things first.",
    readTime: 5,
    featured: true,
  },
  {
    id: 2,
    category: 'Insights',
    title: "Before you run ads, check this",
    excerpt:
      "Ads amplify what's already there. If the foundation is weak, spend makes it worse — not better. Here's the pre-launch audit that changes outcomes.",
    readTime: 4,
  },
  {
    id: 3,
    category: 'Content',
    title: "Content without direction is wasted effort",
    excerpt:
      "Publishing consistently isn't the same as publishing strategically. The difference starts with a clear brief — not a calendar.",
    readTime: 6,
  },
  {
    id: 4,
    category: 'Growth',
    title: "How to know if your marketing is actually working",
    excerpt:
      "Vanity metrics look good in reports. But they rarely tell you what to do next. Here's how to track what matters.",
    readTime: 5,
  },
  {
    id: 5,
    category: 'SEO',
    title: "Your website ranks for the wrong things",
    excerpt:
      "Traffic without intent is noise. Here's how to audit your SEO analysis for actual business value — not just volume.",
    readTime: 7,
  },
  {
    id: 6,
    category: 'Campaigns',
    title: "Structuring a campaign before you brief the team",
    excerpt:
      "A strong campaign planning structure prevents 80% of mid-flight corrections. This is what to align on before work begins.",
    readTime: 5,
  },
  {
    id: 7,
    category: 'Insights',
    title: "The gap between marketing activity and marketing results",
    excerpt:
      "Being busy is not the same as being effective. How to measure the difference and find where your effort is actually going.",
    readTime: 4,
  },
  {
    id: 8,
    category: 'Content',
    title: "Why your content calendar isn't a content strategy",
    excerpt:
      "Scheduling is the last step. Most teams start there. That's why content rarely connects with the right audience at the right time.",
    readTime: 6,
  },
  {
    id: 9,
    category: 'Growth',
    title: "The channels that actually move the needle for your stage",
    excerpt:
      "Not every channel works at every growth stage. Here's how to match your channel mix to where you actually are.",
    readTime: 5,
  },
];

// ── Category config ───────────────────────────────────────────────────────────

const CATEGORIES: Category[] = ['All', 'Campaigns', 'Content', 'SEO', 'Growth', 'Insights'];

const CATEGORY_STYLE: Record<Exclude<Category, 'All'>, { gradient: string; tag: string; dot: string }> = {
  Campaigns: {
    gradient: 'from-[#0A1F44] to-[#0A66C2]',
    tag: 'bg-blue-100 text-blue-700',
    dot: 'bg-[#0A66C2]',
  },
  Content: {
    gradient: 'from-[#1a0544] to-[#7c3aed]',
    tag: 'bg-violet-100 text-violet-700',
    dot: 'bg-violet-600',
  },
  SEO: {
    gradient: 'from-[#052e16] to-[#059669]',
    tag: 'bg-emerald-100 text-emerald-700',
    dot: 'bg-emerald-600',
  },
  Growth: {
    gradient: 'from-[#431407] to-[#ea580c]',
    tag: 'bg-orange-100 text-orange-700',
    dot: 'bg-orange-500',
  },
  Insights: {
    gradient: 'from-[#0a0a44] to-[#4f46e5]',
    tag: 'bg-indigo-100 text-indigo-700',
    dot: 'bg-indigo-600',
  },
};

// ── Article thumbnail ─────────────────────────────────────────────────────────

function ArticleThumbnail({
  articleId,
  category,
  className = '',
}: {
  articleId: number;
  category: Exclude<Category, 'All'>;
  className?: string;
}) {
  const style = CATEGORY_STYLE[category];
  const img = ARTICLE_IMAGES[articleId];

  return (
    <div className={`relative overflow-hidden bg-gradient-to-br ${style.gradient} ${className}`} aria-hidden>
      {img && (
        <Image
          src={img.url}
          alt=""
          fill
          className="object-cover opacity-60 mix-blend-luminosity"
          sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
        />
      )}
      {/* Gradient overlay to keep brand colour */}
      <div className={`absolute inset-0 bg-gradient-to-br ${style.gradient} opacity-60`} />
      {/* Category label */}
      <div className="absolute bottom-0 left-0 right-0 p-4">
        <span className="text-xs font-bold uppercase tracking-widest text-white/50">{category}</span>
      </div>
    </div>
  );
}

// ── Category tag pill ─────────────────────────────────────────────────────────

function CategoryTag({ category }: { category: Exclude<Category, 'All'> }) {
  const style = CATEGORY_STYLE[category];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${style.tag}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${style.dot}`} />
      {category}
    </span>
  );
}

// ── Featured article card ─────────────────────────────────────────────────────

function FeaturedCard({ article }: { article: Article }) {
  return (
    <div className="group grid grid-cols-1 lg:grid-cols-2 overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm hover:shadow-lg transition-shadow duration-300">
      {/* Thumbnail */}
      <ArticleThumbnail
        articleId={article.id}
        category={article.category}
        className="aspect-[16/9] lg:aspect-auto min-h-[220px]"
      />
      {/* Content */}
      <div className="flex flex-col justify-center p-8 lg:p-10">
        <div className="mb-4 flex items-center gap-3">
          <CategoryTag category={article.category} />
          <span className="text-xs text-gray-400">{article.readTime} min read</span>
        </div>
        <h2 className="text-xl font-bold leading-snug text-[#0B1F33] group-hover:text-[#0A66C2] transition-colors sm:text-2xl">
          {article.title}
        </h2>
        <p className="mt-4 text-sm leading-relaxed text-[#6B7C93]">{article.excerpt}</p>
        <div className="mt-6">
          <Link
            href={`/blog/${article.id}`}
            className="inline-flex items-center gap-2 rounded-full bg-[#0A66C2] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#0A1F44] transition-colors"
          >
            Read Article
            <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M17 8l4 4m0 0l-4 4m4-4H3" />
            </svg>
          </Link>
        </div>
      </div>
    </div>
  );
}

// ── Article card ──────────────────────────────────────────────────────────────

function ArticleCard({ article }: { article: Article }) {
  return (
    <article className="group flex flex-col overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm hover:shadow-md hover:border-[#0A66C2]/20 transition-all duration-200">
      {/* Thumbnail */}
      <ArticleThumbnail articleId={article.id} category={article.category} className="aspect-[16/9]" />
      {/* Content */}
      <div className="flex flex-1 flex-col p-5">
        <div className="mb-3 flex items-center gap-2">
          <CategoryTag category={article.category} />
          <span className="text-xs text-gray-400">{article.readTime} min read</span>
        </div>
        <h3 className="text-base font-bold leading-snug text-[#0B1F33] group-hover:text-[#0A66C2] transition-colors">
          {article.title}
        </h3>
        <p className="mt-2 text-sm leading-relaxed text-[#6B7C93] flex-1 line-clamp-2">
          {article.excerpt}
        </p>
        <Link
          href={`/blog/${article.id}`}
          className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-[#0A66C2] hover:gap-2 transition-all"
        >
          Read More
          <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M17 8l4 4m0 0l-4 4m4-4H3" />
          </svg>
        </Link>
      </div>
    </article>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function BlogPage() {
  const [activeCategory, setActiveCategory] = useState<Category>('All');

  const featured = ARTICLES.find(a => a.featured)!;

  const filtered = useMemo(() => {
    const grid = ARTICLES.filter(a => !a.featured);
    if (activeCategory === 'All') return grid;
    return grid.filter(a => a.category === activeCategory);
  }, [activeCategory]);

  const totalByCategory = (cat: Category) =>
    cat === 'All' ? ARTICLES.length : ARTICLES.filter(a => a.category === cat).length;

  return (
    <>
      <Head>
        <title>Marketing Insights & Decision Journal — Omnivyra</title>
        <meta
          name="description"
          content="Practical marketing strategy insights, campaign optimization guides, content strategy frameworks and SEO analysis — written to help you decide, not just inform."
        />
      </Head>

      <div className="min-h-screen bg-[#F5F9FF]">

        {/* ═══════════════════════════════════════════════════════════════════
            SECTION 1 — HERO
        ════════════════════════════════════════════════════════════════════ */}
        <section className="relative overflow-hidden bg-gradient-to-br from-[#0A1F44] via-[#0A3060] to-[#0A66C2]">
          {/* Orbs */}
          <div className="pointer-events-none absolute -top-24 -left-24 h-80 w-80 rounded-full bg-[#0A66C2]/30 blur-[100px]" />
          <div className="pointer-events-none absolute top-10 right-10 h-56 w-56 rounded-full bg-[#3FA9F5]/15 blur-[80px]" />

          <div className="relative mx-auto max-w-4xl px-6 py-20 sm:py-28 text-center">
            {/* Eyebrow */}
            <div className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-4 py-1.5 text-xs font-semibold uppercase tracking-widest text-white/70 mb-8">
              Decision Intelligence Journal
            </div>

            <h1 className="text-4xl font-bold tracking-tight text-white sm:text-6xl leading-[1.1]">
              Insights for better{' '}
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#3FA9F5] to-white">
                marketing decisions
              </span>
            </h1>

            <p className="mt-6 mx-auto max-w-xl text-base text-white/70 leading-relaxed sm:text-lg">
              Clear thinking on campaigns, content strategy, and growth — so you know what to do next.
            </p>

            <p className="mt-3 text-sm text-white/40 italic">
              No hype. No noise. Just what actually helps.
            </p>

            <div className="mt-10">
              <a
                href="#latest"
                className="inline-flex items-center gap-2 rounded-full border border-white/30 bg-white/10 px-7 py-3 text-sm font-semibold text-white backdrop-blur-sm hover:bg-white/20 transition-all"
              >
                Explore latest insights
                <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </a>
            </div>
          </div>

          {/* Wave divider */}
          <div className="absolute bottom-0 left-0 right-0 overflow-hidden leading-none">
            <svg viewBox="0 0 1440 40" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="none" className="h-10 w-full fill-[#F5F9FF]">
              <path d="M0,40 C360,0 1080,0 1440,40 L1440,40 L0,40 Z" />
            </svg>
          </div>
        </section>

        <div id="latest" className="mx-auto max-w-6xl px-6 py-16 sm:py-20 space-y-16">

          {/* ═══════════════════════════════════════════════════════════════
              SECTION 2 — CATEGORY FILTER
          ════════════════════════════════════════════════════════════════ */}
          <div className="relative">
            {/* Horizontal scroll wrapper for mobile */}
            <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-hide -mx-2 px-2">
              {CATEGORIES.map(cat => {
                const isActive = activeCategory === cat;
                const count = totalByCategory(cat);
                return (
                  <button
                    key={cat}
                    onClick={() => setActiveCategory(cat)}
                    className={`flex-none whitespace-nowrap rounded-full px-4 py-2 text-sm font-semibold transition-all duration-200 ${
                      isActive
                        ? 'bg-[#0A66C2] text-white shadow-md shadow-[#0A66C2]/25'
                        : 'bg-white border border-gray-200 text-[#6B7C93] hover:border-[#0A66C2]/30 hover:text-[#0A66C2]'
                    }`}
                  >
                    {cat}
                    <span
                      className={`ml-1.5 text-xs ${isActive ? 'text-white/70' : 'text-gray-400'}`}
                    >
                      {count}
                    </span>
                  </button>
                );
              })}
            </div>
            {/* Fade edge on mobile */}
            <div className="pointer-events-none absolute right-0 top-0 h-full w-12 bg-gradient-to-l from-[#F5F9FF] sm:hidden" />
          </div>

          {/* ═══════════════════════════════════════════════════════════════
              SECTION 3 — FEATURED ARTICLE
          ════════════════════════════════════════════════════════════════ */}
          {(activeCategory === 'All' || activeCategory === featured.category) && (
            <div>
              <div className="flex items-center gap-3 mb-6">
                <span className="text-xs font-bold uppercase tracking-widest text-[#0A66C2]">Featured</span>
                <div className="flex-1 h-px bg-[#0A66C2]/15" />
              </div>
              <FeaturedCard article={featured} />
            </div>
          )}

          {/* ═══════════════════════════════════════════════════════════════
              SECTION 4 — ARTICLE GRID
          ════════════════════════════════════════════════════════════════ */}
          <div>
            <div className="flex items-center gap-3 mb-6">
              <span className="text-xs font-bold uppercase tracking-widest text-gray-400">
                {activeCategory === 'All' ? 'All Articles' : activeCategory}
              </span>
              <div className="flex-1 h-px bg-gray-200" />
              <span className="text-xs text-gray-400">{filtered.length} articles</span>
            </div>

            {filtered.length === 0 ? (
              <div className="py-16 text-center rounded-2xl bg-white border border-gray-100">
                <p className="text-[#6B7C93] font-medium">No articles in this category yet.</p>
                <button
                  onClick={() => setActiveCategory('All')}
                  className="mt-3 text-sm text-[#0A66C2] hover:underline"
                >
                  View all articles
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
                {filtered.map(article => (
                  <ArticleCard key={article.id} article={article} />
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ═══════════════════════════════════════════════════════════════════
            SECTION 5 — WHAT YOU'LL FIND HERE
        ════════════════════════════════════════════════════════════════════ */}
        <section className="bg-white border-y border-gray-100">
          <div className="mx-auto max-w-5xl px-6 py-16 sm:py-24">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-20 items-center">
              {/* Text */}
              <div>
                <div className="inline-block rounded-full bg-[#0A66C2]/10 px-4 py-1 text-xs font-semibold uppercase tracking-widest text-[#0A66C2] mb-6">
                  What This Journal Is For
                </div>
                <h2 className="text-2xl font-bold tracking-tight text-[#0B1F33] sm:text-3xl leading-snug">
                  Not for reading.
                  <br />
                  <span className="text-[#0A66C2]">For deciding.</span>
                </h2>
                <div className="mt-8 space-y-4">
                  {[
                    'Understanding what\'s working (and what\'s not)',
                    'Structuring campaigns before execution',
                    'Creating content with direction',
                    'Connecting insights across channels',
                    'Making better marketing decisions',
                  ].map((item, i) => (
                    <div key={i} className="flex items-start gap-3">
                      <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#0A66C2] to-[#3FA9F5]">
                        <svg className="h-3 w-3 text-white" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                        </svg>
                      </div>
                      <span className="text-sm text-[#6B7C93] leading-relaxed">{item}</span>
                    </div>
                  ))}
                </div>
                <div className="mt-8 rounded-2xl border-l-4 border-[#0A66C2] bg-[#F5F9FF] px-5 py-4">
                  <p className="text-sm font-medium text-[#0B1F33] leading-relaxed">
                    This is not about doing more.
                    <br />
                    It's about doing the <em className="not-italic font-bold">right</em> things.
                  </p>
                </div>
              </div>

              {/* Stats / categories visual */}
              <div className="grid grid-cols-2 gap-4">
                {(Object.keys(CATEGORY_STYLE) as Exclude<Category, 'All'>[]).map(cat => {
                  const style = CATEGORY_STYLE[cat];
                  const count = ARTICLES.filter(a => a.category === cat).length;
                  return (
                    <button
                      key={cat}
                      onClick={() => {
                        setActiveCategory(cat);
                        document.getElementById('latest')?.scrollIntoView({ behavior: 'smooth' });
                      }}
                      className={`group relative overflow-hidden rounded-2xl bg-gradient-to-br ${style.gradient} p-5 text-left hover:scale-[1.02] transition-transform`}
                    >
                      <p className="text-xs font-bold uppercase tracking-widest text-white/60 mb-2">{cat}</p>
                      <p className="text-2xl font-bold text-white">{count}</p>
                      <p className="text-xs text-white/50 mt-0.5">articles</p>
                      <div className="absolute -bottom-4 -right-4 h-16 w-16 rounded-full bg-white/5 blur-xl" />
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </section>

        {/* ═══════════════════════════════════════════════════════════════════
            SECTION 6 — CTA
        ════════════════════════════════════════════════════════════════════ */}
        <section className="relative overflow-hidden bg-gradient-to-br from-[#0A1F44] via-[#0A3060] to-[#0A66C2]">
          <div className="pointer-events-none absolute top-0 left-1/3 h-64 w-64 rounded-full bg-[#3FA9F5]/15 blur-[80px]" />
          <div className="pointer-events-none absolute bottom-0 right-1/4 h-48 w-48 rounded-full bg-white/5 blur-[60px]" />

          <div className="relative mx-auto max-w-2xl px-6 py-20 sm:py-28 text-center">
            <div className="mx-auto mb-8 h-px w-16 bg-gradient-to-r from-transparent via-white/30 to-transparent" />

            <h2 className="text-2xl font-bold tracking-tight text-white sm:text-4xl leading-snug">
              Clarity shouldn't stay{' '}
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#3FA9F5] to-white">
                theoretical
              </span>
            </h2>

            <p className="mt-5 text-base text-white/65">
              Use these marketing performance insights inside your own campaigns.
            </p>

            <div className="mt-8">
              <Link
                href="/get-free-credits"
                className="inline-flex items-center gap-2 rounded-full bg-white px-9 py-4 text-sm font-bold text-[#0A1F44] shadow-xl hover:bg-white/90 hover:scale-105 transition-all"
              >
                👉 Get Free Credits
              </Link>
            </div>

            <p className="mt-5 text-xs text-white/35">
              No credit card required · Start in minutes
            </p>

            <div className="mx-auto mt-10 h-px w-16 bg-gradient-to-r from-transparent via-white/20 to-transparent" />
          </div>
        </section>

        <Footer />
      </div>
    </>
  );
}
