'use client';

import React, { useEffect, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { FileText, Plus, Edit, Trash2, Eye, Loader2 } from 'lucide-react';

type BlogRow = {
  id: string;
  title: string;
  slug: string;
  excerpt: string | null;
  category: string | null;
  status: string;
  is_featured: boolean;
  published_at: string | null;
  views_count: number;
  created_at: string;
};

export default function AdminBlogListPage() {
  const [posts, setPosts] = useState<BlogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [accessDenied, setAccessDenied] = useState(false);

  // Use blog API as source of truth: 200 = super admin (cookie or role), 403 = denied
  useEffect(() => {
    setLoading(true);
    setAccessDenied(false);
    setError(null);
    fetch('/api/admin/blog', { credentials: 'include' })
      .then(async (res) => {
        if (res.status === 403) {
          setAccessDenied(true);
          return null;
        }
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          const msg = data?.error || res.statusText || 'Failed to load';
          throw new Error(msg);
        }
        return data;
      })
      .then((data) => {
        if (data?.posts) setPosts(data.posts);
      })
      .catch((err) => setError(err?.message || 'Failed to load'))
      .finally(() => setLoading(false));
  }, []);

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this post?')) return;
    setDeletingId(id);
    try {
      const res = await fetch(`/api/admin/blog/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Delete failed');
      setPosts((prev) => prev.filter((p) => p.id !== id));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed');
    } finally {
      setDeletingId(null);
    }
  };

  if (loading && !accessDenied) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <Loader2 className="h-10 w-10 animate-spin text-[#0B5ED7]" />
      </div>
    );
  }

  if (accessDenied) {
    return (
      <div className="min-h-screen bg-gray-50 p-6">
        <div className="mx-auto max-w-2xl rounded-lg bg-white p-8 shadow text-center">
          <h1 className="text-xl font-bold text-gray-900">Access Denied</h1>
          <p className="mt-2 text-gray-600">Only Super Admins can manage the blog. Log in at Super Admin Login first.</p>
          <Link href="/super-admin/login" className="mt-4 inline-block text-[#0B5ED7] hover:underline">
            Go to Super Admin Login
          </Link>
        </div>
      </div>
    );
  }

  return (
    <>
      <Head>
        <title>Blog CMS | Admin</title>
      </Head>
      <div className="min-h-screen bg-gray-50">
        {/* Top bar: logo (home) + back link */}
        <div className="border-b border-gray-200 bg-white px-4 py-3 sm:px-6">
          <div className="mx-auto flex max-w-5xl items-center justify-between">
            <Link href="/dashboard" className="flex shrink-0 items-center" aria-label="Home">
              <img
                src="/logo.png"
                alt="Omnivera"
                width={100}
                height={40}
                className="h-10 w-auto object-contain sm:h-11"
              />
            </Link>
            <Link
              href="/super-admin/dashboard"
              className="text-sm font-medium text-gray-600 hover:text-gray-900"
            >
              ← Back to Dashboard
            </Link>
          </div>
        </div>

        <div className="mx-auto max-w-5xl p-6">
          <div className="mb-8 flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Blog CMS</h1>
              <p className="text-sm text-gray-600">Create and manage thought leadership posts.</p>
            </div>
            <Link
              href="/admin/blog/new"
              className="inline-flex items-center gap-2 rounded-lg bg-[#0B5ED7] px-4 py-2.5 text-sm font-semibold text-white hover:opacity-90"
            >
              <Plus className="h-4 w-4" /> New Post
            </Link>
          </div>

          {error && (
            <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              <p className="font-medium">{error}</p>
              {(error.includes('does not exist') || error.toLowerCase().includes('public_blogs')) && (
                <p className="mt-2 text-red-600">
                  Run the blog table migration in Supabase: open <code className="rounded bg-red-100 px-1">database/public_blogs.sql</code> in your project and execute it in the Supabase SQL Editor.
                </p>
              )}
            </div>
          )}

          <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow">
            <table className="min-w-full text-sm">
              <thead className="border-b bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left font-medium text-gray-700">Title</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-700">Category</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-700">Status</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-700">Featured</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-700">Views</th>
                  <th className="px-4 py-3 text-right font-medium text-gray-700">Actions</th>
                </tr>
              </thead>
              <tbody>
                {posts.map((post) => (
                  <tr key={post.id} className="border-b border-gray-100">
                    <td className="px-4 py-3">
                      <span className="font-medium text-gray-900">{post.title}</span>
                    </td>
                    <td className="px-4 py-3 text-gray-600">{post.category || '—'}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                          post.status === 'published'
                            ? 'bg-green-100 text-green-800'
                            : post.status === 'scheduled'
                            ? 'bg-amber-100 text-amber-800'
                            : 'bg-gray-100 text-gray-700'
                        }`}
                      >
                        {post.status}
                      </span>
                    </td>
                    <td className="px-4 py-3">{post.is_featured ? 'Yes' : '—'}</td>
                    <td className="px-4 py-3 text-gray-600">{post.views_count ?? 0}</td>
                    <td className="px-4 py-3 text-right">
                      {post.status === 'published' && (
                        <a
                          href={`/blog/${encodeURIComponent(post.slug)}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="mr-2 inline-flex text-gray-500 hover:text-gray-700"
                          title="View"
                        >
                          <Eye className="h-4 w-4" />
                        </a>
                      )}
                      <Link
                        href={`/admin/blog/edit/${post.id}`}
                        className="mr-2 inline-flex text-gray-500 hover:text-[#0B5ED7]"
                        title="Edit"
                      >
                        <Edit className="h-4 w-4" />
                      </Link>
                      <button
                        type="button"
                        onClick={() => handleDelete(post.id)}
                        disabled={deletingId === post.id}
                        className="inline-flex text-gray-500 hover:text-red-600 disabled:opacity-50"
                        title="Delete"
                      >
                        {deletingId === post.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Trash2 className="h-4 w-4" />
                        )}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {posts.length === 0 && (
              <div className="flex flex-col items-center justify-center py-16 text-gray-500">
                <FileText className="mb-4 h-12 w-12" />
                <p>No posts yet.</p>
                <Link href="/admin/blog/new" className="mt-2 text-[#0B5ED7] hover:underline">
                  Create your first post
                </Link>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
