'use client';

import React, { useEffect, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { BlogEditorForm, type BlogFormState } from '../../../../components/blog/BlogEditorForm';
import { BlogQualityPanel, type ImproveArea } from '../../../../components/blog/BlogQualityPanel';
import { Loader2 } from 'lucide-react';
import type { MediaBlockItem } from '../../../../components/blog/BlogMediaBlock';
import type { ContentBlock } from '../../../../lib/blog/blockTypes';

function useBlogAccess() {
  const [allowed, setAllowed] = useState<boolean | null>(null);
  useEffect(() => {
    fetch('/api/admin/blog', { credentials: 'include' })
      .then((res) => setAllowed(res.status === 200))
      .catch(() => setAllowed(false));
  }, []);
  return { allowed, checked: allowed !== null };
}

export default function AdminBlogEditPage() {
  const router = useRouter();
  const id = router.query.id as string | undefined;
  const { allowed, checked } = useBlogAccess();
  const [post, setPost] = useState<Record<string, unknown> | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [liveState, setLiveState] = useState<BlogFormState | null>(null);
  const [editorPatch, setEditorPatch] = useState<Partial<BlogFormState> | null>(null);
  const [improvingArea, setImprovingArea] = useState<ImproveArea | null>(null);

  const jumpToImproveArea = (area: ImproveArea) => {
    const byArea: Record<ImproveArea, { sectionId: string; focusId?: string }> = {
      structure: { sectionId: 'blog-section-content' },
      depth:     { sectionId: 'blog-section-content' },
      geo:       { sectionId: 'blog-section-content' },
      linking:   { sectionId: 'blog-section-content' },
      seo:       { sectionId: 'blog-section-seo', focusId: 'blog-input-seo-title' },
    };

    const target = byArea[area];
    const sectionEl = document.getElementById(target.sectionId);
    if (sectionEl) sectionEl.scrollIntoView({ behavior: 'smooth', block: 'center' });

    if (target.focusId) {
      const inputEl = document.getElementById(target.focusId) as HTMLInputElement | HTMLTextAreaElement | null;
      if (inputEl) window.setTimeout(() => inputEl.focus(), 280);
    }
  };

  const autoImproveArea = async (area: ImproveArea) => {
    if (!liveState || improvingArea) return;
    setImprovingArea(area);
    setError(null);

    try {
      const fallbackCompanyId = typeof window !== 'undefined' ? (localStorage.getItem('selected_company_id') || '') : '';
      const companyId = (typeof post?.company_id === 'string' ? post.company_id : fallbackCompanyId);
      if (!companyId) {
        jumpToImproveArea(area);
        setError('Company context is required for AI improvement.');
        return;
      }

      const resp = await fetch('/api/content/improve-draft', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company_id: companyId,
          area,
          contentType: 'blog',
          draft: {
            title: liveState.title,
            excerpt: liveState.excerpt,
            seo_meta_title: liveState.seo_meta_title,
            seo_meta_description: liveState.seo_meta_description,
            tags: liveState.tags,
            content_blocks: liveState.content_blocks,
          },
        }),
      });

      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(data?.error || 'AI improvement failed');

      const updated = data?.updated as Partial<BlogFormState> | undefined;
      if (updated) {
        setEditorPatch({
          title: typeof updated.title === 'string' ? updated.title : liveState.title,
          excerpt: typeof updated.excerpt === 'string' ? updated.excerpt : liveState.excerpt,
          seo_meta_title: typeof updated.seo_meta_title === 'string' ? updated.seo_meta_title : liveState.seo_meta_title,
          seo_meta_description: typeof updated.seo_meta_description === 'string' ? updated.seo_meta_description : liveState.seo_meta_description,
          tags: Array.isArray(updated.tags) ? updated.tags : liveState.tags,
          content_blocks: Array.isArray(updated.content_blocks)
            ? updated.content_blocks
            : liveState.content_blocks,
        });
      }

      const delta = Number(data?.scoreDelta || 0);
      const after = Number(data?.afterScore || 0);
      if (delta > 0) {
        setError(null);
      }
      jumpToImproveArea(area);
      if (delta <= 0) {
        setError(`AI improvements applied for ${area}. Score is ${after}/100 — run again or adjust manually for bigger gains.`);
      }
    } catch (e) {
      jumpToImproveArea(area);
      setError(e instanceof Error ? e.message : 'AI improvement failed');
    } finally {
      setImprovingArea(null);
    }
  };

  useEffect(() => {
    if (!id || !allowed) return;
    fetch(`/api/admin/blog/${id}`, { credentials: 'include' })
      .then((res) => {
        if (res.status === 403) throw new Error('Not authorized');
        if (res.status === 404) throw new Error('Post not found');
        return res.json();
      })
      .then(setPost)
      .catch((e) => setLoadError(e?.message || 'Failed to load'));
  }, [id, allowed]);

  const handleSubmit = async (state: BlogFormState) => {
    if (!id) return;
    setError(null);
    setIsSaving(true);
    try {
      const res = await fetch(`/api/admin/blog/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title:                state.title,
          slug:                 state.slug || undefined,
          excerpt:              state.excerpt || undefined,
          content_markdown:     state.content_markdown,
          content_html:         undefined,
          content_blocks:       state.content_blocks.length ? state.content_blocks : null,
          featured_image_url:   state.featured_image_url || undefined,
          category:             state.category || undefined,
          tags:                 state.tags,
          media_blocks:         state.media_blocks.length ? state.media_blocks : undefined,
          seo_meta_title:       state.seo_meta_title || undefined,
          seo_meta_description: state.seo_meta_description || undefined,
          status:               state.status,
          is_featured:          state.is_featured,
          published_at:         state.status === 'published' ? (post?.published_at || new Date().toISOString()) : state.published_at || undefined,
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

  if (!checked || (allowed && id && !post && !loadError)) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <Loader2 className="h-10 w-10 animate-spin text-[#0B5ED7]" />
      </div>
    );
  }

  if (checked && !allowed) {
    return (
      <div className="min-h-screen bg-gray-50 p-6">
        <div className="mx-auto max-w-2xl rounded-lg bg-white p-8 shadow text-center">
          <h1 className="text-xl font-bold text-gray-900">Access Denied</h1>
          <p className="mt-2 text-gray-600">Only Super Admins can edit blog posts. Log in at Super Admin Login first.</p>
          <Link href="/super-admin/login" className="mt-4 inline-block text-[#0B5ED7] hover:underline">
            Go to Super Admin Login
          </Link>
        </div>
      </div>
    );
  }

  if (checked && loadError) {
    return (
      <div className="min-h-screen bg-gray-50 p-6">
        <div className="mx-auto max-w-2xl rounded-lg bg-white p-8 shadow text-center">
          <h1 className="text-xl font-bold text-gray-900">Error</h1>
          <p className="mt-2 text-gray-600">{loadError || 'Post not found'}</p>
          <Link href="/admin/blog" className="mt-4 inline-block text-[#0B5ED7] hover:underline">
            Back to Blog CMS
          </Link>
        </div>
      </div>
    );
  }

  const initial: Partial<BlogFormState> = {
    title:                (post?.title as string) ?? '',
    slug:                 (post?.slug as string) ?? '',
    excerpt:              (post?.excerpt as string) ?? '',
    content_markdown:     (post?.content_markdown as string) ?? '',
    content_blocks:       Array.isArray(post?.content_blocks) ? (post.content_blocks as ContentBlock[]) : [],
    featured_image_url:   (post?.featured_image_url as string) ?? '',
    category:             (post?.category as string) ?? '',
    tags:                 Array.isArray(post?.tags) ? (post.tags as string[]) : [],
    media_blocks:         Array.isArray(post?.media_blocks) ? (post.media_blocks as MediaBlockItem[]) : [],
    seo_meta_title:       (post?.seo_meta_title as string) ?? '',
    seo_meta_description: (post?.seo_meta_description as string) ?? '',
    status:               (post?.status as BlogFormState['status']) ?? 'draft',
    is_featured:          !!post?.is_featured,
    published_at:         post?.published_at ? new Date(post.published_at as string).toISOString() : '',
  };

  return (
    <>
      <Head>
        <title>Edit: {post?.title != null ? String(post.title) : 'Post'} | Blog CMS</title>
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
          <h1 className="mb-6 text-2xl font-bold text-gray-900">Edit post</h1>
          {error && (
            <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          )}

          <div className="flex gap-6 items-start">
            {/* ── Editor ─────────────────────────────────────────────────── */}
            <div className="flex-1 min-w-0 rounded-lg border border-gray-200 bg-white p-6 shadow">
              <BlogEditorForm
                initial={initial}
                onSubmit={handleSubmit}
                onCancel={() => router.push('/admin/blog')}
                submitLabel="Save changes"
                isSaving={isSaving}
                onStateChange={setLiveState}
                externalPatch={editorPatch}
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
                  onImprove={jumpToImproveArea}
                  onAutoImprove={autoImproveArea}
                  improvingArea={improvingArea}
                />
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
