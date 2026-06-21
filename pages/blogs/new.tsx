'use client';

import React, { useEffect, useRef, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { BlogEditorForm, type BlogFormState } from '../../components/blog/BlogEditorForm';
import { ContentQualityPanel, type ImproveArea, type PostBlogStatus } from '../../components/content/ContentQualityPanel';
import EditorShareActions from '../../components/content/EditorShareActions';
import { createDefaultBlogTemplate } from '../../lib/blog/blogTemplate';
import { checkDuplication, type DuplicationResult, type ExistingPostMeta } from '../../lib/blog/topicDetection';
import { AlertTriangle, XCircle, Loader2 } from 'lucide-react';
import { useCompanyContext } from '../../components/CompanyContext';
import type { BlogGenerationOutput } from '../../lib/blog/blogGenerationEngine';
import type { BlogFormatType } from '../../lib/blog/blogStructureTemplates';
import { resolveGeneratedPrefillBlocks } from '../../lib/content/editorPrefill';
import PromotePlatformModal, { type PromotablePlatform } from '../../components/content/PromotePlatformModal';
import PromotionWorkspace, { type WorkspacePlatformSeed } from '../../components/content/PromotionWorkspace';
import { resolveCanonicalContentUrl } from '../../lib/content/promotionDraft';
import { useCompanyIdentity } from '../../hooks/useCompanyIdentity';
import type { CreatorFlowContext } from '../../lib/content/creatorFlowContext';

const DEFAULT_TEMPLATE = createDefaultBlogTemplate();
const CMS_INTEGRATION_TYPES = new Set([
  'wordpress',
  'custom_blog_api',
  'ghost',
  'drupal',
  'joomla',
  'webflow',
  'shopify',
  'hubspot',
  'wix',
  'squarespace',
]);

const CMS_LABELS: Record<string, string> = {
  wordpress: 'WordPress',
  joomla: 'Joomla',
  drupal: 'Drupal',
  ghost: 'Ghost',
  custom_blog_api: 'Other CMS',
  webflow: 'Other CMS',
  shopify: 'Other CMS',
  hubspot: 'Other CMS',
  wix: 'Other CMS',
  squarespace: 'Other CMS',
};

type PrefillPayload = {
  output?: (BlogGenerationOutput & { content_blocks?: unknown[]; content_markdown?: string }) | null;
  source?: string;
  target_word_count?: number;
  format_type?: BlogFormatType;
  creator_context?: CreatorFlowContext;
};

type CmsIntegrationOption = {
  id: string;
  type: string;
  name: string;
};

type ConnectedSocialAccount = {
  platform_key: string;
  platform_label: string;
  connected: boolean;
  category: string;
  social_account_id?: string | null;
};

function safeFileStem(value: string): string {
  return (value || 'blog-post').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80) || 'blog-post';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  return typeof value === 'string' ? value.trim() : '';
}

function stripHtml(value: string): string {
  return value
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function readUrlCandidates(value: unknown, depth = 0): string[] {
  if (depth > 4 || value == null) return [];
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return /^https?:\/\//i.test(trimmed) ? [trimmed] : [];
  }
  if (Array.isArray(value)) return value.flatMap((item) => readUrlCandidates(item, depth + 1));
  if (!isRecord(value)) return [];

  const directKeys = [
    'url', 'src', 'href', 'file_url', 'fileUrl', 'storage_url', 'storageUrl',
    'public_url', 'publicUrl', 'preview_url', 'previewUrl', 'thumbnail_url',
    'thumbnailUrl', 'image_url', 'imageUrl', 'asset_url', 'assetUrl',
  ];
  const nestedKeys = [
    'files', 'images', 'media', 'media_bundle', 'mediaBundle', 'asset_payload',
    'assetPayload', 'creator_asset', 'creatorAsset', 'variants', 'selectedVariant',
    'rendered_asset', 'renderedAsset', 'output',
  ];

  return [
    ...directKeys.flatMap((key) => readUrlCandidates(value[key], depth + 1)),
    ...nestedKeys.flatMap((key) => readUrlCandidates(value[key], depth + 1)),
  ];
}

