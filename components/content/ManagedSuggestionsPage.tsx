'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { ArrowLeft, ArrowRight, Check, Loader2, RefreshCw, Sparkles } from 'lucide-react';
import { useCompanyContext } from '../CompanyContext';
import GenerationProgressTracker from './GenerationProgressTracker';
import type { ContentBlock } from '../../lib/blog/blockTypes';

type FieldKey = 'uniqueness' | 'mustInclude' | 'objective' | 'trend';

type Suggestions = {
  uniqueness_directive_options: string[];
  must_include_points_options: string[];
  campaign_objective_options: string[];
  trend_context_options: string[];
};

type GeneratedEditorPayload = {
  title?: string;
  excerpt?: string;
  category?: string;
  tags?: string[];
  seo_meta_title?: string;
  seo_meta_description?: string;
  content_blocks?: unknown[];
  content_html?: string;
  content_markdown?: string;
  primary_keyword?: string;
  secondary_keywords?: string[];
};

type ShortformGenerationPayload = {
  success?: boolean;
  content_type?: 'post' | 'thread';
  template_used?: string | null;
  master_content?: Record<string, unknown>;
  platform_variant?: Record<string, unknown>;
};

type TemplateSessionPayload = {
  blocks: ContentBlock[];
  format_type?: string | null;
  template_name?: string;
};

type Props = {
  contentType: 'article' | 'guide' | 'story' | 'whitepaper' | 'case-study' | 'post' | 'thread';
  title: string;
  stepLabel: string;
  heading: string;
  theme: 'blue' | 'violet' | 'pink' | 'slate' | 'amber' | 'emerald';
  generatePath: string;
  backPath: string;
};

const FIELD_META: { key: FieldKey; apiKey: keyof Suggestions; label: string; description: string }[] = [
  { key: 'uniqueness', apiKey: 'uniqueness_directive_options', label: 'Uniqueness Directive', description: 'What makes this piece stand out from competitors' },
  { key: 'mustInclude', apiKey: 'must_include_points_options', label: 'Must-Include Points', description: 'Key facts, data, or frameworks to include' },
  { key: 'objective', apiKey: 'campaign_objective_options', label: 'Campaign Objective', description: 'The business goal this content serves' },
  { key: 'trend', apiKey: 'trend_context_options', label: 'Trend Context', description: 'Relevant industry trends to reference' },
];

