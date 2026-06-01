'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { ArrowLeft, Eye, LayoutGrid, Loader2, Pencil, Wand2 } from 'lucide-react';
import { useCompanyContext } from '../CompanyContext';
import { TemplateCard, TemplateLegend, TemplatePreviewModal, TemplatePreviewPanel } from '../blog/TemplateCard';
import { TemplateCustomizer } from '../blog/TemplateCustomizer';
import type { ContentBlock } from '../../lib/blog/blockTypes';
import {
  getRecommendedTemplateDescriptors,
  getSystemTemplateDescriptors,
  type ManagedContentType,
  type SystemTemplateDescriptor,
} from '../../lib/content/contentTemplateRegistry';
import { buildManagedTemplateBlocks } from '../../lib/content/managedTemplateBlocks';

type SavedTemplate = {
  id: string;
  name: string;
  description: string | null;
  content_blocks: ContentBlock[];
  usage_count: number;
  format_type?: string | null;
};

type SelectionBundle = {
  topic?: string;
  reason?: string;
  targetWords?: number;
  depthLabel?: string;
  formatLabel?: string;
  suggestions?: {
    uniqueness_directive_options: string[];
    must_include_points_options: string[];
    campaign_objective_options: string[];
    trend_context_options: string[];
  };
};

type Props = {
  contentType: ManagedContentType;
  pageTitle: string;
  heading: string;
  subtitle: string;
  accentColor: 'orange' | 'pink' | 'violet' | 'blue' | 'amber';
  backPath: string;
  generatePath: string;
  suggestionsPath?: string;
};

const ACCENT_SURFACES = {
  orange: 'from-orange-50 to-amber-50',
  pink: 'from-pink-50 to-rose-50',
  violet: 'from-violet-50 to-purple-50',
  blue: 'from-blue-50 to-cyan-50',
  amber: 'from-amber-50 to-yellow-50',
} as const;

