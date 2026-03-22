/**
 * BlogGenerateModal
 *
 * 4-step modal for AI blog generation.
 *
 * Step 1 — Theme Input:    topic, cluster, intent, series selection
 * Step 2 — Clarify:        targeted questions (only when signal is weak)
 * Step 3 — Pick Angle:     3 editorial directions + recommended badge from historical performance
 * Step 4 — Generating:     loading state while full post is constructed
 *
 * On completion, calls onGenerated(output, confidence, hookAssessment) so the parent
 * can pre-fill the editor, show a confidence badge, and warn about weak hooks.
 */

import React, { useState } from 'react';
import {
  X, Loader2, Sparkles, ChevronRight, ArrowLeft,
  Target, Layers, Lightbulb, BarChart2, Zap, TrendingUp,
  BookOpen, Check, AlertCircle, Star,
} from 'lucide-react';
import type { BlogGenerationOutput, BlogAngle, AngleType } from '../../lib/blog/blogGenerationEngine';
import type { ClarificationQuestion } from '../../lib/blog/blogClarificationEngine';
import type { HookAssessment } from '../../pages/api/admin/blog/generate';

// ── Types ─────────────────────────────────────────────────────────────────────

interface SeriesBlog {
  id:         string;
  title:      string;
  slug:       string | null;
  angle_type?: string | null;
}

interface IndustryAngle {
  angle_type:     AngleType;
  recommendation: 'best' | 'good' | 'avoid';
  prior_note:     string;
  confidence:     'data' | 'prior';
}

interface Props {
  companyId:   string;
  clusters?:   string[];
  blogs?:      SeriesBlog[];
  industry?:   string | null;   // company industry — powers Angle × Industry Matrix
  onClose:     () => void;
  onGenerated: (
    output:         BlogGenerationOutput & { content_blocks?: unknown[] },
    confidence:     'high' | 'medium',
    hookAssessment: HookAssessment,
    angleType:      AngleType | null,
  ) => void;
}

type Step = 'theme' | 'clarify' | 'angles' | 'generating';

const INTENT_OPTIONS = [
  { value: '',           label: 'Any — let AI decide' },
  { value: 'awareness',  label: 'Awareness — introduce a concept or problem' },
  { value: 'authority',  label: 'Authority — establish deep expertise' },
  { value: 'conversion', label: 'Conversion — move readers toward action' },
  { value: 'retention',  label: 'Retention — help practitioners go deeper' },
];

const ANGLE_META: Record<AngleType, { icon: React.ReactNode; color: string; border: string; bg: string }> = {
  analytical: {
    icon:   <BarChart2 className="h-5 w-5" />,
    color:  'text-blue-600',
    border: 'border-blue-200',
    bg:     'bg-blue-50',
  },
  contrarian: {
    icon:   <Zap className="h-5 w-5" />,
    color:  'text-amber-600',
    border: 'border-amber-200',
    bg:     'bg-amber-50',
  },
  strategic: {
    icon:   <TrendingUp className="h-5 w-5" />,
    color:  'text-emerald-600',
    border: 'border-emerald-200',
    bg:     'bg-emerald-50',
  },
};

const STEPS: Step[] = ['theme', 'clarify', 'angles', 'generating'];

