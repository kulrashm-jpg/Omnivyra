'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { ArrowLeft, Eye, LayoutGrid, Loader2, Pencil } from 'lucide-react';
import { useCompanyContext } from '../../components/CompanyContext';
import { TemplateCard, TemplateLegend, TemplatePreviewModal, TemplatePreviewPanel } from '../../components/blog/TemplateCard';
import { TemplateCustomizer } from '../../components/blog/TemplateCustomizer';
import { getDefaultNewsletterTemplates, instantiateNewsletterTemplate } from '../../lib/newsletter/defaultNewsletterTemplates';
import { getNewsletterTemplateVisuals } from '../../lib/newsletter/newsletterTemplateVisuals';
import type { ContentBlock } from '../../lib/blog/blockTypes';
import {
  NEWSLETTER_DEPTH_OPTIONS,
  getNewsletterEngineConfig,
  isValidNewsletterDepth,
  resolveNewsletterTargetWords,
} from '../../lib/newsletter/newsletterContentEngine';
import type { NewsletterFormatType } from '../../lib/blog/blogStructureTemplates';

type SavedTemplate = {
  id: string;
  name: string;
  description: string | null;
  content_blocks: ContentBlock[];
  usage_count: number;
  format_type?: string | null;
};

export default function NewsletterTemplatePage() {
  const router = useRouter();
  const { user, selectedCompanyId, isLoading: authLoading } = useCompanyContext();
  const companyId = selectedCompanyId;

  const formatQuery = typeof router.query.format === 'string' ? router.query.format : 'insight-letter';
  const topicQuery = typeof router.query.topic === 'string' ? router.query.topic : '';
  const depthQuery = typeof router.query.depth === 'string' && isValidNewsletterDepth(router.query.depth)
    ? router.query.depth
    : 'standard';

  const [mode, setMode] = useState<'select' | 'customize'>('select');
  const [topic, setTopic] = useState(topicQuery);
  const [depth, setDepth] = useState(depthQuery);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [customBlocks, setCustomBlocks] = useState<ContentBlock[]>([]);
  const [selectedFormatType, setSelectedFormatType] = useState<string | null>(null);
  const [selectedTemplateName, setSelectedTemplateName] = useState<string | null>(null);
  const [savedTemplates, setSavedTemplates] = useState<SavedTemplate[]>([]);
  const [loadingSaved, setLoadingSaved] = useState(true);
  const [previewTpl, setPreviewTpl] = useState<{ name: string; description: string; blocks: ContentBlock[]; formatType?: string | null; isDefault?: boolean } | null>(null);

  const defaults = useMemo(() => getDefaultNewsletterTemplates(), []);
  const typeConfig = getNewsletterEngineConfig(formatQuery);
  const resolvedFormat = (typeConfig?.value || 'insight-letter') as NewsletterFormatType;
  const targetWords = resolveNewsletterTargetWords(resolvedFormat, depth);
  const filteredDefaults = useMemo(
    () => defaults.filter((tpl) => tpl.format_type === resolvedFormat),
    [defaults, resolvedFormat],
  );
  const filteredSavedTemplates = useMemo(
    () => savedTemplates.filter((tpl) => !tpl.format_type || tpl.format_type === resolvedFormat),
    [savedTemplates, resolvedFormat],
  );

  useEffect(() => {
    const preferredIndex = filteredDefaults.findIndex((tpl) => tpl.format_type === resolvedFormat);
    const initialIndex = preferredIndex >= 0 ? preferredIndex : 0;
    const tpl = filteredDefaults[initialIndex];
    if (!tpl) return;
    const blocks = instantiateNewsletterTemplate(tpl, targetWords);
    setSelectedIdx(initialIndex);
    setCustomBlocks(blocks);
    setSelectedFormatType(tpl.format_type ?? null);
    setSelectedTemplateName(tpl.name);
  }, [filteredDefaults, resolvedFormat, targetWords]);

  useEffect(() => {
    if (!companyId) return;
    setLoadingSaved(true);
    fetch(`/api/block-templates?company_id=${companyId}&content_type=newsletter`, { credentials: 'include' })
      .then((r) => r.json())
      .then((data) => setSavedTemplates(data.templates || []))
      .catch(() => {})
      .finally(() => setLoadingSaved(false));
  }, [companyId]);

  const handleSelectDefault = useCallback((idx: number) => {
    const tpl = filteredDefaults[idx];
    if (!tpl) return;
    const blocks = instantiateNewsletterTemplate(tpl, targetWords);
    setSelectedIdx(idx);
    setCustomBlocks(blocks);
    setSelectedFormatType(tpl.format_type ?? null);
    setSelectedTemplateName(tpl.name);
  }, [filteredDefaults, targetWords]);

  const handleSelectSaved = useCallback((tpl: SavedTemplate) => {
    setSelectedIdx(null);
    setCustomBlocks(tpl.content_blocks);
    setSelectedFormatType(tpl.format_type ?? null);
    setSelectedTemplateName(tpl.name);
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
          content_type: 'newsletter',
          format_type: selectedFormatType,
          content_blocks: blocks,
        }),
      });
      const data = await res.json();
      if (data.template) setSavedTemplates((prev) => [data.template, ...prev]);
    } catch {}
  };

  const handleUseTemplate = (blocks: ContentBlock[], formatType: string | null = selectedFormatType) => {
    if (!topic.trim()) return;
    const token = `newsletter_tpl_${Date.now()}`;
    sessionStorage.setItem(token, JSON.stringify({
      blocks,
      format_type: formatType,
      template_name: selectedTemplateName,
      depth,
      target_words: targetWords,
      topic: topic.trim(),
    }));
    router.push({
      pathname: '/newsletters/suggestions',
      query: { tpl: token, topic: topic.trim(), depth, format: formatType || undefined },
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
        <p className="text-gray-500 text-sm">Sign in to continue.</p>
      </div>
    );
  }

  if (mode === 'customize') {
    return (
      <>
        <Head>
          <title>Customize Newsletter Template | Omnivyra</title>
        </Head>
        <div className="min-h-screen bg-gradient-to-br from-amber-50 to-orange-50 p-6">
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
              onUse={handleUseTemplate}
              templateName={selectedTemplateName || undefined}
            />
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <Head>
        <title>Choose Newsletter Template | Omnivyra</title>
      </Head>
      <div className="min-h-screen bg-gradient-to-br from-amber-50 to-orange-50 p-6">
        <div className="mx-auto max-w-6xl">
          <div className="mb-6 flex items-center justify-between">
            <div>
              <p className="mb-1 text-xs text-gray-500">Step 1 of 3 — Choose newsletter layout</p>
              <h1 className="flex items-center gap-2 text-2xl font-bold text-gray-900">
                <LayoutGrid className="h-6 w-6 text-amber-600" /> Choose a Newsletter Template
              </h1>
              {typeConfig && (
                <p className="mt-1 text-sm text-gray-600">
                  {typeConfig.title} · {typeConfig.shortLabel} · {typeConfig.thinkingMode}
                </p>
              )}
            </div>
            <button onClick={() => router.push({ pathname: '/newsletters/intelligence', query: { format: resolvedFormat } })} className="text-sm text-gray-600 hover:text-gray-900">
              ← Back
            </button>
          </div>

          <div className="mb-6 grid gap-4 rounded-2xl border border-amber-100 bg-white/90 p-5 shadow-sm lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
            <div>
              <label className="mb-1.5 block text-sm font-semibold text-gray-700">Newsletter Topic</label>
              <input
                type="text"
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                placeholder="e.g. Why AI products are quietly becoming workflow products"
                className="w-full rounded-xl border border-gray-300 px-4 py-3 text-sm"
              />
            </div>
            <div>
              {typeConfig && (
                <div className="mb-3 rounded-xl border border-amber-100 bg-amber-50/70 px-3 py-2">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-amber-700">Selected Newsletter Type</p>
                  <p className="mt-1 text-sm font-semibold text-gray-900">{typeConfig.title}</p>
                  <p className="text-xs text-gray-600">{typeConfig.shortLabel}</p>
                </div>
              )}
              <label className="mb-1.5 block text-sm font-semibold text-gray-700">Depth</label>
              <div className="grid grid-cols-3 gap-2">
                {NEWSLETTER_DEPTH_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setDepth(option.value)}
                    className={`rounded-xl border px-3 py-3 text-left transition-all ${
                      depth === option.value
                        ? 'border-amber-500 bg-amber-50'
                        : 'border-gray-200 bg-white hover:border-amber-200'
                    }`}
                  >
                    <p className="text-sm font-semibold text-gray-900">{option.label}</p>
                    <p className="mt-0.5 text-[11px] text-gray-500">{option.description}</p>
                  </button>
                ))}
              </div>
              <p className="mt-2 text-xs text-gray-500">Target depth: about {targetWords} words for this newsletter type.</p>
            </div>
          </div>

          <div className="mb-6 rounded-xl border border-gray-100 bg-white px-4 py-3 shadow-sm">
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-gray-400">Block Colors</p>
            <TemplateLegend />
          </div>

          <div className="mb-6 rounded-2xl border border-amber-100 bg-white/90 px-5 py-4 shadow-sm">
            <p className="text-sm font-semibold text-gray-900">Mode-matched newsletter layouts</p>
            <p className="mt-1 text-sm text-gray-600">
              These templates are tailored for <span className="font-medium text-gray-800">{typeConfig ? `${typeConfig.title} (${typeConfig.shortLabel})` : 'this newsletter mode'}</span>, so the card visuals and layout rhythm now reflect the kind of newsletter you are creating, not a generic blog structure.
            </p>
          </div>

          <div className="grid gap-6 lg:grid-cols-[minmax(0,1.25fr)_minmax(320px,0.95fr)]">
            <div>
              <section className="mb-8">
                <h2 className="mb-3 text-sm font-semibold text-gray-700">Default Newsletter Templates</h2>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  {filteredDefaults.map((tpl, i) => {
                    const visual = getNewsletterTemplateVisuals(tpl.name);
                    return (
                      <TemplateCard
                        key={tpl.name}
                        name={tpl.name}
                        description={tpl.description}
                        blocks={instantiateNewsletterTemplate(tpl, targetWords)}
                        isDefault
                        selected={selectedIdx === i}
                        eyebrow={visual?.eyebrow}
                        accentClassName={visual?.accentClassName}
                        surfaceClassName={visual?.surfaceClassName}
                        badgeClassName={visual?.badgeClassName}
                        stats={visual?.stats}
                        onClick={() => handleSelectDefault(i)}
                      />
                    );
                  })}
                </div>
              </section>

              {!loadingSaved && filteredSavedTemplates.length > 0 && (
                <section className="mb-8">
                  <h2 className="mb-3 text-sm font-semibold text-gray-700">Your Newsletter Templates</h2>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    {filteredSavedTemplates.map((tpl) => {
                      const visual = getNewsletterTemplateVisuals(tpl.name);
                      return (
                        <TemplateCard
                          key={tpl.id}
                          name={tpl.name}
                          description={tpl.description || ''}
                          blocks={tpl.content_blocks}
                          usageCount={tpl.usage_count}
                          selected={customBlocks === tpl.content_blocks}
                          eyebrow={visual?.eyebrow || 'Custom Newsletter'}
                          accentClassName={visual?.accentClassName}
                          surfaceClassName={visual?.surfaceClassName}
                          badgeClassName={visual?.badgeClassName}
                          stats={visual?.stats}
                          onClick={() => handleSelectSaved(tpl)}
                        />
                      );
                    })}
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
                      description: 'Expanded block-by-block preview of the current newsletter layout.',
                      blocks: customBlocks,
                      formatType: selectedFormatType,
                      isDefault: selectedIdx != null,
                    })}
                    className="inline-flex items-center gap-2 rounded-xl border border-gray-300 bg-white px-5 py-3 text-sm font-medium text-gray-700 shadow-md transition-all hover:border-amber-300 hover:shadow-lg lg:hidden"
                  >
                    <Eye className="h-4 w-4" /> Full Preview
                  </button>
                  <button
                    type="button"
                    onClick={() => setMode('customize')}
                    className="inline-flex items-center gap-2 rounded-xl border border-gray-300 bg-white px-5 py-3 text-sm font-medium text-gray-700 shadow-md transition-all hover:border-amber-300 hover:shadow-lg"
                  >
                    <Pencil className="h-4 w-4" /> Customize
                  </button>
                  <button
                    type="button"
                    disabled={!topic.trim()}
                    onClick={() => handleUseTemplate(customBlocks, selectedFormatType)}
                    className="inline-flex items-center gap-2 rounded-xl bg-amber-600 px-6 py-3 text-sm font-semibold text-white shadow-md transition-all hover:bg-amber-700 hover:shadow-lg disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Continue →
                  </button>
                </div>
              )}
            </div>

            <div className="hidden lg:block">
              <TemplatePreviewPanel
                name={selectedTemplateName || undefined}
                description={selectedTemplateName
                  ? `Dummy preview of the selected ${selectedTemplateName} layout at ${targetWords} words.`
                  : undefined}
                blocks={customBlocks.length > 0 ? customBlocks : undefined}
                isDefault={selectedIdx != null}
                emptyDescription="Choose any template on the left and we’ll show a dummy newsletter layout preview here."
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
            handleUseTemplate(previewTpl.blocks, previewTpl.formatType ?? null);
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