function getVisuals(contentType: ManagedContentType, templateName: string) {
  const normalizedTemplate = templateName.trim().toLowerCase();
  const storyVisuals: Record<string, {
    eyebrow: string;
    accentClassName: string;
    surfaceClassName: string;
    badgeClassName: string;
    stats: Array<{ label: string; value: string }>;
  }> = {
    'scene snapshot': {
      eyebrow: 'Illustrated Moment',
      accentClassName: 'from-pink-500 via-rose-500 to-orange-400',
      surfaceClassName: 'bg-[radial-gradient(circle_at_top_left,_rgba(244,63,94,0.12),_rgba(255,255,255,0.97)_45%)]',
      badgeClassName: 'bg-pink-100 text-pink-700',
      stats: [{ label: 'Visual', value: 'Hero scene' }, { label: 'Media', value: 'Single image' }],
    },
    'dialogue turn': {
      eyebrow: 'Quote-Led Turn',
      accentClassName: 'from-violet-500 via-fuchsia-500 to-pink-500',
      surfaceClassName: 'bg-[radial-gradient(circle_at_top_left,_rgba(168,85,247,0.12),_rgba(255,255,255,0.97)_45%)]',
      badgeClassName: 'bg-violet-100 text-violet-700',
      stats: [{ label: 'Format', value: 'Dialogue' }, { label: 'Media', value: 'Pull quote' }],
    },
    'visual micro-story': {
      eyebrow: 'Media-First Story',
      accentClassName: 'from-sky-500 via-blue-500 to-violet-500',
      surfaceClassName: 'bg-[radial-gradient(circle_at_top_left,_rgba(59,130,246,0.12),_rgba(255,255,255,0.97)_45%)]',
      badgeClassName: 'bg-sky-100 text-sky-700',
      stats: [{ label: 'Visual', value: 'Thumbnail first' }, { label: 'Media', value: 'Image + payoff' }],
    },
    'cinematic journey': {
      eyebrow: 'Cinematic Longform',
      accentClassName: 'from-rose-600 via-orange-500 to-amber-400',
      surfaceClassName: 'bg-[radial-gradient(circle_at_top_left,_rgba(251,146,60,0.13),_rgba(255,255,255,0.97)_45%)]',
      badgeClassName: 'bg-orange-100 text-orange-700',
      stats: [{ label: 'Visual', value: 'Wide hero' }, { label: 'Format', value: 'Three acts' }],
    },
    'founder reflection': {
      eyebrow: 'Reflective Memoir',
      accentClassName: 'from-slate-700 via-indigo-600 to-violet-500',
      surfaceClassName: 'bg-[radial-gradient(circle_at_top_left,_rgba(79,70,229,0.12),_rgba(255,255,255,0.97)_45%)]',
      badgeClassName: 'bg-indigo-100 text-indigo-700',
      stats: [{ label: 'Format', value: 'Memory led' }, { label: 'Media', value: 'Quote led' }],
    },
    'customer journey': {
      eyebrow: 'Transformation Story',
      accentClassName: 'from-emerald-500 via-teal-500 to-sky-500',
      surfaceClassName: 'bg-[radial-gradient(circle_at_top_left,_rgba(20,184,166,0.12),_rgba(255,255,255,0.97)_45%)]',
      badgeClassName: 'bg-emerald-100 text-emerald-700',
      stats: [{ label: 'Visual', value: 'Journey image' }, { label: 'Format', value: 'Before/after' }],
    },
    'cliffhanger episode': {
      eyebrow: 'Serialized Episode',
      accentClassName: 'from-pink-500 via-rose-500 to-orange-400',
      surfaceClassName: 'bg-[radial-gradient(circle_at_top_left,_rgba(244,63,94,0.12),_rgba(255,255,255,0.97)_45%)]',
      badgeClassName: 'bg-pink-100 text-pink-700',
      stats: [{ label: 'Format', value: 'Cliffhanger' }, { label: 'Media', value: 'Series link' }],
    },
    'series recap': {
      eyebrow: 'Continuity Episode',
      accentClassName: 'from-amber-500 via-orange-500 to-rose-500',
      surfaceClassName: 'bg-[radial-gradient(circle_at_top_left,_rgba(245,158,11,0.12),_rgba(255,255,255,0.97)_45%)]',
      badgeClassName: 'bg-amber-100 text-amber-700',
      stats: [{ label: 'Format', value: 'Recap + advance' }, { label: 'Media', value: 'Continuity thread' }],
    },
    'visual episode board': {
      eyebrow: 'Storyboard Episode',
      accentClassName: 'from-cyan-500 via-blue-500 to-violet-500',
      surfaceClassName: 'bg-[radial-gradient(circle_at_top_left,_rgba(14,165,233,0.12),_rgba(255,255,255,0.97)_45%)]',
      badgeClassName: 'bg-cyan-100 text-cyan-700',
      stats: [{ label: 'Visual', value: 'Storyboard' }, { label: 'Media', value: 'Carousel-ready' }],
    },
  };
  if (contentType === 'story' && storyVisuals[normalizedTemplate]) return storyVisuals[normalizedTemplate];

  const base = {
    article: {
      eyebrow: 'Editorial Structure',
      accentClassName: 'from-orange-500 via-amber-500 to-yellow-400',
      surfaceClassName: 'bg-[radial-gradient(circle_at_top_left,_rgba(249,115,22,0.10),_rgba(255,255,255,0.97)_45%)]',
      badgeClassName: 'bg-orange-100 text-orange-700',
    },
    guide: {
      eyebrow: 'Pillar Framework',
      accentClassName: 'from-violet-500 via-purple-500 to-fuchsia-500',
      surfaceClassName: 'bg-[radial-gradient(circle_at_top_left,_rgba(139,92,246,0.10),_rgba(255,255,255,0.97)_45%)]',
      badgeClassName: 'bg-violet-100 text-violet-700',
    },
    story: {
      eyebrow: 'Narrative Arc',
      accentClassName: 'from-pink-500 via-rose-500 to-orange-400',
      surfaceClassName: 'bg-[radial-gradient(circle_at_top_left,_rgba(244,63,94,0.10),_rgba(255,255,255,0.97)_45%)]',
      badgeClassName: 'bg-pink-100 text-pink-700',
    },
    whitepaper: {
      eyebrow: 'Authority Layout',
      accentClassName: 'from-slate-800 via-blue-700 to-cyan-500',
      surfaceClassName: 'bg-[radial-gradient(circle_at_top_left,_rgba(30,64,175,0.10),_rgba(255,255,255,0.97)_45%)]',
      badgeClassName: 'bg-blue-100 text-blue-700',
    },
    'case-study': {
      eyebrow: 'Proof Structure',
      accentClassName: 'from-amber-500 via-orange-500 to-rose-500',
      surfaceClassName: 'bg-[radial-gradient(circle_at_top_left,_rgba(245,158,11,0.10),_rgba(255,255,255,0.97)_45%)]',
      badgeClassName: 'bg-amber-100 text-amber-700',
    },
    blog: {
      eyebrow: 'Managed Layout',
      accentClassName: 'from-indigo-500 via-violet-500 to-sky-500',
      surfaceClassName: 'bg-white',
      badgeClassName: 'bg-indigo-100 text-indigo-700',
    },
    newsletter: {
      eyebrow: 'Managed Layout',
      accentClassName: 'from-indigo-500 via-violet-500 to-sky-500',
      surfaceClassName: 'bg-white',
      badgeClassName: 'bg-indigo-100 text-indigo-700',
    },
    post: {
      eyebrow: 'Managed Layout',
      accentClassName: 'from-indigo-500 via-violet-500 to-sky-500',
      surfaceClassName: 'bg-white',
      badgeClassName: 'bg-indigo-100 text-indigo-700',
    },
    thread: {
      eyebrow: 'Managed Layout',
      accentClassName: 'from-indigo-500 via-violet-500 to-sky-500',
      surfaceClassName: 'bg-white',
      badgeClassName: 'bg-indigo-100 text-indigo-700',
    },
  }[contentType];

  return {
    ...base,
    stats: [
      { label: 'Template', value: templateName },
      { label: 'Mode', value: base.eyebrow },
    ],
  };
}

