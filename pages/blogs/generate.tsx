'use client';

import React, { useEffect, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { Loader2, Sparkles, AlertCircle } from 'lucide-react';
import BlogGenerateModal from '../../components/blog/BlogGenerateModal';
import { useCompanyContext } from '../../components/CompanyContext';
import type { BlogGenerationOutput } from '../../lib/blog/blogGenerationEngine';
import { BLOG_FORMAT_OPTIONS, isValidBlogFormat, type BlogFormatType } from '../../lib/blog/blogStructureTemplates';
import type { ContentBlock } from '../../lib/blog/blockTypes';
import type { BriefInsight, DraftFieldSuggestions, TemplateSessionPayload, EnrichedGap } from '../blogs.types';





type BlogPost = {
  id: string;
  title: string;
  slug: string | null;
  angle_type?: string | null;
};


function appendPointer(existing: string, nextPointer: string, separator: string): string {
  const next = (nextPointer || '').trim();
  if (!next) return existing;

  const current = (existing || '').trim();
  if (!current) return next;

  const normalizedCurrent = current
    .split(separator)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  if (normalizedCurrent.includes(next.toLowerCase())) return current;
  return `${current}${separator}${next}`;
}

export default function BlogGeneratePage() {
  const router = useRouter();
  const { selectedCompanyId } = useCompanyContext();

  const prefillTopic = typeof router.query.prefill_topic === 'string' ? router.query.prefill_topic.trim() : '';
  const prefillReason = typeof router.query.prefill_reason === 'string' ? router.query.prefill_reason.trim() : '';
  const prefillBriefToken = typeof router.query.prefill_brief === 'string' ? router.query.prefill_brief.trim() : '';
  const prefillCardToken = typeof router.query.prefill_card === 'string' ? router.query.prefill_card.trim() : '';
  const prefillSuggestionsToken = typeof router.query.prefill_suggestions === 'string' ? router.query.prefill_suggestions.trim() : '';
  const templateToken = typeof router.query.tpl === 'string' ? router.query.tpl.trim() : '';
  const prefillFormat = typeof router.query.prefill_format === 'string' && isValidBlogFormat(router.query.prefill_format) ? router.query.prefill_format : null;

  const prefillWords = typeof router.query.words === 'string' && ['800', '1200', '1600', '2000'].includes(router.query.words) ? router.query.words : null;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [posts, setPosts] = useState<BlogPost[]>([]);
  const [showGenerator, setShowGenerator] = useState(false);
  const [brief, setBrief] = useState<BriefInsight | null>(null);
  // Topic is editable: prefilled flows (recommended card / brief) seed it via
  // the effect below; the write-your-own flow (no prefill_topic) lets the user
  // type it, which is what activates "Suggest Inputs" + the generator.
  const [topic, setTopic] = useState('');
  const [targetWords, setTargetWords] = useState(prefillWords || (prefillFormat === 'pillar' ? '3000' : '1200'));
  const [uniquenessDirective, setUniquenessDirective] = useState('');
  const [mustInclude, setMustInclude] = useState('');
  const [campaignObjective, setCampaignObjective] = useState('');
  const [trendContext, setTrendContext] = useState('');
  const [readerStage, setReaderStage] = useState('decision-makers');
  const [ctaPreference, setCtaPreference] = useState('soft educational CTA');
  const [suggestions, setSuggestions] = useState<DraftFieldSuggestions | null>(null);
  const [suggesting, setSuggesting] = useState(false);
  const [suggestionError, setSuggestionError] = useState<string | null>(null);
  const [templateBlocks, setTemplateBlocks] = useState<ContentBlock[] | undefined>(undefined);
  const [templateName, setTemplateName] = useState<string | undefined>(undefined);
  const [formatType, setFormatType] = useState<BlogFormatType>(() => {
    const qf = router.query.format;
    if (typeof qf === 'string' && isValidBlogFormat(qf)) return qf;
    return prefillFormat || 'standard';
  });

  useEffect(() => {
    const bootstrap = async () => {
      setLoading(true);
      setError(null);
      try {
        const postsRes = await fetch(`/api/company/blogs?company_id=${selectedCompanyId}`, { credentials: 'include' });

        if (!postsRes.ok) {
          throw new Error('Unable to load your blog posts.');
        }

        const postsJson = await postsRes.json().catch(() => ({})) as {
          blogs?: Array<{ id: string; title: string; slug: string | null; angle_type?: string | null }>;
        };
        setPosts((postsJson.blogs || []).map((p) => ({
          id: p.id,
          title: p.title,
          slug: p.slug,
          angle_type: p.angle_type || null,
        })));

        // Load prefilled brief from sessionStorage if provided
        if (prefillBriefToken && typeof window !== 'undefined') {
          const rawBrief = sessionStorage.getItem(prefillBriefToken);
          if (rawBrief) {
            const parsed = JSON.parse(rawBrief) as BriefInsight;
            setBrief(parsed);
            sessionStorage.removeItem(prefillBriefToken);
          }
        }

        // Load AI card data from sessionStorage if provided (from AIBlogCardModal)
        if (prefillCardToken && typeof window !== 'undefined') {
          const rawCard = sessionStorage.getItem(prefillCardToken);
          if (rawCard) {
            try {
              const card = JSON.parse(rawCard) as {
                topic?: string;
                intent?: 'awareness' | 'authority' | 'conversion' | 'retention';
                audience?: string;
                reason?: string;
                tone?: string;
                writingStyle?: string;
              };
              // Map AI card fields into a BriefInsight so existing generator picks them up
              setBrief((prev) => ({
                company_id: selectedCompanyId || '',
                company_context: '',
                current_content: '',
                writing_style: card.writingStyle || '',
                related_titles: [],
                intent: card.intent || 'awareness',
                tone: card.tone || '',
                ...prev,
              }));
            } catch {
              // ignore malformed token
            }
            sessionStorage.removeItem(prefillCardToken);
          }
        }

        // Load pre-fetched suggestions from intelligence page
        if (prefillSuggestionsToken && typeof window !== 'undefined') {
          const rawSug = sessionStorage.getItem(prefillSuggestionsToken);
          if (rawSug) {
            try {
              const parsed = JSON.parse(rawSug) as DraftFieldSuggestions;
              setSuggestions(parsed);
              // Auto-prime empty fields with first suggestion
              if (parsed.uniqueness_directive_options?.[0]) setUniquenessDirective(parsed.uniqueness_directive_options[0]);
              if (parsed.must_include_points_options?.[0]) setMustInclude(parsed.must_include_points_options[0]);
              if (parsed.campaign_objective_options?.[0]) setCampaignObjective(parsed.campaign_objective_options[0]);
              if (parsed.trend_context_options?.[0]) setTrendContext(parsed.trend_context_options[0]);
            } catch {}
            sessionStorage.removeItem(prefillSuggestionsToken);
          }
        }

        if (templateToken && typeof window !== 'undefined') {
          const rawTemplate = sessionStorage.getItem(templateToken);
          if (rawTemplate) {
            try {
              const parsed = JSON.parse(rawTemplate) as ContentBlock[] | TemplateSessionPayload;
              if (Array.isArray(parsed)) {
                setTemplateBlocks(parsed);
              } else if (parsed && Array.isArray(parsed.blocks)) {
                setTemplateBlocks(parsed.blocks);
                if (typeof parsed.template_name === 'string' && parsed.template_name.trim()) {
                  setTemplateName(parsed.template_name.trim());
                }
                if (typeof parsed.format_type === 'string' && isValidBlogFormat(parsed.format_type)) {
                  setFormatType(parsed.format_type);
                }
              }
            } catch {
              // ignore malformed template session payload
            }
            sessionStorage.removeItem(templateToken);
          }
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to initialize generator.');
      } finally {
        setLoading(false);
      }
    };

    if (selectedCompanyId) {
      void bootstrap();
    }
  }, [selectedCompanyId, prefillBriefToken, prefillCardToken, prefillSuggestionsToken, templateToken]);

  // Seed the editable topic from the URL prefill once it resolves (router
  // query is empty on first render). User edits are preserved — only a
  // non-empty prefill overrides, and only when the field is still untouched.
  useEffect(() => {
    if (prefillTopic) setTopic((cur) => (cur ? cur : prefillTopic));
  }, [prefillTopic]);

  const handleGenerated = (
    output: BlogGenerationOutput & { content_blocks?: unknown[] },
    confidence: 'high' | 'medium',
    hookAssessment: { strength: 'strong' | 'moderate' | 'weak'; note: string },
    angleType: string | null,
  ) => {
    const token = `blog_prefill_${Date.now()}`;
    const payload = {
      output,
      confidence,
      hookAssessment,
      angleType,
      source: 'company_blog_intelligence',
      prefillReason,
      brief,
      company_id: selectedCompanyId,
      prefillTopic: topic,
      target_word_count: parseInt(targetWords, 10) || 1200,
      savedAt: new Date().toISOString(),
    };

    try {
      sessionStorage.setItem(token, JSON.stringify(payload));
    } catch {
      // ignore storage error; fallback route still works
    }

    // Route to blog editor for refinement and posting
    router.push({ pathname: '/blogs/new', query: { prefill: token } });
  };

  const fetchSuggestions = async () => {
    if (!selectedCompanyId || !topic.trim()) return;
    setSuggesting(true);
    setSuggestionError(null);

    try {
      const resp = await fetch('/api/company/blog/brief-suggestions', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company_id: selectedCompanyId,
          topic: topic.trim(),
          reason: prefillReason,
          brief,
          currentValues: {
            uniquenessDirective,
            mustInclude,
            campaignObjective,
            trendContext,
            target_word_count: targetWords,
          },
        }),
      });

      const data = await resp.json().catch(() => ({})) as DraftFieldSuggestions;
      if (!resp.ok) throw new Error('Unable to generate suggestions right now.');
      setSuggestions(data);

      // Auto-prime empty fields with top suggestion for speed.
      if (!uniquenessDirective && data.uniqueness_directive_options?.[0]) {
        setUniquenessDirective(data.uniqueness_directive_options[0]);
      }
      if (!mustInclude && data.must_include_points_options?.[0]) {
        setMustInclude(data.must_include_points_options[0]);
      }
      if (!campaignObjective && data.campaign_objective_options?.[0]) {
        setCampaignObjective(data.campaign_objective_options[0]);
      }
      if (!trendContext && data.trend_context_options?.[0]) {
        setTrendContext(data.trend_context_options[0]);
      }
    } catch (e) {
      setSuggestionError(e instanceof Error ? e.message : 'Suggestion generation failed.');
    } finally {
      setSuggesting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <Loader2 className="h-10 w-10 animate-spin text-[#0B5ED7]" />
      </div>
    );
  }

  return (
    <>
      <Head>
        <title>{formatType === 'pillar' ? 'Generate Guide | Pillar Content' : 'Generate Draft | Blog Intelligence'}</title>
      </Head>
      <div className="min-h-screen bg-gray-50 p-6">
        <div className="mx-auto max-w-3xl rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between gap-3 mb-5">
            <div>
              <p className="text-xs text-gray-500">{formatType === 'pillar' ? 'Guide / Pillar Content' : 'Blog Intelligence'}</p>
              <h1 className="text-2xl font-bold text-gray-900">{formatType === 'pillar' ? 'Generate Guide Draft' : 'Generate Draft Before Writing'}</h1>
            </div>
            <Link href={`/blogs/intelligence${prefillWords ? `?words=${prefillWords}` : ''}`} className="text-sm text-gray-600 hover:text-gray-900">
              ← Back
            </Link>
          </div>

          {error && (
            <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 flex items-start gap-2">
              <AlertCircle className="h-4 w-4 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <div className="space-y-4">
            <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3">
              <label htmlFor="blog-topic" className="block text-xs font-semibold text-blue-700 uppercase tracking-wide mb-1">
                {prefillTopic ? 'Recommended Topic' : 'Topic'}
              </label>
              <input
                id="blog-topic"
                type="text"
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                placeholder="Enter the blog topic you want to write about"
                className="w-full rounded-md border border-blue-200 bg-white px-3 py-2 text-sm font-semibold text-blue-900 placeholder:font-normal placeholder:text-blue-400 focus:border-[#0B5ED7] focus:outline-none focus:ring-1 focus:ring-[#0B5ED7]"
              />
              {prefillReason && <p className="text-xs text-blue-700 mt-1">{prefillReason}</p>}
            </div>

            {brief && (
              <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Recommendation Brief</p>
                <div>
                  <p className="text-[11px] font-semibold text-gray-500">Company Context</p>
                  <p className="text-xs text-gray-700">{brief.company_context}</p>
                </div>
                <div>
                  <p className="text-[11px] font-semibold text-gray-500">Current Content</p>
                  <p className="text-xs text-gray-700">{brief.current_content}</p>
                </div>
                <div>
                  <p className="text-[11px] font-semibold text-gray-500">Writing Style</p>
                  <p className="text-xs text-gray-700">{brief.writing_style}</p>
                </div>
              </div>
            )}

            <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Draft Strength Inputs</p>
                <button
                  type="button"
                  onClick={fetchSuggestions}
                  disabled={!selectedCompanyId || !topic.trim() || suggesting}
                  className="inline-flex items-center gap-1 rounded-md border border-[#0B5ED7]/25 bg-white px-2.5 py-1 text-[11px] font-semibold text-[#0B5ED7] hover:bg-[#0B5ED7]/5 disabled:opacity-50"
                >
                  {suggesting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                  {suggesting ? 'Suggesting...' : 'Suggest Inputs'}
                </button>
              </div>

              {suggestionError && (
                <p className="rounded-md border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs text-red-700">{suggestionError}</p>
              )}

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">Target Content Length</label>
                <select
                  value={targetWords}
                  onChange={(e) => setTargetWords(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm bg-white"
                >
                  <option value="800">~800 words (concise article)</option>
                  <option value="1200">~1200 words (standard deep article)</option>
                  <option value="1600">~1600 words (authority deep-dive)</option>
                  <option value="2000">~2000 words (pillar long-form)</option>
                  {formatType === 'pillar' && <option value="3000">~3000 words (comprehensive guide)</option>}
                  {formatType === 'pillar' && <option value="4000">~4000 words (in-depth guide)</option>}
                  {formatType === 'pillar' && <option value="5000">~5000 words (definitive pillar)</option>}
                </select>
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">Content Format</label>
                <select
                  value={formatType}
                  onChange={(e) => setFormatType(e.target.value as BlogFormatType)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm bg-white"
                >
                  {BLOG_FORMAT_OPTIONS.map(f => (
                    <option key={f.value} value={f.value}>{f.label} — {f.description}</option>
                  ))}
                </select>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1.5">Reader Stage</label>
                  <select
                    value={readerStage}
                    onChange={(e) => setReaderStage(e.target.value)}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm bg-white"
                  >
                    <option value="beginners">Beginners / new-to-topic</option>
                    <option value="practitioners">Practitioners / operators</option>
                    <option value="decision-makers">Decision-makers / leaders</option>
                    <option value="mixed">Mixed audience</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1.5">CTA Style</label>
                  <select
                    value={ctaPreference}
                    onChange={(e) => setCtaPreference(e.target.value)}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm bg-white"
                  >
                    <option value="soft educational CTA">Soft educational CTA</option>
                    <option value="direct conversion CTA">Direct conversion CTA</option>
                    <option value="engagement CTA">Engagement CTA (comment/share/discuss)</option>
                    <option value="resource CTA">Resource CTA (guide/template/demo)</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">Uniqueness Directive</label>
                <textarea
                  value={uniquenessDirective}
                  onChange={(e) => setUniquenessDirective(e.target.value)}
                  rows={2}
                  placeholder="e.g. Challenge common AI campaign playbooks and propose a 3-layer execution model with real trade-offs."
                  className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm bg-white"
                />
                {!!suggestions?.uniqueness_directive_options?.length && (
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {suggestions.uniqueness_directive_options.map((option, idx) => (
                      <button
                        key={`ud-${idx}`}
                        type="button"
                        onClick={() => setUniquenessDirective((prev) => appendPointer(prev, option, '\n- '))}
                        className="rounded-full border border-indigo-200 bg-indigo-50 px-2 py-1 text-[11px] text-indigo-700 hover:bg-indigo-100"
                      >
                        {option}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">Must-Include Points</label>
                <textarea
                  value={mustInclude}
                  onChange={(e) => setMustInclude(e.target.value)}
                  rows={2}
                  placeholder="Comma-separated: key framework, metrics, counter-example, implementation checklist"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm bg-white"
                />
                {!!suggestions?.must_include_points_options?.length && (
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {suggestions.must_include_points_options.map((option, idx) => (
                      <button
                        key={`mi-${idx}`}
                        type="button"
                        onClick={() => setMustInclude((prev) => appendPointer(prev, option, ', '))}
                        className="rounded-full border border-indigo-200 bg-indigo-50 px-2 py-1 text-[11px] text-indigo-700 hover:bg-indigo-100"
                      >
                        {option}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1.5">Campaign Objective</label>
                  <textarea
                    value={campaignObjective}
                    onChange={(e) => setCampaignObjective(e.target.value)}
                    rows={2}
                    placeholder="e.g. improve SQL conversion rate"
                    className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm bg-white"
                  />
                  {!!suggestions?.campaign_objective_options?.length && (
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {suggestions.campaign_objective_options.map((option, idx) => (
                        <button
                          key={`co-${idx}`}
                          type="button"
                          onClick={() => setCampaignObjective((prev) => appendPointer(prev, option, '\n- '))}
                          className="rounded-full border border-indigo-200 bg-indigo-50 px-2 py-1 text-[11px] text-indigo-700 hover:bg-indigo-100"
                        >
                          {option}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1.5">Trend Context</label>
                  <textarea
                    value={trendContext}
                    onChange={(e) => setTrendContext(e.target.value)}
                    rows={2}
                    placeholder="e.g. AI search traffic shift in 2026"
                    className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm bg-white"
                  />
                  {!!suggestions?.trend_context_options?.length && (
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {suggestions.trend_context_options.map((option, idx) => (
                        <button
                          key={`tc-${idx}`}
                          type="button"
                          onClick={() => setTrendContext((prev) => appendPointer(prev, option, '\n- '))}
                          className="rounded-full border border-indigo-200 bg-indigo-50 px-2 py-1 text-[11px] text-indigo-700 hover:bg-indigo-100"
                        >
                          {option}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <p className="text-[11px] text-gray-500">Tip: Click multiple suggestion chips to append multiple pointers per field.</p>
            </div>

            <button
              type="button"
              onClick={() => setShowGenerator(true)}
              disabled={!selectedCompanyId}
              className="inline-flex items-center gap-2 rounded-lg bg-[#0B5ED7] px-4 py-2.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
            >
              <Sparkles className="h-4 w-4" />
              Advanced Angle Flow
            </button>
          </div>
        </div>
      </div>

      {showGenerator && selectedCompanyId && (
        <BlogGenerateModal
          companyId={selectedCompanyId}
          clusters={[]}
          blogs={posts}
          industry={null}
          initialTopic={topic}
          initialTargetWords={targetWords}
          initialIntent={brief?.intent}
          initialTone={brief?.tone}
          initialRelatedBlogs={brief?.related_titles ?? []}
          initialFormatType={formatType}
          initialTemplateName={templateName}
          initialTemplateBlocks={templateBlocks}
          baseAnswers={{
            ...(brief ? {
              company_context: brief.company_context,
              current_content: brief.current_content,
              writing_style: brief.writing_style,
            } : {}),
            target_word_count: targetWords,
            reader_stage: readerStage,
            cta_preference: ctaPreference,
            uniqueness_directive: uniquenessDirective,
            must_include_points: mustInclude,
            campaign_objective: campaignObjective,
            trend_context: trendContext,
          }}
          onClose={() => setShowGenerator(false)}
          onGenerated={handleGenerated}
        />
      )}
    </>
  );
}
