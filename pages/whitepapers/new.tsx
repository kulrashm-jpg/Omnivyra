'use client';

import React, { useEffect, useRef, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { BlogEditorForm, type BlogFormState } from '../../components/blog/BlogEditorForm';
import { ContentQualityPanel, type ImproveArea } from '../../components/content/ContentQualityPanel';
import { createDefaultBlogTemplate } from '../../lib/blog/blogTemplate';
import { checkDuplication, type DuplicationResult, type ExistingPostMeta } from '../../lib/blog/topicDetection';
import { AlertTriangle, XCircle, Loader2, Copy, Download, CheckCircle2 } from 'lucide-react';
import { useCompanyContext } from '../../components/CompanyContext';
import type { BlogGenerationOutput } from '../../lib/blog/blogGenerationEngine';
import { launchCampaignFromContent } from '../../lib/content/launchCampaignFromContent';

const DEFAULT_TEMPLATE = createDefaultBlogTemplate();

type PrefillPayload = {
  output?: (BlogGenerationOutput & { content_blocks?: unknown[] }) | null;
  source?: string;
  target_word_count?: number;
};

export default function WhitepaperNewPage() {
  const router = useRouter();
  const { selectedCompanyId } = useCompanyContext();
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [liveState, setLiveState] = useState<BlogFormState | null>(null);
  const [prefillChecked, setPrefillChecked] = useState(false);
  const [prefillInitial, setPrefillInitial] = useState<Partial<BlogFormState> | null>(null);
  const [prefillNotice, setPrefillNotice] = useState<string | null>(null);
  const [editorPatch, setEditorPatch] = useState<Partial<BlogFormState> | null>(null);
  const [improvingArea, setImprovingArea] = useState<ImproveArea | null>(null);
  const [targetWordCount, setTargetWordCount] = useState<number>(3000);
  const [primaryKeyword, setPrimaryKeyword] = useState<string | null>(null);
  const [secondaryKeywords, setSecondaryKeywords] = useState<string[] | null>(null);

  // Use/Share state
  const [showUseMenu, setShowUseMenu] = useState(false);
  const [copied, setCopied] = useState(false);
  const [markingUsed, setMarkingUsed] = useState(false);
  const [savedId, setSavedId] = useState<string | null>(null);

  // Duplication detection
  const [existingPosts, setExistingPosts] = useState<ExistingPostMeta[]>([]);
  const [dupResult, setDupResult] = useState<DuplicationResult | null>(null);
  const dupTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    if (sectionEl) {
      sectionEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    if (target.focusId) {
      const inputEl = document.getElementById(target.focusId) as HTMLInputElement | HTMLTextAreaElement | null;
      if (inputEl) {
        window.setTimeout(() => inputEl.focus(), 280);
      }
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
          contentType: 'whitepaper',
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
      setPrefillNotice(
        delta > 0
          ? `AI improved ${area}. Score +${delta} (now ${after}/85). Review content when ready.`
          : `AI improvement applied for ${area}. Review changes and run again if needed.`,
      );
      jumpToImproveArea(area);
    } catch (e) {
      jumpToImproveArea(area);
      setError(e instanceof Error ? e.message : 'AI improvement failed');
    } finally {
      setImprovingArea(null);
    }
  };

  // Fetch existing posts once for duplication checking
  useEffect(() => {
    if (!selectedCompanyId) return;
    fetch(`/api/company/blogs?company_id=${selectedCompanyId}&content_type=whitepaper`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (Array.isArray(data?.blogs)) {
          setExistingPosts(
            data.blogs.map((p: { id: string; title: string; slug: string; tags: string[]; category: string }) => ({
              id: p.id, title: p.title, slug: p.slug, tags: p.tags ?? [], category: p.category ?? '',
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
          content_blocks: Array.isArray(output.content_blocks)
            ? (output.content_blocks as BlogFormState['content_blocks'])
            : DEFAULT_TEMPLATE,
          content_markdown: (output as unknown as Record<string, unknown>).content_markdown as string || '',
        });
        const outputAny = output as unknown as Record<string, unknown>;
        if (typeof outputAny.primary_keyword === 'string') setPrimaryKeyword(outputAny.primary_keyword);
        if (Array.isArray(outputAny.secondary_keywords)) setSecondaryKeywords(outputAny.secondary_keywords as string[]);
      }
      sessionStorage.removeItem(token);
    } catch {
      // Invalid token payload should not block editor usage.
    } finally {
      const nextQuery = { ...router.query };
      delete nextQuery.prefill;
      void router.replace({ pathname: router.pathname, query: nextQuery }, undefined, { shallow: true });
      setPrefillChecked(true);
    }
  }, [router.isReady]);

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

  // ── Save whitepaper (draft) ───────────────────────────────────────────────
  const handleSubmit = async (state: BlogFormState) => {
    if (!selectedCompanyId) {
      setError('Company context required to save whitepaper.');
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
          content_type: 'whitepaper',
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
          status:               'draft',
          is_featured:          false,
          primary_keyword:      primaryKeyword || undefined,
          secondary_keywords:   secondaryKeywords?.length ? secondaryKeywords : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Save failed');
      setSavedId(data.id ?? null);
      setPrefillNotice('Whitepaper saved as draft. Use the options below to share or export.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setIsSaving(false);
    }
  };

  const handleCreateCampaign = () => {
    if (!liveState?.title?.trim()) {
      setError('Add a title before creating a campaign from this content.');
      return;
    }
    launchCampaignFromContent({
      router,
      contentType: 'whitepaper',
      title: liveState.title,
      excerpt: liveState.excerpt,
      tags: liveState.tags,
      targetWordCount,
      sourceId: savedId,
      contentMarkdown: liveState.content_markdown,
    });
  };

  // ── Copy content to clipboard ──────────────────────────────────────────────
  const handleCopy = () => {
    if (!liveState) return;
    const text = liveState.content_markdown || liveState.title || '';
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  // ── Export as text file ────────────────────────────────────────────────────
  const handleExport = () => {
    if (!liveState) return;
    const text = `# ${liveState.title}\n\n${liveState.content_markdown || ''}`;
    const blob = new Blob([text], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(liveState.title || 'whitepaper').toLowerCase().replace(/\s+/g, '-')}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ── Mark as used ───────────────────────────────────────────────────────────
  const handleMarkUsed = async (platform?: string) => {
    if (!savedId || !selectedCompanyId) {
      setError('Save the whitepaper first before marking as used.');
      return;
    }
    setMarkingUsed(true);
    try {
      const res = await fetch('/api/content/mark-used', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content_id: savedId,
          content_type: 'whitepaper',
          company_id: selectedCompanyId,
          platform,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Failed to mark as used');
      setPrefillNotice(`Whitepaper marked as used${platform ? ` on ${platform}` : ''}. Great work!`);
      setShowUseMenu(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to mark as used');
    } finally {
      setMarkingUsed(false);
    }
  };

  if (!prefillChecked) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <Loader2 className="h-10 w-10 animate-spin text-[#1B2A4A]" />
      </div>
    );
  }

  return (
    <>
      <Head>
        <title>New Whitepaper | Content Intelligence</title>
      </Head>
      <div className="min-h-screen bg-gray-50">
        <div className="border-b border-gray-200 bg-white px-4 py-3 sm:px-6">
          <div className="mx-auto flex max-w-[1200px] items-center justify-between">
            <Link href="/dashboard" className="flex shrink-0 items-center" aria-label="Home">
              <img src="/logo.png" alt="Logo" width={100} height={40} className="h-10 w-auto object-contain sm:h-11" />
            </Link>
            <Link href="/whitepapers/create" className="text-sm font-medium text-gray-600 hover:text-gray-900">
              &larr; Back to Whitepapers
            </Link>
          </div>
        </div>

        <div className="mx-auto max-w-[1200px] p-6">
          <h1 className="mb-6 text-2xl font-bold text-gray-900">New Whitepaper</h1>
          {prefillNotice && (
            <div className="mb-4 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
              {prefillNotice}
            </div>
          )}
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
                      <span className="underline">{m.title}</span>
                      <span className="ml-2 opacity-60">({Math.round(m.sim * 100)}% overlap)</span>
                    </li>
                  ))}
                </ul>
                <p className="mt-1 opacity-70 text-xs">
                  Consider differentiating your angle or merging content.
                </p>
              </div>
            </div>
          )}

          <div className="flex gap-6 items-start">
            {/* ── Editor ─────────────────────────────────────────────────── */}
            <div className="flex-1 min-w-0 rounded-lg border border-gray-200 bg-white p-6 shadow">
              <BlogEditorForm
                initial={{
                  content_blocks: DEFAULT_TEMPLATE,
                  ...(prefillInitial || {}),
                }}
                onSubmit={handleSubmit}
                onCancel={() => router.push('/whitepapers')}
                submitLabel="Save Whitepaper"
                isSaving={isSaving}
                onStateChange={setLiveState}
                externalPatch={editorPatch}
              />

              {/* ── Use / Share Actions ──────────────────────────────────── */}
              <div className="mt-6 border-t border-gray-200 pt-4">
                <div className="flex items-center gap-2 mb-3">
                  <h3 className="text-sm font-semibold text-gray-700">Use / Share</h3>
                  {savedId && (
                    <span className="text-[10px] text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full font-medium">Saved</span>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={handleCopy}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 transition-colors"
                  >
                    {copied ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
                    {copied ? 'Copied!' : 'Copy Content'}
                  </button>
                  <button
                    type="button"
                    onClick={handleExport}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 transition-colors"
                  >
                    <Download className="h-3.5 w-3.5" />
                    Export
                  </button>

                  {/* Mark as Used dropdown */}
                  <div className="relative">
                    <button
                      type="button"
                      onClick={() => setShowUseMenu(!showUseMenu)}
                      disabled={markingUsed}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg bg-[#1B2A4A] text-white hover:opacity-90 transition-colors disabled:opacity-50"
                    >
                      {markingUsed ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                      Mark as Used
                    </button>
                    {showUseMenu && (
                      <div className="absolute top-full left-0 mt-1 w-44 bg-white border border-gray-200 rounded-lg shadow-lg z-20 py-1">
                        <button onClick={() => handleMarkUsed()} className="block w-full text-left px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50">General use</button>
                        <button onClick={() => handleMarkUsed('website')} className="block w-full text-left px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50">Website / Landing page</button>
                        <button onClick={() => handleMarkUsed('linkedin')} className="block w-full text-left px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50">LinkedIn</button>
                        <button onClick={() => handleMarkUsed('email')} className="block w-full text-left px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50">Email campaign</button>
                        <button onClick={() => handleMarkUsed('sales')} className="block w-full text-left px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50">Sales enablement</button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* ── Quality panel (sticky right sidebar) ────────────────────── */}
            <div className="hidden xl:block w-[280px] shrink-0 sticky top-6 self-start">
              {liveState && (
                <ContentQualityPanel
                  blocks={liveState.content_blocks}
                  formState={{
                    title:                liveState.title,
                    excerpt:              liveState.excerpt,
                    seo_meta_title:       liveState.seo_meta_title,
                    seo_meta_description: liveState.seo_meta_description,
                    tags:                 liveState.tags,
                    target_word_count:    targetWordCount,
                    content_type:         'whitepaper',
                  }}
                  onImprove={jumpToImproveArea}
                  onAutoImprove={autoImproveArea}
                  improvingArea={improvingArea}
                  onCreateCampaign={handleCreateCampaign}
                />
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
