'use client';

import React, { useEffect, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { BlogEditorForm, type BlogFormState } from '../../../components/blog/BlogEditorForm';
import { Loader2 } from 'lucide-react';

function useBlogAccess() {
  const [allowed, setAllowed] = useState<boolean | null>(null);
  useEffect(() => {
    fetch('/api/admin/blog', { credentials: 'include' })
      .then((res) => setAllowed(res.status === 200))
      .catch(() => setAllowed(false));
  }, []);
  return { allowed, checked: allowed !== null };
}

export default function AdminBlogNewPage() {
  const router = useRouter();
  const { allowed, checked } = useBlogAccess();
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (state: BlogFormState) => {
    setError(null);
    setIsSaving(true);
    try {
      const res = await fetch('/api/admin/blog', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: state.title,
          slug: state.slug || undefined,
          excerpt: state.excerpt || undefined,
          content_markdown: state.content_markdown,
          content_html: undefined,
          featured_image_url: state.featured_image_url || undefined,
          category: state.category || undefined,
          tags: state.tags,
          media_blocks: state.media_blocks.length ? state.media_blocks : undefined,
          seo_meta_title: state.seo_meta_title || undefined,
          seo_meta_description: state.seo_meta_description || undefined,
          status: state.status,
          is_featured: state.is_featured,
          published_at: state.status === 'published' ? new Date().toISOString() : state.published_at || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Save failed');
      router.push('/admin/blog');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setIsSaving(false);
    }
  };

  if (!checked) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <Loader2 className="h-10 w-10 animate-spin text-[#0B5ED7]" />
      </div>
    );
  }

  if (!allowed) {
    return (
      <div className="min-h-screen bg-gray-50 p-6">
        <div className="mx-auto max-w-2xl rounded-lg bg-white p-8 shadow text-center">
          <h1 className="text-xl font-bold text-gray-900">Access Denied</h1>
          <p className="mt-2 text-gray-600">Only Super Admins can create blog posts. Log in at Super Admin Login first.</p>
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
        <title>New Post | Blog CMS</title>
      </Head>
      <div className="min-h-screen bg-gray-50">
        <div className="border-b border-gray-200 bg-white px-4 py-3 sm:px-6">
          <div className="mx-auto flex max-w-5xl items-center justify-between">
            <Link href="/dashboard" className="flex shrink-0 items-center" aria-label="Home">
              <img src="/logo.png" alt="Omnivera" width={100} height={40} className="h-10 w-auto object-contain sm:h-11" />
            </Link>
            <Link href="/admin/blog" className="text-sm font-medium text-gray-600 hover:text-gray-900">
              ← Back to Blog CMS
            </Link>
          </div>
        </div>
        <div className="mx-auto max-w-3xl p-6">
          <h1 className="mb-6 text-2xl font-bold text-gray-900">New Post</h1>
          {error && (
            <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          )}
          <div className="rounded-lg border border-gray-200 bg-white p-6 shadow">
            <BlogEditorForm
              onSubmit={handleSubmit}
              onCancel={() => router.push('/admin/blog')}
              submitLabel="Create post"
              isSaving={isSaving}
            />
          </div>
        </div>
      </div>
    </>
  );
}
