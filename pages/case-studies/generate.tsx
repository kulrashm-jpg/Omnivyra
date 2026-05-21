'use client';

import React, { useEffect, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { AlertCircle, Loader2, Sparkles } from 'lucide-react';
import BlogGenerateModal from '../../components/blog/BlogGenerateModal';
import { useCompanyContext } from '../../components/CompanyContext';
import SuggestionOptionPicker from '../../components/content/SuggestionOptionPicker';
import { fetchWithAuth } from '../../components/community-ai/fetchWithAuth';
import type { BlogGenerationOutput } from '../../lib/blog/blogGenerationEngine';
import type { ContentBlock } from '../../lib/blog/blockTypes';
import type { BriefInsight, DraftFieldSuggestions, TemplateSessionPayload, EnrichedGap } from '../blogs.types';


type BlogPost = {
  id: string;
  title: string;
  slug: string | null;
  angle_type?: string | null;
};



type SelectionBundle = {
  targetWords?: number;
  suggestions?: DraftFieldSuggestions;
  brief?: BriefInsight;
};

type SuggestionSessionPayload = {
  uniqueness_directive?: string;
  must_include_points?: string;
  campaign_objective?: string;
  trend_context?: string;
  target_word_count?: number;
  format_type?: string | null;
  template_name?: string | null;
  template_blocks?: ContentBlock[];
};

function appendPointer(existing: string, nextPointer: string, separator: string): string {
  const next = (nextPointer || '').trim();
  if (!next) return existing;

  const current = (existing || '').trim();
  if (!current) return next;

  const normalizedCurrent = current
    .split(separator)
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);

  if (normalizedCurrent.includes(next.toLowerCase())) return current;
  return `${current}${separator}${next}`;
}

function appendAllPointers(options: string[], separator: string): string {
  return options.reduce((accumulator, option) => appendPointer(accumulator, option, separator), '');
}

