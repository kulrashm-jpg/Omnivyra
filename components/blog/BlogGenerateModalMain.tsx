import React, { useState } from 'react';
import { X, Loader2, Sparkles, ChevronRight, ArrowLeft, Target, Layers, Lightbulb, BarChart2, Zap, TrendingUp, BookOpen, Check, AlertCircle, Star } from 'lucide-react';
import type { BlogGenerationOutput, BlogAngle, AngleType } from '../../lib/blog/blogGenerationEngine';
import type { ClarificationQuestion } from '../../lib/blog/blogClarificationEngine';
import type { HookAssessment } from '../../lib/blog/hookAssessment';
import type { AngleEffectivenessEntry } from '../../lib/blog/feedbackOptimizationEngine';
import type { SEOIntelligenceResult } from '../../lib/blog/seoIntelligenceEngine';
import type { TrendIntelligenceResult } from '../../lib/blog/trendIntelligenceEngine';
import { BLOG_FORMAT_OPTIONS, ARTICLE_FORMAT_OPTIONS, WHITEPAPER_FORMAT_OPTIONS, NEWSLETTER_FORMAT_OPTIONS, STORY_FORMAT_OPTIONS, GUIDE_FORMAT_OPTIONS, type BlogFormatType, type ArticleFormatType, type WhitepaperFormatType, type NewsletterFormatType, type StoryFormatType, type GuideFormatType } from '../../lib/blog/blogStructureTemplates';
import type { ContentBlock } from '../../lib/blog/blockTypes';
import { getRecommendedTemplateCards, getTemplateCards } from '../../lib/content/contentTemplateCards';
import type { ManagedContentType } from '../../lib/content/contentTemplateRegistry';

// ── Types ─────────────────────────────────────────────────────────────────────

import { stepProgress, type IndustryAngle, type Props, type Step, type GenerationKind, type QualityGateReport, INTENT_OPTIONS, ANGLE_META, ANGLE_TRACKER_STEPS, FULL_TRACKER_STEPS } from './BlogGenerateModalModel';


// ── Component ─────────────────────────────────────────────────────────────────