const THEME = {
  blue: {
    bg: 'from-orange-50 to-amber-50',
    icon: 'text-orange-600',
    border: 'border-orange-200',
    chipOn: 'bg-orange-100 text-orange-800 ring-1 ring-orange-300 font-semibold',
    chipOff: 'bg-gray-50 text-gray-700 hover:bg-orange-50 hover:text-orange-700 border border-gray-200',
    badge: 'bg-orange-100 text-orange-700',
    btn: 'bg-orange-600 hover:bg-orange-700',
    link: 'text-orange-700 hover:text-orange-900',
  },
  violet: {
    bg: 'from-violet-50 to-purple-50',
    icon: 'text-violet-600',
    border: 'border-violet-200',
    chipOn: 'bg-violet-100 text-violet-800 ring-1 ring-violet-300 font-semibold',
    chipOff: 'bg-gray-50 text-gray-700 hover:bg-violet-50 hover:text-violet-700 border border-gray-200',
    badge: 'bg-violet-100 text-violet-700',
    btn: 'bg-violet-600 hover:bg-violet-700',
    link: 'text-violet-700 hover:text-violet-900',
  },
  pink: {
    bg: 'from-pink-50 to-rose-50',
    icon: 'text-pink-600',
    border: 'border-pink-200',
    chipOn: 'bg-pink-100 text-pink-800 ring-1 ring-pink-300 font-semibold',
    chipOff: 'bg-gray-50 text-gray-700 hover:bg-pink-50 hover:text-pink-700 border border-gray-200',
    badge: 'bg-pink-100 text-pink-700',
    btn: 'bg-pink-600 hover:bg-pink-700',
    link: 'text-pink-700 hover:text-pink-900',
  },
  slate: {
    bg: 'from-slate-50 to-blue-50',
    icon: 'text-slate-700',
    border: 'border-slate-200',
    chipOn: 'bg-slate-100 text-slate-800 ring-1 ring-slate-300 font-semibold',
    chipOff: 'bg-gray-50 text-gray-700 hover:bg-slate-50 hover:text-slate-700 border border-gray-200',
    badge: 'bg-slate-100 text-slate-700',
    btn: 'bg-slate-800 hover:bg-slate-900',
    link: 'text-slate-700 hover:text-slate-900',
  },
  amber: {
    bg: 'from-amber-50 to-orange-50',
    icon: 'text-amber-600',
    border: 'border-amber-200',
    chipOn: 'bg-amber-100 text-amber-800 ring-1 ring-amber-300 font-semibold',
    chipOff: 'bg-gray-50 text-gray-700 hover:bg-amber-50 hover:text-amber-700 border border-gray-200',
    badge: 'bg-amber-100 text-amber-700',
    btn: 'bg-amber-600 hover:bg-amber-700',
    link: 'text-amber-700 hover:text-amber-900',
  },
  emerald: {
    bg: 'from-emerald-50 to-green-50',
    icon: 'text-emerald-600',
    border: 'border-emerald-200',
    chipOn: 'bg-emerald-100 text-emerald-800 ring-1 ring-emerald-300 font-semibold',
    chipOff: 'bg-gray-50 text-gray-700 hover:bg-emerald-50 hover:text-emerald-700 border border-gray-200',
    badge: 'bg-emerald-100 text-emerald-700',
    btn: 'bg-emerald-600 hover:bg-emerald-700',
    link: 'text-emerald-700 hover:text-emerald-900',
  },
} as const;

const GENERATION_META = {
  article: {
    label: 'article',
    title: 'Article',
    apiPath: '/api/articles/generate',
    editorPath: '/articles/new',
    progressTheme: 'purple' as const,
    estimatedSeconds: 24,
  },
  guide: {
    label: 'guide',
    title: 'Guide',
    apiPath: '/api/guides/generate',
    editorPath: '/guides/new',
    progressTheme: 'purple' as const,
    estimatedSeconds: 28,
  },
  story: {
    label: 'story',
    title: 'Story',
    apiPath: '/api/stories/generate',
    editorPath: '/stories/new',
    progressTheme: 'purple' as const,
    estimatedSeconds: 22,
  },
  whitepaper: {
    label: 'whitepaper',
    title: 'Whitepaper',
    apiPath: '/api/whitepapers/generate',
    editorPath: '/whitepapers/new',
    progressTheme: 'purple' as const,
    estimatedSeconds: 30,
  },
  'case-study': {
    label: 'case study',
    title: 'Case Study',
    apiPath: '/api/case-studies/generate',
    editorPath: '/case-studies/new',
    progressTheme: 'amber' as const,
    estimatedSeconds: 24,
  },
  post: {
    label: 'post',
    title: 'Post',
    apiPath: '/api/posts/generate',
    editorPath: '/posts/result',
    progressTheme: 'purple' as const,
    estimatedSeconds: 14,
  },
  thread: {
    label: 'thread',
    title: 'Thread',
    apiPath: '/api/threads/generate',
    editorPath: '/threads/result',
    progressTheme: 'amber' as const,
    estimatedSeconds: 18,
  },
} as const;

const GENERATION_STAGES = [
  {
    label: 'Locking the brief',
    description: 'We are combining your topic, suggestions, target length, and template direction into one final generation brief.',
  },
  {
    label: 'Mapping the structure',
    description: 'The selected template is being aligned with the content flow so each section has a clear job.',
  },
  {
    label: 'Writing the draft',
    description: 'The main draft is being written with fuller detail, transitions, and supporting depth.',
  },
  {
    label: 'Strengthening relevance',
    description: 'The engine is refining clarity, focus, and supporting context without drifting into filler.',
  },
  {
    label: 'Preparing the editor draft',
    description: 'The generated content is being packaged for the editor so you can review, improve, and save it.',
  },
] as const;