function uniqueUrls(urls: string[]): string[] {
  return urls.map((url) => url.trim()).filter(Boolean).filter((url, index, all) => all.indexOf(url) === index);
}

function blockText(block: unknown): string {
  if (!isRecord(block)) return '';
  const type = readString(block, 'type');
  if (type === 'heading') return `${readString(block, 'text')}\n`;
  if (type === 'paragraph' || type === 'text') return stripHtml(readString(block, 'html') || readString(block, 'text'));
  if (type === 'summary' || type === 'callout') return [readString(block, 'title'), readString(block, 'body')].filter(Boolean).join('\n');
  if (type === 'quote') return readString(block, 'text') ? `"${readString(block, 'text')}"` : '';
  if (type === 'key_insights') {
    const items = Array.isArray(block.items) ? block.items.map(String).filter(Boolean) : [];
    return items.map((item) => `- ${item}`).join('\n');
  }
  if (type === 'list') {
    const items = Array.isArray(block.items) ? block.items : [];
    return items
      .filter(isRecord)
      .map((item) => `- ${readString(item, 'text')}`)
      .filter((line) => line !== '- ')
      .join('\n');
  }
  if (type === 'image' || type === 'media' || type === 'creator_asset') {
    const title = readString(block, 'title') || readString(block, 'alt') || 'Asset';
    const urls = uniqueUrls(readUrlCandidates(block));
    return urls.length ? [`${title}:`, ...urls.map((url) => `- ${url}`)].join('\n') : '';
  }
  return '';
}

function blockHtml(block: unknown): string {
  if (!isRecord(block)) return '';
  const type = readString(block, 'type');
  if (type === 'heading') return `<h2>${escapeHtml(readString(block, 'text'))}</h2>`;
  if (type === 'paragraph' || type === 'text') return readString(block, 'html') || `<p>${escapeHtml(readString(block, 'text'))}</p>`;
  if (type === 'summary' || type === 'callout') {
    return `<aside>${readString(block, 'title') ? `<h3>${escapeHtml(readString(block, 'title'))}</h3>` : ''}<p>${escapeHtml(readString(block, 'body'))}</p></aside>`;
  }
  if (type === 'key_insights') {
    const items = Array.isArray(block.items) ? block.items.map(String).filter(Boolean) : [];
    return items.length ? `<ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>` : '';
  }
  if (type === 'list') {
    const items = Array.isArray(block.items) ? block.items.filter(isRecord) : [];
    return items.length ? `<ul>${items.map((item) => `<li>${escapeHtml(readString(item, 'text'))}</li>`).join('')}</ul>` : '';
  }
  if (type === 'image' || type === 'media' || type === 'creator_asset') {
    const title = readString(block, 'title') || readString(block, 'alt') || 'Asset';
    const caption = readString(block, 'caption') || readString(block, 'description');
    const figures = uniqueUrls(readUrlCandidates(block)).map((url) =>
      `<figure><img src="${escapeHtml(url)}" alt="${escapeHtml(title)}" />${caption ? `<figcaption>${escapeHtml(caption)}</figcaption>` : ''}</figure>`,
    );
    return figures.join('\n');
  }
  return '';
}

function buildTextDownload(state: BlogFormState | null): string {
  if (!state) return '';
  const body = state.content_blocks.map(blockText).filter(Boolean).join('\n\n');
  const assets = uniqueUrls(readUrlCandidates(state.content_blocks));
  return [
    state.title,
    state.excerpt,
    body,
    assets.length ? `Assets\n${assets.map((url) => `- ${url}`).join('\n')}` : '',
  ].filter(Boolean).join('\n\n');
}