export default function BlogGenerateModal({
  companyId,
  clusters = [],
  blogs = [],
  industry,
  initialTopic,
  initialTargetWords,
  initialIntent,
  initialTone,
  initialRelatedBlogs,
  baseAnswers,
  initialTemplateName,
  initialTemplateBlocks,
  contentType = 'blog',
  initialFormatType = 'standard',
  onClose,
  onGenerated,
}: Props) {
  // Step 1 state
  const [topic,          setTopic]          = useState(initialTopic ?? '');
  const [cluster,        setCluster]        = useState('');
  const [intent,         setIntent]         = useState('');
  const [targetWords,    setTargetWords]    = useState(initialTargetWords || '1200');
  const [seriesMode,     setSeriesMode]     = useState(false);
  const [selectedBlogIds, setSelectedBlogIds] = useState<string[]>([]);

  // Step 2 state
  const [questions, setQuestions] = useState<ClarificationQuestion[]>([]);
  const [answers,   setAnswers]   = useState<Record<string, string>>({});

  // Step 3 state
  const [angles,              setAngles]              = useState<BlogAngle[]>([]);
  const [selectedAngle,       setSelectedAngle]       = useState<BlogAngle | null>(null);
  const [recommendedAngle,    setRecommendedAngle]    = useState<AngleType | null>(null);
  const [industryMatrix,      setIndustryMatrix]      = useState<IndustryAngle[]>([]);
  const [angleEffectiveness,  setAngleEffectiveness]  = useState<Partial<Record<AngleType, AngleEffectivenessEntry>>>({});
  const [effectivenessBased,  setEffectivenessBased]  = useState(false);
  const [seoIntelligence,     setSeoIntelligence]     = useState<SEOIntelligenceResult | null>(null);
  const [trendIntelligence,   setTrendIntelligence]   = useState<TrendIntelligenceResult | null>(null);

  // Flow
  const [step,         setStep]         = useState<Step>('theme');
  const [hadClarify,   setHadClarify]   = useState(false);
  const [error,        setError]        = useState('');
  const [generationKind, setGenerationKind] = useState<GenerationKind>('angles');
  const [generationProgress, setGenerationProgress] = useState(0);
  const [qualityReport, setQualityReport] = useState<QualityGateReport | null>(null);
  const [openingEditor, setOpeningEditor] = useState(false);

  React.useEffect(() => {
    if (step !== 'generating') {
      setGenerationProgress(0);
      setOpeningEditor(false);
      return undefined;
    }
    const ceiling = generationKind === 'full' ? 94 : 88;
    const interval = window.setInterval(() => {
      setGenerationProgress((current) => {
        if (current >= ceiling) return current;
        const increment = generationKind === 'full'
          ? current < 55 ? 6 : current < 80 ? 3 : 1
          : current < 60 ? 10 : 4;
        return Math.min(ceiling, current + increment);
      });
    }, generationKind === 'full' ? 900 : 500);
    return () => window.clearInterval(interval);
  }, [generationKind, step]);

  // Keep topic in sync when caller changes initialTopic (e.g. route query prefill)
  React.useEffect(() => {
    if (typeof initialTopic === 'string' && initialTopic.trim()) {
      setTopic(initialTopic.trim());
    }
  }, [initialTopic]);

  React.useEffect(() => {
    if (initialIntent) {
      setIntent(initialIntent);
    }
  }, [initialIntent]);

  React.useEffect(() => {
    if (initialTargetWords && initialTargetWords.trim()) {
      setTargetWords(initialTargetWords.trim());
    }
  }, [initialTargetWords]);

  const managedContentType = contentType as ManagedContentType;
  const templateCards = React.useMemo(() => getTemplateCards(managedContentType), [managedContentType]);
  const recommendedTemplateCards = React.useMemo(
    () => getRecommendedTemplateCards(managedContentType),
    [managedContentType],
  );
  const activeTemplateName = typeof initialTemplateName === 'string' ? initialTemplateName.trim().toLowerCase() : '';
  const activeFormatType = typeof initialFormatType === 'string' ? initialFormatType.trim().toLowerCase() : 'standard';

  function isActiveTemplateCard(card: { title: string; formatType?: string }) {
    if (activeTemplateName) {
      return card.title.trim().toLowerCase() === activeTemplateName;
    }
    return typeof card.formatType === 'string' && card.formatType.trim().toLowerCase() === activeFormatType;
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  const publishedBlogs = blogs.filter(b => b.id && b.title);

  function toggleBlogId(id: string) {
    setSelectedBlogIds(prev => {
      const next = prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id];
      // Angle lock-in: detect dominant angle from selected related long-form pieces
      if (next.length > 0) {
        const counts: Record<string, number> = {};
        for (const bid of next) {
          const b = publishedBlogs.find(x => x.id === bid);
          const at = b?.angle_type;
          if (at && ['analytical', 'contrarian', 'strategic'].includes(at)) {
            counts[at] = (counts[at] ?? 0) + 1;
          }
        }
        const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
        if (top) {
          setRecommendedAngle(top[0] as AngleType);
        }
      } else {
        setRecommendedAngle(null);
      }
      return next;
    });
  }

  const apiEndpoint = contentType === 'whitepaper'
    ? '/api/whitepapers/generate'
    : contentType === 'guide'
      ? '/api/guides/generate'
      : contentType === 'newsletter'
        ? '/api/newsletters/generate'
        : contentType === 'story'
          ? '/api/stories/generate'
          : contentType === 'article'
            ? '/api/articles/generate'
            : contentType === 'case-study'
              ? '/api/case-studies/generate'
              : '/api/blogs/generate';
  const contentLabel = contentType === 'whitepaper'
    ? 'whitepaper'
    : contentType === 'guide'
      ? 'guide'
      : contentType === 'newsletter'
        ? 'newsletter'
        : contentType === 'story'
          ? 'story'
          : contentType === 'article'
            ? 'article'
            : contentType === 'case-study'
              ? 'case study'
            : 'blog';
  const contentLabelTitle = contentLabel.charAt(0).toUpperCase() + contentLabel.slice(1);

  function buildBody(extra: Record<string, unknown> = {}): Record<string, unknown> {
    const mergedAnswers = {
      ...(baseAnswers || {}),
      ...answers,
      ...(targetWords ? { target_word_count: targetWords } : {}),
    };

    const body: Record<string, unknown> = {
      company_id: companyId,
      topic:      topic.trim(),
      content_type: contentType,
      format_type: initialFormatType,
      cache_version: `live-path-sync-v2:${contentType}:${String(initialFormatType || 'standard')}`,
    };
    if (initialTemplateName)          body.template_name = initialTemplateName;
    if (initialTemplateBlocks?.length) body.template_blocks = initialTemplateBlocks;
    if (cluster)                    body.cluster        = cluster;
    if (intent)                     body.intent         = intent;
    if (Object.keys(mergedAnswers).length) body.answers = mergedAnswers;
    if (initialTone)                body.tone           = initialTone;
    if (selectedBlogIds.length)     body.series_blog_ids = selectedBlogIds;
    if (selectedBlogIds.length === 0 && (initialRelatedBlogs?.length || 0) > 0) {
      body.related_blogs = initialRelatedBlogs;
    }
    if (seriesMode && selectedBlogIds.length) {
      const titles = selectedBlogIds
        .map(id => publishedBlogs.find(b => b.id === id)?.title)
        .filter(Boolean);
      if (titles.length) body.related_blogs = titles;
    }
    return { ...body, ...extra };
  }

  // ── Fetch industry matrix (fire-and-forget, enriches angle cards) ─────────
  async function fetchIndustryMatrix() {
    if (!industry) return;
    try {
      const r = await fetch(`/api/track/angle-industry-matrix?industry=${encodeURIComponent(industry)}`);
      if (r.ok) {
        const d = await r.json();
        setIndustryMatrix(d.angles ?? []);
      }
    } catch { /* non-blocking */ }
  }

  // ── Submit theme → check clarification + fetch angles ────────────────────
  async function submitTheme() {
    if (!topic.trim()) { setError('Please enter a topic.'); return; }
    setError('');
    setQualityReport(null);
    setGenerationKind('angles');
    setGenerationProgress(5);
    setStep('generating'); // temporary loading state

    try {
      const [res] = await Promise.all([
        fetch(apiEndpoint, {
          method:  'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify(buildBody({ mode: 'angles' })),
        }),
        fetchIndustryMatrix(),
      ]);
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Something went wrong.'); setStep('theme'); return; }
      setGenerationProgress(100);

      if (data.needs_clarification) {
        setQuestions(data.questions ?? []);
        setHadClarify(true);
        setStep('clarify');
      } else {
        setAngles(data.angles ?? []);
        setRecommendedAngle(data.recommended_angle ?? null);
        setAngleEffectiveness(data.angle_effectiveness ?? {});
        setEffectivenessBased(data.effectiveness_based ?? false);
        setSeoIntelligence(data.seo_intelligence ?? null);
        setTrendIntelligence(data.trend_intelligence ?? null);
        setStep('angles');
      }
    } catch {
      setError('Network error. Please try again.');
      setStep('theme');
    }
  }

  // ── Submit answers → fetch angles ─────────────────────────────────────────
  async function submitAnswers() {
    setError('');
    setQualityReport(null);
    setGenerationKind('angles');
    setGenerationProgress(5);
    setStep('generating'); // temporary loading state

    try {
      const [res] = await Promise.all([
        fetch(apiEndpoint, {
          method:  'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify(buildBody({ mode: 'angles' })),
        }),
        fetchIndustryMatrix(),
      ]);
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Something went wrong.'); setStep('clarify'); return; }
      setGenerationProgress(100);

      setAngles(data.angles ?? []);
      setRecommendedAngle(data.recommended_angle ?? null);
      setAngleEffectiveness(data.angle_effectiveness ?? {});
      setEffectivenessBased(data.effectiveness_based ?? false);
      setSeoIntelligence(data.seo_intelligence ?? null);
      setTrendIntelligence(data.trend_intelligence ?? null);
      setStep('angles');
    } catch {
      setError('Network error. Please try again.');
      setStep('clarify');
    }
  }

  // ── Submit angle → generate full content draft ───────────────────────────
  async function generateFull() {
    if (!selectedAngle) return;
    setError('');
    setQualityReport(null);
    setOpeningEditor(false);
    setGenerationKind('full');
    setGenerationProgress(5);
    setStep('generating');

    try {
      const res  = await fetch(apiEndpoint, {
        method:  'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(buildBody({ mode: 'full', selected_angle: selectedAngle })),
      });
      const data = await res.json();
      if (!res.ok) {
        const report = data.thought_leadership_quality && typeof data.thought_leadership_quality === 'object'
          ? data.thought_leadership_quality as QualityGateReport
          : null;
        setQualityReport(report);
        setError(report?.failures?.length
          ? `Quality gate blocked this draft: ${report.failures.join('; ')}`
          : data.error || 'Generation failed.');
        setGenerationProgress(100);
        setStep('angles');
        return;
      }
      setGenerationProgress(100);

      const confidence: 'high' | 'medium' = data.confidence ?? 'medium';
      const hookAssessment: HookAssessment = data.hook_assessment ?? { strength: 'moderate', note: '' };

      // Attach SEO keywords to result for persistence downstream
      const resultWithSeo = { ...data.result };
      const seo = data.seo_intelligence ?? seoIntelligence;
      if (seo) {
        resultWithSeo.primary_keyword = seo.primary_keyword;
        resultWithSeo.secondary_keywords = seo.secondary_keywords;
      }

      setOpeningEditor(true);
      setGenerationProgress(100);
      await onGenerated(resultWithSeo, confidence, hookAssessment, selectedAngle?.type ?? null);
    } catch {
      setOpeningEditor(false);
      setError('Network error. Please try again.');
      setStep('angles');
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  const progress = stepProgress(step, hadClarify);
  const trackerSteps = generationKind === 'full' ? FULL_TRACKER_STEPS : ANGLE_TRACKER_STEPS;
  const activeTrackerIndex = Math.max(0, trackerSteps.findLastIndex((item) => generationProgress >= item.minProgress));

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden max-h-[90vh] flex flex-col">

        {/* Header */}
        <div className="bg-gradient-to-r from-indigo-600 to-violet-600 px-6 py-4 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <Sparkles className="h-5 w-5 text-white" />
            <h2 className="text-base font-bold text-white">Generate {contentLabelTitle} from Theme</h2>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-white/70 hover:text-white hover:bg-white/20 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Progress bar */}
        <div className="h-1 bg-indigo-100 shrink-0">
          <div
            className="h-full bg-indigo-500 transition-all duration-500"
            style={{ width: `${progress}%` }}
          />
        </div>

        {/* Scrollable body */}
        <div className="overflow-y-auto flex-1">

          {/* ── STEP 1: Theme Input ──────────────────────────────────────── */}
          {step === 'theme' && (
            <div className="p-6 space-y-5">
              <p className="text-sm text-gray-500">
                Describe your topic. AI will propose three editorial angles — you pick the direction, then it writes the full post.
              </p>

              {/* Topic */}
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">
                  <Lightbulb className="inline h-4 w-4 mr-1.5 text-amber-500" />
                  Topic / Theme
                  <span className="text-red-500 ml-0.5">*</span>
                </label>
                <textarea
                  value={topic}
                  onChange={e => { setTopic(e.target.value); setError(''); }}
                  placeholder="e.g. Why most B2B content strategies fail — and how intent-based clusters fix the problem"
                  rows={3}
                  className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-400 resize-none placeholder-gray-400"
                />
                <p className="text-[11px] text-gray-400 mt-1">Be specific. More context = less clarification needed.</p>
              </div>

              {/* Cluster */}
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">
                  <Layers className="inline h-4 w-4 mr-1.5 text-indigo-500" />
                  Content Cluster
                  <span className="text-gray-400 font-normal ml-1">(optional)</span>
                </label>
                {clusters.length > 0 ? (
                  <select
                    value={cluster}
                    onChange={e => setCluster(e.target.value)}
                    className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                  >
                    <option value="">Not part of a cluster</option>
                    {clusters.map(c => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                ) : (
                  <input
                    value={cluster}
                    onChange={e => setCluster(e.target.value)}
                    placeholder="e.g. Content Strategy, ABM, Demand Generation"
                    className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-400 placeholder-gray-400"
                  />
                )}
              </div>

              {/* Intent */}
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">
                  <Target className="inline h-4 w-4 mr-1.5 text-green-500" />
                  Strategic Intent
                  <span className="text-gray-400 font-normal ml-1">(optional)</span>
                </label>
                <select
                  value={intent}
                  onChange={e => setIntent(e.target.value)}
                  className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                >
                  {INTENT_OPTIONS.map(o => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>

              {/* Target length */}
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">
                  Target Length
                  <span className="text-gray-400 font-normal ml-1">(word count)</span>
                </label>
                <select
                  value={targetWords}
                  onChange={e => setTargetWords(e.target.value)}
                  className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                >
                  <option value="800">~800 words (short)</option>
                  <option value="1200">~1200 words (standard)</option>
                  <option value="1600">~1600 words (deep-dive)</option>
                  <option value="2000">~2000 words (pillar content)</option>
                </select>
              </div>

              {/* Format type (read-only display from briefing page) */}
              {initialFormatType !== 'standard' && (
                <div className="flex items-center gap-2 rounded-lg border border-indigo-100 bg-indigo-50/50 px-3 py-2">
                  <span className="text-xs text-gray-500">Format:</span>
                  <span className="text-xs font-semibold text-indigo-700">
                    {BLOG_FORMAT_OPTIONS.find(f => f.value === initialFormatType)?.label
                      ?? ARTICLE_FORMAT_OPTIONS.find(f => f.value === initialFormatType)?.label
                      ?? WHITEPAPER_FORMAT_OPTIONS.find(f => f.value === initialFormatType)?.label
                      ?? NEWSLETTER_FORMAT_OPTIONS.find(f => f.value === initialFormatType)?.label
                      ?? STORY_FORMAT_OPTIONS.find(f => f.value === initialFormatType)?.label
                      ?? GUIDE_FORMAT_OPTIONS.find(f => f.value === initialFormatType)?.label
                      ?? 'Standard'}
                  </span>
                </div>
              )}

              {(recommendedTemplateCards.length > 0 || templateCards.length > 0) && (
                <div className="space-y-3">
                  {recommendedTemplateCards.length > 0 && (
                    <div>
                      <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500">Recommended Templates</p>
                      <div className="grid gap-2">
                        {recommendedTemplateCards.map((card) => {
                          const active = isActiveTemplateCard(card);
                          return (
                            <div
                              key={`recommended-${card.id}`}
                              className={`rounded-xl border px-3 py-2.5 ${
                                active
                                  ? 'border-indigo-300 bg-indigo-50'
                                  : 'border-amber-200 bg-amber-50/60'
                              }`}
                            >
                              <div className="flex items-center justify-between gap-3">
                                <div>
                                  <p className={`text-sm font-semibold ${active ? 'text-indigo-700' : 'text-gray-800'}`}>{card.title}</p>
                                  <p className="mt-0.5 text-xs text-gray-600">{card.description}</p>
                                </div>
                                <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                                  active ? 'bg-indigo-100 text-indigo-700' : 'bg-amber-100 text-amber-700'
                                }`}>
                                  {active ? 'Current' : 'Recommended'}
                                </span>
                              </div>
                              {card.recommendedFor.length > 0 && (
                                <p className="mt-2 text-[11px] text-gray-500">
                                  Best for: {card.recommendedFor.join(', ')}
                                </p>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {templateCards.length > 0 && (
                    <div>
                      <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500">Available Template Families</p>
                      <div className="flex flex-wrap gap-2">
                        {templateCards.map((card) => {
                          const active = isActiveTemplateCard(card);
                          return (
                            <div
                              key={card.id}
                              className={`rounded-full border px-2.5 py-1 text-[11px] ${
                                active
                                  ? 'border-indigo-300 bg-indigo-50 text-indigo-700'
                                  : 'border-gray-200 bg-white text-gray-600'
                              }`}
                              title={card.description}
                            >
                              {card.title}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Series toggle */}
              {publishedBlogs.length > 0 && (
                <div>
                  <button
                    type="button"
                    onClick={() => setSeriesMode(v => !v)}
                    className="flex items-center gap-2 text-sm font-semibold text-indigo-700 hover:text-indigo-900 transition-colors"
                  >
                    <BookOpen className="h-4 w-4" />
                    {seriesMode ? 'Remove series context' : 'Part of an existing series?'}
                  </button>

                  {seriesMode && (
                    <div className="mt-3 space-y-2">
                      <p className="text-xs text-gray-500">Select previous articles in this series. AI will avoid repeating them and build on their content.</p>
                      <div className="max-h-40 overflow-y-auto border border-gray-200 rounded-xl divide-y divide-gray-100">
                        {publishedBlogs.map(b => (
                          <label
                            key={b.id}
                            className="flex items-center gap-3 px-3 py-2.5 cursor-pointer hover:bg-gray-50 transition-colors"
                          >
                            <div className={`w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 transition-colors ${
                              selectedBlogIds.includes(b.id)
                                ? 'bg-indigo-600 border-indigo-600'
                                : 'border-gray-300'
                            }`}>
                              {selectedBlogIds.includes(b.id) && (
                                <Check className="h-2.5 w-2.5 text-white" />
                              )}
                            </div>
                            <input
                              type="checkbox"
                              className="sr-only"
                              checked={selectedBlogIds.includes(b.id)}
                              onChange={() => toggleBlogId(b.id)}
                            />
                            <span className="text-sm text-gray-700 line-clamp-1">{b.title}</span>
                          </label>
                        ))}
                      </div>
                      {selectedBlogIds.length > 0 && (
                        <p className="text-[11px] text-indigo-600 font-medium">
                          {selectedBlogIds.length} article{selectedBlogIds.length !== 1 ? 's' : ''} selected — AI will read their content and ensure this builds progressively
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}

              {error && (
                <div className="space-y-3 rounded-xl border border-red-200 bg-red-50 px-3 py-3">
                  <p className="text-sm text-red-700 flex items-start gap-2">
                    <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" /> {error}
                  </p>
                  {qualityReport ? (
                    <div className="space-y-2">
                      <div className="grid grid-cols-2 gap-2 text-[11px]">
                        {[
                          ['POV', qualityReport.companyPovScore],
                          ['Strategic', qualityReport.strategicValueScore],
                          ['Executive', qualityReport.executiveRelevanceScore],
                          ['Rebrand', qualityReport.rebrandResistanceScore],
                          ['Editorial body', qualityReport.editorialBodyScore],
                          ['Duplication', qualityReport.duplicationScore],
                        ].map(([label, score]) => (
                          <div key={String(label)} className="rounded-lg bg-white/80 px-2 py-1.5 text-gray-700">
                            <span className="font-semibold">{label}</span>
                            <span className="float-right tabular-nums">{typeof score === 'number' ? score : '—'}</span>
                          </div>
                        ))}
                      </div>
                      {(qualityReport.editorialBody?.issues?.length || qualityReport.executiveAudience?.issues?.length || qualityReport.contentDuplication?.issues?.length) ? (
                        <ul className="space-y-1 text-[11px] leading-4 text-red-700">
                          {[...(qualityReport.editorialBody?.issues ?? []), ...(qualityReport.executiveAudience?.issues ?? []), ...(qualityReport.contentDuplication?.issues ?? [])]
                            .slice(0, 4)
                            .map((issue) => <li key={issue}>• {issue}</li>)}
                        </ul>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              )}

              <div className="flex justify-end pt-1">
                <button
                  onClick={submitTheme}
                  disabled={!topic.trim()}
                  className="flex items-center gap-2 px-5 py-2.5 bg-indigo-600 text-white rounded-xl text-sm font-semibold hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  Continue <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}

          {/* ── STEP 2: Clarification ────────────────────────────────────── */}
          {step === 'clarify' && (
            <div className="p-6 space-y-5">
              <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
                <p className="text-sm font-semibold text-amber-800">A few quick questions</p>
                <p className="text-xs text-amber-700 mt-0.5">
                  Your topic needs a bit more context. Answer what you can — all fields are optional.
                </p>
              </div>

              <div className="space-y-4">
                {questions.map(q => (
                  <div key={q.id}>
                    <label className="block text-sm font-medium text-gray-700 mb-1.5">
                      {q.question}
                    </label>
                    <input
                      type="text"
                      value={answers[q.id] ?? ''}
                      onChange={e => setAnswers(prev => ({ ...prev, [q.id]: e.target.value }))}
                      placeholder={q.placeholder}
                      className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-400 placeholder-gray-400"
                    />
                  </div>
                ))}
              </div>

              {error && (
                <div className="space-y-3 rounded-xl border border-red-200 bg-red-50 px-3 py-3">
                  <p className="text-sm text-red-700 flex items-start gap-2">
                    <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" /> {error}
                  </p>
                  {qualityReport ? (
                    <div className="space-y-2">
                      <div className="grid grid-cols-2 gap-2 text-[11px]">
                        {[
                          ['POV', qualityReport.companyPovScore],
                          ['Strategic', qualityReport.strategicValueScore],
                          ['Executive', qualityReport.executiveRelevanceScore],
                          ['Rebrand', qualityReport.rebrandResistanceScore],
                          ['Editorial body', qualityReport.editorialBodyScore],
                          ['Duplication', qualityReport.duplicationScore],
                        ].map(([label, score]) => (
                          <div key={String(label)} className="rounded-lg bg-white/80 px-2 py-1.5 text-gray-700">
                            <span className="font-semibold">{label}</span>
                            <span className="float-right tabular-nums">{typeof score === 'number' ? score : '—'}</span>
                          </div>
                        ))}
                      </div>
                      {(qualityReport.editorialBody?.issues?.length || qualityReport.executiveAudience?.issues?.length || qualityReport.contentDuplication?.issues?.length) ? (
                        <ul className="space-y-1 text-[11px] leading-4 text-red-700">
                          {[...(qualityReport.editorialBody?.issues ?? []), ...(qualityReport.executiveAudience?.issues ?? []), ...(qualityReport.contentDuplication?.issues ?? [])]
                            .slice(0, 4)
                            .map((issue) => <li key={issue}>• {issue}</li>)}
                        </ul>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              )}

              <div className="flex items-center justify-between pt-1">
                <button
                  onClick={() => { setStep('theme'); setError(''); }}
                  className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 font-medium transition-colors"
                >
                  <ArrowLeft className="h-4 w-4" /> Back
                </button>
                <button
                  onClick={submitAnswers}
                  className="flex items-center gap-2 px-5 py-2.5 bg-indigo-600 text-white rounded-xl text-sm font-semibold hover:bg-indigo-700 transition-colors"
                >
                  See Angles <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}

          {/* ── STEP 3: Angle Picker ─────────────────────────────────────── */}
          {step === 'angles' && (
            <div className="p-6 space-y-4">
              <div>
                <p className="text-sm font-semibold text-gray-900">Choose your editorial angle</p>
                <p className="text-xs text-gray-500 mt-0.5">
                  Three distinct directions for this topic. Pick the one that best fits your audience and goal.
                </p>
              </div>

              {recommendedAngle && (
                <div className="flex items-center gap-1.5 text-xs text-indigo-700 bg-indigo-50 border border-indigo-200 rounded-lg px-3 py-1.5">
                  <Star className="h-3 w-3 fill-indigo-500 text-indigo-500" />
                  <span>
                    <strong>Recommended:</strong> {recommendedAngle.charAt(0).toUpperCase() + recommendedAngle.slice(1)}
                    {effectivenessBased
                      ? ` — ${Math.round((angleEffectiveness[recommendedAngle]?.score ?? 0) * 100)}% effective based on past content`
                      : ` — based on your past ${contentLabel} performance`}
                  </span>
                </div>
              )}

              {/* SEO Intelligence keywords */}
              {seoIntelligence && (
                <div className="bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 space-y-1">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-gray-700">
                    <Target className="h-3 w-3 text-indigo-500" />
                    SEO Keywords
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <span className="text-[10px] font-bold text-indigo-700 bg-indigo-100 px-2 py-0.5 rounded-full">
                      {seoIntelligence.primary_keyword}
                    </span>
                    {seoIntelligence.secondary_keywords.map(kw => (
                      <span key={kw} className="text-[10px] text-gray-600 bg-gray-200 px-2 py-0.5 rounded-full">
                        {kw}
                      </span>
                    ))}
                  </div>
                  {seoIntelligence.keyword_warnings.length > 0 && (
                    <div className="text-[10px] text-amber-700 mt-1">
                      {seoIntelligence.keyword_warnings.map((w, i) => (
                        <p key={i} className="flex items-start gap-1">
                          <AlertCircle className="h-3 w-3 shrink-0 mt-0.5 text-amber-500" />
                          {w}
                        </p>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Trend signals */}
              {trendIntelligence && trendIntelligence.relevant_trends.length > 0 && (
                <div className="bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 space-y-1">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-emerald-800">
                    <TrendingUp className="h-3 w-3 text-emerald-600" />
                    Trending in Your Market
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {trendIntelligence.relevant_trends.slice(0, 2).map(t => (
                      <span key={t.topic} className="text-[10px] font-medium text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full">
                        {t.topic} ({Math.round(t.discussion_growth * 100)}% growth)
                      </span>
                    ))}
                  </div>
                </div>
              )}

              <div className="space-y-3">
                {angles.map(angle => {
                  const meta          = ANGLE_META[angle.type];
                  const selected      = selectedAngle?.type === angle.type;
                  const isRecommend   = recommendedAngle === angle.type;
                  const industryAngle = industryMatrix.find(m => m.angle_type === angle.type);
                  const isBestForInd  = industryAngle?.recommendation === 'best';
                  const isAvoidForInd = industryAngle?.recommendation === 'avoid';
                  const effEntry      = angleEffectiveness[angle.type];
                  // Check if this angle's title has strong overlap with a relevant trend (>0.5 similarity)
                  const hasTrendOverlap = trendIntelligence?.relevant_trends.some(t => {
                    const tWords = new Set(t.topic.toLowerCase().split(/\s+/).filter(w => w.length >= 3));
                    const titleWords = angle.title.toLowerCase().split(/\s+/).filter(w => w.length >= 3);
                    const matches = titleWords.filter(w => tWords.has(w)).length;
                    const union = new Set([...tWords, ...titleWords]).size;
                    return union > 0 && (matches / union) > 0.5;
                  });
                  return (
                    <button
                      key={angle.type}
                      type="button"
                      onClick={() => setSelectedAngle(angle)}
                      className={`w-full text-left rounded-xl border-2 p-4 transition-all ${
                        selected
                          ? `${meta.border} ${meta.bg} ring-2 ring-offset-1 ring-indigo-400`
                          : isAvoidForInd
                          ? 'border-gray-100 bg-gray-50 opacity-70 hover:opacity-100 hover:border-gray-200'
                          : 'border-gray-200 hover:border-gray-300 bg-white'
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <div className={`shrink-0 mt-0.5 ${selected ? meta.color : 'text-gray-400'}`}>
                          {meta.icon}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1 flex-wrap">
                            <span className={`text-[11px] font-bold uppercase tracking-wider ${selected ? meta.color : 'text-gray-400'}`}>
                              {angle.label}
                            </span>
                            {isRecommend && (
                              <span className="flex items-center gap-0.5 text-[10px] font-semibold text-indigo-700 bg-indigo-100 px-1.5 py-0.5 rounded-full">
                                <Star className="h-2.5 w-2.5 fill-indigo-500" /> Recommended
                              </span>
                            )}
                            {effEntry && effEntry.sample_size >= 3 && !isRecommend && (
                              <span className="text-[10px] font-semibold text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded-full">
                                {Math.round(effEntry.score * 100)}% effective
                              </span>
                            )}
                            {isBestForInd && !isRecommend && industry && (
                              <span className="flex items-center gap-0.5 text-[10px] font-semibold text-violet-700 bg-violet-50 px-1.5 py-0.5 rounded-full">
                                <TrendingUp className="h-2.5 w-2.5" /> Works well for {industry}
                              </span>
                            )}
                            {hasTrendOverlap && (
                              <span className="flex items-center gap-0.5 text-[10px] font-semibold text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded-full">
                                <TrendingUp className="h-2.5 w-2.5" /> Trending
                              </span>
                            )}
                            {selected && (
                              <span className="flex items-center gap-0.5 text-[10px] font-semibold text-emerald-700 bg-emerald-100 px-1.5 py-0.5 rounded-full">
                                <Check className="h-2.5 w-2.5" /> Selected
                              </span>
                            )}
                          </div>
                          <p className="text-sm font-semibold text-gray-900 mb-1">{angle.title}</p>
                          <p className="text-xs text-gray-500 leading-relaxed">{angle.angle_summary}</p>
                          <p className="text-xs text-gray-400 italic mt-1.5 line-clamp-1">"{angle.hook}"</p>
                          {industryAngle?.prior_note && isBestForInd && industry && (
                            <p className="text-[10px] text-violet-600 mt-1.5 leading-relaxed">
                              {industryAngle.prior_note}
                            </p>
                          )}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>

              {error && (
                <div className="space-y-3 rounded-xl border border-red-200 bg-red-50 px-3 py-3">
                  <p className="text-sm text-red-700 flex items-start gap-2">
                    <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" /> {error}
                  </p>
                  {qualityReport ? (
                    <div className="space-y-2">
                      <div className="grid grid-cols-2 gap-2 text-[11px]">
                        {[
                          ['POV', qualityReport.companyPovScore],
                          ['Strategic', qualityReport.strategicValueScore],
                          ['Executive', qualityReport.executiveRelevanceScore],
                          ['Rebrand', qualityReport.rebrandResistanceScore],
                          ['Editorial body', qualityReport.editorialBodyScore],
                          ['Duplication', qualityReport.duplicationScore],
                        ].map(([label, score]) => (
                          <div key={String(label)} className="rounded-lg bg-white/80 px-2 py-1.5 text-gray-700">
                            <span className="font-semibold">{label}</span>
                            <span className="float-right tabular-nums">{typeof score === 'number' ? score : '—'}</span>
                          </div>
                        ))}
                      </div>
                      {(qualityReport.editorialBody?.issues?.length || qualityReport.executiveAudience?.issues?.length || qualityReport.contentDuplication?.issues?.length) ? (
                        <ul className="space-y-1 text-[11px] leading-4 text-red-700">
                          {[...(qualityReport.editorialBody?.issues ?? []), ...(qualityReport.executiveAudience?.issues ?? []), ...(qualityReport.contentDuplication?.issues ?? [])]
                            .slice(0, 4)
                            .map((issue) => <li key={issue}>• {issue}</li>)}
                        </ul>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              )}

              <div className="flex items-center justify-between pt-1">
                <button
                  onClick={() => { setStep(hadClarify ? 'clarify' : 'theme'); setError(''); }}
                  className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 font-medium transition-colors"
                >
                  <ArrowLeft className="h-4 w-4" /> Back
                </button>
                <button
                  onClick={generateFull}
                  disabled={!selectedAngle}
                  className="flex items-center gap-2 px-5 py-2.5 bg-indigo-600 text-white rounded-xl text-sm font-semibold hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  <Sparkles className="h-4 w-4" /> Write This {contentLabelTitle}
                </button>
              </div>
            </div>
          )}

          {/* ── STEP 4: Generating ───────────────────────────────────────── */}
          {step === 'generating' && (
            <div className="px-6 py-10 flex flex-col items-center gap-5 text-center">
              <div className="relative">
                <div className="w-14 h-14 rounded-full bg-indigo-100 flex items-center justify-center">
                  <Sparkles className="h-6 w-6 text-indigo-600" />
                </div>
                <Loader2 className="absolute -inset-1 h-16 w-16 text-indigo-400 animate-spin opacity-60" />
              </div>
              <div>
                <p className="text-base font-bold text-gray-900">
                  {openingEditor ? 'Opening editor...' : angles.length === 0 ? 'Generating angle options...' : `Writing your ${contentLabel}...`}
                </p>
                <p className="text-sm text-gray-500 mt-1 max-w-xs">
                  {openingEditor
                    ? 'Your draft is ready. Moving directly to the blog editor.'
                    : angles.length === 0
                    ? 'Analysing the topic and identifying three editorial directions.'
                    : 'Constructing the narrative section by section and running quality gates.'}
                </p>
              </div>
              <div className="w-full max-w-sm rounded-2xl border border-indigo-100 bg-indigo-50/60 p-4 text-left">
                <div className="mb-3 flex items-center justify-between text-xs font-semibold text-indigo-800">
                  <span>{generationKind === 'full' ? 'Blog generation progress' : 'Angle generation progress'}</span>
                  <span className="tabular-nums">{Math.max(5, Math.round(generationProgress))}%</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-white">
                  <div
                    className="h-full rounded-full bg-indigo-600 transition-all duration-500"
                    style={{ width: `${Math.max(5, generationProgress)}%` }}
                  />
                </div>
                <div className="mt-4 space-y-3">
                  {trackerSteps.map((item, index) => {
                    const complete = generationProgress >= item.minProgress && index < activeTrackerIndex;
                    const active = index === activeTrackerIndex;
                    return (
                      <div key={item.label} className="flex gap-3">
                        <div className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${
                          complete
                            ? 'border-emerald-500 bg-emerald-500 text-white'
                            : active
                              ? 'border-indigo-500 bg-white text-indigo-600'
                              : 'border-gray-200 bg-white text-gray-300'
                        }`}>
                          {complete ? <Check className="h-3 w-3" /> : active ? <Loader2 className="h-3 w-3 animate-spin" /> : <span className="h-1.5 w-1.5 rounded-full bg-current" />}
                        </div>
                        <div>
                          <p className={`text-xs font-semibold ${active || complete ? 'text-gray-900' : 'text-gray-400'}`}>{item.label}</p>
                          <p className={`text-[11px] leading-4 ${active ? 'text-gray-600' : 'text-gray-400'}`}>{item.detail}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}

