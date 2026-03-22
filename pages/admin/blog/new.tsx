'use client';

import React, { useEffect, useRef, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { BlogEditorForm, type BlogFormState } from '../../../components/blog/BlogEditorForm';
import { BlogQualityPanel } from '../../../components/blog/BlogQualityPanel';
import { createDefaultBlogTemplate } from '../../../lib/blog/blogTemplate';
import { checkDuplication, type DuplicationResult, type ExistingPostMeta } from '../../../lib/blog/topicDetection';
import { AlertTriangle, XCircle, Loader2 } from 'lucide-react';

function useBlogAccess() {
  const [allowed, setAllowed] = useState<boolean | null>(null);
  useEffect(() => {
    fetch('/api/admin/blog', { credentials: 'include' })
      .then((res) => setAllowed(res.status === 200))
      .catch(() => setAllowed(false));
  }, []);
  return { allowed, checked: allowed !== null };
}

const DEFAULT_TEMPLATE = createDefaultBlogTemplate();

export default function AdminBlogNewPage() {
  const router = useRouter();
  const { allowed, checked } = useBlogAccess();
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [liveState, setLiveState] = useState<BlogFormState | null>(null);

  // Duplication detection
  const [existingPosts, setExistingPosts] = useState<ExistingPostMeta[]>([]);
  const [dupResult, setDupResult] = useState<DuplicationResult | null>(null);
  const dupTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Fetch existing posts once for duplication checking
  useEffect(() => {
    fetch('/api/admin/blog', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (Array.isArray(data?.posts)) {
          setExistingPosts(
            data.posts.map((p: { id: string; title: string; slug: string; tags: string[]; category: string }) => ({
              id: p.id, title: p.title, slug: p.slug, tags: p.tags ?? [], category: p.category ?? '',
            })),
          );
        }
      })
      .catch(() => {});
  }, []);

  // Debounced duplication check whenever title or tags change
  useEffect(() => {
    const title = liveState?.title?.trim() ?? '';
    const tags  = liveState?.tags ?? [];

    if (dupTimerRef.current) clearTimeout(dupTimerRef.current);

    if (title.length < 6 || existingPosts.length === 0) {
      setDupResult(null);
      return;
    }

    dupTimerRef.current = setTimeout(() => {
      const result = checkDuplication(title, tags, existingPosts);
      setDupResult(result.status === 'new' ? null : result);
    }, 600);

    return () => { if (dupTimerRef.current) clearTimeout(dupTimerRef.current); };
  }, [liveState?.title, liveState?.tags, existingPosts]);

  const handleSubmit = async (state: BlogFormState) => {
    setError(null);
    setIsSaving(true);
    try {
      const res = await fetch('/api/admin/blog', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title:                state.title,
          slug:                 state.slug || undefined,
          excerpt:              state.excerpt || undefined,
          content_markdown:     state.content_markdown,
          content_html:         undefined,
          content_blocks:       state.content_blocks.length ? state.content_blocks : undefined,
          featured_image_url:   state.featured_image_url || undefined,
          category:             state.category || undefined,
          tags:                 state.tags,
          media_blocks:         state.media_blocks.length ? state.media_blocks : undefined,
          seo_meta_title:       state.seo_meta_title || undefined,
          seo_meta_description: state.seo_meta_description || undefined,
          status:               state.status,
          is_featured:          state.is_featured,
          published_at:         state.status === 'published' ? new Date().toISOString() : state.published_at || undefined,
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
          <div className="mx-auto flex max-w-[1200px] items-center justify-between">
            <Link href="/dashboard" className="flex shrink-0 items-center" aria-label="Home">
              <img src="/logo.png" alt="Omnivera" width={100} height={40} className="h-10 w-auto object-contain sm:h-11" />
            </Link>
            <Link href="/admin/blog" className="text-sm font-medium text-gray-600 hover:text-gray-900">
              ← Back to Blog CMS
            </Link>
          </div>
        </div>

        <div className="mx-auto max-w-[1200px] p-6">
          <h1 className="mb-6 text-2xl font-bold text-gray-900">New Post</h1>
          {error && (
            <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          )}

          {/* ── Duplication warning ────────────────────────────────────── */}
          {dupResult && (
            <div className={`mb-4 rounded-lg border px-4 py-3 text-sm flex gap-3 items-start ${
              dupResult.status === 'duplicate'
                ? 'border-red-300 bg-red-50 text-red-800'
                : 'border-amber-300 bg-amber-50 text-amber-800'
            }`}>
              {dupResult.status === 'duplicate'
                ? <XCircle className="h-4 w-4 mt-0.5 shrink-0" />
                : <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />}
              <div>
                <p className="font-semibold">
                  {dupResult.status === 'duplicate'
                    ? 'Possible duplicate topic detected'
                    : 'Similar content already exists'}
                </p>
                <ul className="mt-1 space-y-0.5">
                  {dupResult.matchedTitles.slice(0, 3).map((m) => (
                    <li key={m.slug}>
                      <Link
                        href={`/blog/${m.slug}`}
                        target="_blank"
                        className="underline hover:opacity-75"
                      >
                        {m.title}
                      </Link>
                      <span className="ml-2 opacity-60">({Math.round(m.sim * 100)}% overlap)</span>
                    </li>
                  ))}
                </ul>
                <p className="mt-1 opacity-70 text-xs">
                  Consider differentiating your angle, linking to the existing post, or merging content.
                </p>
              </div>
            </div>
          )}

          <div className="flex gap-6 items-start">
            {/* ── Editor ─────────────────────────────────────────────────── */}
            <div className="flex-1 min-w-0 rounded-lg border border-gray-200 bg-white p-6 shadow">
              <BlogEditorForm
                initial={{ content_blocks: DEFAULT_TEMPLATE }}
                onSubmit={handleSubmit}
                onCancel={() => router.push('/admin/blog')}
                submitLabel="Create post"
                isSaving={isSaving}
                onStateChange={setLiveState}
              />
            </div>

            {/* ── Quality panel (sticky right sidebar) ────────────────────── */}
            <div className="hidden xl:block w-[280px] shrink-0 sticky top-6 self-start">
              {liveState && (
                <BlogQualityPanel
                  blocks={liveState.content_blocks}
                  formState={{
                    title:                liveState.title,
                    excerpt:              liveState.excerpt,
                    seo_meta_title:       liveState.seo_meta_title,
                    seo_meta_description: liveState.seo_meta_description,
                    tags:                 liveState.tags,
                  }}
                />
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