function stepProgress(step: Step, hasClarify: boolean): number {
  if (step === 'theme')      return 25;
  if (step === 'clarify')    return 50;
  if (step === 'angles')     return hasClarify ? 75 : 50;
  return 100;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function BlogGenerateModal({ companyId, clusters = [], blogs = [], industry, onClose, onGenerated }: Props) {
  // Step 1 state
  const [topic,          setTopic]          = useState('');
  const [cluster,        setCluster]        = useState('');
  const [intent,         setIntent]         = useState('');
  const [seriesMode,     setSeriesMode]     = useState(false);
  const [selectedBlogIds, setSelectedBlogIds] = useState<string[]>([]);

  // Step 2 state
  const [questions, setQuestions] = useState<ClarificationQuestion[]>([]);
  const [answers,   setAnswers]   = useState<Record<string, string>>({});

  // Step 3 state
  const [angles,           setAngles]           = useState<BlogAngle[]>([]);
  const [selectedAngle,    setSelectedAngle]    = useState<BlogAngle | null>(null);
  const [recommendedAngle, setRecommendedAngle] = useState<AngleType | null>(null);
  const [industryMatrix,   setIndustryMatrix]   = useState<IndustryAngle[]>([]);

  // Flow
  const [step,         setStep]         = useState<Step>('theme');
  const [hadClarify,   setHadClarify]   = useState(false);
  const [error,        setError]        = useState('');

  // ── Helpers ───────────────────────────────────────────────────────────────

  const publishedBlogs = blogs.filter(b => b.id && b.title);

  function toggleBlogId(id: string) {
    setSelectedBlogIds(prev => {
      const next = prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id];
      // Angle lock-in: detect dominant angle from selected series blogs
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

  function buildBody(extra: Record<string, unknown> = {}): Record<string, unknown> {
    const body: Record<string, unknown> = {
      company_id: companyId,
      topic:      topic.trim(),
    };
    if (cluster)                    body.cluster        = cluster;
    if (intent)                     body.intent         = intent;
    if (Object.keys(answers).length) body.answers       = answers;
    if (selectedBlogIds.length)     body.series_blog_ids = selectedBlogIds;
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
    setStep('generating'); // temporary loading state

    try {
      const [res] = await Promise.all([
        fetch('/api/admin/blog/generate', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify(buildBody({ mode: 'angles' })),
        }),
        fetchIndustryMatrix(),
      ]);
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Something went wrong.'); setStep('theme'); return; }

      if (data.needs_clarification) {
        setQuestions(data.questions ?? []);
        setHadClarify(true);
        setStep('clarify');
      } else {
        setAngles(data.angles ?? []);
        setRecommendedAngle(data.recommended_angle ?? null);
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
    setStep('generating'); // temporary loading state

    try {
      const [res] = await Promise.all([
        fetch('/api/admin/blog/generate', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify(buildBody({ mode: 'angles' })),
        }),
        fetchIndustryMatrix(),
      ]);
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Something went wrong.'); setStep('clarify'); return; }

      setAngles(data.angles ?? []);
      setRecommendedAngle(data.recommended_angle ?? null);
      setStep('angles');
    } catch {
      setError('Network error. Please try again.');
      setStep('clarify');
    }
  }

  // ── Submit angle → generate full blog ────────────────────────────────────
  async function generateFull() {
    if (!selectedAngle) return;
    setError('');
    setStep('generating');

    try {
      const res  = await fetch('/api/admin/blog/generate', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(buildBody({ mode: 'full', selected_angle: selectedAngle })),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Generation failed.'); setStep('angles'); return; }

      const confidence: 'high' | 'medium' = data.confidence ?? 'medium';
      const hookAssessment: HookAssessment = data.hook_assessment ?? { strength: 'moderate', note: '' };
      onGenerated(data.result, confidence, hookAssessment, selectedAngle?.type ?? null);
    } catch {
      setError('Network error. Please try again.');
      setStep('angles');
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  const progress = stepProgress(step, hadClarify);

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden max-h-[90vh] flex flex-col">

        {/* Header */}
        <div className="bg-gradient-to-r from-indigo-600 to-violet-600 px-6 py-4 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <Sparkles className="h-5 w-5 text-white" />
            <h2 className="text-base font-bold text-white">Generate Blog from Theme</h2>
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
                <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2 flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 shrink-0" /> {error}
                </p>
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
                <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2 flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 shrink-0" /> {error}
                </p>
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
                  <span><strong>Recommended:</strong> {recommendedAngle.charAt(0).toUpperCase() + recommendedAngle.slice(1)} — based on your past blog performance</span>
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
                            {isBestForInd && !isRecommend && industry && (
                              <span className="flex items-center gap-0.5 text-[10px] font-semibold text-violet-700 bg-violet-50 px-1.5 py-0.5 rounded-full">
                                <TrendingUp className="h-2.5 w-2.5" /> Works well for {industry}
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
                <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2 flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 shrink-0" /> {error}
                </p>
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
                  <Sparkles className="h-4 w-4" /> Write This Blog
                </button>
              </div>
            </div>
          )}

          {/* ── STEP 4: Generating ───────────────────────────────────────── */}
          {step === 'generating' && (
            <div className="px-6 py-14 flex flex-col items-center gap-4 text-center">
              <div className="relative">
                <div className="w-14 h-14 rounded-full bg-indigo-100 flex items-center justify-center">
                  <Sparkles className="h-6 w-6 text-indigo-600" />
                </div>
                <Loader2 className="absolute -inset-1 h-16 w-16 text-indigo-400 animate-spin opacity-60" />
              </div>
              <div>
                <p className="text-base font-bold text-gray-900">
                  {angles.length === 0 ? 'Generating angle options…' : 'Writing your blog post'}
                </p>
                <p className="text-sm text-gray-500 mt-1 max-w-xs">
                  {angles.length === 0
                    ? 'Analysing the topic and identifying three editorial directions.'
                    : 'Constructing the narrative section by section. Takes 15–30 seconds.'}
                </p>
              </div>
              {angles.length > 0 && (
                <div className="flex flex-col gap-1.5 text-xs text-gray-400 mt-2">
                  {[
                    'Applying the selected angle',
                    'Writing key insights',
                    selectedBlogIds.length > 0 ? 'Checking series for continuity' : 'Crafting narrative structure',
                    'Writing each section with depth',
                    'Generating SEO metadata',
                  ].map((label, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <div
                        className="w-1.5 h-1.5 rounded-full bg-indigo-300 animate-pulse"
                        style={{ animationDelay: `${i * 0.3}s` }}
                      />
                      {label}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
