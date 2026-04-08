'use client';

import React, { useEffect, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { Loader2, Sparkles, AlertCircle } from 'lucide-react';
import BlogGenerateModal from '../../components/blog/BlogGenerateModal';
import { useCompanyContext } from '../../components/CompanyContext';
import type { BlogGenerationOutput } from '../../lib/blog/blogGenerationEngine';
import { WHITEPAPER_FORMAT_OPTIONS, isValidWhitepaperFormat, type WhitepaperFormatType } from '../../lib/blog/blogStructureTemplates';

type BriefInsight = {
  company_id: string;
  company_context: string;
  current_content: string;
  writing_style: string;
  related_titles: string[];
  intent: 'awareness' | 'authority' | 'conversion' | 'retention';
  tone: string;
};

type DraftFieldSuggestions = {
  uniqueness_directive_options: string[];
  must_include_points_options: string[];
  campaign_objective_options: string[];
  trend_context_options: string[];
};

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

export default function WhitepaperGeneratePage() {
  const router = useRouter();
  const { selectedCompanyId } = useCompanyContext();

  const prefillTopic = typeof router.query.prefill_topic === 'string' ? router.query.prefill_topic.trim() : '';
  const prefillReason = typeof router.query.prefill_reason === 'string' ? router.query.prefill_reason.trim() : '';
  const prefillBriefToken = typeof router.query.prefill_brief === 'string' ? router.query.prefill_brief.trim() : '';
  const prefillCardToken = typeof router.query.prefill_card === 'string' ? router.query.prefill_card.trim() : '';

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [posts, setPosts] = useState<BlogPost[]>([]);
  const [showGenerator, setShowGenerator] = useState(false);
  const [brief, setBrief] = useState<BriefInsight | null>(null);
  const [targetWords, setTargetWords] = useState('3000');
  const [uniquenessDirective, setUniquenessDirective] = useState('');
  const [mustInclude, setMustInclude] = useState('');
  const [campaignObjective, setCampaignObjective] = useState('');
  const [trendContext, setTrendContext] = useState('');
  const [readerStage, setReaderStage] = useState('decision-makers');
  const [ctaPreference, setCtaPreference] = useState('resource CTA');
  const [suggestions, setSuggestions] = useState<DraftFieldSuggestions | null>(null);
  const [suggesting, setSuggesting] = useState(false);
  const [suggestionError, setSuggestionError] = useState<string | null>(null);
  const [whitepaperFormat, setWhitepaperFormat] = useState<WhitepaperFormatType>(() => {
    const qf = router.query.format;
    return typeof qf === 'string' && isValidWhitepaperFormat(qf) ? qf : 'research';
  });

  useEffect(() => {
    const bootstrap = async () => {
      setLoading(true);
      setError(null);
      try {
        const postsRes = await fetch(`/api/company/blogs?company_id=${selectedCompanyId}&content_type=whitepaper`, { credentials: 'include' });

        if (!postsRes.ok) {
          throw new Error('Unable to load your whitepapers.');
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
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to initialize generator.');
      } finally {
        setLoading(false);
      }
    };

    if (selectedCompanyId) {
      void bootstrap();
    }
  }, [selectedCompanyId, prefillBriefToken, prefillCardToken]);

  const handleGenerated = (
    output: BlogGenerationOutput & { content_blocks?: unknown[] },
    confidence: 'high' | 'medium',
    hookAssessment: { strength: 'strong' | 'moderate' | 'weak'; note: string },
    angleType: string | null,
  ) => {
    const token = `whitepaper_prefill_${Date.now()}`;
    const payload = {
      output,
      confidence,
      hookAssessment,
      angleType,
      source: 'whitepaper_intelligence',
      prefillReason,
      brief,
      company_id: selectedCompanyId,
      prefillTopic,
      target_word_count: parseInt(targetWords, 10) || 3000,
      savedAt: new Date().toISOString(),
    };

    try {
      sessionStorage.setItem(token, JSON.stringify(payload));
    } catch {
      // ignore storage error
    }

    router.push({ pathname: '/whitepapers/new', query: { prefill: token } });
  };

  const fetchSuggestions = async () => {
    if (!selectedCompanyId || !prefillTopic) return;
    setSuggesting(true);
    setSuggestionError(null);

    try {
      const resp = await fetch('/api/company/blog/brief-suggestions', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company_id: selectedCompanyId,
          topic: prefillTopic,
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
        <Loader2 className="h-10 w-10 animate-spin text-[#1B2A4A]" />
      </div>
    );
  }

  return (
    <>
      <Head>
        <title>Generate Whitepaper | Content Intelligence</title>
      </Head>
      <div className="min-h-screen bg-gray-50 p-6">
        <div className="mx-auto max-w-3xl rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between gap-3 mb-5">
            <div>
              <p className="text-xs text-gray-500">Whitepaper Intelligence</p>
              <h1 className="text-2xl font-bold text-gray-900">Generate Whitepaper Draft</h1>
            </div>
            <Link href="/whitepapers/create" className="text-sm text-gray-600 hover:text-gray-900">
              &larr; Back
            </Link>
          </div>

          {error && (
            <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 flex items-start gap-2">
              <AlertCircle className="h-4 w-4 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <div className="space-y-4">
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
              <p className="text-xs font-semibold text-slate-700 uppercase tracking-wide mb-1">Recommended Topic</p>
              <p className="text-sm font-bold text-slate-900">{prefillTopic || 'No topic prefilled'}</p>
              {prefillReason && <p className="text-xs text-slate-700 mt-1">{prefillReason}</p>}
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
                  disabled={!selectedCompanyId || !prefillTopic || suggesting}
                  className="inline-flex items-center gap-1 rounded-md border border-[#1B2A4A]/25 bg-white px-2.5 py-1 text-[11px] font-semibold text-[#1B2A4A] hover:bg-[#1B2A4A]/5 disabled:opacity-50"
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
                  <option value="2500">~2500 words (concise whitepaper)</option>
                  <option value="3000">~3000 words (standard whitepaper)</option>
                  <option value="4000">~4000 words (comprehensive whitepaper)</option>
                  <option value="5000">~5000 words (in-depth research paper)</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">Whitepaper Template</label>
                <select
                  value={whitepaperFormat}
                  onChange={(e) => setWhitepaperFormat(e.target.value as WhitepaperFormatType)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm bg-white"
                >
                  {WHITEPAPER_FORMAT_OPTIONS.map(opt => (
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
                    <option value="c-suite">C-Suite / Executives</option>
                    <option value="decision-makers">Decision-makers / Directors</option>
                    <option value="practitioners">Practitioners / Technical leads</option>
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
                    <option value="resource CTA">Resource CTA (guide/framework/demo)</option>
                    <option value="consultation CTA">Consultation CTA (schedule a briefing)</option>
                    <option value="soft educational CTA">Soft educational CTA</option>
                    <option value="engagement CTA">Engagement CTA (discuss/share findings)</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">Uniqueness Directive</label>
                <textarea
                  value={uniquenessDirective}
                  onChange={(e) => setUniquenessDirective(e.target.value)}
                  rows={2}
                  placeholder="e.g. Present proprietary framework with data-backed methodology distinct from industry standard approaches."
                  className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm bg-white"
                />
                {!!suggestions?.uniqueness_directive_options?.length && (
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {suggestions.uniqueness_directive_options.map((option, idx) => (
                      <button
                        key={`ud-${idx}`}
                        type="button"
                        onClick={() => setUniquenessDirective((prev) => appendPointer(prev, option, '\n- '))}
                        className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] text-slate-700 hover:bg-slate-100"
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
                  placeholder="Comma-separated: executive summary, methodology section, data citations, strategic recommendations"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm bg-white"
                />
                {!!suggestions?.must_include_points_options?.length && (
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {suggestions.must_include_points_options.map((option, idx) => (
                      <button
                        key={`mi-${idx}`}
                        type="button"
                        onClick={() => setMustInclude((prev) => appendPointer(prev, option, ', '))}
                        className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] text-slate-700 hover:bg-slate-100"
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
                    placeholder="e.g. establish thought leadership in AI governance for enterprise"
                    className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm bg-white"
                  />
                  {!!suggestions?.campaign_objective_options?.length && (
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {suggestions.campaign_objective_options.map((option, idx) => (
                        <button
                          key={`co-${idx}`}
                          type="button"
                          onClick={() => setCampaignObjective((prev) => appendPointer(prev, option, '\n- '))}
                          className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] text-slate-700 hover:bg-slate-100"
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
                    placeholder="e.g. emerging regulatory frameworks, market consolidation trends"
                    className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm bg-white"
                  />
                  {!!suggestions?.trend_context_options?.length && (
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {suggestions.trend_context_options.map((option, idx) => (
                        <button
                          key={`tc-${idx}`}
                          type="button"
                          onClick={() => setTrendContext((prev) => appendPointer(prev, option, '\n- '))}
                          className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] text-slate-700 hover:bg-slate-100"
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
              className="inline-flex items-center gap-2 rounded-lg bg-[#1B2A4A] px-4 py-2.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
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
          initialTopic={prefillTopic}
          initialTargetWords={targetWords}
          initialIntent={brief?.intent}
          initialTone={brief?.tone}
          initialRelatedBlogs={brief?.related_titles ?? []}
          contentType="whitepaper"
          initialFormatType={whitepaperFormat}
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
