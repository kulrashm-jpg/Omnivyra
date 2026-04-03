'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { Loader2, Sparkles, AlertCircle, CheckCircle2 } from 'lucide-react';
import type { BlogGenerationOutput } from '../../../lib/blog/blogGenerationEngine';

type BriefInsight = {
  company_id: string;
  company_name: string;
  company_context: string;
  current_content: string;
  writing_style: string;
  related_titles: string[];
  intent: 'awareness' | 'authority' | 'conversion' | 'retention';
  tone: string;
};

type PrefillPayload = {
  selectedCompanyId: string;
  prefillTopic: string;
  prefillReason?: string;
  brief?: BriefInsight | null;
  targetWords?: string;
  readerStage?: string;
  ctaPreference?: string;
  uniquenessDirective?: string;
  mustInclude?: string;
  campaignObjective?: string;
  trendContext?: string;
};

type SuggestionResponse = {
  uniqueness_directive_options: string[];
  must_include_points_options: string[];
  campaign_objective_options: string[];
  trend_context_options: string[];
};

export default function AdminBlogContentRefinePage() {
  const router = useRouter();
  const token = typeof router.query.prefill === 'string' ? router.query.prefill : '';

  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successNote, setSuccessNote] = useState<string | null>(null);
  const [suggesting, setSuggesting] = useState(false);

  const [companyId, setCompanyId] = useState('');
  const [topic, setTopic] = useState('');
  const [reason, setReason] = useState('');
  const [brief, setBrief] = useState<BriefInsight | null>(null);

  const [targetWords, setTargetWords] = useState('1200');
  const [depthMode, setDepthMode] = useState('deep practical');
  const [readerStage, setReaderStage] = useState('decision-makers');
  const [ctaPreference, setCtaPreference] = useState('soft educational CTA');
  const [relevanceFocus, setRelevanceFocus] = useState('');
  const [uniquenessDirective, setUniquenessDirective] = useState('');
  const [mustInclude, setMustInclude] = useState('');
  const [campaignObjective, setCampaignObjective] = useState('');
  const [trendContext, setTrendContext] = useState('');
  const [avoidPhrases, setAvoidPhrases] = useState('generic AI fluff, broad claims without evidence');

  const [suggestions, setSuggestions] = useState<SuggestionResponse | null>(null);

  useEffect(() => {
    if (!router.isReady) return;

    try {
      if (!token) {
        setError('Missing prefill token. Return to Generate page and try again.');
        setLoading(false);
        return;
      }

      const raw = sessionStorage.getItem(token);
      if (!raw) {
        setError('Prefill data expired. Please return and restart refinement flow.');
        setLoading(false);
        return;
      }

      const payload = JSON.parse(raw) as PrefillPayload;

      setCompanyId(payload.selectedCompanyId || '');
      setTopic(payload.prefillTopic || '');
      setReason(payload.prefillReason || '');
      setBrief(payload.brief || null);
      setTargetWords(payload.targetWords || '1200');
      setReaderStage(payload.readerStage || 'decision-makers');
      setCtaPreference(payload.ctaPreference || 'soft educational CTA');
      setUniquenessDirective(payload.uniquenessDirective || '');
      setMustInclude(payload.mustInclude || '');
      setCampaignObjective(payload.campaignObjective || '');
      setTrendContext(payload.trendContext || '');
    } catch {
      setError('Invalid prefill payload. Please restart from Generate page.');
    } finally {
      setLoading(false);
    }
  }, [router.isReady, token]);

  const canGenerate = useMemo(() => {
    return !!companyId && !!topic.trim();
  }, [companyId, topic]);

  const suggestInputs = async () => {
    if (!canGenerate) return;
    setSuggesting(true);
    setError(null);

    try {
      const resp = await fetch('/api/admin/blog/brief-suggestions', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company_id: companyId,
          topic,
          reason,
          brief,
          currentValues: { uniquenessDirective, mustInclude, campaignObjective, trendContext },
        }),
      });

      const data = await resp.json().catch(() => ({})) as SuggestionResponse;
      if (!resp.ok) throw new Error('Suggestion generation failed');
      setSuggestions(data);

      if (!uniquenessDirective && data.uniqueness_directive_options?.[0]) setUniquenessDirective(data.uniqueness_directive_options[0]);
      if (!mustInclude && data.must_include_points_options?.[0]) setMustInclude(data.must_include_points_options[0]);
      if (!campaignObjective && data.campaign_objective_options?.[0]) setCampaignObjective(data.campaign_objective_options[0]);
      if (!trendContext && data.trend_context_options?.[0]) setTrendContext(data.trend_context_options[0]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to generate suggestions');
    } finally {
      setSuggesting(false);
    }
  };

  const generateAndOpenEditor = async () => {
    if (!canGenerate) return;
    setGenerating(true);
    setError(null);
    setSuccessNote(null);

    try {
      const answers: Record<string, string> = {
        ...(brief ? {
          company_context: brief.company_context,
          current_content: brief.current_content,
          writing_style: brief.writing_style,
        } : {}),
        target_word_count: targetWords,
        depth: depthMode,
        reader_stage: readerStage,
        cta_preference: ctaPreference,
        relevance_focus: relevanceFocus,
        uniqueness_directive: uniquenessDirective,
        must_include_points: mustInclude,
        campaign_objective: campaignObjective,
        trend_context: trendContext,
        avoid_phrases: avoidPhrases,
      };

      const resp = await fetch('/api/admin/blog/generate', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company_id: companyId,
          mode: 'full',
          topic,
          intent: brief?.intent || 'authority',
          related_blogs: brief?.related_titles || [],
          series_context: reason || undefined,
          tone: brief?.tone || undefined,
          answers,
        }),
      });

      const data = await resp.json().catch(() => ({})) as {
        result?: BlogGenerationOutput & { content_blocks?: unknown[] };
        confidence?: 'high' | 'medium';
        hook_assessment?: { strength: 'strong' | 'moderate' | 'weak'; note: string };
        error?: string;
      };

      if (!resp.ok || !data.result) {
        throw new Error(data?.error || 'Draft generation failed');
      }

      const outToken = `sa_blog_prefill_${Date.now()}`;
      const payload = {
        output: data.result,
        confidence: data.confidence || 'medium',
        hookAssessment: data.hook_assessment || { strength: 'moderate', note: '' },
        source: 'superadmin_blog_intelligence',
        prefillReason: reason,
        brief,
        savedAt: new Date().toISOString(),
      };

      sessionStorage.setItem(outToken, JSON.stringify(payload));
      setSuccessNote('Draft generated. Opening editor...');
      await router.push({ pathname: '/admin/blog/new', query: { prefill: outToken } });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not generate draft');
    } finally {
      setGenerating(false);
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
        <title>Content Refinement | Blog CMS</title>
      </Head>
      <div className="min-h-screen bg-gray-50 p-6">
        <div className="mx-auto max-w-4xl rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
          <div className="mb-5 flex items-center justify-between">
            <div>
              <p className="text-xs text-gray-500">Pre-Editor Quality Step</p>
              <h1 className="text-2xl font-bold text-gray-900">Content Refinement Before Editor</h1>
              <p className="mt-1 text-sm text-gray-600">Lock in depth, relevance, and uniqueness here. Then auto-open prefilled editor.</p>
            </div>
            <Link href="/admin/blog/generate" className="text-sm text-gray-600 hover:text-gray-900">← Back</Link>
          </div>

          {error && (
            <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 flex items-start gap-2">
              <AlertCircle className="h-4 w-4 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {successNote && (
            <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700 flex items-start gap-2">
              <CheckCircle2 className="h-4 w-4 mt-0.5" />
              <span>{successNote}</span>
            </div>
          )}

          <div className="space-y-4">
            <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-blue-700">Topic</p>
              <p className="text-sm font-bold text-blue-900">{topic || 'No topic'}</p>
              {reason ? <p className="mt-1 text-xs text-blue-700">{reason}</p> : null}
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">Target Length (words)</label>
                <select value={targetWords} onChange={(e) => setTargetWords(e.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm">
                  <option value="800">~800</option>
                  <option value="1200">~1200</option>
                  <option value="1600">~1600</option>
                  <option value="2000">~2000</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">Depth Mode</label>
                <select value={depthMode} onChange={(e) => setDepthMode(e.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm">
                  <option value="concise practical">Concise practical</option>
                  <option value="deep practical">Deep practical</option>
                  <option value="thought leadership">Thought leadership</option>
                  <option value="framework + examples">Framework + examples</option>
                </select>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">Reader Stage</label>
                <select value={readerStage} onChange={(e) => setReaderStage(e.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm">
                  <option value="beginners">Beginners</option>
                  <option value="practitioners">Practitioners</option>
                  <option value="decision-makers">Decision-makers</option>
                  <option value="mixed">Mixed</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">CTA Preference</label>
                <select value={ctaPreference} onChange={(e) => setCtaPreference(e.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm">
                  <option value="soft educational CTA">Soft educational CTA</option>
                  <option value="direct conversion CTA">Direct conversion CTA</option>
                  <option value="engagement CTA">Engagement CTA</option>
                  <option value="resource CTA">Resource CTA</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1.5">Relevance Focus (pain points, urgency, business context)</label>
              <textarea value={relevanceFocus} onChange={(e) => setRelevanceFocus(e.target.value)} rows={2} className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm" placeholder="What should feel immediately relevant to this audience?" />
            </div>

            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1.5">Uniqueness Directive</label>
              <textarea value={uniquenessDirective} onChange={(e) => setUniquenessDirective(e.target.value)} rows={2} className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm" />
            </div>

            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1.5">Must-Include Points</label>
              <textarea value={mustInclude} onChange={(e) => setMustInclude(e.target.value)} rows={2} className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm" />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">Campaign Objective</label>
                <textarea value={campaignObjective} onChange={(e) => setCampaignObjective(e.target.value)} rows={2} className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm" />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">Trend Context</label>
                <textarea value={trendContext} onChange={(e) => setTrendContext(e.target.value)} rows={2} className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm" />
              </div>
            </div>

            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1.5">Avoid Phrases / Patterns</label>
              <input value={avoidPhrases} onChange={(e) => setAvoidPhrases(e.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm" />
            </div>

            {!!suggestions && (
              <div className="rounded-lg border border-indigo-200 bg-indigo-50 p-3 text-xs text-indigo-700">
                Suggestions loaded. You can copy pointers from recommendations above and refine manually before generation.
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2 pt-1">
              <button
                type="button"
                onClick={suggestInputs}
                disabled={suggesting || !canGenerate}
                className="inline-flex items-center gap-2 rounded-lg border border-[#0B5ED7]/30 bg-white px-4 py-2.5 text-sm font-semibold text-[#0B5ED7] disabled:opacity-50"
              >
                {suggesting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                {suggesting ? 'Generating Suggestions...' : 'Suggest Refinements'}
              </button>

              <button
                type="button"
                onClick={generateAndOpenEditor}
                disabled={generating || !canGenerate}
                className="inline-flex items-center gap-2 rounded-lg bg-[#0B5ED7] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
              >
                {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                {generating ? 'Generating Draft...' : 'Generate Draft and Open Editor'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
