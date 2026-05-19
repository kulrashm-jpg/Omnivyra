'use client';

import React, { useEffect, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { Loader2, Sparkles, AlertCircle } from 'lucide-react';
import BlogGenerateModal from '../../components/blog/BlogGenerateModal';
import { useCompanyContext } from '../../components/CompanyContext';
import type { BlogGenerationOutput } from '../../lib/blog/blogGenerationEngine';
import { NEWSLETTER_FORMAT_OPTIONS, isValidNewsletterFormat, type NewsletterFormatType } from '../../lib/blog/blogStructureTemplates';
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

export default function NewsletterGeneratePage() {
  const router = useRouter();
  const { selectedCompanyId } = useCompanyContext();

  const prefillTopic = typeof router.query.prefill_topic === 'string' ? router.query.prefill_topic.trim() : '';
  const prefillReason = typeof router.query.prefill_reason === 'string' ? router.query.prefill_reason.trim() : '';
  const prefillBriefToken = typeof router.query.prefill_brief === 'string' ? router.query.prefill_brief.trim() : '';
  const prefillCardToken = typeof router.query.prefill_card === 'string' ? router.query.prefill_card.trim() : '';
  const templateToken = typeof router.query.tpl === 'string' ? router.query.tpl.trim() : '';

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [posts, setPosts] = useState<BlogPost[]>([]);
  const [showGenerator, setShowGenerator] = useState(false);
  const [brief, setBrief] = useState<BriefInsight | null>(null);
  // Topic is editable: prefilled flows (recommended card / brief) seed it via
  // the effect below; the write-your-own flow (no prefill_topic) lets the user
  // type it, which is what activates "Suggest Inputs" + the generator.
  const [topic, setTopic] = useState('');
  const [targetWords, setTargetWords] = useState('1200');
  const [uniquenessDirective, setUniquenessDirective] = useState('');
  const [mustInclude, setMustInclude] = useState('');
  const [campaignObjective, setCampaignObjective] = useState('');
  const [trendContext, setTrendContext] = useState('');
  const [readerStage, setReaderStage] = useState('subscribers');
  const [ctaPreference, setCtaPreference] = useState('engagement CTA');
  const [suggestions, setSuggestions] = useState<DraftFieldSuggestions | null>(null);
  const [suggesting, setSuggesting] = useState(false);
  const [suggestionError, setSuggestionError] = useState<string | null>(null);
  const [templateBlocks, setTemplateBlocks] = useState<ContentBlock[] | undefined>(undefined);
  const [templateName, setTemplateName] = useState<string | undefined>(undefined);
  const [newsletterFormat, setNewsletterFormat] = useState<NewsletterFormatType>(() => {
    const qf = router.query.format;
    return typeof qf === 'string' && isValidNewsletterFormat(qf) ? qf : 'weekly-brief';
  });

  useEffect(() => {
    const bootstrap = async () => {
      setLoading(true);
      setError(null);
      try {
        const postsRes = await fetch(`/api/company/blogs?company_id=${selectedCompanyId}&content_type=newsletter`, { credentials: 'include' });

        if (!postsRes.ok) {
          throw new Error('Unable to load your newsletters.');
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

        if (prefillBriefToken && typeof window !== 'undefined') {
          const rawBrief = sessionStorage.getItem(prefillBriefToken);
          if (rawBrief) {
            const parsed = JSON.parse(rawBrief) as BriefInsight;
            setBrief(parsed);
            sessionStorage.removeItem(prefillBriefToken);
          }
        }

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
              setBrief((prev) => ({
                company_id: selectedCompanyId || '',
                company_context: '',
                current_content: '',
                writing_style: card.writingStyle || '',
                related_titles: [],
                intent: card.intent || 'authority',
                tone: card.tone || '',
                ...prev,
              }));
            } catch {
              // ignore malformed token
            }
            sessionStorage.removeItem(prefillCardToken);
          }
        }

        if (templateToken && typeof window !== 'undefined') {
          const rawTemplate = sessionStorage.getItem(templateToken);
          if (rawTemplate) {
            try {
              const parsed = JSON.parse(rawTemplate) as TemplateSessionPayload;
              if (Array.isArray(parsed.blocks)) {
                setTemplateBlocks(parsed.blocks);
              }
              if (typeof parsed.template_name === 'string' && parsed.template_name.trim()) {
                setTemplateName(parsed.template_name.trim());
              }
              if (typeof parsed.format_type === 'string' && isValidNewsletterFormat(parsed.format_type)) {
                setNewsletterFormat(parsed.format_type);
              }
              if (typeof parsed.topic === 'string' && parsed.topic.trim()) {
                // only set if no explicit query topic was provided
              }
              if (typeof parsed.target_words === 'number' && parsed.target_words >= 300) {
                setTargetWords(String(parsed.target_words));
              }
            } catch {
              // ignore malformed template payload
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
  }, [selectedCompanyId, prefillBriefToken, prefillCardToken, templateToken]);

  // Seed the editable topic from the URL prefill once it resolves (router
  // query is empty on first render). User edits are preserved — prefill only
  // fills while the field is still untouched.
  useEffect(() => {
    if (prefillTopic) setTopic((cur) => (cur ? cur : prefillTopic));
  }, [prefillTopic]);

  const handleGenerated = (
    output: BlogGenerationOutput & { content_blocks?: unknown[] },
    confidence: 'high' | 'medium',
    hookAssessment: { strength: 'strong' | 'moderate' | 'weak'; note: string },
    angleType: string | null,
  ) => {
    const token = `newsletter_prefill_${Date.now()}`;
    const payload = {
      output,
      confidence,
      hookAssessment,
      angleType,
      source: 'newsletter_intelligence',
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
      // ignore storage error
    }

    router.push({ pathname: '/newsletters/new', query: { prefill: token } });
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
          },
        }),
      });

      const data = await resp.json().catch(() => ({})) as DraftFieldSuggestions;
      if (!resp.ok) throw new Error('Unable to generate suggestions right now.');
      setSuggestions(data);

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
        <Loader2 className="h-10 w-10 animate-spin text-amber-600" />
      </div>
    );
  }

  return (
    <>
      <Head>
        <title>Generate Newsletter | Newsletter Intelligence</title>
      </Head>
      <div className="min-h-screen bg-gray-50 p-6">
        <div className="mx-auto max-w-3xl rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between gap-3 mb-5">
            <div>
              <p className="text-xs text-amber-600 font-semibold">Newsletter Intelligence</p>
              <h1 className="text-2xl font-bold text-gray-900">Generate Newsletter Draft</h1>
            </div>
            <Link href="/newsletters/create" className="text-sm text-gray-600 hover:text-gray-900">
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
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
              <label htmlFor="newsletter-topic" className="block text-xs font-semibold text-amber-700 uppercase tracking-wide mb-1">
                Newsletter Topic
              </label>
              <input
                id="newsletter-topic"
                type="text"
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                placeholder="Enter the newsletter topic you want to write about"
                className="w-full rounded-md border border-amber-200 bg-white px-3 py-2 text-sm font-semibold text-amber-900 placeholder:font-normal placeholder:text-amber-400 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
              />
              {prefillReason && <p className="text-xs text-amber-700 mt-1">{prefillReason}</p>}
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
                  className="inline-flex items-center gap-1 rounded-md border border-amber-600/25 bg-white px-2.5 py-1 text-[11px] font-semibold text-amber-600 hover:bg-amber-50 disabled:opacity-50"
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
                  <option value="800">~800 words (quick newsletter)</option>
                  <option value="1200">~1200 words (standard newsletter)</option>
                  <option value="1600">~1600 words (in-depth newsletter)</option>
                  <option value="2000">~2000 words (feature newsletter)</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">Newsletter Template</label>
                <select
                  value={newsletterFormat}
                  onChange={(e) => setNewsletterFormat(e.target.value as NewsletterFormatType)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm bg-white"
                >
                  {NEWSLETTER_FORMAT_OPTIONS.map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label} — {opt.description}</option>
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
                    <option value="subscribers">Subscribers / engaged readers</option>
                    <option value="leads">Leads / prospects</option>
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
                    <option value="engagement CTA">Engagement CTA (reply/share/discuss)</option>
                    <option value="resource CTA">Resource CTA (guide/template/tool)</option>
                    <option value="soft educational CTA">Soft educational CTA</option>
                    <option value="direct conversion CTA">Direct conversion CTA</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">Uniqueness Directive</label>
                <textarea
                  value={uniquenessDirective}
                  onChange={(e) => setUniquenessDirective(e.target.value)}
                  rows={2}
                  placeholder="e.g. Focus on under-the-radar insights that mainstream newsletters are missing."
                  className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm bg-white"
                />
                {!!suggestions?.uniqueness_directive_options?.length && (
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {suggestions.uniqueness_directive_options.map((option, idx) => (
                      <button
                        key={`ud-${idx}`}
                        type="button"
                        onClick={() => setUniquenessDirective((prev) => appendPointer(prev, option, '\n- '))}
                        className="rounded-full border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] text-amber-700 hover:bg-amber-100"
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
                  placeholder="Comma-separated: key trend, industry stat, actionable tip, expert perspective"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm bg-white"
                />
                {!!suggestions?.must_include_points_options?.length && (
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {suggestions.must_include_points_options.map((option, idx) => (
                      <button
                        key={`mi-${idx}`}
                        type="button"
                        onClick={() => setMustInclude((prev) => appendPointer(prev, option, ', '))}
                        className="rounded-full border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] text-amber-700 hover:bg-amber-100"
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
                    placeholder="e.g. build subscriber trust and engagement around AI governance"
                    className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm bg-white"
                  />
                  {!!suggestions?.campaign_objective_options?.length && (
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {suggestions.campaign_objective_options.map((option, idx) => (
                        <button
                          key={`co-${idx}`}
                          type="button"
                          onClick={() => setCampaignObjective((prev) => appendPointer(prev, option, '\n- '))}
                          className="rounded-full border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] text-amber-700 hover:bg-amber-100"
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
                    placeholder="e.g. rising adoption of AI agents in enterprise workflows"
                    className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm bg-white"
                  />
                  {!!suggestions?.trend_context_options?.length && (
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {suggestions.trend_context_options.map((option, idx) => (
                        <button
                          key={`tc-${idx}`}
                          type="button"
                          onClick={() => setTrendContext((prev) => appendPointer(prev, option, '\n- '))}
                          className="rounded-full border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] text-amber-700 hover:bg-amber-100"
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
              className="inline-flex items-center gap-2 rounded-lg bg-amber-600 px-4 py-2.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
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
          contentType="newsletter"
          initialFormatType={newsletterFormat}
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