function getGenerationTimeoutMs(contentType: Props['contentType'], targetWords: number): number {
  if (contentType === 'post' || contentType === 'thread') {
    return 2 * 60 * 1000;
  }
  if (contentType === 'whitepaper') {
    if (targetWords >= 4000) return 8 * 60 * 1000;
    if (targetWords >= 3000) return 6 * 60 * 1000;
    return 5 * 60 * 1000;
  }
  if (contentType === 'guide') {
    if (targetWords >= 3000) return 5 * 60 * 1000;
    return 4 * 60 * 1000;
  }
  if (contentType === 'article') {
    if (targetWords >= 2000) return 4 * 60 * 1000;
    return 3 * 60 * 1000;
  }
  if (contentType === 'story') {
    return 3 * 60 * 1000;
  }
  return 4 * 60 * 1000;
}

function buildEditorSafePayload(result: Record<string, unknown>): GeneratedEditorPayload {
  return {
    title: typeof result.title === 'string' ? result.title : '',
    excerpt: typeof result.excerpt === 'string' ? result.excerpt : '',
    category: typeof result.category === 'string' ? result.category : '',
    tags: Array.isArray(result.tags) ? result.tags.filter((value): value is string => typeof value === 'string') : [],
    seo_meta_title: typeof result.seo_meta_title === 'string' ? result.seo_meta_title : '',
    seo_meta_description: typeof result.seo_meta_description === 'string' ? result.seo_meta_description : '',
    content_blocks: Array.isArray(result.content_blocks) ? result.content_blocks : [],
    content_html: typeof result.content_html === 'string' ? result.content_html : '',
    content_markdown: typeof result.content_markdown === 'string' ? result.content_markdown : '',
    primary_keyword: typeof result.primary_keyword === 'string' ? result.primary_keyword : undefined,
    secondary_keywords: Array.isArray(result.secondary_keywords)
      ? result.secondary_keywords.filter((value): value is string => typeof value === 'string')
      : undefined,
  };
}

function getSuggestionRangeLabel(words: number): string {
  if (words >= 4000) return '7-8';
  if (words >= 3000) return '6-7';
  if (words >= 2000) return '5-6';
  if (words >= 1400) return '4-5';
  return '3-4';
}

function getEffectiveTargetWords(
  contentType: Props['contentType'],
  requestedWords: number,
  hasTemplate: boolean,
): number {
  if (contentType === 'post') {
    return Math.min(requestedWords, 280);
  }
  if (contentType === 'thread') {
    return Math.min(requestedWords, 700);
  }
  if (contentType === 'whitepaper' && hasTemplate && requestedWords > 3000) {
    return 3000;
  }
  return requestedWords;
}

