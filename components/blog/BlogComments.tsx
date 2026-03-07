'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { MessageSquare, Send } from 'lucide-react';

type Comment = {
  id: string;
  authorName: string;
  content: string;
  createdAt: string;
};

type BlogCommentsProps = {
  slug: string;
  className?: string;
};

export function BlogComments({ slug, className = '' }: BlogCommentsProps) {
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [authorName, setAuthorName] = useState('');
  const [authorEmail, setAuthorEmail] = useState('');
  const [content, setContent] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const fetchComments = useCallback(() => {
    if (!slug) return;
    setLoading(true);
    fetch(`/api/blog/${encodeURIComponent(slug)}/comments`)
      .then((r) => r.json())
      .then((d) => {
        setComments(d.comments || []);
      })
      .catch(() => setComments([]))
      .finally(() => setLoading(false));
  }, [slug]);

  useEffect(() => {
    fetchComments();
  }, [fetchComments]);

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (!slug || submitting) return;
      setError(null);
      setSubmitting(true);
      fetch(`/api/blog/${encodeURIComponent(slug)}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          author_name: authorName.trim(),
          author_email: authorEmail.trim(),
          content: content.trim(),
        }),
      })
        .then((r) => {
          if (!r.ok) return r.json().then((d) => Promise.reject(new Error(d.error || 'Failed to post comment')));
          return r.json();
        })
        .then((d) => {
          setSuccess(true);
          setContent('');
          setComments((prev) => [...prev, d.comment]);
          setTimeout(() => setSuccess(false), 3000);
        })
        .catch((err) => setError(err.message))
        .finally(() => setSubmitting(false));
    },
    [slug, submitting, authorName, authorEmail, content]
  );

  return (
    <section className={`rounded-2xl border border-gray-200 bg-white p-6 sm:p-8 ${className}`}>
      <h2 className="flex items-center gap-2 text-xl font-bold text-gray-900">
        <MessageSquare className="h-5 w-5 text-[#0B5ED7]" />
        Comments ({comments.length})
      </h2>

      <form onSubmit={handleSubmit} className="mt-6 space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <input
            type="text"
            placeholder="Your name"
            value={authorName}
            onChange={(e) => setAuthorName(e.target.value)}
            required
            className="rounded-lg border border-gray-200 px-4 py-3 text-sm focus:border-[#0B5ED7] focus:outline-none focus:ring-1 focus:ring-[#0B5ED7]"
          />
          <input
            type="email"
            placeholder="Your email"
            value={authorEmail}
            onChange={(e) => setAuthorEmail(e.target.value)}
            required
            className="rounded-lg border border-gray-200 px-4 py-3 text-sm focus:border-[#0B5ED7] focus:outline-none focus:ring-1 focus:ring-[#0B5ED7]"
          />
        </div>
        <textarea
          placeholder="Write a comment..."
          value={content}
          onChange={(e) => setContent(e.target.value)}
          required
          rows={4}
          className="w-full rounded-lg border border-gray-200 px-4 py-3 text-sm focus:border-[#0B5ED7] focus:outline-none focus:ring-1 focus:ring-[#0B5ED7]"
        />
        {error && <p className="text-sm text-red-600">{error}</p>}
        {success && <p className="text-sm text-green-600">Comment posted successfully!</p>}
        <button
          type="submit"
          disabled={submitting}
          className="inline-flex items-center gap-2 rounded-lg bg-[#0B5ED7] px-5 py-2.5 text-sm font-medium text-white transition hover:bg-[#0a54c4] disabled:opacity-60"
        >
          <Send className="h-4 w-4" />
          {submitting ? 'Posting...' : 'Post Comment'}
        </button>
      </form>

      <div className="mt-8 space-y-6">
        {loading ? (
          <p className="text-sm text-gray-500">Loading comments...</p>
        ) : comments.length === 0 ? (
          <p className="text-sm text-gray-500">No comments yet. Be the first to share your thoughts!</p>
        ) : (
          comments.map((c) => (
            <div key={c.id} className="border-b border-gray-100 pb-4 last:border-0 last:pb-0">
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-medium text-gray-900">{c.authorName}</span>
                <time
                  dateTime={c.createdAt}
                  className="text-xs text-gray-500"
                >
                  {new Date(c.createdAt).toLocaleDateString('en-US', {
                    year: 'numeric',
                    month: 'short',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </time>
              </div>
              <p className="mt-1 whitespace-pre-wrap text-sm text-gray-600">{c.content}</p>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
