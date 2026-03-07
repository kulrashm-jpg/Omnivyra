'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';

type RelatedPost = {
  id: string;
  title: string;
  slug: string;
  excerpt: string | null;
  featured_image_url: string | null;
  category: string | null;
  published_at: string | null;
};

type ReadNextSectionProps = {
  currentSlug: string;
  className?: string;
};

export function ReadNextSection({
  currentSlug,
  className = '',
}: ReadNextSectionProps) {
  const [posts, setPosts] = useState<RelatedPost[]>([]);
  const [loading, setLoading] = useState(!!currentSlug);

  useEffect(() => {
    if (!currentSlug) return;
    setLoading(true);
    fetch(`/api/blog/related?slug=${encodeURIComponent(currentSlug)}&limit=3`)
      .then((r) => r.json())
      .then((d) => setPosts(d.posts || []))
      .catch(() => setPosts([]))
      .finally(() => setLoading(false));
  }, [currentSlug]);

  if (loading || posts.length === 0) return null;

  return (
    <section className={`${className}`}>
      <h2 className="mb-6 text-xl font-bold tracking-tight text-slate-900">You might also like</h2>
      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {posts.map((post) => (
          <Link
            key={post.id}
            href={`/blog/${encodeURIComponent(post.slug)}`}
            className="group block overflow-hidden rounded-2xl border border-slate-200/60 bg-white shadow-[0_2px_12px_rgba(0,0,0,0.04)] transition-all duration-300 hover:border-[#0B5ED7]/40 hover:shadow-[0_8px_24px_rgba(0,0,0,0.1)]"
          >
            <div className="relative aspect-[16/9] w-full overflow-hidden bg-slate-100">
              {post.featured_image_url ? (
                <>
                  <img
                    src={post.featured_image_url}
                    alt=""
                    className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.05]"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/10 to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" aria-hidden />
                </>
              ) : (
                <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-slate-100 to-slate-200">
                  <div className="h-10 w-10 rounded-full border-2 border-dashed border-slate-300" />
                </div>
              )}
            </div>
            <div className="p-5">
              {post.category && (
                <span className="text-xs font-semibold uppercase tracking-wider text-[#0B5ED7]">
                  {post.category}
                </span>
              )}
              <h3 className="mt-1.5 line-clamp-2 font-semibold text-slate-900 transition-colors group-hover:text-[#0B5ED7]">
                {post.title}
              </h3>
              {post.excerpt && (
                <p className="mt-2 line-clamp-2 text-sm text-slate-600">{post.excerpt}</p>
              )}
              {post.published_at && (
                <time
                  dateTime={post.published_at}
                  className="mt-3 block text-xs text-slate-500"
                >
                  {new Date(post.published_at).toLocaleDateString('en-US', {
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric',
                  })}
                </time>
              )}
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}