function buildHtmlDownload(state: BlogFormState | null): string {
  if (!state) return '';
  const body = state.content_blocks.map(blockHtml).filter(Boolean).join('\n');
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${escapeHtml(state.title)}</title>
  <style>
    body{font-family:Inter,Arial,sans-serif;color:#24384d;line-height:1.7;max-width:820px;margin:40px auto;padding:0 20px}
    h1{color:#07182b;font-size:42px;line-height:1.15} h2{color:#07182b;margin-top:42px}
    img{display:block;max-width:100%;height:auto;border-radius:14px;margin:16px auto}
    figure{margin:30px 0;padding:12px;border:1px solid #e5e7eb;border-radius:16px;background:#fff}
    figcaption{color:#64748b;text-align:center;font-size:14px}
    aside{border-left:4px solid #0a66c2;background:#f5f9ff;padding:16px 20px;margin:26px 0}
  </style>
</head>
<body>
  <h1>${escapeHtml(state.title)}</h1>
  ${state.excerpt ? `<p><strong>${escapeHtml(state.excerpt)}</strong></p>` : ''}
  ${body}
</body>
</html>`;
}

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
  // Promotion workflow (PHASE BLOG-PROMOTION-2) — text-only platform drafts.
  const [promoteModalOpen, setPromoteModalOpen] = useState(false);
  const [promoteGenerating, setPromoteGenerating] = useState(false);
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [workspaceSeeds, setWorkspaceSeeds] = useState<WorkspacePlatformSeed[]>([]);
  const [workspaceBlogUrl, setWorkspaceBlogUrl] = useState('');
  const [improvingArea, setImprovingArea] = useState<ImproveArea | null>(null);
  const [improvingIssueKey, setImprovingIssueKey] = useState<string | null>(null);
  const [cmsIntegrations, setCmsIntegrations] = useState<CmsIntegrationOption[]>([]);
  const [socialAccounts, setSocialAccounts] = useState<ConnectedSocialAccount[]>([]);
  const [hasLeadCapture, setHasLeadCapture] = useState<boolean>(false);
  const [isPostingBlog, setIsPostingBlog] = useState<boolean>(false);
  const [postBlogStatus, setPostBlogStatus] = useState<PostBlogStatus | null>(null);
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
    let active = true;
    Promise.all([
      fetch(`/api/integrations?company_id=${encodeURIComponent(selectedCompanyId)}`, { credentials: 'include' })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
      fetch(`/api/social-accounts/status?companyId=${encodeURIComponent(selectedCompanyId)}`, { credentials: 'include' })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
    ]).then(([integrationData, socialData]) => {
      if (!active) return;
      const integrations = Array.isArray(integrationData?.integrations) ? integrationData.integrations : [];
      setCmsIntegrations(
        integrations
          .filter((item: { type: string; status: string }) => CMS_INTEGRATION_TYPES.has(item.type) && item.status === 'connected')
          .map((item: { id: string; type: string; name: string }) => ({ id: item.id, type: item.type, name: item.name })),
      );
      setHasLeadCapture(
        integrations.some((item: { type: string; status: string }) => item.type === 'lead_webhook' && item.status === 'connected'),
      );
      setSocialAccounts(
        (Array.isArray(socialData?.accounts) ? socialData.accounts : [])
          .filter((account: ConnectedSocialAccount) => account.connected && (account.category === 'social' || account.platform_key === 'medium')),
      );
    }).catch(() => {
      if (!active) return;
      setCmsIntegrations([]);
      setSocialAccounts([]);
      setHasLeadCapture(false);
    });
    return () => {
      active = false;
    };
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

  const saveBlogState = async (state: BlogFormState): Promise<string | null> => {
    if (!selectedCompanyId) {
      throw new Error('Company context required to save blog post.');
    }

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
    const nextId = (data?.id ?? data?.blog?.id ?? editId) || null;
    setSavedId(nextId);
    return nextId;
  };

  const handleSubmit = async (state: BlogFormState) => {
    setError(null);
    setPostBlogStatus(null);
    setIsSaving(true);
    try {
      await saveBlogState(state);
      setPrefillNotice(isEditing ? 'Blog updated. You can now copy, export, or mark it as used.' : 'Blog post saved. You can now copy, export, or mark it as used.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setIsSaving(false);
    }
  };

  const handlePostBlogToWebsite = async (targetIntegration?: CmsIntegrationOption) => {
    if (!selectedCompanyId) {
      setError('Company context required to post the blog.');
      return;
    }
    const integration = targetIntegration ?? cmsIntegrations[0] ?? null;
    if (!integration) {
      setError('Connect a website CMS integration before posting.');
      return;
    }
    if (!liveState) {
      setError('Blog draft is still loading. Try again in a moment.');
      return;
    }
    setError(null);
    setPostBlogStatus({ type: 'info', message: 'Saving draft before publishing...' });
    setIsPostingBlog(true);
    try {
      const blogId = savedId || await saveBlogState({ ...liveState, status: 'draft' });
      if (!blogId) throw new Error('Could not save the blog before posting.');
      setPostBlogStatus({ type: 'info', message: `Draft saved. Queuing publish to ${integration.name}...` });
      const res = await fetch(`/api/blogs/${encodeURIComponent(blogId)}/publish`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company_id: selectedCompanyId,
          integration_id: integration.id,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.success === false) {
        throw new Error(data?.message || data?.error || 'Publish failed');
      }
      const successMessage = data?.message
        ? String(data.message)
        : `Publishing job queued for ${integration.name}.`;
      setPostBlogStatus({ type: 'success', message: successMessage });
      setPrefillNotice(`Blog posted to website via ${integration.name}.`);
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Publish failed';
      setPostBlogStatus({ type: 'error', message });
      setError(message);
    } finally {
      setIsPostingBlog(false);
    }
  };

  // PHASE BLOG-PROMOTION-2 — "Promote on social" opens a platform-selection
  // modal (no immediate launch). On generate, each selected platform is run
  // through the existing adaptation flow to produce a text-only promotional
  // draft, then the in-app Promotion Workspace opens. No creator/asset path.
  const openPromoteModal = () => {
    if (!liveState) {
      setError('Generate and save a draft before sharing.');
      return;
    }
    setPromoteModalOpen(true);
  };

  const handleGeneratePromotionDrafts = async (selectedKeys: string[]) => {
    if (!liveState) return;
    setPromoteGenerating(true);
    const source = liveState.content_markdown || buildTextDownload(liveState);
    const topic = liveState.title;
    const canonicalUrl = resolveCanonicalContentUrl({
      status: liveState.status,
      slug: liveState.slug,
      origin: typeof window !== 'undefined' ? window.location.origin : null,
    });
    try {
      const seeds: WorkspacePlatformSeed[] = await Promise.all(
        selectedKeys.map(async (key): Promise<WorkspacePlatformSeed> => {
          const account = connectedSocialByPlatform.get(key);
          let promotionalText = '';
          try {
            const resp = await fetch('/api/content/quick-platform-adapt', {
              method: 'POST',
              credentials: 'include',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                platform: key,
                content: source,
                contentType: 'post',
                companyId: selectedCompanyId || undefined,
                topic,
              }),
            });
            const data = await resp.json().catch(() => ({}));
            if (resp.ok) promotionalText = String(data?.variant?.generated_content || '').trim();
          } catch {
            // Leave empty; the workspace lets the user Regenerate per platform.
          }
          return {
            platform: key,
            label: account?.platform_label || key,
            accountId: account?.social_account_id ?? null,
            promotionalText,
          };
        }),
      );
      setWorkspaceSeeds(seeds);
      setWorkspaceBlogUrl(canonicalUrl);
      setPromoteModalOpen(false);
      setWorkspaceOpen(true);
    } finally {
      setPromoteGenerating(false);
    }
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

  const draftShareReady = Boolean(savedId && liveState?.title?.trim() && (liveState.content_markdown?.trim() || liveState.content_blocks.length > 0));
  const shareDisabledReason = draftShareReady ? null : 'Generate and save a draft before sharing.';
  const connectedSocialByPlatform = new Map(
    socialAccounts.map((account) => [account.platform_key === 'twitter' ? 'x' : account.platform_key, account]),
  );
  const publishDestinations = cmsIntegrations.map((integration) => ({
    key: integration.id,
    label: CMS_LABELS[integration.type] || integration.name || 'Other CMS',
    detail: integration.name,
    onClick: () => handlePostBlogToWebsite(integration),
  }));
  // Connected social platforms offered in the promotion modal — sourced from
  // the connected-account registry (no hardcoded list).
  const promotePlatforms: PromotablePlatform[] = Array.from(connectedSocialByPlatform.entries()).map(
    ([platform, account]) => ({
      key: platform,
      label: account.platform_label || platform,
      accountId: account.social_account_id ?? null,
    }),
  );
  // A single "Promote on social" action that opens the platform-selection modal.
  const repurposeDestinations = promotePlatforms.length > 0
    ? [{
        key: 'promote-on-social',
        label: 'Promote on social',
        detail: `${promotePlatforms.length} connected platform${promotePlatforms.length === 1 ? '' : 's'}`,
        onClick: openPromoteModal,
      }]
    : [];

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
                downloads={[
                  {
                    label: 'Download text + assets',
                    fileName: `${safeFileStem(liveState?.title || 'blog-post')}-with-assets.txt`,
                    content: buildTextDownload(liveState),
                    mimeType: 'text/plain;charset=utf-8',
                  },
                  {
                    label: 'Download HTML',
                    fileName: `${safeFileStem(liveState?.title || 'blog-post')}.html`,
                    content: buildHtmlDownload(liveState),
                    mimeType: 'text/html;charset=utf-8',
                  },
                ]}
                shareDisabledReason={shareDisabledReason}
                publishDestinations={publishDestinations}
                repurposeDestinations={repurposeDestinations}
                onMarkUsed={handleMarkUsed}
                markUsedOptions={[
                  { label: 'General use' },
                  { label: 'Website', value: 'website' },
                  { label: 'LinkedIn', value: 'linkedin' },
                  { label: 'Email', value: 'email' },
                ]}
              />

              <PromotePlatformModal
                open={promoteModalOpen}
                platforms={promotePlatforms}
                generating={promoteGenerating}
                onCancel={() => setPromoteModalOpen(false)}
                onGenerate={handleGeneratePromotionDrafts}
              />
              <PromotionWorkspace
                open={workspaceOpen}
                contentId={savedId || liveState?.slug || liveState?.title || 'unsaved'}
                contentType="blog"
                title={liveState?.title || ''}
                topic={liveState?.title || ''}
                sourceContent={liveState?.content_markdown || buildTextDownload(liveState)}
                companyId={selectedCompanyId}
                blogUrl={workspaceBlogUrl}
                seeds={workspaceSeeds}
                onClose={() => setWorkspaceOpen(false)}
              />
            </div>

            {/* ── Quality panel (sticky right sidebar) ────────────────────── */}
            <div className="hidden lg:block w-[280px] shrink-0 sticky top-6 self-start">
              {liveState && (() => {
                const websiteIntegrationAvailable = cmsIntegrations.length > 0;
                let websiteIntegrationReason: string | undefined;
                const primaryCmsIntegration = cmsIntegrations[0] ?? null;
                if (!primaryCmsIntegration) {
                  websiteIntegrationReason = 'Connect a website CMS (WordPress, HubSpot, etc.) in Integrations to enable posting.';
                } else if (!hasLeadCapture) {
                  websiteIntegrationReason = `Connected to ${primaryCmsIntegration.name}. Posting is available; add lead capture for full attribution.`;
                } else if (!savedId) {
                  websiteIntegrationReason = 'Posting is available. We will save this draft before publishing it.';
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
                    postBlogStatus={postBlogStatus}
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
