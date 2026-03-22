/**
 * /company-blog
 *
 * Public-facing listing of a company's published blog posts.
 * Fetches from /api/blogs/public?company_id=<id>.
 * Rendered server-side compatible — no auth required to view.
 */

import React, { useEffect, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { Loader2, Calendar, ArrowRight, BookOpen } from 'lucide-react';
import LandingNavbar from '../../components/landing/LandingNavbar';

interface BlogListing {
  id:                 string;
  title:              string;
  slug:               string | null;
  excerpt:            string | null;
  featured_image_url: string | null;
  category:           string | null;
  tags:               string[];
  published_at:       string | null;
  is_featured:        boolean;
}

function formatDate(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

const PAGE_SIZE = 12;

export default function CompanyBlogIndex() {
  const router = useRouter();
  const { company_id } = router.query;

  const [blogs,    setBlogs]    = useState<BlogListing[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error,    setError]    = useState<string | null>(null);
  const [page,     setPage]     = useState(1);
  const [hasMore,  setHasMore]  = useState(false);

  const fetchPage = (cid: string, p: number, append: boolean) => {
    if (p === 1) setLoading(true); else setLoadingMore(true);
    fetch(`/api/blogs/public?company_id=${encodeURIComponent(cid)}&page=${p}`)
      .then((r) => r.ok ? r.json() : Promise.reject(new Error('Failed')))
      .then((d) => {
        const incoming = Array.isArray(d.blogs) ? d.blogs : [];
        setBlogs((prev) => append ? [...prev, ...incoming] : incoming);
        setHasMore(d.pagination?.has_more ?? false);
      })
      .catch(() => setError('Could not load blog posts.'))
      .finally(() => { setLoading(false); setLoadingMore(false); });
  };

  useEffect(() => {
    const cid = typeof company_id === 'string' ? company_id : null;
    if (!cid) return;
    setPage(1);
    fetchPage(cid, 1, false);
  }, [company_id]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadMore = () => {
    const cid = typeof company_id === 'string' ? company_id : null;
    if (!cid || loadingMore) return;
    const next = page + 1;
    setPage(next);
    fetchPage(cid, next, true);
  };

  const featured = blogs.find((b) => b.is_featured) ?? null;
  const rest     = blogs.filter((b) => !b.is_featured);

  const blogUrl = (b: BlogListing) =>
    b.slug
      ? `/company-blog/${b.slug}?company_id=${company_id}`
      : `/company-blog/${b.id}?company_id=${company_id}`;

  return (
    <>
      <Head>
        <title>Blog</title>
        <meta name="description" content="Latest articles and insights" />
      </Head>
      <LandingNavbar />

      <main className="min-h-screen bg-white">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-16">

          {/* Header */}
          <div className="mb-12">
            <p className="text-[10px] font-bold uppercase tracking-widest text-[#0A66C2] mb-2">Blog</p>
            <h1 className="text-3xl sm:text-4xl font-bold text-gray-900 leading-tight">
              Ideas, insights &amp; strategies
            </h1>
          </div>

          {/* Loading */}
          {loading && (
            <div className="flex items-center justify-center py-24 text-gray-400 gap-2">
              <Loader2 className="h-5 w-5 animate-spin" />
              <span className="text-sm">Loading…</span>
            </div>
          )}

          {/* Error */}
          {!loading && error && (
            <p className="py-12 text-center text-sm text-red-500">{error}</p>
          )}

          {/* Empty */}
          {!loading && !error && blogs.length === 0 && (
            <div className="flex flex-col items-center justify-center py-24 text-gray-400 gap-4">
              <BookOpen className="h-8 w-8" />
              <p className="text-sm">No published posts yet.</p>
              <Link
                href="/blogs"
                className="inline-flex items-center gap-1.5 rounded-full bg-[#0A66C2] px-4 py-2 text-xs font-semibold text-white hover:bg-[#0A66C2]/90 transition-colors"
              >
                Create your first blog
              </Link>
            </div>
          )}

          {/* Featured post */}
          {!loading && !error && featured && (
            <Link
              href={blogUrl(featured)}
              className="group mb-12 block overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm hover:shadow-md transition-shadow"
            >
              {featured.featured_image_url && (
                <div className="h-64 sm:h-80 w-full overflow-hidden">
                  <img
                    src={featured.featured_image_url}
                    alt={featured.title}
                    className="h-full w-full object-cover group-hover:scale-105 transition-transform duration-500"
                  />
                </div>
              )}
              <div className="p-6 sm:p-8">
                {featured.category && (
                  <span className="mb-3 inline-block rounded-full bg-[#0A66C2]/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-[#0A66C2]">
                    {featured.category}
                  </span>
                )}
                <h2 className="text-2xl font-bold text-gray-900 leading-tight mb-3 group-hover:text-[#0A66C2] transition-colors">
                  {featured.title}
                </h2>
                {featured.excerpt && (
                  <p className="text-gray-500 leading-relaxed mb-4 line-clamp-3">{featured.excerpt}</p>
                )}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-xs text-gray-400">
                    <Calendar className="h-3.5 w-3.5" />
                    {formatDate(featured.published_at)}
                  </div>
                  <span className="inline-flex items-center gap-1 text-xs font-semibold text-[#0A66C2] group-hover:gap-2 transition-all">
                    Read article <ArrowRight className="h-3.5 w-3.5" />
                  </span>
                </div>
              </div>
            </Link>
          )}

          {/* Post grid */}
          {!loading && !error && rest.length > 0 && (
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {rest.map((b) => (

                <Link
                  key={b.id}
                  href={blogUrl(b)}
                  className="group flex flex-col overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm hover:shadow-md transition-shadow"
                >
                  {b.featured_image_url ? (
                    <div className="h-44 overflow-hidden">
                      <img
                        src={b.featured_image_url}
                        alt={b.title}
                        className="h-full w-full object-cover group-hover:scale-105 transition-transform duration-500"
                      />
                    </div>
                  ) : (
                    <div className="h-44 bg-gradient-to-br from-[#0A66C2]/10 to-indigo-50 flex items-center justify-center">
                      <BookOpen className="h-8 w-8 text-[#0A66C2]/30" />
                    </div>
                  )}

                  <div className="flex flex-1 flex-col p-5">
                    {b.category && (
                      <span className="mb-2 text-[10px] font-bold uppercase tracking-widest text-[#0A66C2]">
                        {b.category}
                      </span>
                    )}
                    <h2 className="text-sm font-bold text-gray-900 leading-snug line-clamp-2 mb-2 group-hover:text-[#0A66C2] transition-colors">
                      {b.title}
                    </h2>
                    {b.excerpt && (
                      <p className="text-xs text-gray-500 leading-relaxed line-clamp-3 mb-4 flex-1">
                        {b.excerpt}
                      </p>
                    )}
                    <div className="flex items-center gap-1.5 text-[10px] text-gray-400 mt-auto">
                      <Calendar className="h-3 w-3" />
                      {formatDate(b.published_at)}
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}

          {/* Load more */}
          {!loading && !error && hasMore && (
            <div className="mt-10 flex justify-center">
              <button
                onClick={loadMore}
                disabled={loadingMore}
                className="inline-flex items-center gap-2 rounded-full border border-gray-200 bg-white px-6 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-60 transition-colors shadow-sm"
              >
                {loadingMore ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {loadingMore ? 'Loading…' : 'Load more'}
              </button>
            </div>
          )}

        </div>
      </main>
    </>
  );
}
