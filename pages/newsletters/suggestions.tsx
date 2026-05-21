'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { ArrowRight, Check, Loader2, RefreshCw, Sparkles } from 'lucide-react';
import { useCompanyContext } from '../../components/CompanyContext';
import { fetchWithAuth } from '../../components/community-ai/fetchWithAuth';
import GenerationProgressTracker from '../../components/content/GenerationProgressTracker';
import type { ContentBlock } from '../../lib/blog/blockTypes';
import { getNewsletterEngineConfig, isValidNewsletterDepth } from '../../lib/newsletter/newsletterContentEngine';

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
  depth?: string;
  target_words?: number;
  topic?: string;
};

const FIELD_META: { key: FieldKey; apiKey: keyof Suggestions; label: string; description: string }[] = [
  { key: 'uniqueness', apiKey: 'uniqueness_directive_options', label: 'Uniqueness Directive', description: 'What makes this newsletter distinctly valuable' },
  { key: 'mustInclude', apiKey: 'must_include_points_options', label: 'Must-Include Points', description: 'Key ideas, frameworks, or facts to work in' },
  { key: 'objective', apiKey: 'campaign_objective_options', label: 'Campaign Objective', description: 'The strategic purpose this newsletter serves' },
  { key: 'trend', apiKey: 'trend_context_options', label: 'Trend Context', description: 'Relevant shifts, signals, or market context to reference' },
];

const NEWSLETTER_GENERATION_STAGES = [
  {
    label: 'Locking the newsletter brief',
    description: 'We are combining your topic, depth, selected guidance, and template direction into the final generation brief.',
  },
  {
    label: 'Applying the thinking mode',
    description: 'The engine is switching into the right newsletter mindset so the output matches the selected newsletter type.',
  },
  {
    label: 'Writing each required section',
    description: 'Every required block is being drafted in order so the newsletter feels complete, structured, and purposeful.',
  },
  {
    label: 'Tightening clarity and flow',
    description: 'Transitions, sharpness, and reader value are being refined so the draft lands more cleanly.',
  },
  {
    label: 'Preparing the editor draft',
    description: 'The finished newsletter is being shaped for the editor so you can review, polish, and save it.',
  },
] as const;