export default function ManagedSuggestionsPage({
  contentType,
  title,
  stepLabel,
  heading,
  theme,
  generatePath,
  backPath,
}: Props) {
  const router = useRouter();
  const { user, selectedCompanyId, isLoading: authLoading } = useCompanyContext();
  const companyId = selectedCompanyId;
  const colors = THEME[theme];

  const tplToken = typeof router.query.tpl === 'string' ? router.query.tpl : '';
  const topic = typeof router.query.prefill_topic === 'string'
    ? router.query.prefill_topic
    : typeof router.query.topic === 'string'
      ? decodeURIComponent(router.query.topic)
      : '';
  const bundleToken = typeof router.query.prefill_bundle === 'string' ? router.query.prefill_bundle : '';
  const format = typeof router.query.format === 'string' ? router.query.format : '';
  const targetWordsQuery = typeof router.query.target_words === 'string' ? Number.parseInt(router.query.target_words, 10) : NaN;
  const platformQuery = typeof router.query.platform === 'string' ? router.query.platform : '';
  const isShortform = contentType === 'post' || contentType === 'thread';

  const [templateBlocks, setTemplateBlocks] = useState<ContentBlock[] | null>(null);
  const [templateFormatType, setTemplateFormatType] = useState<string | null>(format || null);
  const [templateName, setTemplateName] = useState<string | null>(null);
  const [targetWords, setTargetWords] = useState(Number.isFinite(targetWordsQuery) ? targetWordsQuery : 2000);
  const [selectedPlatform, setSelectedPlatform] = useState(
    platformQuery || (contentType === 'thread' ? 'x' : 'linkedin'),
  );
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

  const suggestionRangeLabel = useMemo(() => getSuggestionRangeLabel(targetWords), [targetWords]);
  const generationMeta = GENERATION_META[contentType];
  const effectiveTargetWords = useMemo(
    () => getEffectiveTargetWords(contentType, targetWords, Boolean(templateBlocks?.length)),
    [contentType, targetWords, templateBlocks],
  );
  const generationTimeoutMs = useMemo(
    () => getGenerationTimeoutMs(contentType, effectiveTargetWords),
    [contentType, effectiveTargetWords],
  );
  const targetWordNotice = useMemo(() => {
    if (effectiveTargetWords === targetWords) return null;
    if (contentType === 'whitepaper') {
      return `To keep whitepaper generation reliable in the current template flow, ${targetWords.toLocaleString()}-word requests are drafted at ${effectiveTargetWords.toLocaleString()} words first. You can expand and deepen the draft further in the editor after it opens.`;
    }
    return null;
  }, [contentType, effectiveTargetWords, targetWords]);
  void generatePath;

  const toggleChip = (key: FieldKey, value: string) => {
    setSelected((prev) => ({
      ...prev,
      [key]: prev[key].includes(value)
        ? prev[key].filter((entry) => entry !== value)
        : [...prev[key], value],
    }));
  };

  const toggleAllChips = (key: FieldKey, values: string[]) => {
    setSelected((prev) => {
      const allSelected = values.length > 0 && values.every((value) => prev[key].includes(value));
      return { ...prev, [key]: allSelected ? [] : [...values] };
    });
  };

  const resolveField = (key: FieldKey): string => {
    const chips = [...selected[key]];
    const custom = customText[key].trim();
    if (custom) chips.push(custom);
    return chips.join('. ');
  };

  useEffect(() => {
    if (!tplToken || typeof window === 'undefined') return;
    try {
      const raw = sessionStorage.getItem(tplToken);
      if (!raw) return;
      const parsed = JSON.parse(raw) as TemplateSessionPayload;
      if (Array.isArray(parsed.blocks)) setTemplateBlocks(parsed.blocks);
      if (typeof parsed.format_type === 'string') setTemplateFormatType(parsed.format_type);
      if (typeof parsed.template_name === 'string') setTemplateName(parsed.template_name);
    } catch {
      // ignore malformed template payload
    }
  }, [tplToken]);

  useEffect(() => {
    if (!bundleToken || typeof window === 'undefined') return;
    try {
      const raw = sessionStorage.getItem(bundleToken);
      if (!raw) return;
      const parsed = JSON.parse(raw) as { targetWords?: number; suggestions?: Suggestions };
      if (typeof parsed.targetWords === 'number' && parsed.targetWords >= 300) {
        setTargetWords(parsed.targetWords);
      }
      if (parsed.suggestions) {
        setSuggestions(parsed.suggestions);
        setSelected({
          uniqueness: parsed.suggestions.uniqueness_directive_options?.[0] ? [parsed.suggestions.uniqueness_directive_options[0]] : [],
          mustInclude: parsed.suggestions.must_include_points_options?.[0] ? [parsed.suggestions.must_include_points_options[0]] : [],
          objective: parsed.suggestions.campaign_objective_options?.[0] ? [parsed.suggestions.campaign_objective_options[0]] : [],
          trend: parsed.suggestions.trend_context_options?.[0] ? [parsed.suggestions.trend_context_options[0]] : [],
        });
      }
    } catch {
      // ignore malformed bundle
    }
  }, [bundleToken]);

  const fetchSuggestions = useCallback(async () => {
    if (!companyId || !topic) return;
    setLoading(true);
    setError(null);
    try {
      const resp = await fetch('/api/company/blog/brief-suggestions', {
        method: 'POST',
        credentials: 'include',
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
    if (!suggestions) {
      void fetchSuggestions();
    }
  }, [fetchSuggestions, suggestions]);

  const handleGenerate = async () => {
    if (!companyId || !topic) return;
    setGenerating(true);
    setError(null);

    try {
      const controller = new AbortController();
      const timeoutId = window.setTimeout(() => controller.abort(), generationTimeoutMs);

      const shortformExtraInstruction = [
        resolveField('uniqueness') ? `Differentiate using this direction: ${resolveField('uniqueness')}` : undefined,
        resolveField('mustInclude') ? `Include these points or proof: ${resolveField('mustInclude')}` : undefined,
        resolveField('trend') ? `Reference this context or trend: ${resolveField('trend')}` : undefined,
        'Keep the post factual. Do not invent testimonials, customer proof, adoption claims, or historical year references that were not provided.',
        'If the topic includes a specific launch date or year, preserve it exactly instead of substituting another timeline.',
      ]
        .filter(Boolean)
        .join('\n');

      const response = await fetch(generationMeta.apiPath, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify(
          isShortform
            ? {
                company_id: companyId,
                topic,
                platform: selectedPlatform,
                objective: resolveField('objective') || undefined,
                template_name: templateName || undefined,
                tone: resolveField('uniqueness') || undefined,
                extra_instruction: shortformExtraInstruction || undefined,
              }
            : {
                company_id: companyId,
                topic,
                mode: 'full',
                target_word_count: effectiveTargetWords,
                format_type: templateFormatType || format || undefined,
                template_name: templateName || undefined,
                template_blocks: templateBlocks || undefined,
                cache_version: `direct-suggestions-flow:${contentType}:${templateFormatType || format || 'default'}`,
                answers: {
                  uniqueness_directive: resolveField('uniqueness'),
                  must_include_points: resolveField('mustInclude'),
                  campaign_objective: resolveField('objective'),
                  trend_context: resolveField('trend'),
                  target_word_count: String(effectiveTargetWords),
                },
              },
        ),
      });
      window.clearTimeout(timeoutId);

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error((data as { error?: string }).error || `Failed to generate ${generationMeta.label}`);
      }

      const token = `${contentType.replace(/[^a-z]/g, '_')}_prefill_${Date.now()}`;

      if (isShortform) {
        const result = data as ShortformGenerationPayload;
        if (!result?.platform_variant || typeof result.platform_variant !== 'object') {
          throw new Error(`The ${generationMeta.label} was generated, but the output payload was missing.`);
        }

        sessionStorage.setItem(token, JSON.stringify({
          output: result,
          source: `${contentType}_template_flow`,
          topic,
          platform: selectedPlatform,
          template_name: templateName || undefined,
        }));

        setGenerating(false);
        const destination = {
          pathname: generationMeta.editorPath,
          query: { prefill: token },
        };
        const navigated = await router.push(destination);
        if (!navigated && typeof window !== 'undefined') {
          const params = new URLSearchParams({ prefill: token });
          window.location.assign(`${generationMeta.editorPath}?${params.toString()}`);
        }
        return;
      }

      const result = (data as { result?: Record<string, unknown> }).result;
      if (!result || typeof result !== 'object') {
        throw new Error(`The ${generationMeta.label} was generated, but the editor payload was missing.`);
      }

      if (typeof window !== 'undefined') {
        const resultRecord = result as Record<string, unknown>;
        console.info(`[${contentType}] prefill-summary`, {
          titleLength: typeof resultRecord.title === 'string' ? resultRecord.title.length : 0,
          excerptLength: typeof resultRecord.excerpt === 'string' ? resultRecord.excerpt.length : 0,
          blockCount: Array.isArray(resultRecord.content_blocks) ? resultRecord.content_blocks.length : 0,
          htmlLength: typeof resultRecord.content_html === 'string' ? resultRecord.content_html.length : 0,
          markdownLength: typeof resultRecord.content_markdown === 'string' ? resultRecord.content_markdown.length : 0,
        });
      }

      if (typeof window !== 'undefined') {
        const storage = window.sessionStorage;
        Object.keys(storage)
          .filter((key) => key.includes('_prefill_'))
          .slice(0, 20)
          .forEach((key) => {
            if (key !== token) storage.removeItem(key);
          });
      }

      sessionStorage.setItem(token, JSON.stringify({
        output: buildEditorSafePayload(result),
        source: `${contentType}_template_flow`,
        target_word_count: effectiveTargetWords,
        format_type: templateFormatType || format || undefined,
        template_name: templateName || undefined,
      }));

      setGenerating(false);

      const destination = {
        pathname: generationMeta.editorPath,
        query: { prefill: token },
      };
      const navigated = await router.push(destination);
      if (!navigated && typeof window !== 'undefined') {
        const params = new URLSearchParams({ prefill: token });
        window.location.assign(`${generationMeta.editorPath}?${params.toString()}`);
      }
    } catch (err) {
      const message =
        err instanceof DOMException && err.name === 'AbortError'
          ? `${generationMeta.title} generation exceeded the allowed time window. Please try again. If this was a very long draft, allow a few more minutes or reduce the target length once to confirm the flow.`
          : err instanceof Error
            ? err.message
            : `Failed to generate ${generationMeta.label}`;
      setError(message);
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
        <title>{title} | Omnivyra</title>
      </Head>
      <GenerationProgressTracker
        open={generating}
        title={`Building your ${generationMeta.title} draft`}
        subtitle="You can follow each stage below while the final draft is being prepared."
        estimatedSeconds={generationMeta.estimatedSeconds}
        stages={[...GENERATION_STAGES]}
        theme={generationMeta.progressTheme}
      />
      <div className={`min-h-screen bg-gradient-to-br ${colors.bg} p-6`}>
        <div className="mx-auto max-w-4xl">
          <div className="mb-6 flex items-center justify-between">
            <div>
              <p className="mb-1 text-xs text-gray-500">{stepLabel}</p>
              <h1 className="flex items-center gap-2 text-2xl font-bold text-gray-900">
                <Sparkles className={`h-6 w-6 ${colors.icon}`} /> {heading}
              </h1>
              <p className="mt-1 text-sm text-gray-500">
                {targetWords.toLocaleString()}+ words · {suggestionRangeLabel} suggestions per field
              </p>
            </div>
            <div className="flex gap-2">
              <button onClick={() => router.push(backPath)} className="text-sm text-gray-600 hover:text-gray-900">
                <ArrowLeft className="mr-1 inline h-4 w-4" />Back
              </button>
              <button
                onClick={() => void fetchSuggestions()}
                disabled={loading}
                className={`inline-flex items-center gap-1 text-sm ${colors.link} disabled:opacity-50`}
              >
                <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /> Refresh
              </button>
            </div>
          </div>

          <div className={`mb-6 rounded-2xl border ${colors.border} bg-white px-5 py-4 shadow-sm`}>
            <p className={`text-xs font-semibold uppercase tracking-wide ${colors.link}`}>Topic</p>
            <p className="mt-1 text-base font-semibold text-gray-900">{topic || '(no topic selected)'}</p>
            {(templateBlocks || templateName) && (
              <p className="mt-1 text-xs text-gray-500">
                {templateName ? `Template: ${templateName}` : null}
                {templateName && templateBlocks ? ' · ' : null}
                {templateBlocks ? `${templateBlocks.length} blocks` : null}
              </p>
            )}
          </div>

          {isShortform && (
            <div className={`mb-6 rounded-2xl border ${colors.border} bg-white px-5 py-4 shadow-sm`}>
              <p className={`text-xs font-semibold uppercase tracking-wide ${colors.link}`}>Platform Target</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {(contentType === 'thread'
                  ? [
                      { value: 'x', label: 'X' },
                      { value: 'linkedin', label: 'LinkedIn' },
                    ]
                  : [
                      { value: 'linkedin', label: 'LinkedIn' },
                      { value: 'x', label: 'X' },
                    ]).map((platform) => {
                  const isSelected = selectedPlatform === platform.value;
                  return (
                    <button
                      key={platform.value}
                      type="button"
                      onClick={() => setSelectedPlatform(platform.value)}
                      className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                        isSelected ? colors.chipOn : colors.chipOff
                      }`}
                    >
                      {platform.label}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {error && (
            <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3">
              <p className="text-sm text-red-700">{error}</p>
            </div>
          )}

          {targetWordNotice && (
            <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-3">
              <p className="text-sm text-amber-800">{targetWordNotice}</p>
            </div>
          )}

          {loading && (
            <div className="py-16 text-center">
              <Loader2 className={`mx-auto mb-2 h-8 w-8 animate-spin ${colors.icon}`} />
              <p className="text-sm text-gray-500">Generating {suggestionRangeLabel} suggestions per field...</p>
            </div>
          )}

          {!loading && suggestions && (
            <div className="mb-8 space-y-6">
              {FIELD_META.map(({ key, apiKey, label, description }) => {
                const options = suggestions[apiKey] || [];
                const sel = selected[key];
                const custom = customText[key];
                const selCount = sel.length + (custom.trim() ? 1 : 0);
                const allOptionsSelected = options.length > 0 && options.every((opt) => sel.includes(opt));
                return (
                  <div key={key} className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
                    <div className="mb-3 flex items-start justify-between">
                      <div>
                        <h3 className="text-sm font-semibold text-gray-900">{label}</h3>
                        <p className="text-xs text-gray-500">{description}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        {options.length > 1 && (
                          <button
                            type="button"
                            onClick={() => toggleAllChips(key, options)}
                            className={`text-[10px] font-medium ${colors.link}`}
                          >
                            {allOptionsSelected ? 'Clear all' : 'Select all'}
                          </button>
                        )}
                        {selCount > 0 && (
                          <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${colors.badge}`}>
                            {selCount} selected
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="mb-3 flex flex-wrap gap-2">
                      {options.map((opt, index) => {
                        const isSelected = sel.includes(opt);
                        return (
                          <button
                            key={`${key}-${index}`}
                            type="button"
                            onClick={() => toggleChip(key, opt)}
                            className={`inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs transition-all ${
                              isSelected ? colors.chipOn : colors.chipOff
                            }`}
                          >
                            {isSelected && <Check className="h-3 w-3" />}
                            {opt}
                          </button>
                        );
                      })}
                    </div>

                    <input
                      type="text"
                      value={custom}
                      onChange={(e) => setCustomText((prev) => ({ ...prev, [key]: e.target.value }))}
                      placeholder={`Add your own ${label.toLowerCase()}...`}
                      className="w-full rounded-lg border border-gray-200 px-3 py-2 text-xs text-gray-700 focus:outline-none focus:ring-1 focus:ring-gray-300"
                    />
                  </div>
                );
              })}
            </div>
          )}

          {!loading && suggestions && (
            <div className="sticky bottom-6 flex justify-center">
              <button
                type="button"
                onClick={() => void handleGenerate()}
                disabled={generating}
                className={`inline-flex items-center gap-2 rounded-xl px-8 py-3 text-sm font-semibold text-white shadow-lg transition-all hover:shadow-xl ${colors.btn}`}
              >
                {generating ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" /> Generating...
                  </>
                ) : (
                  <>
                    Generate {generationMeta.title} <ArrowRight className="h-4 w-4" />
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
