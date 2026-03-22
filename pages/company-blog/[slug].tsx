/**
 * /company-blog/[slug]
 *
 * Public-facing company blog post reader.
 * Resolves by slug (preferred) or id fallback.
 * Renders content_blocks using BlockRenderer (same as public_blogs reader).
 * Falls back to HTML/markdown content field for older posts.
 *
 * Includes "Repurpose Content" section for authenticated company members:
 * LinkedIn (3 variations) / Twitter thread / Email — with Copy, Edit, Regenerate actions.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import ReactMarkdown from 'react-markdown';
import rehypeRaw from 'rehype-raw';
import {
  ArrowLeft, Loader2, Calendar, Clock,
  Repeat2, Copy, Check, RefreshCw, ChevronDown, ChevronUp,
} from 'lucide-react';
import LandingNavbar from '../../components/landing/LandingNavbar';
import { BlockRenderer } from '../../components/blog/BlockRenderer';
import type { ContentBlock } from '../../lib/blog/blockTypes';
import { estimateReadTimeFromBlocks } from '../../lib/blog/blockUtils';
import type { RepurposeOutput, LinkedInVariation } from '../../lib/blog/blogRepurposingEngine';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface BlogPost {
  id:                   string;
  title:                string;
  slug:                 string | null;
  excerpt:              string | null;
  content:              string | null;
  content_blocks:       ContentBlock[] | null;
  featured_image_url:   string | null;
  category:             string | null;
  tags:                 string[];
  seo_meta_title:       string | null;
  seo_meta_description: string | null;
  published_at:         string | null;
  created_at:           string;
}

type RepurposeTab = 'linkedin' | 'twitter' | 'email';
type LinkedInTab  = LinkedInVariation;
type ToneOption   = 'professional' | 'conversational' | 'bold' | 'educational';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

function estimateReadTimeMarkdown(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.ceil(words / 200));
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };
  return (
    <button
      onClick={copy}
      className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-gray-600 hover:bg-gray-50 transition-colors"
    >
      {copied ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
      {copied ? 'Copied!' : label}
    </button>
  );
}

interface EditableTextProps {
  value:    string;
  onChange: (v: string) => void;
}
function EditableText({ value, onChange }: EditableTextProps) {
  const ref = useRef<HTMLTextAreaElement>(null);
  // Auto-resize
  useEffect(() => {
    if (ref.current) {
      ref.current.style.height = 'auto';
      ref.current.style.height = ref.current.scrollHeight + 'px';
    }
  }, [value]);
  return (
    <textarea
      ref={ref}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full resize-none rounded-lg border border-[#0A66C2]/30 bg-white p-3 text-sm text-gray-800 leading-relaxed focus:outline-none focus:ring-2 focus:ring-[#0A66C2]/20"
      rows={6}
    />
  );
}

// ---------------------------------------------------------------------------
// RepurposePanel
// ---------------------------------------------------------------------------

interface RepurposePanelProps {
  blogId:    string;
  companyId: string | null;
}

function RepurposePanel({ blogId, companyId }: RepurposePanelProps) {
  const [open,        setOpen]        = useState(false);
  const [loading,     setLoading]     = useState(false);
  const [error,       setError]       = useState<string | null>(null);
  const [output,      setOutput]      = useState<RepurposeOutput | null>(null);
  const [tab,         setTab]         = useState<RepurposeTab>('linkedin');
  const [linkedInTab, setLinkedInTab] = useState<LinkedInTab>('insight-led');
  const [tone,        setTone]        = useState<ToneOption>('professional');

  // Editable overrides (keyed so each variation / section can be edited independently)
  const [edits, setEdits] = useState<Record<string, string>>({});

  const generate = useCallback(async (selectedTone: ToneOption) => {
    setLoading(true);
    setError(null);
    setEdits({});
    try {
      const body: Record<string, string> = { tone: selectedTone, source: 'company' };
      if (companyId) body.company_id = companyId;

      const r = await fetch(`/api/blogs/${blogId}/repurpose`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error('Generation failed');
      const d = await r.json();
      setOutput(d.repurpose ?? null);
    } catch {
      setError('Could not generate repurposed content. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [blogId, companyId]);

  const handleOpen = () => {
    setOpen(true);
    if (!output && !loading) generate(tone);
  };

  const handleRegenerate = () => generate(tone);

  const handleToneChange = (t: ToneOption) => {
    setTone(t);
    if (output) generate(t); // re-generate immediately when tone changes
  };

  // Get current text (edited override or original)
  const getLinkedInContent = (variation: LinkedInTab): string => {
    const key = `linkedin_${variation}`;
    if (key in edits) return edits[key];
    return output?.linkedin_posts?.find((p) => p.variation === variation)?.content ?? '';
  };

  const getTwitterContent = (): string => {
    const key = 'twitter';
    if (key in edits) return edits[key];
    return output?.twitter_thread?.join('\n\n') ?? '';
  };

  const getEmailContent = (field: 'subject' | 'preview' | 'cta' | 'bullets'): string => {
    const key = `email_${field}`;
    if (key in edits) return edits[key];
    if (!output) return '';
    if (field === 'bullets') return output.email.bullet_insights.join('\n');
    return (output.email as any)[field] ?? '';
  };

  const setEdit = (key: string, val: string) => setEdits((prev) => ({ ...prev, [key]: val }));

  // ── Render ──────────────────────────────────────────────────────────────

  return (
    <div className="mt-12 border-t border-gray-100 pt-10">
      {/* Header row */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-lg font-bold text-gray-900">Repurpose Content</h2>
          <p className="text-xs text-gray-500 mt-0.5">Generate LinkedIn posts, Twitter threads &amp; email copy from this article.</p>
        </div>
        <button
          onClick={open ? () => setOpen(false) : handleOpen}
          className="inline-flex items-center gap-2 rounded-full bg-[#0A66C2] px-4 py-2 text-xs font-semibold text-white hover:bg-[#0A66C2]/90 transition-colors shadow-sm"
        >
          <Repeat2 className="h-3.5 w-3.5" />
          {open ? 'Hide' : 'Repurpose this article'}
          {open ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        </button>
      </div>

      {open && (
        <div className="rounded-2xl border border-gray-100 bg-gray-50 p-6">

          {/* Tone + Regenerate */}
          <div className="flex flex-wrap items-center gap-3 mb-6">
            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Tone:</span>
            {(['professional', 'conversational', 'bold', 'educational'] as ToneOption[]).map((t) => (
              <button
                key={t}
                onClick={() => handleToneChange(t)}
                className={`rounded-full px-3 py-1 text-xs font-semibold capitalize transition-colors ${
                  tone === t
                    ? 'bg-[#0A66C2] text-white'
                    : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-100'
                }`}
              >
                {t}
              </button>
            ))}
            {output && !loading && (
              <button
                onClick={handleRegenerate}
                className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-gray-600 hover:bg-gray-50 transition-colors"
              >
                <RefreshCw className="h-3.5 w-3.5" /> Regenerate all
              </button>
            )}
          </div>

          {/* Loading */}
          {loading && (
            <div className="flex items-center justify-center py-16 gap-2 text-gray-400">
              <Loader2 className="h-5 w-5 animate-spin" />
              <span className="text-sm">Generating repurposed content…</span>
            </div>
          )}

          {/* Error */}
          {!loading && error && (
            <p className="text-sm text-red-500 text-center py-8">{error}</p>
          )}

          {/* Content */}
          {!loading && !error && output && (
            <>
              {/* Platform tabs */}
              <div className="flex gap-1 mb-6 border-b border-gray-200">
                {(['linkedin', 'twitter', 'email'] as RepurposeTab[]).map((t) => (
                  <button
                    key={t}
                    onClick={() => setTab(t)}
                    className={`px-4 py-2 text-xs font-semibold capitalize transition-colors border-b-2 -mb-px ${
                      tab === t
                        ? 'border-[#0A66C2] text-[#0A66C2]'
                        : 'border-transparent text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    {t === 'linkedin' ? 'LinkedIn' : t === 'twitter' ? 'Twitter / X' : 'Email'}
                  </button>
                ))}
              </div>

              {/* ── LinkedIn ── */}
              {tab === 'linkedin' && (
                <div>
                  {/* Variation tabs */}
                  <div className="flex gap-2 mb-4">
                    {(['insight-led', 'story-led', 'contrarian'] as LinkedInTab[]).map((v) => (
                      <button
                        key={v}
                        onClick={() => setLinkedInTab(v)}
                        className={`rounded-full px-3 py-1 text-[11px] font-semibold capitalize transition-colors ${
                          linkedInTab === v
                            ? 'bg-[#0A66C2]/10 text-[#0A66C2]'
                            : 'bg-white border border-gray-200 text-gray-500 hover:bg-gray-50'
                        }`}
                      >
                        {output.linkedin_posts.find((p) => p.variation === v)?.label ?? v}
                      </button>
                    ))}
                  </div>

                  <EditableText
                    value={getLinkedInContent(linkedInTab)}
                    onChange={(v) => setEdit(`linkedin_${linkedInTab}`, v)}
                  />

                  <div className="flex gap-2 mt-3">
                    <CopyButton text={getLinkedInContent(linkedInTab)} label="Copy post" />
                  </div>
                </div>
              )}

              {/* ── Twitter ── */}
              {tab === 'twitter' && (
                <div>
                  <div className="space-y-3 mb-4">
                    {(output.twitter_thread).map((tweet, i) => {
                      const editKey = `twitter_tweet_${i}`;
                      const val = editKey in edits ? edits[editKey] : tweet;
                      return (
                        <div key={i} className="flex gap-3">
                          <span className="mt-2 flex-shrink-0 text-[11px] font-bold text-gray-400 w-5 text-right">{i + 1}</span>
                          <div className="flex-1">
                            <EditableText
                              value={val}
                              onChange={(v) => setEdit(editKey, v)}
                            />
                            <p className={`text-[10px] mt-1 text-right ${val.length > 280 ? 'text-red-500' : 'text-gray-400'}`}>
                              {val.length}/280
                            </p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <CopyButton
                    text={output.twitter_thread.map((t, i) => {
                      const key = `twitter_tweet_${i}`;
                      return key in edits ? edits[key] : t;
                    }).join('\n\n')}
                    label="Copy full thread"
                  />
                </div>
              )}

              {/* ── Email ── */}
              {tab === 'email' && (
                <div className="space-y-5">
                  <div>
                    <label className="block text-[11px] font-bold text-gray-500 uppercase tracking-wide mb-1">Subject line</label>
                    <input
                      type="text"
                      value={getEmailContent('subject')}
                      onChange={(e) => setEdit('email_subject', e.target.value)}
                      maxLength={80}
                      className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-[#0A66C2]/20"
                    />
                    <p className="text-[10px] text-gray-400 mt-1 text-right">{getEmailContent('subject').length}/80</p>
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold text-gray-500 uppercase tracking-wide mb-1">Preview text</label>
                    <input
                      type="text"
                      value={getEmailContent('preview')}
                      onChange={(e) => setEdit('email_preview', e.target.value)}
                      maxLength={120}
                      className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-[#0A66C2]/20"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold text-gray-500 uppercase tracking-wide mb-1">Key bullet insights</label>
                    <EditableText
                      value={getEmailContent('bullets')}
                      onChange={(v) => setEdit('email_bullets', v)}
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold text-gray-500 uppercase tracking-wide mb-1">CTA button label</label>
                    <input
                      type="text"
                      value={getEmailContent('cta')}
                      onChange={(e) => setEdit('email_cta', e.target.value)}
                      className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-[#0A66C2]/20"
                    />
                  </div>

                  <CopyButton
                    text={[
                      `Subject: ${getEmailContent('subject')}`,
                      `Preview: ${getEmailContent('preview')}`,
                      '',
                      getEmailContent('bullets'),
                      '',
                      `CTA: ${getEmailContent('cta')}`,
                    ].join('\n')}
                    label="Copy email copy"
                  />
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function CompanyBlogPost() {
  const router    = useRouter();
  const { slug }  = router.query;
  const companyId = typeof router.query.company_id === 'string' ? router.query.company_id : null;

  const [post,    setPost]    = useState<BlogPost | null>(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);

  useEffect(() => {
    if (!slug) return;

    const slugStr = typeof slug === 'string' ? slug : (slug as string[])[0];
    if (!slugStr) return;

    setLoading(true);
    setError(null);

    const qs = companyId
      ? `slug=${encodeURIComponent(slugStr)}&company_id=${encodeURIComponent(companyId)}`
      : `id=${encodeURIComponent(slugStr)}`;

    fetch(`/api/blogs/${slugStr}/public?${qs}`)
      .then((r) => r.ok ? r.json() : Promise.reject(new Error('Not found')))
      .then((d) => setPost(d.post ?? null))
      .catch(() => setError('This post could not be found.'))
      .finally(() => setLoading(false));
  }, [slug, companyId]);

  const hasBlocks = Array.isArray(post?.content_blocks) && (post!.content_blocks!).length > 0;
  const readTime  = hasBlocks
    ? estimateReadTimeFromBlocks(post!.content_blocks!)
    : estimateReadTimeMarkdown(post?.content ?? '');

  const backHref  = companyId
    ? `/company-blog?company_id=${companyId}`
    : '/company-blog';

  const pageTitle = post?.seo_meta_title ?? post?.title ?? 'Blog';
  const pageDesc  = post?.seo_meta_description ?? post?.excerpt ?? '';

  return (
    <>
      <Head>
        <title>{pageTitle}</title>
        {pageDesc && <meta name="description" content={pageDesc} />}
        {post?.featured_image_url && <meta property="og:image" content={post.featured_image_url} />}
      </Head>
      <LandingNavbar />

      <main className="min-h-screen bg-white">

        {/* Loading */}
        {loading && (
          <div className="flex items-center justify-center min-h-screen text-gray-400 gap-2">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span className="text-sm">Loading…</span>
          </div>
        )}

        {/* Error */}
        {!loading && error && (
          <div className="flex flex-col items-center justify-center min-h-screen gap-4 text-gray-500">
            <p className="text-sm">{error}</p>
            <Link href={backHref} className="text-xs text-[#0A66C2] hover:underline">
              ← Back to blog
            </Link>
          </div>
        )}

        {/* Post */}
        {!loading && !error && post && (
          <article>
            {/* Hero */}
            {post.featured_image_url && (
              <div className="h-64 sm:h-96 w-full overflow-hidden">
                <img
                  src={post.featured_image_url}
                  alt={post.title}
                  className="h-full w-full object-cover"
                />
              </div>
            )}

            <div className="max-w-3xl mx-auto px-4 sm:px-6 py-12">

              {/* Back */}
              <Link
                href={backHref}
                className="inline-flex items-center gap-1.5 text-xs text-gray-400 hover:text-[#0A66C2] mb-8 transition-colors"
              >
                <ArrowLeft className="h-3.5 w-3.5" /> Back to blog
              </Link>

              {/* Category */}
              {post.category && (
                <span className="mb-4 inline-block rounded-full bg-[#0A66C2]/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-[#0A66C2]">
                  {post.category}
                </span>
              )}

              {/* Title */}
              <h1 className="text-3xl sm:text-4xl font-bold text-gray-900 leading-tight mb-4">
                {post.title}
              </h1>

              {/* Meta */}
              <div className="flex items-center gap-4 text-xs text-gray-400 mb-8">
                <span className="flex items-center gap-1">
                  <Calendar className="h-3.5 w-3.5" />
                  {formatDate(post.published_at)}
                </span>
                <span className="flex items-center gap-1">
                  <Clock className="h-3.5 w-3.5" />
                  {readTime} min read
                </span>
              </div>

              {/* Tags */}
              {post.tags && post.tags.length > 0 && (
                <div className="flex flex-wrap gap-2 mb-8">
                  {post.tags.map((t) => (
                    <span key={t} className="rounded-full bg-gray-100 px-3 py-1 text-[11px] text-gray-500">
                      #{t}
                    </span>
                  ))}
                </div>
              )}

              {/* Excerpt */}
              {post.excerpt && (
                <p className="text-lg text-gray-600 leading-relaxed mb-8 font-medium border-l-4 border-[#0A66C2]/30 pl-4">
                  {post.excerpt}
                </p>
              )}

              {/* Content — blocks preferred, markdown/HTML fallback */}
              <div className="prose prose-gray max-w-none">
                {hasBlocks ? (
                  <BlockRenderer blocks={post.content_blocks!} />
                ) : post.content ? (
                  <ReactMarkdown rehypePlugins={[rehypeRaw]}>
                    {post.content}
                  </ReactMarkdown>
                ) : (
                  <p className="text-gray-400 text-sm">No content available.</p>
                )}
              </div>

              {/* Repurpose section (visible when company_id is present) */}
              {companyId && (
                <RepurposePanel blogId={post.id} companyId={companyId} />
              )}

            </div>
          </article>
        )}
      </main>
    </>
  );
}
