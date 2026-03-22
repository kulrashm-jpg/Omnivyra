'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { BookOpen, ChevronRight, ChevronLeft, CheckCircle2 } from 'lucide-react';

interface SeriesPost {
  position: number;
  blog_id:  string;
  title:    string;
  slug:     string;
  excerpt:  string | null;
}

interface SeriesData {
  id:          string;
  title:       string;
  description: string | null;
  posts:       SeriesPost[];
}

interface Props {
  currentSlug: string;
  className?:  string;
}

export function BlogSeriesWidget({ currentSlug, className = '' }: Props) {
  const [series, setSeries] = useState<SeriesData | null>(null);
  const [currentPos, setCurrentPos] = useState(0);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!currentSlug) return;
    fetch(`/api/blog/${encodeURIComponent(currentSlug)}/series`)
      .then((r) => r.json())
      .then((d) => {
        if (d.series) {
          setSeries(d.series);
          setCurrentPos(d.currentPosition ?? 0);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [currentSlug]);

  if (loading || !series || series.posts.length < 2) return null;

  const total    = series.posts.length;
  const partNum  = currentPos + 1;
  const prevPost = series.posts.find((p) => p.position === currentPos - 1) ?? null;
  const nextPost = series.posts.find((p) => p.position === currentPos + 1) ?? null;

  return (
    <div className={`overflow-hidden rounded-2xl border border-[#0A66C2]/20 bg-gradient-to-br from-[#F5F9FF] to-white ${className}`}>
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 border-b border-[#0A66C2]/10 bg-[#0A66C2]/5 px-5 py-3">
        <BookOpen className="h-4 w-4 shrink-0 text-[#0A66C2]" />
        <div className="flex-1 min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-widest text-[#0A66C2]">
            Reading Series · Part {partNum} of {total}
          </p>
          <p className="text-sm font-semibold text-[#0B1F33] leading-snug truncate">
            {series.title}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          className="shrink-0 text-xs font-medium text-[#0A66C2] hover:underline"
        >
          {expanded ? 'Hide' : 'View all'}
        </button>
      </div>

      {/* ── Expanded post list ───────────────────────────────────────────────── */}
      {expanded && (
        <ol className="px-5 py-3 space-y-1 border-b border-[#0A66C2]/10">
          {series.posts.map((post) => {
            const isCurrent = post.slug === currentSlug;
            const isPast    = post.position < currentPos;
            return (
              <li key={post.blog_id}>
                {isCurrent ? (
                  <div className="flex items-start gap-2.5 py-1.5">
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#0A66C2] text-[10px] font-bold text-white mt-0.5">
                      {post.position + 1}
                    </span>
                    <span className="text-sm font-semibold text-[#0A66C2] leading-snug">
                      {post.title}
                      <span className="ml-2 text-[10px] font-normal text-[#0A66C2]/60">(you are here)</span>
                    </span>
                  </div>
                ) : (
                  <Link
                    href={`/blog/${encodeURIComponent(post.slug)}`}
                    className="flex items-start gap-2.5 rounded-lg py-1.5 hover:bg-[#0A66C2]/5 transition-colors"
                  >
                    {isPast ? (
                      <CheckCircle2 className="h-5 w-5 shrink-0 text-green-500 mt-0.5" />
                    ) : (
                      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-gray-100 text-[10px] font-bold text-gray-500 mt-0.5">
                        {post.position + 1}
                      </span>
                    )}
                    <span className="text-sm text-[#3D4F61] hover:text-[#0A66C2] leading-snug transition-colors">
                      {post.title}
                    </span>
                  </Link>
                )}
              </li>
            );
          })}
        </ol>
      )}

      {/* ── Prev / Next navigation ───────────────────────────────────────────── */}
      <div className="flex items-stretch divide-x divide-[#0A66C2]/10">
        {prevPost ? (
          <Link
            href={`/blog/${encodeURIComponent(prevPost.slug)}`}
            className="flex flex-1 items-center gap-2 px-4 py-3 text-sm hover:bg-[#0A66C2]/5 transition-colors"
          >
            <ChevronLeft className="h-4 w-4 shrink-0 text-[#0A66C2]" />
            <span className="min-w-0">
              <span className="block text-[10px] font-semibold uppercase tracking-wider text-[#0A66C2]">Previous</span>
              <span className="block text-xs text-[#3D4F61] line-clamp-1 mt-0.5">{prevPost.title}</span>
            </span>
          </Link>
        ) : (
          <div className="flex-1" />
        )}
        {nextPost && (
          <Link
            href={`/blog/${encodeURIComponent(nextPost.slug)}`}
            className="flex flex-1 items-center justify-end gap-2 px-4 py-3 text-sm hover:bg-[#0A66C2]/5 transition-colors"
          >
            <span className="min-w-0 text-right">
              <span className="block text-[10px] font-semibold uppercase tracking-wider text-[#0A66C2]">Up Next</span>
              <span className="block text-xs text-[#3D4F61] line-clamp-1 mt-0.5">{nextPost.title}</span>
            </span>
            <ChevronRight className="h-4 w-4 shrink-0 text-[#0A66C2]" />
          </Link>
        )}
      </div>
    </div>
  );
}
