'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { ArrowLeft, ArrowRight, Loader2, Sparkles, Check, RefreshCw } from 'lucide-react';
import { useCompanyContext } from '../../components/CompanyContext';
import { fetchWithAuth } from '../../components/community-ai/fetchWithAuth';
import GenerationProgressTracker from '../../components/content/GenerationProgressTracker';
import type { ContentBlock } from '../../lib/blog/blockTypes';

// ── Per-tier suggestion range ────────────────────────────────────────────────

function getSuggestionRangeLabel(words: number): string {
  if (words >= 2000) return '6-8';
  if (words >= 1600) return '5-6';
  if (words >= 1200) return '4-5';
  return '3';
}

type FieldKey = 'uniqueness' | 'mustInclude' | 'objective' | 'trend';

type Suggestions = {
  uniqueness_directive_options: string[];
  must_include_points_options: string[];
  campaign_objective_options: string[];
  trend_context_options: string[];
};

type TemplateSessionPayload = {
  blocks: ContentBlock[];
  format_type?: string | null;
  template_name?: string;
};

const FIELD_META: { key: FieldKey; apiKey: keyof Suggestions; label: string; description: string }[] = [
  { key: 'uniqueness', apiKey: 'uniqueness_directive_options', label: 'Uniqueness Directive', description: 'What makes this piece stand out from competitors' },
  { key: 'mustInclude', apiKey: 'must_include_points_options', label: 'Must-Include Points', description: 'Key facts, data, or frameworks to include' },
  { key: 'objective', apiKey: 'campaign_objective_options', label: 'Campaign Objective', description: 'The business goal this content serves' },
  { key: 'trend', apiKey: 'trend_context_options', label: 'Trend Context', description: 'Relevant industry trends to reference' },
];

const BLOG_GENERATION_STAGES = [
  {
    label: 'Locking the brief',
    description: 'We are combining your selected suggestions, target length, and template direction into one final content brief.',
  },
  {
    label: 'Mapping the structure',
    description: 'The engine is aligning the article flow to the chosen layout so every major section has a clear role.',
  },
  {
    label: 'Writing the body',
    description: 'The draft is being written section by section with real depth, transitions, and examples instead of surface-level filler.',
  },
  {
    label: 'Strengthening discoverability',
    description: 'SEO metadata and supporting optimization details are being added without overtaking the main content.',
  },
  {
    label: 'Preparing the editor draft',
    description: 'The generated content is being packaged for the editor so you can review, improve, and publish it.',
  },
] as const;

// ── Page ─────────────────────────────────────────────────────────────────────

