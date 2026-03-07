'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Heart } from 'lucide-react';

const FINGERPRINT_KEY = 'blog_like_fp';

function getOrCreateFingerprint(): string {
  if (typeof window === 'undefined') return '';
  let fp = localStorage.getItem(FINGERPRINT_KEY);
  if (!fp) {
    fp = `fp_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`;
    localStorage.setItem(FINGERPRINT_KEY, fp);
  }
  return fp;
}

type BlogLikeButtonProps = {
  slug: string;
  initialCount?: number;
  className?: string;
};

export function BlogLikeButton({
  slug,
  initialCount = 0,
  className = '',
}: BlogLikeButtonProps) {
  const [count, setCount] = useState(initialCount);
  const [liked, setLiked] = useState(false);
  const [loading, setLoading] = useState(false);

  const fetchLikes = useCallback(() => {
    if (!slug) return;
    const fp = getOrCreateFingerprint();
    const url = fp
      ? `/api/blog/${encodeURIComponent(slug)}/like?fingerprint=${encodeURIComponent(fp)}`
      : `/api/blog/${encodeURIComponent(slug)}/like`;
    fetch(url)
      .then((r) => r.json())
      .then((d) => {
        if (typeof d.likesCount === 'number') setCount(d.likesCount);
        if (typeof d.hasLiked === 'boolean') setLiked(d.hasLiked);
      })
      .catch(() => {});
  }, [slug]);

  useEffect(() => {
    fetchLikes();
  }, [fetchLikes]);

  const handleLike = useCallback(() => {
    if (!slug || loading) return;
    setLoading(true);
    const fingerprint = getOrCreateFingerprint();
    fetch(`/api/blog/${encodeURIComponent(slug)}/like`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fingerprint }),
    })
      .then((r) => r.json())
      .then((d) => {
        if (typeof d.likesCount === 'number') setCount(d.likesCount);
        if (typeof d.liked === 'boolean') setLiked(d.liked);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [slug, loading]);

  return (
    <button
      type="button"
      onClick={handleLike}
      disabled={loading}
      className={`inline-flex items-center gap-2 rounded-full border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition hover:border-[#0B5ED7] hover:bg-[#F5F9FF] hover:text-[#0B5ED7] disabled:opacity-60 ${className}`}
      aria-label={liked ? 'Unlike' : 'Like this post'}
    >
      <Heart
        className={`h-4 w-4 ${liked ? 'fill-red-500 text-red-500' : ''}`}
      />
      <span>{count}</span>
    </button>
  );
}
