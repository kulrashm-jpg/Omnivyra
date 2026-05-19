'use client';

import React, { useEffect, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { Loader2, Sparkles, AlertCircle } from 'lucide-react';
import BlogGenerateModal from '../../components/blog/BlogGenerateModal';
import { useCompanyContext } from '../../components/CompanyContext';
import SuggestionOptionPicker from '../../components/content/SuggestionOptionPicker';
import type { BlogGenerationOutput } from '../../lib/blog/blogGenerationEngine';
import { ARTICLE_FORMAT_OPTIONS, isValidArticleFormat, type ArticleFormatType } from '../../lib/blog/blogStructureTemplates';
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
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  if (normalizedCurrent.includes(next.toLowerCase())) return current;
  return `${current}${separator}${next}`;
}

function appendAllPointers(options: string[], separator: string): string {
  return options.reduce((accumulator, option) => appendPointer(accumulator, option, separator), '');
}

export default function ArticleGeneratePage() {
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
  const [showGenerator, setShowGenerator] = useState(false);
  const [brief, setBrief] = useState<BriefInsight | null>(null);
  // Topic is editable: prefilled flows (recommended card / brief) seed it via
  // the effect below; the write-your-own flow (no prefill_topic) lets the user
  // type it, which is what activates "Suggest Inputs" + the generator.
  const [topic, setTopic] = useState('');
  const [targetWords, setTargetWords] = useState('1600');
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
  const [articleFormat, setArticleFormat] = useState<ArticleFormatType>(() => {
    const qf = router.query.format;
    return typeof qf === 'string' && isValidArticleFormat(qf) ? qf : 'narrative';
  });

  useEffect(() => {
    const bootstrap = async () => {
      setLoading(true);
      setError(null);
      try {
        const postsRes = await fetch(`/api/company/blogs?company_id=${selectedCompanyId}&content_type=article`, { credentials: 'include' });

        if (!postsRes.ok) {
          throw new Error('Unable to load your articles.');
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
              if (typeof parsed.format_type === 'string' && isValidArticleFormat(parsed.format_type)) {
                setArticleFormat(parsed.format_type);
              }
            } catch {
              // ignore malformed template payload
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
              if (typeof parsed.format_type === 'string' && isValidArticleFormat(parsed.format_type)) {
                setArticleFormat(parsed.format_type);
              }
            } catch {
              // ignore malformed suggestion payload
            }
            sessionStorage.removeItem(suggestionToken);
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
    const token = `article_prefill_${Date.now()}`;
    const payload = {
      output,
      confidence,
      hookAssessment,
      angleType,
      source: 'article_intelligence',
      prefillReason,
      brief,
      company_id: selectedCompanyId,
      prefillTopic: topic,
      target_word_count: parseInt(targetWords, 10) || 1600,
      savedAt: new Date().toISOString(),
    };

    try {
      sessionStorage.setItem(token, JSON.stringify(payload));
    } catch {
      // ignore storage error
    }

    router.push({ pathname: '/articles/new', query: { prefill: token } });
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
        <Loader2 className="h-10 w-10 animate-spin text-[#0B5ED7]" />
      </div>
    );
  }

  return (
    <>
      <Head>
        <title>Generate Article | Article Intelligence</title>
      </Head>
      <div className="min-h-screen bg-gray-50 p-6">
        <div className="mx-auto max-w-3xl rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between gap-3 mb-5">
            <div>
              <p className="text-xs text-gray-500">Article Intelligence</p>
              <h1 className="text-2xl font-bold text-gray-900">Generate Article Draft</h1>
            </div>
            <Link href="/articles/create" className="text-sm text-gray-600 hover:text-gray-900">
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
              <label htmlFor="article-topic" className="block text-xs font-semibold text-blue-700 uppercase tracking-wide mb-1">
                {prefillTopic ? 'Recommended Topic' : 'Topic'}
              </label>
              <input
                id="article-topic"
                type="text"
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                placeholder="Enter the article topic you want to write about"
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
                  <option value="1200">~1200 words (standard article)</option>
                  <option value="1600">~1600 words (in-depth article)</option>
                  <option value="2000">~2000 words (investigative deep-dive)</option>
                  <option value="2500">~2500 words (feature article)</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">Article Template</label>
                <select
                  value={articleFormat}
                  onChange={(e) => setArticleFormat(e.target.value as ArticleFormatType)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm bg-white"
                >
                  {ARTICLE_FORMAT_OPTIONS.map(opt => (
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
                  placeholder="e.g. Challenge common assumptions and present original analysis with multiple expert perspectives."
                  className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm bg-white"
                />
                <SuggestionOptionPicker
                  options={suggestions?.uniqueness_directive_options ?? []}
                  accent="blue"
                  onPick={(option) => setUniquenessDirective((prev) => appendPointer(prev, option, '\n- '))}
                  onSelectAll={() => setUniquenessDirective(appendAllPointers(suggestions?.uniqueness_directive_options ?? [], '\n- '))}
                  onClear={() => setUniquenessDirective('')}
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">Must-Include Points</label>
                <textarea
                  value={mustInclude}
                  onChange={(e) => setMustInclude(e.target.value)}
                  rows={2}
                  placeholder="Comma-separated: key framework, expert quotes, counter-arguments, data citations"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm bg-white"
                />
                <SuggestionOptionPicker
                  options={suggestions?.must_include_points_options ?? []}
                  accent="blue"
                  onPick={(option) => setMustInclude((prev) => appendPointer(prev, option, ', '))}
                  onSelectAll={() => setMustInclude(appendAllPointers(suggestions?.must_include_points_options ?? [], ', '))}
                  onClear={() => setMustInclude('')}
                />
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1.5">Campaign Objective</label>
                  <textarea
                    value={campaignObjective}
                    onChange={(e) => setCampaignObjective(e.target.value)}
                    rows={2}
                    placeholder="e.g. establish thought leadership in AI governance"
                    className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm bg-white"
                  />
                  <SuggestionOptionPicker
                    options={suggestions?.campaign_objective_options ?? []}
                    accent="blue"
                    onPick={(option) => setCampaignObjective((prev) => appendPointer(prev, option, '\n- '))}
                    onSelectAll={() => setCampaignObjective(appendAllPointers(suggestions?.campaign_objective_options ?? [], '\n- '))}
                    onClear={() => setCampaignObjective('')}
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1.5">Trend Context</label>
                  <textarea
                    value={trendContext}
                    onChange={(e) => setTrendContext(e.target.value)}
                    rows={2}
                    placeholder="e.g. regulatory shifts in data privacy 2026"
                    className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm bg-white"
                  />
                  <SuggestionOptionPicker
                    options={suggestions?.trend_context_options ?? []}
                    accent="blue"
                    onPick={(option) => setTrendContext((prev) => appendPointer(prev, option, '\n- '))}
                    onSelectAll={() => setTrendContext(appendAllPointers(suggestions?.trend_context_options ?? [], '\n- '))}
                    onClear={() => setTrendContext('')}
                  />
                </div>
              </div>
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
          initialTemplateName={templateName}
          initialTemplateBlocks={templateBlocks}
          contentType="article"
          initialFormatType={articleFormat}
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