export default function BlogSuggestionsPage() {
  const router = useRouter();
  const { user, selectedCompanyId, isLoading: authLoading } = useCompanyContext();
  const companyId = selectedCompanyId;

  const words = parseInt((router.query.words as string) || '1200', 10);
  const topic = decodeURIComponent((router.query.topic as string) || '');
  const tplToken = (router.query.tpl as string) || '';

  const suggestionRangeLabel = getSuggestionRangeLabel(words);

  // ── State ──────────────────────────────────────────────────────────────────
  const [templateBlocks, setTemplateBlocks] = useState<ContentBlock[] | null>(null);
  const [templateFormatType, setTemplateFormatType] = useState<string | null>(null);
  const [templateName, setTemplateName] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<Suggestions | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);

  // Selected values per field (multi-select: array of selected strings)
  const [selected, setSelected] = useState<Record<FieldKey, string[]>>({
    uniqueness: [],
    mustInclude: [],
    objective: [],
    trend: [],
  });
  // Custom text per field (additional user-typed input)
  const [customText, setCustomText] = useState<Record<FieldKey, string>>({
    uniqueness: '',
    mustInclude: '',
    objective: '',
    trend: '',
  });

  /** Toggle a suggestion chip on/off */
  const toggleChip = (key: FieldKey, value: string) => {
    setSelected((prev) => {
      const arr = prev[key];
      const next = arr.includes(value) ? arr.filter((v) => v !== value) : [...arr, value];
      return { ...prev, [key]: next };
    });
  };

  /** Toggle all suggestion chips for a field on/off */
  const toggleAllChips = (key: FieldKey, values: string[]) => {
    setSelected((prev) => {
      const allSelected = values.length > 0 && values.every((value) => prev[key].includes(value));
      return {
        ...prev,
        [key]: allSelected ? [] : [...values],
      };
    });
  };

  /** Build the final value for a field: all selected chips + custom text, joined */
  const resolveField = (key: FieldKey): string => {
    const chips = [...selected[key]];
    const custom = customText[key].trim();
    if (custom) chips.push(custom);
    return chips.join('. ');
  };

  // ── Load template from sessionStorage ──────────────────────────────────────
  useEffect(() => {
    if (!tplToken) return;
    try {
      const raw = sessionStorage.getItem(tplToken);
      if (raw) {
        const parsed = JSON.parse(raw) as ContentBlock[] | TemplateSessionPayload;
        if (Array.isArray(parsed)) {
          setTemplateBlocks(parsed);
          setTemplateFormatType(null);
        } else if (parsed && Array.isArray(parsed.blocks)) {
          setTemplateBlocks(parsed.blocks);
          setTemplateFormatType(typeof parsed.format_type === 'string' ? parsed.format_type : null);
          setTemplateName(typeof parsed.template_name === 'string' ? parsed.template_name : null);
        }
        sessionStorage.removeItem(tplToken);
      }
    } catch {}
  }, [tplToken]);

  // ── Fetch suggestions ──────────────────────────────────────────────────────
  const fetchSuggestions = useCallback(async () => {
    if (!companyId || !topic) return;
    setLoading(true);
    setError(null);
    try {
      const resp = await fetchWithAuth('/api/company/blog/brief-suggestions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company_id: companyId,
          topic,
          currentValues: {
            target_word_count: words,
            format_type: templateFormatType,
          },
        }),
      });
      if (!resp.ok) throw new Error('Failed to load suggestions');
      const data = await resp.json();
      setSuggestions(data);

      // Auto-prime with first suggestion per field
      setSelected({
        uniqueness: data.uniqueness_directive_options?.[0] ? [data.uniqueness_directive_options[0]] : [],
        mustInclude: data.must_include_points_options?.[0] ? [data.must_include_points_options[0]] : [],
        objective: data.campaign_objective_options?.[0] ? [data.campaign_objective_options[0]] : [],
        trend: data.trend_context_options?.[0] ? [data.trend_context_options[0]] : [],
      });
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [companyId, topic, words, templateFormatType]);

  useEffect(() => {
    fetchSuggestions();
  }, [fetchSuggestions]);

  // ── Generate with template ─────────────────────────────────────────────────
  const handleGenerate = async () => {
    if (!companyId || !topic) return;
    setGenerating(true);

    try {
      const resp = await fetchWithAuth('/api/blogs/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company_id: companyId,
          topic,
          mode: 'full',
          target_word_count: words,
          format_type: templateFormatType || undefined,
          template_name: templateName || undefined,
          template_blocks: templateBlocks,
          answers: {
            uniqueness_directive: resolveField('uniqueness'),
            must_include_points: resolveField('mustInclude'),
            campaign_objective: resolveField('objective'),
            trend_context: resolveField('trend'),
          },
        }),
      });

      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'Generation failed');

      // Store result and navigate to editor
      const token = `blog_prefill_${Date.now()}`;
      sessionStorage.setItem(token, JSON.stringify({
        output: data.result,
        source: 'template_flow',
        target_word_count: words,
        format_type: templateFormatType || undefined,
        template_name: templateName || undefined,
      }));
      router.push({ pathname: '/blogs/new', query: { prefill: token } });
    } catch (err: any) {
      setError(err.message);
    } finally {
      setGenerating(false);
    }
  };

  // ── Auth guard ─────────────────────────────────────────────────────────────
  if (authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <Loader2 className="h-10 w-10 animate-spin text-gray-400" />
      </div>
    );
  }
  if (!user?.userId) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <p className="text-gray-500 text-sm">Sign in to continue.</p>
      </div>
    );
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <>
      <Head>
        <title>Suggestions | Omnivyra</title>
      </Head>
      <GenerationProgressTracker
        open={generating}
        title={`Building your ${words}+ word blog draft`}
        subtitle="You can follow each stage below while the full draft is being prepared."
        estimatedSeconds={28}
        stages={[...BLOG_GENERATION_STAGES]}
        theme="purple"
      />
      <div className="min-h-screen bg-gradient-to-br from-purple-50 to-indigo-50 p-6">
        <div className="mx-auto max-w-3xl">
          {/* Header */}
          <div className="flex items-center justify-between mb-6">
            <div>
              <p className="text-xs text-gray-500 mb-1">Step 4 of 5 — Fine-tune content direction</p>
              <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
                <Sparkles className="h-6 w-6 text-purple-600" /> Content Suggestions
              </h1>
              <p className="mt-1 text-sm text-gray-500">
                {words}+ words · {suggestionRangeLabel} suggestions per field
              </p>
            </div>
            <div className="flex gap-2">
              <button onClick={() => router.back()} className="text-sm text-gray-600 hover:text-gray-900">
                <ArrowLeft className="h-4 w-4 inline mr-1" />Back
              </button>
              <button
                onClick={fetchSuggestions}
                disabled={loading}
                className="inline-flex items-center gap-1 text-sm text-purple-600 hover:text-purple-800 disabled:opacity-50"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /> Refresh
              </button>
            </div>
          </div>

          {/* Topic card */}
          <div className="rounded-xl bg-white border border-gray-200 p-4 mb-6 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-1">Topic</p>
            <p className="text-base font-semibold text-gray-900">{topic || '(no topic selected)'}</p>
            {templateBlocks && (
              <p className="mt-1 text-xs text-gray-500">
                Template: {templateBlocks.length} blocks
                {templateBlocks.some((b) => b.type === 'columns') && ' · includes columns'}
              </p>
            )}
          </div>

          {/* Error */}
          {error && (
            <div className="rounded-xl bg-red-50 border border-red-200 p-3 mb-4">
              <p className="text-sm text-red-700">{error}</p>
            </div>
          )}

          {/* Loading */}
          {loading && (
            <div className="text-center py-16">
              <Loader2 className="h-8 w-8 animate-spin text-purple-400 mx-auto mb-2" />
              <p className="text-sm text-gray-500">Generating {suggestionRangeLabel} suggestions per field...</p>
            </div>
          )}

          {/* Suggestion fields */}
          {!loading && suggestions && (
            <div className="space-y-6 mb-8">
              {FIELD_META.map(({ key, apiKey, label, description }) => {
                const options = suggestions[apiKey] || [];
                const sel = selected[key];
                const custom = customText[key];
                const selCount = sel.length + (custom.trim() ? 1 : 0);
                const allOptionsSelected = options.length > 0 && options.every((opt) => sel.includes(opt));
                return (
                  <div key={key} className="rounded-xl bg-white border border-gray-200 p-4 shadow-sm">
                    <div className="flex items-start justify-between mb-3">
                      <div>
                        <h3 className="text-sm font-semibold text-gray-900">{label}</h3>
                        <p className="text-xs text-gray-500">{description}</p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        {options.length > 1 && (
                          <button
                            type="button"
                            onClick={() => toggleAllChips(key, options)}
                            className="text-[10px] font-medium text-purple-600 hover:text-purple-800"
                          >
                            {allOptionsSelected ? 'Clear all' : 'Select all'}
                          </button>
                        )}
                        {selCount > 0 && (
                          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-purple-100 text-purple-700">
                            {selCount} selected
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Suggestion chips — multi-select */}
                    <div className="flex flex-wrap gap-2 mb-3">
                      {options.map((opt, i) => {
                        const isSelected = sel.includes(opt);
                        return (
                          <button
                            key={i}
                            type="button"
                            onClick={() => toggleChip(key, opt)}
                            className={`inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs transition-all ${
                              isSelected
                                ? 'bg-purple-100 text-purple-800 ring-1 ring-purple-300 font-semibold'
                                : 'bg-gray-50 text-gray-700 hover:bg-purple-50 hover:text-purple-700 border border-gray-200'
                            }`}
                          >
                            {isSelected && <Check className="h-3 w-3" />}
                            {opt}
                          </button>
                        );
                      })}
                    </div>

                    {/* Custom input (additive — combined with selected chips) */}
                    <input
                      type="text"
                      value={custom}
                      onChange={(e) => setCustomText((prev) => ({ ...prev, [key]: e.target.value }))}
                      placeholder={`Add your own ${label.toLowerCase()}...`}
                      className="w-full rounded-lg border border-gray-200 px-3 py-2 text-xs text-gray-700 focus:border-purple-400 focus:outline-none focus:ring-1 focus:ring-purple-300"
                    />
                  </div>
                );
              })}
            </div>
          )}

          {/* Generate button */}
          {!loading && suggestions && (
            <div className="sticky bottom-6 flex justify-center">
              <button
                type="button"
                onClick={handleGenerate}
                disabled={generating}
                className="inline-flex items-center gap-2 rounded-xl bg-purple-600 px-8 py-3 text-sm font-semibold text-white shadow-lg hover:shadow-xl hover:bg-purple-700 transition-all disabled:opacity-60"
              >
                {generating ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" /> Generating...
                  </>
                ) : (
                  <>
                    Generate {words}+ Word Draft <ArrowRight className="h-4 w-4" />
                  </>
                )}
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