export default function ManagedTemplateSelectionPage({
  contentType,
  pageTitle,
  heading,
  subtitle,
  accentColor,
  backPath,
  generatePath,
  suggestionsPath,
}: Props) {
  const router = useRouter();
  const { user, selectedCompanyId, isLoading: authLoading } = useCompanyContext();
  const companyId = selectedCompanyId;
  const selectedFormat = typeof router.query.format === 'string' ? router.query.format : '';

  const [mode, setMode] = useState<'select' | 'customize'>('select');
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [selectedDescriptor, setSelectedDescriptor] = useState<SystemTemplateDescriptor | null>(null);
  const [customBlocks, setCustomBlocks] = useState<ContentBlock[]>([]);
  const [selectedTemplateName, setSelectedTemplateName] = useState<string | null>(null);
  const [selectedFormatType, setSelectedFormatType] = useState<string | null>(selectedFormat || null);
  const [savedTemplates, setSavedTemplates] = useState<SavedTemplate[]>([]);
  const [loadingSaved, setLoadingSaved] = useState(true);
  const [previewTpl, setPreviewTpl] = useState<{ name: string; description: string; blocks: ContentBlock[]; formatType?: string | null; isDefault?: boolean } | null>(null);
  const [selectionBundle, setSelectionBundle] = useState<SelectionBundle | null>(null);

  const allTemplates = useMemo(() => getSystemTemplateDescriptors(contentType), [contentType]);
  const recommendedTemplates = useMemo(() => {
    const formatMatched = allTemplates.filter((template) => template.formatType === selectedFormat);
    if (formatMatched.length > 0) return formatMatched;
    return getRecommendedTemplateDescriptors(contentType).slice(0, 2);
  }, [allTemplates, contentType, selectedFormat]);
  const otherTemplates = useMemo(
    () => allTemplates.filter((template) => !recommendedTemplates.some((r) => r.name === template.name)),
    [allTemplates, recommendedTemplates],
  );
  const selectedSavedTemplate = useMemo(
    () => (selectedKey?.startsWith('saved:') ? savedTemplates.find((template) => `saved:${template.id}` === selectedKey) ?? null : null),
    [savedTemplates, selectedKey],
  );

  useEffect(() => {
    const initialTemplate = recommendedTemplates[0] || allTemplates[0];
    if (!initialTemplate || selectedKey) return;
    setSelectedKey(`system:${initialTemplate.name}`);
    setSelectedDescriptor(initialTemplate);
    setSelectedTemplateName(initialTemplate.name);
    setSelectedFormatType(initialTemplate.formatType ?? selectedFormat ?? null);
    setCustomBlocks(buildManagedTemplateBlocks(contentType, initialTemplate.formatType, initialTemplate.name));
  }, [allTemplates, contentType, recommendedTemplates, selectedFormat, selectedKey]);

  useEffect(() => {
    if (!companyId) return;
    setLoadingSaved(true);
    fetch(`/api/block-templates?company_id=${companyId}&content_type=${contentType}`, { credentials: 'include' })
      .then((r) => r.json())
      .then((data) => setSavedTemplates(data.templates || []))
      .catch(() => {})
      .finally(() => setLoadingSaved(false));
  }, [companyId, contentType]);

  useEffect(() => {
    const bundleToken = typeof router.query.prefill_bundle === 'string' ? router.query.prefill_bundle.trim() : '';
    if (!bundleToken || typeof window === 'undefined') return;
    const rawBundle = sessionStorage.getItem(bundleToken);
    if (!rawBundle) return;
    try {
      setSelectionBundle(JSON.parse(rawBundle) as SelectionBundle);
    } catch {
      // ignore malformed selection bundles
    }
  }, [router.query.prefill_bundle]);

  const handleSelectSystem = useCallback((descriptor: SystemTemplateDescriptor) => {
    setSelectedKey(`system:${descriptor.name}`);
    setSelectedDescriptor(descriptor);
    setSelectedTemplateName(descriptor.name);
    setSelectedFormatType(descriptor.formatType ?? null);
    setCustomBlocks(buildManagedTemplateBlocks(contentType, descriptor.formatType, descriptor.name));
  }, [contentType]);

  const handleSelectSaved = useCallback((template: SavedTemplate) => {
    setSelectedKey(`saved:${template.id}`);
    setSelectedDescriptor(null);
    setSelectedTemplateName(template.name);
    setSelectedFormatType(template.format_type ?? null);
    setCustomBlocks(template.content_blocks);
  }, []);

  const handleSaveTemplate = async (blocks: ContentBlock[], name: string) => {
    if (!companyId) return;
    try {
      const res = await fetch('/api/block-templates', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company_id: companyId,
          name,
          content_type: contentType,
          format_type: selectedFormatType,
          content_blocks: blocks,
        }),
      });
      const data = await res.json();
      if (data.template) {
        setSavedTemplates((prev) => [data.template, ...prev]);
      }
    } catch {
      // ignore save failures in the template picker surface
    }
  };

  const handleCreateWithAi = () => {
    const seedTemplate = selectedDescriptor ?? recommendedTemplates[0] ?? allTemplates[0];
    if (seedTemplate) {
      setSelectedKey(`system:${seedTemplate.name}`);
      setSelectedDescriptor(seedTemplate);
      setSelectedTemplateName(seedTemplate.name);
      setSelectedFormatType(seedTemplate.formatType ?? null);
      setCustomBlocks(buildManagedTemplateBlocks(contentType, seedTemplate.formatType, seedTemplate.name));
    }
    setMode('customize');
  };

  const handleContinue = (blocks: ContentBlock[], formatType: string | null = selectedFormatType) => {
    const token = `${contentType.replace(/[^a-z]/g, '_')}_tpl_${Date.now()}`;
    sessionStorage.setItem(token, JSON.stringify({
      blocks,
      format_type: formatType,
      template_name: selectedTemplateName,
    }));
    const carriedQuery = Object.entries(router.query).reduce<Record<string, string>>((accumulator, [key, value]) => {
      if (key === 'tpl') return accumulator;
      if (typeof value === 'string' && value.trim()) {
        accumulator[key] = value;
      }
      return accumulator;
    }, {});
    void router.push({
      pathname: suggestionsPath || generatePath,
      query: {
        ...carriedQuery,
        format: formatType || selectedFormat || undefined,
        tpl: token,
        target_words: selectionBundle?.targetWords || carriedQuery.target_words || undefined,
      },
    });
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
        <p className="text-sm text-gray-500">Sign in to continue.</p>
      </div>
    );
  }

  if (mode === 'customize') {
    return (
      <>
        <Head>
          <title>{pageTitle} | Customize Template</title>
        </Head>
        <div className={`min-h-screen bg-gradient-to-br ${ACCENT_SURFACES[accentColor]} p-6`}>
          <div className="mx-auto max-w-3xl">
            <div className="mb-6 flex items-center justify-between">
              <button
                onClick={() => setMode('select')}
                className="inline-flex items-center gap-1.5 text-sm text-gray-600 hover:text-gray-900"
              >
                <ArrowLeft className="h-4 w-4" /> Back to templates
              </button>
            </div>
            <TemplateCustomizer
              blocks={customBlocks}
              onChange={setCustomBlocks}
              onSave={handleSaveTemplate}
              onUse={handleContinue}
              templateName={selectedTemplateName || undefined}
            />
          </div>
        </div>
      </>
    );
  }

  const previewVisuals = getVisuals(contentType, selectedTemplateName || 'Template');

  return (
    <>
      <Head>
        <title>{pageTitle} | Choose Template</title>
      </Head>
      <div className={`min-h-screen bg-gradient-to-br ${ACCENT_SURFACES[accentColor]} p-6`}>
        <div className="mx-auto max-w-5xl">
          <div className="mb-6 flex items-center justify-between">
            <div>
              <p className="mb-1 text-xs text-gray-500">Step 2 of 4 - Choose template</p>
              <h1 className="flex items-center gap-2 text-2xl font-bold text-gray-900">
                <LayoutGrid className="h-6 w-6 text-gray-800" /> {heading}
              </h1>
              {selectionBundle?.topic ? (
                <p className="mt-1 text-sm text-gray-500">
                  Topic: <span className="font-medium text-gray-700">{selectionBundle.topic}</span>
                  {selectionBundle.targetWords ? ` · ${selectionBundle.targetWords.toLocaleString()}+ words` : ''}
                </p>
              ) : (
                <p className="mt-1 max-w-2xl text-sm text-gray-600">{subtitle}</p>
              )}
            </div>
            <button onClick={() => router.push(backPath)} className="text-sm text-gray-600 hover:text-gray-900">
              &larr; Back
            </button>
          </div>

          <div className="mb-6 rounded-xl border border-gray-100 bg-white px-4 py-3 shadow-sm">
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-gray-400">Block Colors</p>
            <TemplateLegend />
          </div>

          <div className="grid gap-6 lg:grid-cols-[minmax(0,1.25fr)_minmax(320px,0.95fr)]">
            <div>
              {recommendedTemplates.length > 0 && (
                <section className="mb-8">
                  <h2 className="mb-3 text-sm font-semibold text-gray-700">Default Templates</h2>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    {recommendedTemplates.map((tpl) => {
                      const visuals = getVisuals(contentType, tpl.name);
                      return (
                        <TemplateCard
                          key={tpl.name}
                          name={tpl.name}
                          description={tpl.description}
                          blocks={buildManagedTemplateBlocks(contentType, tpl.formatType, tpl.name)}
                          isDefault
                          selected={selectedKey === `system:${tpl.name}`}
                          eyebrow={visuals.eyebrow}
                          accentClassName={visuals.accentClassName}
                          surfaceClassName={visuals.surfaceClassName}
                          badgeClassName={visuals.badgeClassName}
                          stats={[
                            { label: 'Best For', value: tpl.recommendedFor?.[0] || 'Managed content flow' },
                            { label: 'Format', value: tpl.formatType || 'Flexible' },
                          ]}
                          onClick={() => handleSelectSystem(tpl)}
                        />
                      );
                    })}
                  </div>
                </section>
              )}

              {otherTemplates.length > 0 && (
                <section className="mb-8">
                  <h2 className="mb-3 text-sm font-semibold text-gray-700">More Templates</h2>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    {otherTemplates.map((tpl) => {
                      const visuals = getVisuals(contentType, tpl.name);
                      return (
                        <TemplateCard
                          key={tpl.name}
                          name={tpl.name}
                          description={tpl.description}
                          blocks={buildManagedTemplateBlocks(contentType, tpl.formatType, tpl.name)}
                          isDefault
                          selected={selectedKey === `system:${tpl.name}`}
                          eyebrow={visuals.eyebrow}
                          accentClassName={visuals.accentClassName}
                          surfaceClassName={visuals.surfaceClassName}
                          badgeClassName={visuals.badgeClassName}
                          stats={[
                            { label: 'Feel', value: tpl.executionStrategy.replace(/-/g, ' ') },
                            { label: 'Format', value: tpl.formatType || 'Flexible' },
                          ]}
                          onClick={() => handleSelectSystem(tpl)}
                        />
                      );
                    })}
                  </div>
                </section>
              )}

              {!loadingSaved && savedTemplates.length > 0 && (
                <section className="mb-8">
                  <h2 className="mb-3 text-sm font-semibold text-gray-700">Your Custom Templates</h2>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    {savedTemplates.map((tpl) => (
                      <TemplateCard
                        key={tpl.id}
                        name={tpl.name}
                        description={tpl.description || 'Saved custom layout for this content type.'}
                        blocks={tpl.content_blocks}
                        usageCount={tpl.usage_count}
                        selected={selectedKey === `saved:${tpl.id}`}
                        eyebrow="Custom Template"
                        accentClassName={previewVisuals.accentClassName}
                        surfaceClassName="bg-white"
                        badgeClassName={previewVisuals.badgeClassName}
                        stats={[
                          { label: 'Uses', value: String(tpl.usage_count) },
                          { label: 'Format', value: tpl.format_type || 'Flexible' },
                        ]}
                        onClick={() => handleSelectSaved(tpl)}
                      />
                    ))}
                  </div>
                </section>
              )}

              {loadingSaved && (
                <div className="py-8 text-center">
                  <Loader2 className="mx-auto h-5 w-5 animate-spin text-gray-400" />
                  <p className="mt-1 text-xs text-gray-400">Loading saved templates...</p>
                </div>
              )}

              {customBlocks.length > 0 && (
                <div className="sticky bottom-6 mt-8 flex justify-center gap-3">
                  <button
                    type="button"
                    onClick={() => setPreviewTpl({
                      name: selectedTemplateName || 'Template Preview',
                      description: selectedDescriptor?.description || 'Expanded block-by-block preview of the selected layout.',
                      blocks: customBlocks,
                      formatType: selectedFormatType,
                      isDefault: !!selectedDescriptor,
                    })}
                    className="inline-flex items-center gap-2 rounded-xl border border-gray-300 bg-white px-5 py-3 text-sm font-medium text-gray-700 shadow-md transition-all hover:border-gray-400 hover:shadow-lg lg:hidden"
                  >
                    <Eye className="h-4 w-4" /> Full Preview
                  </button>
                  <button
                    type="button"
                    onClick={() => setMode('customize')}
                    className="inline-flex items-center gap-2 rounded-xl border border-gray-300 bg-white px-5 py-3 text-sm font-medium text-gray-700 shadow-md transition-all hover:border-gray-400 hover:shadow-lg"
                  >
                    <Pencil className="h-4 w-4" /> Customize
                  </button>
                  <button
                    type="button"
                    onClick={handleCreateWithAi}
                    className="inline-flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-5 py-3 text-sm font-semibold text-emerald-700 shadow-md transition-all hover:bg-emerald-100 hover:shadow-lg"
                  >
                    <Wand2 className="h-4 w-4" /> Create with AI
                  </button>
                  <button
                    type="button"
                    onClick={() => handleContinue(customBlocks, selectedFormatType)}
                    className="inline-flex items-center gap-2 rounded-xl bg-gray-900 px-6 py-3 text-sm font-semibold text-white shadow-md transition-all hover:bg-black hover:shadow-lg"
                  >
                    Continue &rarr;
                  </button>
                </div>
              )}
            </div>

            <div className="hidden lg:block">
              <TemplatePreviewPanel
                name={selectedTemplateName || undefined}
                description={selectedDescriptor?.description || (selectedTemplateName ? 'Saved custom layout ready for reuse.' : undefined)}
                blocks={customBlocks}
                isDefault={!!selectedDescriptor}
                eyebrow={previewVisuals.eyebrow}
                accentClassName={previewVisuals.accentClassName}
                stats={previewVisuals.stats}
                emptyTitle="Select a template"
                emptyDescription="Choose a recommended or custom template to inspect the structure before continuing."
              />
            </div>
          </div>
        </div>
      </div>

      {previewTpl && (
        <TemplatePreviewModal
          name={previewTpl.name}
          description={previewTpl.description}
          blocks={previewTpl.blocks}
          isDefault={previewTpl.isDefault}
          onClose={() => setPreviewTpl(null)}
          onSelect={() => {
            setPreviewTpl(null);
            handleContinue(previewTpl.blocks, previewTpl.formatType || null);
          }}
          onCustomize={() => {
            setPreviewTpl(null);
            setMode('customize');
          }}
        />
      )}
    </>
  );
}
