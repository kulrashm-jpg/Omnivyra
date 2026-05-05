'use client';

import React, { useEffect, useRef, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { AlertTriangle, Loader2, XCircle } from 'lucide-react';
import { BlogEditorForm, type BlogFormState } from '../../components/blog/BlogEditorForm';
import { ContentQualityPanel, type ImproveArea } from '../../components/content/ContentQualityPanel';
import EditorShareActions from '../../components/content/EditorShareActions';
import { useCompanyContext } from '../../components/CompanyContext';
import { createDefaultBlogTemplate } from '../../lib/blog/blogTemplate';
import type { BlogGenerationOutput } from '../../content/engine/generator';
import { checkDuplication, type DuplicationResult, type ExistingPostMeta } from '../../lib/blog/topicDetection';
import { launchCampaignFromContent } from '../../lib/content/launchCampaignFromContent';
import { resolveGeneratedPrefillBlocks } from '../../lib/content/editorPrefill';
import { launchSocialPostingFromContent } from '../../lib/content/socialPosting';
import { useCompanyIdentity } from '../../hooks/useCompanyIdentity';

const DEFAULT_TEMPLATE = createDefaultBlogTemplate();

type PrefillPayload = {
  output?: (BlogGenerationOutput & { content_blocks?: unknown[]; content_markdown?: string }) | null;
  target_word_count?: number;
};

export default function CaseStudyNewPage() {
  const router = useRouter();
  const { selectedCompanyId } = useCompanyContext();
  const companyIdentity = useCompanyIdentity(selectedCompanyId);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [liveState, setLiveState] = useState<BlogFormState | null>(null);
  const [prefillChecked, setPrefillChecked] = useState(false);
  const [prefillInitial, setPrefillInitial] = useState<Partial<BlogFormState> | null>(null);
  const [prefillNotice, setPrefillNotice] = useState<string | null>(null);
  const [editorPatch, setEditorPatch] = useState<Partial<BlogFormState> | null>(null);
  const [improvingArea, setImprovingArea] = useState<ImproveArea | null>(null);
  const [targetWordCount, setTargetWordCount] = useState<number>(1800);
  const [primaryKeyword, setPrimaryKeyword] = useState<string | null>(null);
  const [secondaryKeywords, setSecondaryKeywords] = useState<string[] | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [existingPosts, setExistingPosts] = useState<ExistingPostMeta[]>([]);
  const [dupResult, setDupResult] = useState<DuplicationResult | null>(null);
  const dupTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const jumpToImproveArea = (area: ImproveArea) => {
    const byArea: Record<ImproveArea, { sectionId: string; focusId?: string }> = {
      structure: { sectionId: 'blog-section-content' },
      depth: { sectionId: 'blog-section-content' },
      geo: { sectionId: 'blog-section-content' },
      linking: { sectionId: 'blog-section-content' },
      seo: { sectionId: 'blog-section-seo', focusId: 'blog-input-seo-title' },
    };

    const target = byArea[area];
    const sectionEl = document.getElementById(target.sectionId);
    if (sectionEl) {
      sectionEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    if (target.focusId) {
      const inputEl = document.getElementById(target.focusId) as HTMLInputElement | HTMLTextAreaElement | null;
      if (inputEl) window.setTimeout(() => inputEl.focus(), 280);
    }
  };

  const autoImproveArea = async (area: ImproveArea) => {
    if (!liveState || improvingArea || !selectedCompanyId) return;
    setImprovingArea(area);
    setError(null);

    try {
      const resp = await fetch('/api/content/improve-draft', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company_id: selectedCompanyId,
          area,
          contentType: 'case-study',
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
          content_blocks: Array.isArray(updated.content_blocks) ? updated.content_blocks : liveState.content_blocks,
        });
      }

      const delta = Number(data?.scoreDelta || 0);
      const after = Number(data?.afterScore || 0);
      setPrefillNotice(
        delta > 0
          ? `AI improved ${area}. Score +${delta} (now ${after}/100).`
          : `AI improvement applied for ${area}. Review the updated draft.`,
      );
      jumpToImproveArea(area);
    } catch (e) {
      jumpToImproveArea(area);
      setError(e instanceof Error ? e.message : 'AI improvement failed');
    } finally {
      setImprovingArea(null);
    }
  };

  useEffect(() => {
    if (!selectedCompanyId) return;
    fetch(`/api/company/blogs?company_id=${selectedCompanyId}&content_type=case-study`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (Array.isArray(data?.blogs)) {
          setExistingPosts(
            data.blogs.map((p: { id: string; title: string; slug: string; tags: string[]; category: string }) => ({
              id: p.id,
              title: p.title,
              slug: p.slug,
              tags: p.tags ?? [],
              category: p.category ?? '',
            })),
          );
        }
      })
      .catch(() => {});
  }, [selectedCompanyId]);

  useEffect(() => {
    if (!router.isReady) return;

    const token = typeof router.query.prefill === 'string' ? router.query.prefill : '';
    if (!token) {
      setPrefillChecked(true);
      return;
    }

    try {
      const raw = sessionStorage.getItem(token);
      if (!raw) {
        setPrefillChecked(true);
        return;
      }

      const parsed = JSON.parse(raw) as PrefillPayload;
      const output = parsed?.output;
      if (parsed?.target_word_count && parsed.target_word_count >= 300) {
        setTargetWordCount(parsed.target_word_count);
      }
      if (output) {
        setPrefillInitial({
          title: output.title || '',
          excerpt: output.excerpt || '',
          category: output.category || '',
          tags: Array.isArray(output.tags) ? output.tags : [],
          seo_meta_title: output.seo_meta_title || '',
          seo_meta_description: output.seo_meta_description || '',
          content_blocks: resolveGeneratedPrefillBlocks(output, DEFAULT_TEMPLATE),
          content_markdown: (output as unknown as Record<string, unknown>).content_markdown as string || '',
        });
        const outputAny = output as unknown as Record<string, unknown>;
        if (typeof outputAny.primary_keyword === 'string') setPrimaryKeyword(outputAny.primary_keyword);
        if (Array.isArray(outputAny.secondary_keywords)) setSecondaryKeywords(outputAny.secondary_keywords as string[]);
      }
      sessionStorage.removeItem(token);
    } catch {
      // Ignore malformed token payloads.
    } finally {
      const nextQuery = { ...router.query };
      delete nextQuery.prefill;
      void router.replace({ pathname: router.pathname, query: nextQuery }, undefined, { shallow: true });
      setPrefillChecked(true);
    }
  }, [router.isReady]);

  useEffect(() => {
    const title = liveState?.title?.trim() ?? '';
    const tags = liveState?.tags ?? [];

    if (dupTimerRef.current) clearTimeout(dupTimerRef.current);

    if (title.length < 6 || existingPosts.length === 0) {
      setDupResult(null);
      return;
    }

    dupTimerRef.current = setTimeout(() => {
      const result = checkDuplication(title, tags, existingPosts);
      setDupResult(result.status === 'new' ? null : result);
    }, 600);

    return () => {
      if (dupTimerRef.current) clearTimeout(dupTimerRef.current);
    };
  }, [liveState?.title, liveState?.tags, existingPosts]);

  const handleSubmit = async (state: BlogFormState) => {
    if (!selectedCompanyId) {
      setError('Company context required to save case study.');
      return;
    }

    setError(null);
    setIsSaving(true);
    try {
      const res = await fetch('/api/company/blogs', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company_id: selectedCompanyId,
          content_type: 'case-study',
          title: state.title,
          slug: state.slug || undefined,
          excerpt: state.excerpt || undefined,
          content_markdown: state.content_markdown,
          content_html: undefined,
          content_blocks: state.content_blocks.length ? state.content_blocks : undefined,
          featured_image_url: state.featured_image_url || undefined,
          category: state.category || undefined,
          tags: state.tags,
          media_blocks: state.media_blocks.length ? state.media_blocks : undefined,
          seo_meta_title: state.seo_meta_title || undefined,
          seo_meta_description: state.seo_meta_description || undefined,
          status: 'draft',
          is_featured: false,
          primary_keyword: primaryKeyword || undefined,
          secondary_keywords: secondaryKeywords?.length ? secondaryKeywords : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Save failed');
      setSavedId(data.id ?? null);
      setPrefillNotice('Case study saved as draft. You can now share, export, or turn it into a campaign asset.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setIsSaving(false);
    }
  };

  const handleCreateCampaign = () => {
    if (!liveState?.title?.trim()) {
      setError('Add a title before creating a campaign from this case study.');
      return;
    }
    launchCampaignFromContent({
      router,
      contentType: 'case-study',
      title: liveState.title,
      excerpt: liveState.excerpt,
      tags: liveState.tags,
      targetWordCount,
      sourceId: savedId,
      contentMarkdown: liveState.content_markdown,
    });
  };

  const handlePostToSocial = () => {
    if (!liveState) return;
    launchSocialPostingFromContent({
      router,
      contentType: 'case-study',
      title: liveState.title,
      content: liveState.content_markdown || '',
      tags: liveState.tags,
      excerpt: liveState.excerpt,
      sourceId: savedId,
    });
  };

  const handleMarkUsed = async (platform?: string) => {
    if (!savedId || !selectedCompanyId) {
      setError('Save the case study first before marking it as used.');
      return;
    }
    try {
      const res = await fetch('/api/content/mark-used', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content_id: savedId,
          content_type: 'case-study',
          company_id: selectedCompanyId,
          platform,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Failed to mark as used');
      setPrefillNotice(`Case study marked as used${platform ? ` on ${platform}` : ''}.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to mark as used');
    }
  };

  if (!prefillChecked) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <Loader2 className="h-10 w-10 animate-spin text-amber-600" />
      </div>
    );
  }

  return (
    <>
      <Head>
        <title>New Case Study | Proof-Led Content</title>
      </Head>

      <div className="min-h-screen bg-gray-50">
        <div className="border-b border-gray-200 bg-white px-4 py-3 sm:px-6">
          <div className="mx-auto flex max-w-[1200px] items-center justify-between">
            <Link href="/dashboard" className="flex shrink-0 items-center" aria-label="Home">
              <img src="/logo.png" alt="Logo" width={100} height={40} className="h-10 w-auto object-contain sm:h-11" />
            </Link>
            <Link href="/case-studies/generate" className="text-sm font-medium text-gray-600 hover:text-gray-900">
              &larr; Back to Case Study Intelligence
            </Link>
          </div>
        </div>

        <div className="mx-auto max-w-[1200px] p-6">
          <h1 className="mb-6 text-2xl font-bold text-gray-900">New Case Study</h1>
          {prefillNotice && (
            <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
              {prefillNotice}
            </div>
          )}
          {error && (
            <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          )}

          {dupResult && (
            <div
              className={`mb-4 flex items-start gap-3 rounded-lg border px-4 py-3 text-sm ${
                dupResult.status === 'duplicate'
                  ? 'border-red-300 bg-red-50 text-red-800'
                  : 'border-amber-300 bg-amber-50 text-amber-800'
              }`}
            >
              {dupResult.status === 'duplicate'
                ? <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
                : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />}
              <div>
                <p className="font-semibold">
                  {dupResult.status === 'duplicate' ? 'Possible duplicate case study detected' : 'Similar proof asset already exists'}
                </p>
                <ul className="mt-1 space-y-0.5">
                  {dupResult.matchedTitles.slice(0, 3).map((m) => (
                    <li key={m.slug}>
                      <span className="underline">{m.title}</span>
                      <span className="ml-2 opacity-60">({Math.round(m.sim * 100)}% overlap)</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          <div className="flex items-start gap-6">
            <div className="min-w-0 flex-1 rounded-lg border border-gray-200 bg-white p-6 shadow">
              <BlogEditorForm
                initial={{
                  content_blocks: DEFAULT_TEMPLATE,
                  ...(prefillInitial || {}),
                }}
                onSubmit={handleSubmit}
                onCancel={() => router.push('/case-studies/generate')}
                submitLabel="Save Case Study"
                isSaving={isSaving}
                onStateChange={setLiveState}
                externalPatch={editorPatch}
              />

              <EditorShareActions
                saved={Boolean(savedId)}
                copyText={liveState?.content_markdown || liveState?.title || ''}
                exportText={`# ${liveState?.title || ''}\n\n${liveState?.content_markdown || ''}`}
                exportFileName={`case-study-${(liveState?.title || 'proof').toLowerCase().replace(/\s+/g, '-')}.md`}
                onMarkUsed={handleMarkUsed}
                onPostToSocial={handlePostToSocial}
                markUsedOptions={[
                  { label: 'General use' },
                  { label: 'Website', value: 'website' },
                  { label: 'Sales enablement', value: 'sales' },
                  { label: 'Email', value: 'email' },
                ]}
              />
            </div>

            <div className="sticky top-6 hidden w-[280px] shrink-0 self-start xl:block">
              {liveState && (
                <ContentQualityPanel
                  blocks={liveState.content_blocks}
                  formState={{
                    title: liveState.title,
                    excerpt: liveState.excerpt,
                    seo_meta_title: liveState.seo_meta_title,
                    seo_meta_description: liveState.seo_meta_description,
                    tags: liveState.tags,
                    target_word_count: targetWordCount,
                    content_type: 'case-study',
                  }}
                  onImprove={jumpToImproveArea}
                  onAutoImprove={autoImproveArea}
                  improvingArea={improvingArea}
                  onCreateCampaign={handleCreateCampaign}
                  companyIdentity={companyIdentity}
                />
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