export default function CaseStudyGeneratePage() {
  const router = useRouter();
  const { selectedCompanyId } = useCompanyContext();

  const prefillTopic = typeof router.query.prefill_topic === 'string' ? router.query.prefill_topic.trim() : '';
  const prefillReason = typeof router.query.prefill_reason === 'string' ? router.query.prefill_reason.trim() : '';
  const prefillBriefToken = typeof router.query.prefill_brief === 'string' ? router.query.prefill_brief.trim() : '';
  const prefillCardToken = typeof router.query.prefill_card === 'string' ? router.query.prefill_card.trim() : '';
  const prefillBundleToken = typeof router.query.prefill_bundle === 'string' ? router.query.prefill_bundle.trim() : '';
  const templateToken = typeof router.query.tpl === 'string' ? router.query.tpl.trim() : '';
  const suggestionToken = typeof router.query.suggestion_token === 'string' ? router.query.suggestion_token.trim() : '';

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [posts, setPosts] = useState<BlogPost[]>([]);
  const [brief, setBrief] = useState<BriefInsight | null>(null);
  // Topic is editable: prefilled flows (recommended card / brief) seed it via
  // the effect below; the write-your-own flow (no prefill_topic) lets the user
  // type it, which is what activates "Suggest Inputs" + the generator.
  const [topic, setTopic] = useState('');
  const [showGenerator, setShowGenerator] = useState(false);
  const [targetWords, setTargetWords] = useState('1800');
  const [templateBlocks, setTemplateBlocks] = useState<ContentBlock[] | undefined>(undefined);
  const [templateName, setTemplateName] = useState<string | undefined>(undefined);
  const [customerName, setCustomerName] = useState('');
  const [challenge, setChallenge] = useState('');
  const [solution, setSolution] = useState('');
  const [results, setResults] = useState('');
  const [proofAssets, setProofAssets] = useState('');
  const [readerStage, setReaderStage] = useState('decision');
  const [ctaPreference, setCtaPreference] = useState('sales CTA');
  const [uniquenessDirective, setUniquenessDirective] = useState('');
  const [mustInclude, setMustInclude] = useState('');
  const [campaignObjective, setCampaignObjective] = useState('');
  const [trendContext, setTrendContext] = useState('');
  const [suggestions, setSuggestions] = useState<DraftFieldSuggestions | null>(null);
  const [suggesting, setSuggesting] = useState(false);
  const [suggestionError, setSuggestionError] = useState<string | null>(null);

  useEffect(() => {
    const bootstrap = async () => {
      setLoading(true);
      setError(null);
      try {
        const postsRes = await fetch(`/api/company/blogs?company_id=${selectedCompanyId}&content_type=case-study`, {
          credentials: 'include',
        });

        if (!postsRes.ok) {
          throw new Error('Unable to load existing case studies.');
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
                intent?: 'awareness' | 'authority' | 'conversion' | 'retention';
                tone?: string;
                writingStyle?: string;
              };
              setBrief((prev) => ({
                company_id: selectedCompanyId || '',
                company_context: '',
                current_content: '',
                writing_style: card.writingStyle || '',
                related_titles: [],
                intent: card.intent || 'conversion',
                tone: card.tone || '',
                ...prev,
              }));
            } catch {
              // ignore malformed token
            }
            sessionStorage.removeItem(prefillCardToken);
          }
        }

        if (prefillBundleToken && typeof window !== 'undefined') {
          const rawBundle = sessionStorage.getItem(prefillBundleToken);
          if (rawBundle) {
            try {
              const bundle = JSON.parse(rawBundle) as SelectionBundle;
              if (bundle.brief) setBrief((prev) => prev ?? bundle.brief);
              if (bundle.suggestions) setSuggestions(bundle.suggestions);
              if (bundle.targetWords) setTargetWords(String(bundle.targetWords));
            } catch {
              // ignore malformed bundle
            }
          }
        }

        if (templateToken && typeof window !== 'undefined') {
          const rawTemplate = sessionStorage.getItem(templateToken);
          if (rawTemplate) {
            try {
              const parsed = JSON.parse(rawTemplate) as TemplateSessionPayload;
              if (Array.isArray(parsed.blocks)) setTemplateBlocks(parsed.blocks);
              if (typeof parsed.template_name === 'string' && parsed.template_name.trim()) {
                setTemplateName(parsed.template_name.trim());
              }
            } catch {
              // ignore malformed template token
            }
            sessionStorage.removeItem(templateToken);
          }
        }

        if (suggestionToken && typeof window !== 'undefined') {
          const rawSuggestions = sessionStorage.getItem(suggestionToken);
          if (rawSuggestions) {
            try {
              const parsed = JSON.parse(rawSuggestions) as SuggestionSessionPayload;
              if (typeof parsed.uniqueness_directive === 'string') setUniquenessDirective(parsed.uniqueness_directive);
              if (typeof parsed.must_include_points === 'string') setMustInclude(parsed.must_include_points);
              if (typeof parsed.campaign_objective === 'string') setCampaignObjective(parsed.campaign_objective);
              if (typeof parsed.trend_context === 'string') setTrendContext(parsed.trend_context);
              if (typeof parsed.target_word_count === 'number' && parsed.target_word_count > 0) {
                setTargetWords(String(parsed.target_word_count));
              }
              if (typeof parsed.template_name === 'string' && parsed.template_name.trim()) {
                setTemplateName(parsed.template_name.trim());
              }
              if (Array.isArray(parsed.template_blocks)) {
                setTemplateBlocks(parsed.template_blocks);
              }
            } catch {
              // ignore malformed suggestion payload
            }
            sessionStorage.removeItem(suggestionToken);
          }
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to initialize case study generator.');
      } finally {
        setLoading(false);
      }
    };

    if (selectedCompanyId) {
      void bootstrap();
    }
  }, [selectedCompanyId, prefillBriefToken, prefillCardToken, prefillBundleToken, templateToken, suggestionToken]);

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
    const token = `case_study_prefill_${Date.now()}`;
    const payload = {
      output,
      confidence,
      hookAssessment,
      angleType,
      source: 'case_study_intelligence',
      prefillReason,
      brief,
      company_id: selectedCompanyId,
      prefillTopic: topic,
      target_word_count: parseInt(targetWords, 10) || 1800,
      savedAt: new Date().toISOString(),
    };

    try {
      sessionStorage.setItem(token, JSON.stringify(payload));
    } catch {
      // ignore storage issues
    }

    void router.push({ pathname: '/case-studies/new', query: { prefill: token } });
  };

  const fetchSuggestions = async () => {
    if (!selectedCompanyId || !topic.trim()) return;
    setSuggesting(true);
    setSuggestionError(null);

    try {
      const resp = await fetchWithAuth('/api/company/blog/brief-suggestions', {
        method: 'POST',
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

  useEffect(() => {
    // Auto-suggest ONLY for prefilled flows, once, after the topic is seeded.
    // `topic === prefillTopic` ensures we don't fire per-keystroke while the
    // user types their own topic (write-your-own uses the manual button).
    if (!prefillTopic || topic !== prefillTopic || suggestions || suggesting) return;
    void fetchSuggestions();
  }, [prefillTopic, topic, suggestions, suggesting]);

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
        <title>Generate Case Study | Proof-Led Content</title>
      </Head>

      <div className="min-h-screen bg-gray-50 p-6">
        <div className="mx-auto max-w-3xl rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
          <div className="mb-5 flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold text-amber-600">Proof-Led Content</p>
              <h1 className="text-2xl font-bold text-gray-900">Generate Case Study Draft</h1>
            </div>
            <Link href="/case-studies/create" className="text-sm text-gray-600 hover:text-gray-900">
              &larr; Back
            </Link>
          </div>

          {error && (
            <div className="mb-4 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              <AlertCircle className="mt-0.5 h-4 w-4" />
              <span>{error}</span>
            </div>
          )}

            <div className="space-y-4">
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
                <label htmlFor="case-study-topic" className="mb-1 block text-xs font-semibold uppercase tracking-wide text-amber-700">
                  Case Study Topic
                </label>
                <input
                  id="case-study-topic"
                  type="text"
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                  placeholder="Enter the case study topic you want to write about"
                  className="w-full rounded-md border border-amber-200 bg-white px-3 py-2 text-sm font-semibold text-amber-900 placeholder:font-normal placeholder:text-amber-400 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
                />
                {prefillReason && <p className="mt-1 text-xs text-amber-700">{prefillReason}</p>}
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
                    className="inline-flex items-center gap-1 rounded-md border border-amber-600/25 bg-white px-2.5 py-1 text-[11px] font-semibold text-amber-700 hover:bg-amber-50 disabled:opacity-50"
                  >
                    {suggesting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                    {suggesting ? 'Suggesting...' : 'Suggest Inputs'}
                  </button>
                </div>

                {suggestionError && (
                  <p className="rounded-md border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs text-red-700">{suggestionError}</p>
                )}

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-600">Target length</label>
                    <select
                      value={targetWords}
                      onChange={(e) => setTargetWords(e.target.value)}
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                    >
                      <option value="1400">1400+ words</option>
                      <option value="1800">1800+ words</option>
                      <option value="2200">2200+ words</option>
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-600">Reader stage</label>
                    <select
                      value={readerStage}
                      onChange={(e) => setReaderStage(e.target.value)}
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                    >
                      <option value="awareness">Awareness</option>
                      <option value="evaluation">Evaluation</option>
                      <option value="decision">Decision</option>
                      <option value="sales_enablement">Sales enablement</option>
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-600">Customer / brand name</label>
                    <input
                      value={customerName}
                      onChange={(e) => setCustomerName(e.target.value)}
                      placeholder="Acme Logistics"
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-600">CTA preference</label>
                    <input
                      value={ctaPreference}
                      onChange={(e) => setCtaPreference(e.target.value)}
                      placeholder="Book a demo"
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                    />
                  </div>
                </div>

                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-600">Uniqueness directive</label>
                  <textarea
                    rows={2}
                    value={uniquenessDirective}
                    onChange={(e) => setUniquenessDirective(e.target.value)}
                    placeholder="Avoid generic success-story language. Show the mechanism behind the outcome."
                    className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                  />
                  <SuggestionOptionPicker
                    options={suggestions?.uniqueness_directive_options ?? []}
                    accent="amber"
                    onPick={(option) => setUniquenessDirective((prev) => appendPointer(prev, option, '\n- '))}
                    onSelectAll={() => setUniquenessDirective(appendAllPointers(suggestions?.uniqueness_directive_options ?? [], '\n- '))}
                    onClear={() => setUniquenessDirective('')}
                  />
                </div>

                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-600">Must-Include Points</label>
                  <textarea
                    rows={2}
                    value={mustInclude}
                    onChange={(e) => setMustInclude(e.target.value)}
                    placeholder="Comma-separated: customer context, bottleneck, implementation detail, measurable result, proof asset"
                    className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                  />
                  <SuggestionOptionPicker
                    options={suggestions?.must_include_points_options ?? []}
                    accent="amber"
                    onPick={(option) => setMustInclude((prev) => appendPointer(prev, option, ', '))}
                    onSelectAll={() => setMustInclude(appendAllPointers(suggestions?.must_include_points_options ?? [], ', '))}
                    onClear={() => setMustInclude('')}
                  />
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-600">Campaign Objective</label>
                    <textarea
                      rows={2}
                      value={campaignObjective}
                      onChange={(e) => setCampaignObjective(e.target.value)}
                      placeholder="e.g. build buyer trust with proof of execution"
                      className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                    />
                    <SuggestionOptionPicker
                      options={suggestions?.campaign_objective_options ?? []}
                      accent="amber"
                      onPick={(option) => setCampaignObjective((prev) => appendPointer(prev, option, '\n- '))}
                      onSelectAll={() => setCampaignObjective(appendAllPointers(suggestions?.campaign_objective_options ?? [], '\n- '))}
                      onClear={() => setCampaignObjective('')}
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-600">Trend Context</label>
                    <textarea
                      rows={2}
                      value={trendContext}
                      onChange={(e) => setTrendContext(e.target.value)}
                      placeholder="e.g. higher buyer scrutiny, longer evaluation cycles, AI operations pressure"
                      className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                    />
                    <SuggestionOptionPicker
                      options={suggestions?.trend_context_options ?? []}
                      accent="amber"
                      onPick={(option) => setTrendContext((prev) => appendPointer(prev, option, '\n- '))}
                      onSelectAll={() => setTrendContext(appendAllPointers(suggestions?.trend_context_options ?? [], '\n- '))}
                      onClear={() => setTrendContext('')}
                    />
                  </div>
                </div>
              </div>

            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-600">Core challenge</label>
              <textarea
                rows={3}
                value={challenge}
                onChange={(e) => setChallenge(e.target.value)}
                placeholder="What problem existed before your intervention?"
                className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-600">Solution / intervention</label>
              <textarea
                rows={3}
                value={solution}
                onChange={(e) => setSolution(e.target.value)}
                placeholder="What did your team implement, and how was it different?"
                className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
              />
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-600">Measured results</label>
                <textarea
                  rows={3}
                  value={results}
                  onChange={(e) => setResults(e.target.value)}
                  placeholder="Revenue lift, time saved, conversion gain, ROI, retention improvement..."
                  className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-600">Proof assets</label>
                <textarea
                  rows={3}
                  value={proofAssets}
                  onChange={(e) => setProofAssets(e.target.value)}
                  placeholder="Quotes, screenshots, metrics tables, benchmark references, implementation timeline..."
                  className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3 pt-2">
              <button
                type="button"
                onClick={() => setShowGenerator(true)}
                className="inline-flex items-center gap-2 rounded-lg bg-amber-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-amber-700"
              >
                <Sparkles className="h-4 w-4" />
                Generate Case Study
              </button>
              <p className="text-xs text-gray-500">
                Existing case studies loaded: <span className="font-semibold text-gray-700">{posts.length}</span>
              </p>
            </div>
          </div>
        </div>
      </div>

      {showGenerator && selectedCompanyId && (
        <BlogGenerateModal
          companyId={selectedCompanyId}
          clusters={[]}
          blogs={posts}
          industry={null}
          initialTopic={topic || customerName || challenge}
          initialTargetWords={targetWords}
          initialIntent={brief?.intent || 'conversion'}
          initialTone={brief?.tone}
          initialRelatedBlogs={brief?.related_titles ?? []}
          initialTemplateName={templateName}
          initialTemplateBlocks={templateBlocks}
          contentType="case-study"
          initialFormatType="case-study"
          baseAnswers={{
              ...(brief ? {
                company_context: brief.company_context,
                current_content: brief.current_content,
                writing_style: brief.writing_style,
              } : {}),
              target_word_count: targetWords,
              reader_stage: readerStage,
              cta_preference: ctaPreference,
              customer_name: customerName,
              challenge_summary: challenge,
              solution_summary: solution,
              results_summary: results,
              proof_assets: proofAssets,
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
