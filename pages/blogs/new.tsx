'use client';

import React, { useEffect, useRef, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { BlogEditorForm, type BlogFormState } from '../../components/blog/BlogEditorForm';
import { ContentQualityPanel, type ImproveArea } from '../../components/content/ContentQualityPanel';
import EditorShareActions from '../../components/content/EditorShareActions';
import { createDefaultBlogTemplate } from '../../lib/blog/blogTemplate';
import { checkDuplication, type DuplicationResult, type ExistingPostMeta } from '../../lib/blog/topicDetection';
import { AlertTriangle, XCircle, Loader2 } from 'lucide-react';
import { useCompanyContext } from '../../components/CompanyContext';
import type { BlogGenerationOutput } from '../../lib/blog/blogGenerationEngine';
import type { BlogFormatType } from '../../lib/blog/blogStructureTemplates';
import { resolveGeneratedPrefillBlocks } from '../../lib/content/editorPrefill';
import { launchSocialPostingFromContent } from '../../lib/content/socialPosting';
import { useCompanyIdentity } from '../../hooks/useCompanyIdentity';
import type { CreatorFlowContext } from '../../lib/content/creatorFlowContext';

const DEFAULT_TEMPLATE = createDefaultBlogTemplate();

type PrefillPayload = {
  output?: (BlogGenerationOutput & { content_blocks?: unknown[]; content_markdown?: string }) | null;
  source?: string;
  target_word_count?: number;
  format_type?: BlogFormatType;
  creator_context?: CreatorFlowContext;
};

export default function BlogNewPage() {
  const router = useRouter();
  const { selectedCompanyId } = useCompanyContext();
  const companyIdentity = useCompanyIdentity(selectedCompanyId);
  const editId = typeof router.query.edit === 'string' ? router.query.edit : null;
  const isEditing = Boolean(editId);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [liveState, setLiveState] = useState<BlogFormState | null>(null);
  const [prefillChecked, setPrefillChecked] = useState(false);
  const [prefillInitial, setPrefillInitial] = useState<Partial<BlogFormState> | null>(null);
  const [prefillNotice, setPrefillNotice] = useState<string | null>(null);
  const [editorPatch, setEditorPatch] = useState<Partial<BlogFormState> | null>(null);
  const [improvingArea, setImprovingArea] = useState<ImproveArea | null>(null);
  const [improvingIssueKey, setImprovingIssueKey] = useState<string | null>(null);
  const [cmsIntegration, setCmsIntegration] = useState<{ id: string; type: string; name: string } | null>(null);
  const [hasLeadCapture, setHasLeadCapture] = useState<boolean>(false);
  const [isPostingBlog, setIsPostingBlog] = useState<boolean>(false);
  const [targetWordCount, setTargetWordCount] = useState<number>(800);
  const [formatType, setFormatType] = useState<BlogFormatType | undefined>(undefined);
  const [primaryKeyword, setPrimaryKeyword] = useState<string | null>(null);
  const [secondaryKeywords, setSecondaryKeywords] = useState<string[] | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);

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

  const runImprove = async (
    area: ImproveArea,
    issueMessage: string | null,
    issueKey: string | null,
  ) => {
    if (!liveState || improvingArea || improvingIssueKey || !selectedCompanyId) return;
    if (issueKey) setImprovingIssueKey(issueKey);
    else setImprovingArea(area);
    setError(null);

    try {
      const resp = await fetch('/api/content/improve-draft', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company_id: selectedCompanyId,
          area,
          contentType: 'blog',
          ...(issueMessage ? { issue_message: issueMessage } : {}),
          draft: {
            title: liveState.title,
            excerpt: liveState.excerpt,
            seo_meta_title: liveState.seo_meta_title,
            seo_meta_description: liveState.seo_meta_description,
            tags: liveState.tags,
            content_blocks: liveState.content_blocks,
            target_word_count: targetWordCount,
            format_type: liveState.format_type || formatType,
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

      setPrefillNotice(
        issueMessage
          ? `AI applied fix: "${issueMessage}". Review the updated draft and quality panel.`
          : `AI improved ${area}. Review the updated draft and quality panel for the refreshed score.`,
      );
      jumpToImproveArea(area);
    } catch (e) {
      jumpToImproveArea(area);
      setError(e instanceof Error ? e.message : 'AI improvement failed');
    } finally {
      if (issueKey) setImprovingIssueKey(null);
      else setImprovingArea(null);
    }
  };

  const autoImproveArea = (area: ImproveArea) => runImprove(area, null, null);

  const autoImproveIssue = async (area: ImproveArea, message: string, key: string) => {
    await runImprove(area, message, key);
  };

  useEffect(() => {
    if (!selectedCompanyId) return;
    fetch(`/api/integrations?company_id=${encodeURIComponent(selectedCompanyId)}`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        const list = Array.isArray(data?.integrations) ? data.integrations : [];
        const connectedCms = list.find((i: { type: string; status: string; id: string; name: string }) =>
          i.type !== 'lead_webhook' && i.status === 'connected',
        );
        const connectedLead = list.find((i: { type: string; status: string }) =>
          i.type === 'lead_webhook' && i.status === 'connected',
        );
        if (connectedCms) {
          setCmsIntegration({ id: connectedCms.id, type: connectedCms.type, name: connectedCms.name });
        } else {
          setCmsIntegration(null);
        }
        setHasLeadCapture(Boolean(connectedLead));
      })
      .catch(() => {
        setCmsIntegration(null);
        setHasLeadCapture(false);
      });
  }, [selectedCompanyId]);

  useEffect(() => {
    if (!selectedCompanyId) return;
    fetch(`/api/company/blogs?company_id=${selectedCompanyId}`, { credentials: 'include' })
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
    if (!router.isReady || !selectedCompanyId) return;

    const bootstrap = async () => {
      if (editId) {
        try {
          const res = await fetch(`/api/blogs/${editId}?company_id=${encodeURIComponent(selectedCompanyId)}`, {
            credentials: 'include',
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(data?.error || 'Failed to load blog');

          const blog = data?.blog as Record<string, unknown>;
          setSavedId(editId);
          setPrefillInitial({
            title: typeof blog?.title === 'string' ? blog.title : '',
            slug: typeof blog?.slug === 'string' ? blog.slug : '',
            excerpt: typeof blog?.excerpt === 'string' ? blog.excerpt : '',
            category: typeof blog?.category === 'string' ? blog.category : '',
            tags: Array.isArray(blog?.tags) ? (blog.tags as string[]) : [],
            seo_meta_title: typeof blog?.seo_meta_title === 'string' ? blog.seo_meta_title : '',
            seo_meta_description: typeof blog?.seo_meta_description === 'string' ? blog.seo_meta_description : '',
            featured_image_url: typeof blog?.featured_image_url === 'string' ? blog.featured_image_url : '',
            content_markdown: typeof blog?.content === 'string' ? blog.content : '',
            content_blocks: Array.isArray(blog?.content_blocks) && blog.content_blocks.length > 0
              ? (blog.content_blocks as BlogFormState['content_blocks'])
              : DEFAULT_TEMPLATE,
            is_featured: blog?.is_featured === true,
            status: (typeof blog?.status === 'string' ? blog.status : 'draft') as BlogFormState['status'],
            published_at: typeof blog?.published_at === 'string' ? blog.published_at : '',
          });
          setPrefillNotice('Editing an existing blog. Update the draft and save when ready.');
        } catch (e) {
          setError(e instanceof Error ? e.message : 'Failed to load blog');
        } finally {
          setPrefillChecked(true);
        }
        return;
      }

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
        if (typeof parsed?.format_type === 'string' && parsed.format_type.trim()) {
          setFormatType(parsed.format_type);
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
            format_type: typeof parsed?.format_type === 'string' ? parsed.format_type : undefined,
          });
          const outputAny = output as unknown as Record<string, unknown>;
          if (typeof outputAny.primary_keyword === 'string') setPrimaryKeyword(outputAny.primary_keyword);
          if (Array.isArray(outputAny.secondary_keywords)) setSecondaryKeywords(outputAny.secondary_keywords as string[]);
          if (parsed.source === 'company_blog_intelligence') {
            setPrefillNotice('Draft prefilled from your blog intelligence. Review and publish when ready.');
          } else if (parsed.source === 'creator_content') {
            const contextLine = parsed.creator_context?.creatorType
              ? ` Source: ${parsed.creator_context.creatorType}.`
              : '';
            setPrefillNotice(`Draft prefilled from Creator Content.${contextLine} Review, edit, and save when ready.`);
          }
        }
        sessionStorage.removeItem(token);
      } catch {
      } finally {
        const nextQuery = { ...router.query };
        delete nextQuery.prefill;
        void router.replace({ pathname: router.pathname, query: nextQuery }, undefined, { shallow: true });
        setPrefillChecked(true);
      }
    };

    void bootstrap();
  }, [router.isReady, selectedCompanyId, editId, router.query, router]);

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
    if (!selectedCompanyId) {
      setError('Company context required to save blog post.');
      return;
    }

    setError(null);
    setIsSaving(true);
    try {
      const endpoint = isEditing && editId
        ? `/api/blogs/${encodeURIComponent(editId)}?company_id=${encodeURIComponent(selectedCompanyId)}`
        : '/api/company/blogs';
      const method = isEditing && editId ? 'PUT' : 'POST';
      const res = await fetch(endpoint, {
        method,
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company_id: selectedCompanyId,
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
          primary_keyword:      primaryKeyword || undefined,
          secondary_keywords:   secondaryKeywords?.length ? secondaryKeywords : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Save failed');
      setSavedId((data?.id ?? data?.blog?.id ?? editId) || null);
      setPrefillNotice(isEditing ? 'Blog updated. You can now copy, export, or mark it as used.' : 'Blog post saved. You can now copy, export, or mark it as used.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setIsSaving(false);
    }
  };

  const handlePostBlogToWebsite = async () => {
    if (!selectedCompanyId) {
      setError('Company context required to post the blog.');
      return;
    }
    if (!savedId) {
      setError('Save the blog as a draft first, then post it to the website.');
      return;
    }
    if (!cmsIntegration) {
      setError('Connect a website CMS integration before posting.');
      return;
    }
    setError(null);
    setIsPostingBlog(true);
    try {
      const res = await fetch(`/api/blogs/${encodeURIComponent(savedId)}/publish`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company_id: selectedCompanyId,
          integration_id: cmsIntegration.id,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.success === false) {
        throw new Error(data?.message || data?.error || 'Publish failed');
      }
      setPrefillNotice(`Blog posted to website via ${cmsIntegration.name}.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Publish failed');
    } finally {
      setIsPostingBlog(false);
    }
  };

  const handlePostToSocial = () => {
    if (!liveState) return;
    launchSocialPostingFromContent({
      router,
      contentType: 'blog',
      title: liveState.title,
      content: liveState.content_markdown || '',
      tags: liveState.tags,
      excerpt: liveState.excerpt,
      sourceId: savedId,
    });
  };

  const handleMarkUsed = async (platform?: string) => {
    if (!savedId || !selectedCompanyId) {
      setError('Save the post first before marking it as used.');
      return;
    }
    try {
      const res = await fetch('/api/content/mark-used', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content_id: savedId,
          content_type: 'blog',
          company_id: selectedCompanyId,
          platform,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Failed to mark as used');
      setPrefillNotice(`Blog post marked as used${platform ? ` on ${platform}` : ''}.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to mark as used');
    }
  };

  if (!prefillChecked) return <div className="flex min-h-screen items-center justify-center bg-gray-50"><Loader2 className="h-10 w-10 animate-spin text-[#0B5ED7]" /></div>;

  return (
    <>
      <Head>
        <title>{isEditing ? 'Edit Blog' : 'New Blog'} | Blog Intelligence</title>
      </Head>
      <div className="min-h-screen bg-gray-50">
        <div className="border-b border-gray-200 bg-white px-4 py-3 sm:px-6">
          <div className="mx-auto flex max-w-[1200px] items-center justify-between">
            <Link href="/dashboard" className="flex shrink-0 items-center" aria-label="Home">
              <img src="/logo.png" alt="Logo" width={100} height={40} className="h-10 w-auto object-contain sm:h-11" />
            </Link>
            <Link href="/blogs/create" className="text-sm font-medium text-gray-600 hover:text-gray-900">
              Back to Create Blog
            </Link>
          </div>
        </div>

        <div className="mx-auto max-w-[1200px] p-6">
          <h1 className="mb-6 text-2xl font-bold text-gray-900">{isEditing ? 'Edit Blog' : 'New Blog'}</h1>
          {prefillNotice && (
            <div className="mb-4 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-700">
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
                initial={{
                  content_blocks: DEFAULT_TEMPLATE,
                  ...(prefillInitial || {}),
                }}
                onSubmit={handleSubmit}
                onCancel={() => router.push('/blogs/create')}
                submitLabel={isEditing ? 'Update blog' : 'Create blog'}
                isSaving={isSaving}
                onStateChange={setLiveState}
                externalPatch={editorPatch}
              />

              <EditorShareActions
                saved={Boolean(savedId)}
                copyText={liveState?.content_markdown || liveState?.title || ''}
                exportText={`# ${liveState?.title || ''}\n\n${liveState?.content_markdown || ''}`}
                exportFileName={`${(liveState?.title || 'blog-post').toLowerCase().replace(/\s+/g, '-')}.md`}
                onMarkUsed={handleMarkUsed}
                onPostToSocial={handlePostToSocial}
                markUsedOptions={[
                  { label: 'General use' },
                  { label: 'Website', value: 'website' },
                  { label: 'LinkedIn', value: 'linkedin' },
                  { label: 'Email', value: 'email' },
                ]}
              />
            </div>

            {/* ── Quality panel (sticky right sidebar) ────────────────────── */}
            <div className="hidden lg:block w-[280px] shrink-0 sticky top-6 self-start">
              {liveState && (() => {
                const websiteIntegrationAvailable = Boolean(cmsIntegration && savedId);
                let websiteIntegrationReason: string | undefined;
                if (!cmsIntegration) {
                  websiteIntegrationReason = 'Connect a website CMS (WordPress, HubSpot, etc.) in Integrations to enable posting.';
                } else if (!hasLeadCapture) {
                  websiteIntegrationReason = `Connected to ${cmsIntegration.name}. Add a lead-capture webhook for full attribution.`;
                } else if (!savedId) {
                  websiteIntegrationReason = 'Save the blog as a draft first, then post it to your website.';
                }
                return (
                  <ContentQualityPanel
                    blocks={liveState.content_blocks}
                    formState={{
                      title:                liveState.title,
                      excerpt:              liveState.excerpt,
                      seo_meta_title:       liveState.seo_meta_title,
                      seo_meta_description: liveState.seo_meta_description,
                      tags:                 liveState.tags,
                      target_word_count:    targetWordCount,
                      content_type:         'blog',
                      format_type:          liveState.format_type || formatType,
                    }}
                    onImprove={jumpToImproveArea}
                    onAutoImprove={autoImproveArea}
                    improvingArea={improvingArea}
                    onAutoImproveIssue={autoImproveIssue}
                    improvingIssueKey={improvingIssueKey}
                    onPostBlogToWebsite={handlePostBlogToWebsite}
                    websiteIntegrationAvailable={websiteIntegrationAvailable}
                    websiteIntegrationReason={websiteIntegrationReason}
                    isPostingBlog={isPostingBlog}
                    companyIdentity={companyIdentity}
                  />
                );
              })()}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