export default function NewsletterSuggestionsPage() {
  const router = useRouter();
  const { user, selectedCompanyId, isLoading: authLoading } = useCompanyContext();
  const companyId = selectedCompanyId;

  const tplToken = typeof router.query.tpl === 'string' ? router.query.tpl : '';
  const topicQuery = typeof router.query.topic === 'string' ? decodeURIComponent(router.query.topic) : '';
  const depthQuery = typeof router.query.depth === 'string' && isValidNewsletterDepth(router.query.depth)
    ? router.query.depth
    : 'standard';
  const formatQuery = typeof router.query.format === 'string' ? router.query.format : '';

  const [templateBlocks, setTemplateBlocks] = useState<ContentBlock[] | null>(null);
  const [templateFormatType, setTemplateFormatType] = useState<string | null>(formatQuery || null);
  const [templateName, setTemplateName] = useState<string | null>(null);
  const [topic, setTopic] = useState(topicQuery);
  const [depth, setDepth] = useState(depthQuery);
  const [targetWords, setTargetWords] = useState(1200);
  const [suggestions, setSuggestions] = useState<Suggestions | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);

  const [selected, setSelected] = useState<Record<FieldKey, string[]>>({
    uniqueness: [],
    mustInclude: [],
    objective: [],
    trend: [],
  });
  const [customText, setCustomText] = useState<Record<FieldKey, string>>({
    uniqueness: '',
    mustInclude: '',
    objective: '',
    trend: '',
  });

  const typeConfig = getNewsletterEngineConfig(templateFormatType || formatQuery);

  const toggleChip = (key: FieldKey, value: string) => {
    setSelected((prev) => {
      const next = prev[key].includes(value)
        ? prev[key].filter((entry) => entry !== value)
        : [...prev[key], value];
      return { ...prev, [key]: next };
    });
  };

  const toggleAllChips = (key: FieldKey, values: string[]) => {
    setSelected((prev) => {
      const allSelected = values.length > 0 && values.every((value) => prev[key].includes(value));
      return {
        ...prev,
        [key]: allSelected ? [] : [...values],
      };
    });
  };

  const resolveField = (key: FieldKey): string => {
    const chips = [...selected[key]];
    const custom = customText[key].trim();
    if (custom) chips.push(custom);
    return chips.join('. ');
  };

  useEffect(() => {
    if (!tplToken) return;
    try {
      const raw = sessionStorage.getItem(tplToken);
      if (!raw) return;
      const parsed = JSON.parse(raw) as TemplateSessionPayload;
      if (Array.isArray(parsed.blocks)) setTemplateBlocks(parsed.blocks);
      if (typeof parsed.format_type === 'string') setTemplateFormatType(parsed.format_type);
      if (typeof parsed.template_name === 'string') setTemplateName(parsed.template_name);
      if (typeof parsed.topic === 'string' && parsed.topic.trim()) setTopic(parsed.topic.trim());
      if (typeof parsed.depth === 'string' && isValidNewsletterDepth(parsed.depth)) setDepth(parsed.depth);
      if (typeof parsed.target_words === 'number' && parsed.target_words >= 300) setTargetWords(parsed.target_words);
      sessionStorage.removeItem(tplToken);
    } catch {}
  }, [tplToken]);

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
            target_word_count: targetWords,
            format_type: templateFormatType,
          },
        }),
      });
      if (!resp.ok) throw new Error('Failed to load suggestions');
      const data = await resp.json();
      setSuggestions(data);
      setSelected({
        uniqueness: data.uniqueness_directive_options?.[0] ? [data.uniqueness_directive_options[0]] : [],
        mustInclude: data.must_include_points_options?.[0] ? [data.must_include_points_options[0]] : [],
        objective: data.campaign_objective_options?.[0] ? [data.campaign_objective_options[0]] : [],
        trend: data.trend_context_options?.[0] ? [data.trend_context_options[0]] : [],
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load suggestions');
    } finally {
      setLoading(false);
    }
  }, [companyId, targetWords, templateFormatType, topic]);

  useEffect(() => {
    void fetchSuggestions();
  }, [fetchSuggestions]);

  const handleGenerate = async () => {
    if (!companyId || !topic || !templateBlocks) return;
    setGenerating(true);
    setError(null);
    try {
      const resp = await fetchWithAuth('/api/newsletters/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company_id: companyId,
          topic,
          mode: 'full',
          target_word_count: targetWords,
          format_type: templateFormatType || undefined,
          template_name: templateName || undefined,
          template_blocks: templateBlocks,
          answers: {
            uniqueness_directive: resolveField('uniqueness'),
            must_include_points: resolveField('mustInclude'),
            campaign_objective: resolveField('objective'),
            trend_context: resolveField('trend'),
            target_word_count: String(targetWords),
            newsletter_depth: depth,
          },
        }),
      });

      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'Generation failed');

      const token = `newsletter_prefill_${Date.now()}`;
      sessionStorage.setItem(token, JSON.stringify({
        output: data.result,
        source: 'newsletter_template_flow',
        target_word_count: targetWords,
        format_type: templateFormatType || undefined,
        template_name: templateName || undefined,
      }));
      router.push({ pathname: '/newsletters/new', query: { prefill: token } });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Generation failed');
    } finally {
      setGenerating(false);
    }
  };

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

  return (
    <>
      <Head>
        <title>Newsletter Suggestions | Omnivyra</title>
      </Head>
      <GenerationProgressTracker
        open={generating}
        title="Building your newsletter draft"
        subtitle="You can see what is happening now, what is left, and roughly how long the draft should take."
        estimatedSeconds={22}
        stages={[...NEWSLETTER_GENERATION_STAGES]}
        theme="amber"
      />
      <div className="min-h-screen bg-gradient-to-br from-amber-50 to-orange-50 p-6">
        <div className="mx-auto max-w-4xl">
          <div className="mb-6 flex items-center justify-between">
            <div>
              <p className="mb-1 text-xs text-gray-500">Step 2 of 3 — Strengthen the brief</p>
              <h1 className="text-2xl font-bold text-gray-900">Newsletter Suggestions</h1>
              {typeConfig && (
                <p className="mt-1 text-sm text-gray-600">
                  {typeConfig.title} · {typeConfig.shortLabel} · {depth} depth · about {targetWords} words
                </p>
              )}
            </div>
            <button onClick={() => router.back()} className="text-sm text-gray-600 hover:text-gray-900">
              ← Back
            </button>
          </div>

          <div className="mb-5 rounded-2xl border border-amber-100 bg-white px-5 py-4 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">Newsletter Topic</p>
            <p className="mt-1 text-base font-semibold text-gray-900">{topic}</p>
          </div>

          {error && (
            <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          )}

          <div className="mb-5 flex justify-end">
            <button
              type="button"
              onClick={() => void fetchSuggestions()}
              disabled={loading}
              className="inline-flex items-center gap-2 rounded-xl border border-amber-200 bg-white px-4 py-2 text-sm font-medium text-amber-700 hover:bg-amber-50"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Refresh Suggestions
            </button>
          </div>

          <div className="space-y-4">
            {FIELD_META.map((field) => {
              const options = suggestions?.[field.apiKey] || [];
              const selectedCount = selected[field.key].length + (customText[field.key].trim() ? 1 : 0);
              const allOptionsSelected = options.length > 0 && options.every((option) => selected[field.key].includes(option));
              return (
                <div key={field.key} className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
                  <div className="mb-3 flex items-start justify-between gap-3">
                    <div>
                      <h2 className="text-sm font-semibold text-gray-900">{field.label}</h2>
                      <p className="mt-1 text-xs text-gray-500">{field.description}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {options.length > 1 && (
                        <button
                          type="button"
                          onClick={() => toggleAllChips(field.key, options)}
                          className="text-[11px] font-medium text-amber-700 hover:text-amber-900"
                        >
                          {allOptionsSelected ? 'Clear all' : 'Select all'}
                        </button>
                      )}
                      {selectedCount > 0 && (
                        <span className="rounded-full bg-amber-100 px-2 py-1 text-[11px] font-medium text-amber-800">
                          {selectedCount} selected
                        </span>
                      )}
                      <div className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-medium text-amber-700">
                        <Sparkles className="h-3.5 w-3.5" /> AI suggestions
                      </div>
                    </div>
                  </div>

                  {!!options.length && (
                    <div className="mb-3 flex flex-wrap gap-2">
                      {options.map((option, index) => {
                        const active = selected[field.key].includes(option);
                        return (
                          <button
                            key={`${field.key}-${index}`}
                            type="button"
                            onClick={() => toggleChip(field.key, option)}
                            className={`inline-flex items-center gap-1 rounded-full border px-3 py-1.5 text-xs transition-all ${
                              active
                                ? 'border-amber-500 bg-amber-50 text-amber-800'
                                : 'border-gray-200 bg-white text-gray-600 hover:border-amber-200 hover:bg-amber-50/60'
                            }`}
                          >
                            {active && <Check className="h-3 w-3" />}
                            {option}
                          </button>
                        );
                      })}
                    </div>
                  )}

                  <textarea
                    value={customText[field.key]}
                    onChange={(e) => setCustomText((prev) => ({ ...prev, [field.key]: e.target.value }))}
                    rows={3}
                    placeholder={`Add custom guidance for ${field.label.toLowerCase()}...`}
                    className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm"
                  />
                </div>
              );
            })}
          </div>

          <div className="mt-8 flex justify-end">
            <button
              type="button"
              disabled={generating || !templateBlocks}
              onClick={() => void handleGenerate()}
              className="inline-flex items-center gap-2 rounded-xl bg-amber-600 px-6 py-3 text-sm font-semibold text-white shadow-md transition-all hover:bg-amber-700 hover:shadow-lg disabled:cursor-not-allowed disabled:opacity-50"
            >
              {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
              Generate Newsletter
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
