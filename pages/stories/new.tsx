'use client';

import React, { useEffect, useRef, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { BlogEditorForm, type BlogFormState } from '../../components/blog/BlogEditorForm';
import { ContentQualityPanel, type ImproveArea } from '../../components/content/ContentQualityPanel';
import EditorShareActions from '../../components/content/EditorShareActions';
import { createBlock } from '../../lib/blog/blockUtils';
import { checkDuplication, type DuplicationResult, type ExistingPostMeta } from '../../lib/blog/topicDetection';
import { AlertTriangle, XCircle, Loader2 } from 'lucide-react';
import { useCompanyContext } from '../../components/CompanyContext';
import type { BlogGenerationOutput } from '../../lib/blog/blogGenerationEngine';
import type { ContentBlock, HeadingBlock } from '../../lib/blog/blockTypes';
import { launchCampaignFromContent } from '../../lib/content/launchCampaignFromContent';
import { resolveGeneratedPrefillBlocks } from '../../lib/content/editorPrefill';
import { launchSocialPostingFromContent } from '../../lib/content/socialPosting';
import { useCompanyIdentity } from '../../hooks/useCompanyIdentity';

function createDefaultStoryTemplate() {
  const opening = createBlock('paragraph');
  const moment = createBlock('heading') as HeadingBlock;
  moment.text = 'The Moment Everything Shifted';
  moment.anchor = 'the-moment-everything-shifted';
  const momentBody = createBlock('paragraph');
  const friction = createBlock('heading') as HeadingBlock;
  friction.text = 'The Friction Underneath';
  friction.anchor = 'the-friction-underneath';
  const frictionBody = createBlock('paragraph');
  const turn = createBlock('heading') as HeadingBlock;
  turn.text = 'The Turn';
  turn.anchor = 'the-turn';
  const turnBody = createBlock('paragraph');
  const reflection = createBlock('heading') as HeadingBlock;
  reflection.text = 'What Stayed With Them';
  reflection.anchor = 'what-stayed-with-them';
  const reflectionBody = createBlock('paragraph');
  return [opening, moment, momentBody, friction, frictionBody, turn, turnBody, reflection, reflectionBody];
}

const DEFAULT_TEMPLATE = createDefaultStoryTemplate();

function sanitizeStoryEditorText(value: string): string {
  return String(value || '')
    .replace(/^The Moment The Turning Point That Changed Everything Became Real$/i, 'The Turn in the Room')
    .replace(/^The Moment The Turning Point Became Real$/i, 'The Turn in the Room')
    .replace(/^The Moment (.+?) Became Real$/i, '$1')
    .replace(/^The Choice That Changed The Turning Point$/i, 'The Choice That Changed the Room')
    .replace(/\bThe Moment The Turning Point\b/gi, 'The Turning Point')
    .replace(/\b(short story|long story|episodic story)\s*:\s*/gi, '')
    .replace(/\bThe Moment It Became Real should stay close to one compact scene[^.]*\.\s*/gi, '')
    .replace(/\bthe turning point that changed everything becomes real through a specific moment, not through an explanation\.\s*/gi, '')
    .replace(/\bPut the reader close to a person, team, customer, place, or object that makes the tension visible\.\s*/gi, '')
    .replace(/\bUse one concrete detail:[^.]*\.\s*/gi, '')
    .replace(/\bThat detail gives the beat its own job in the story\.\s*/gi, '')
    .replace(/\bLet the turn emerge from action:[^.]*\.\s*/gi, '')
    .replace(/\bDo not restate the topic as advice\.\s*/gi, '')
    .replace(/\bshould stay close\b/gi, 'stays close')
    .replace(/\bshould move\b/gi, 'moves')
    .replace(/\bshould deepen\b/gi, 'deepens')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function isLeakedStoryGuidance(value: string): boolean {
  return /\b(should stay close|Put the reader close|Use one concrete detail|Let the turn emerge|Do not restate the topic|that detail gives the beat)\b/i.test(value);
}

function stripHtml(value: string): string {
  return value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function sanitizeStoryBlocks(blocks: BlogFormState['content_blocks']): BlogFormState['content_blocks'] {
  return blocks
    .map((block): ContentBlock | null => {
      if (block.type === 'heading') {
        const text = sanitizeStoryEditorText(block.text);
        return { ...block, text };
      }
      if (block.type === 'paragraph') {
        const plain = stripHtml(block.html);
        if (isLeakedStoryGuidance(plain)) return null;
        return { ...block, html: sanitizeStoryEditorText(block.html) };
      }
      if (block.type === 'summary') {
        const body = sanitizeStoryEditorText(block.body);
        return body ? { ...block, body } : null;
      }
      if (block.type === 'callout') {
        const title = block.title ? sanitizeStoryEditorText(block.title) : block.title;
        const body = sanitizeStoryEditorText(block.body);
        return { ...block, title, body };
      }
      if (block.type === 'quote') {
        const text = sanitizeStoryEditorText(block.text);
        return text ? { ...block, text } : null;
      }
      return block;
    })
    .filter((block): block is ContentBlock => Boolean(block));
}

type PrefillPayload = {
  output?: (BlogGenerationOutput & { content_blocks?: unknown[]; content_markdown?: string }) | null;
  source?: string;
  target_word_count?: number;
};

export default function StoryNewPage() {
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
  const [targetWordCount, setTargetWordCount] = useState<number>(900);
  const [primaryKeyword, setPrimaryKeyword] = useState<string | null>(null);
  const [secondaryKeywords, setSecondaryKeywords] = useState<string[] | null>(null);

  // Use/Share state
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
          contentType: 'story',
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
          ? `AI improved ${area}. Score +${delta} (now ${after}/80). Review content when ready.`
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
    fetch(`/api/company/blogs?company_id=${selectedCompanyId}&content_type=story`, { credentials: 'include' })
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
        const resolvedBlocks = sanitizeStoryBlocks(resolveGeneratedPrefillBlocks(output, DEFAULT_TEMPLATE));
        setPrefillInitial({
          title: sanitizeStoryEditorText(output.title || ''),
          excerpt: sanitizeStoryEditorText(output.excerpt || ''),
          category: output.category || '',
          tags: Array.isArray(output.tags) ? output.tags : [],
          seo_meta_title: output.seo_meta_title || '',
          seo_meta_description: output.seo_meta_description || '',
          content_blocks: resolvedBlocks,
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

  // ── Save story (draft) ──────────────────────────────────────────────────
  const handleSubmit = async (state: BlogFormState) => {
    if (!selectedCompanyId) {
      setError('Company context required to save story.');
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
          content_type: 'story',
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
      setPrefillNotice('Story saved as draft. Use the options below to share or export.');
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
      contentType: 'story',
      title: liveState.title,
      excerpt: liveState.excerpt,
      tags: liveState.tags,
      targetWordCount,
      sourceId: savedId,
      contentMarkdown: liveState.content_markdown,
    });
  };

  // ── Copy content to clipboard ────────────────────────────────────────────
  const handlePostToSocial = () => {
    if (!liveState) return;
    launchSocialPostingFromContent({
      router,
      contentType: 'story',
      title: liveState.title,
      content: liveState.content_markdown || '',
      tags: liveState.tags,
      excerpt: liveState.excerpt,
      sourceId: savedId,
    });
  };

  // ── Export as text file ──────────────────────────────────────────────────
  // ── Mark as used ─────────────────────────────────────────────────────────
  const handleMarkUsed = async (platform?: string) => {
    if (!savedId || !selectedCompanyId) {
      setError('Save the story first before marking as used.');
      return;
    }
    try {
      const res = await fetch('/api/content/mark-used', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content_id: savedId,
          content_type: 'story',
          company_id: selectedCompanyId,
          platform,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Failed to mark as used');
      setPrefillNotice(`Story marked as used${platform ? ` on ${platform}` : ''}. Great work!`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to mark as used');
    }
  };

  if (!prefillChecked) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <Loader2 className="h-10 w-10 animate-spin text-pink-600" />
      </div>
    );
  }

  return (
    <>
      <Head>
        <title>New Story | Narrative Content</title>
      </Head>
      <div className="min-h-screen bg-gray-50">
        <div className="border-b border-gray-200 bg-white px-4 py-3 sm:px-6">
          <div className="mx-auto flex max-w-[1200px] items-center justify-between">
            <Link href="/dashboard" className="flex shrink-0 items-center" aria-label="Home">
              <img src="/logo.png" alt="Logo" width={100} height={40} className="h-10 w-auto object-contain sm:h-11" />
            </Link>
            <Link href="/stories/generate" className="text-sm font-medium text-gray-600 hover:text-gray-900">
              &larr; Back to Story Intelligence
            </Link>
          </div>
        </div>

        <div className="mx-auto max-w-[1200px] p-6">
          <h1 className="mb-6 text-2xl font-bold text-gray-900">New Story</h1>
          {prefillNotice && (
            <div className="mb-4 rounded-lg border border-pink-200 bg-pink-50 px-4 py-3 text-sm text-pink-700">
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
              <div className="mb-5 rounded-xl border border-pink-100 bg-pink-50 px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-pink-700">Story Direction</p>
                <div className="mt-2 grid gap-2 text-sm leading-6 text-pink-950 sm:grid-cols-2">
                  <p>Start inside someone’s experience: a founder, customer, operator, buyer, or team under pressure.</p>
                  <p>Use story beat headings: scene, friction, turn, aftermath, reflection.</p>
                  <p>Add anecdotes: a meeting moment, customer question, draft revision, delayed launch, or remembered line.</p>
                  <p>Give every beat new information: do not restate the same tension, topic phrase, or lesson under another heading.</p>
                  <p>Close with meaning or emotional payoff, not a truncated summary.</p>
                </div>
              </div>
              <BlogEditorForm
                initial={{
                  content_blocks: DEFAULT_TEMPLATE,
                  ...(prefillInitial || {}),
                }}
                onSubmit={handleSubmit}
                onCancel={() => router.push('/stories/generate')}
                submitLabel="Save Story"
                isSaving={isSaving}
                onStateChange={setLiveState}
                externalPatch={editorPatch}
              />

              {/* ── Use / Share Actions ──────────────────────────────────── */}
              <EditorShareActions
                saved={Boolean(savedId)}
                copyText={liveState?.content_markdown || liveState?.title || ''}
                exportText={`# ${liveState?.title || ''}\n\n${liveState?.content_markdown || ''}`}
                exportFileName={`story-${(liveState?.title || 'untitled').toLowerCase().replace(/\s+/g, '-')}.md`}
                onMarkUsed={handleMarkUsed}
                onPostToSocial={handlePostToSocial}
                markUsedOptions={[
                  { label: 'General use' },
                  { label: 'Social Media', value: 'social_media' },
                  { label: 'LinkedIn', value: 'linkedin' },
                  { label: 'Email', value: 'email' },
                  { label: 'Website', value: 'website' },
                ]}
              />
            </div>

            {/* ── Quality panel (sticky right sidebar) ────────────────────── */}
            <div className="hidden lg:block w-[280px] shrink-0 sticky top-6 self-start">
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
                    content_type:         'story',
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
