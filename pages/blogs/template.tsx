'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { ArrowLeft, Loader2, Pencil, LayoutGrid, Eye } from 'lucide-react';
import { useCompanyContext } from '../../components/CompanyContext';
import { TemplateCard, TemplatePreviewModal, TemplateLegend, TemplatePreviewPanel } from '../../components/blog/TemplateCard';
import { TemplateCustomizer } from '../../components/blog/TemplateCustomizer';
import { getDefaultBlogTemplates, instantiateBlogTemplate, type BlogTemplate as DefaultTemplate } from '../../lib/blog/defaultBlogTemplates';
import type { ContentBlock } from '../../lib/blog/blockTypes';

const BLOG_TEMPLATE_VISUALS: Record<string, {
  eyebrow: string;
  accentClassName: string;
  surfaceClassName: string;
  badgeClassName: string;
  stats: Array<{ label: string; value: string }>;
}> = {
  Classic: {
    eyebrow: 'Editorial Core',
    accentClassName: 'from-slate-900 via-blue-700 to-cyan-500',
    surfaceClassName: 'bg-[radial-gradient(circle_at_top_left,_rgba(15,23,42,0.08),_rgba(255,255,255,0.96)_45%)]',
    badgeClassName: 'bg-slate-100 text-slate-700',
    stats: [
      { label: 'Feel', value: 'Polished deep dive' },
      { label: 'Best For', value: 'Authority + SEO' },
    ],
  },
  'Visual Feature': {
    eyebrow: 'Feature Story',
    accentClassName: 'from-emerald-500 via-teal-500 to-sky-500',
    surfaceClassName: 'bg-[radial-gradient(circle_at_top_left,_rgba(16,185,129,0.10),_rgba(255,255,255,0.96)_45%)]',
    badgeClassName: 'bg-emerald-100 text-emerald-700',
    stats: [
      { label: 'Feel', value: 'Image-led narrative' },
      { label: 'Best For', value: 'Signals + storytelling' },
    ],
  },
  Comparison: {
    eyebrow: 'Decision Guide',
    accentClassName: 'from-amber-500 via-orange-500 to-rose-500',
    surfaceClassName: 'bg-[radial-gradient(circle_at_top_left,_rgba(251,146,60,0.10),_rgba(255,255,255,0.96)_45%)]',
    badgeClassName: 'bg-amber-100 text-amber-700',
    stats: [
      { label: 'Feel', value: 'Clear buyer logic' },
      { label: 'Best For', value: 'Options + verdicts' },
    ],
  },
  Tutorial: {
    eyebrow: 'Operator Walkthrough',
    accentClassName: 'from-indigo-500 via-violet-500 to-fuchsia-500',
    surfaceClassName: 'bg-[radial-gradient(circle_at_top_left,_rgba(99,102,241,0.10),_rgba(255,255,255,0.96)_45%)]',
    badgeClassName: 'bg-indigo-100 text-indigo-700',
    stats: [
      { label: 'Feel', value: 'Practical workflow' },
      { label: 'Best For', value: 'Step-by-step teaching' },
    ],
  },
  Magazine: {
    eyebrow: 'Editorial Feature',
    accentClassName: 'from-rose-500 via-fuchsia-500 to-indigo-500',
    surfaceClassName: 'bg-[radial-gradient(circle_at_top_left,_rgba(244,63,94,0.10),_rgba(255,255,255,0.96)_45%)]',
    badgeClassName: 'bg-rose-100 text-rose-700',
    stats: [
      { label: 'Feel', value: 'Rich magazine rhythm' },
      { label: 'Best For', value: 'Brand + thought leadership' },
    ],
  },
};

function getBlogTemplateVisuals(name: string) {
  return BLOG_TEMPLATE_VISUALS[name] ?? {
    eyebrow: 'Blog Layout',
    accentClassName: 'from-purple-500 via-indigo-500 to-sky-500',
    surfaceClassName: 'bg-white',
    badgeClassName: 'bg-blue-100 text-blue-700',
    stats: [
      { label: 'Feel', value: 'Flexible layout' },
      { label: 'Best For', value: 'Custom editorial use' },
    ],
  };
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function BlogTemplatePage() {
  const router = useRouter();
  const { user, selectedCompanyId, isLoading: authLoading } = useCompanyContext();
  const companyId = selectedCompanyId;

  const words = (router.query.words as string) || '1200';
  const topic = (router.query.topic as string) || '';
  const targetWords = Number.parseInt(words, 10) || 1200;

  // ── State ──────────────────────────────────────────────────────────────────
  const [mode, setMode] = useState<'select' | 'customize'>('select');
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [customBlocks, setCustomBlocks] = useState<ContentBlock[]>([]);
  const [selectedFormatType, setSelectedFormatType] = useState<string | null>(null);
  const [selectedTemplateName, setSelectedTemplateName] = useState<string | null>(null);
  const [savedTemplates, setSavedTemplates] = useState<Array<{ id: string; name: string; description: string | null; content_blocks: ContentBlock[]; usage_count: number; format_type?: string | null }>>([]);
  const [loadingSaved, setLoadingSaved] = useState(true);
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [previewTpl, setPreviewTpl] = useState<{ name: string; description: string; blocks: ContentBlock[]; formatType?: string | null; isDefault?: boolean } | null>(null);

  // ── Default templates ──────────────────────────────────────────────────────
  const defaults: DefaultTemplate[] = getDefaultBlogTemplates();

  useEffect(() => {
    if (previewTpl || customBlocks.length > 0 || defaults.length === 0) return;
    const first = defaults[0];
    const blocks = instantiateBlogTemplate(first, targetWords);
    setSelectedIdx(0);
    setCustomBlocks(blocks);
    setSelectedFormatType(first.format_type ?? null);
    setSelectedTemplateName(first.name);
  }, [customBlocks.length, defaults, previewTpl, targetWords]);

  // ── Fetch saved templates ──────────────────────────────────────────────────
  useEffect(() => {
    if (!companyId) return;
    setLoadingSaved(true);
    fetch(`/api/block-templates?company_id=${companyId}&content_type=blog`, { credentials: 'include' })
      .then((r) => r.json())
      .then((data) => setSavedTemplates(data.templates || []))
      .catch(() => {})
      .finally(() => setLoadingSaved(false));
  }, [companyId]);

  // ── Handlers ───────────────────────────────────────────────────────────────
  const handleSelectDefault = useCallback((idx: number) => {
    const tpl = defaults[idx];
    const blocks = instantiateBlogTemplate(tpl, targetWords);
    setSelectedIdx(idx);
    setCustomBlocks(blocks);
    setSelectedFormatType(tpl.format_type ?? null);
    setSelectedTemplateName(tpl.name);
  }, [defaults, targetWords]);

  const handleSelectSaved = useCallback((tpl: typeof savedTemplates[0]) => {
    setSelectedIdx(null);
    setCustomBlocks(tpl.content_blocks);
    setSelectedFormatType(tpl.format_type ?? null);
    setSelectedTemplateName(tpl.name);
  }, []);

  const handleCustomize = () => {
    if (customBlocks.length === 0 && selectedIdx != null) {
      setCustomBlocks(instantiateBlogTemplate(defaults[selectedIdx], targetWords));
    }
    setMode('customize');
  };

  const handleSaveTemplate = async (blocks: ContentBlock[], name: string) => {
    if (!companyId) return;
    setSavingTemplate(true);
    try {
      const res = await fetch('/api/block-templates', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company_id: companyId,
          name,
          content_type: 'blog',
          format_type: selectedFormatType,
          content_blocks: blocks,
        }),
      });
      const data = await res.json();
      if (data.template) {
        setSavedTemplates((prev) => [data.template, ...prev]);
      }
    } catch {}
    setSavingTemplate(false);
  };

  const handleUseTemplate = (blocks: ContentBlock[], formatType: string | null = selectedFormatType) => {
    // Store blocks with template format so generation and scoring stay consistent.
    const token = `tpl_${Date.now()}`;
    sessionStorage.setItem(token, JSON.stringify({ blocks, format_type: formatType, template_name: selectedTemplateName }));
    router.push({
      pathname: '/blogs/suggestions',
      query: { words, topic, tpl: token },
    });
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

  // ── Customize mode ─────────────────────────────────────────────────────────
  if (mode === 'customize') {
    return (
      <>
        <Head>
          <title>Customize Template | OmniVyra</title>
        </Head>
        <div className="min-h-screen bg-gradient-to-br from-purple-50 to-indigo-50 p-6">
          <div className="mx-auto max-w-3xl">
            <div className="flex items-center justify-between mb-6">
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
            />
          </div>
        </div>
      </>
    );
  }

  // ── Select mode ────────────────────────────────────────────────────────────
  return (
    <>
      <Head>
        <title>Choose Template | OmniVyra</title>
      </Head>
      <div className="min-h-screen bg-gradient-to-br from-purple-50 to-indigo-50 p-6">
        <div className="mx-auto max-w-5xl">
          {/* Header */}
          <div className="flex items-center justify-between mb-6">
            <div>
              <p className="text-xs text-gray-500 mb-1">Step 3 of 5 — Choose layout</p>
              <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
                <LayoutGrid className="h-6 w-6 text-purple-600" /> Choose a Layout Template
              </h1>
              {topic && (
                <p className="mt-1 text-sm text-gray-500">
                  Topic: <span className="font-medium text-gray-700">{decodeURIComponent(topic)}</span>
                  {' · '}{words}+ words
                </p>
              )}
            </div>
            <button
              onClick={() => router.back()}
              className="text-sm text-gray-600 hover:text-gray-900"
            >
              ← Back
            </button>
          </div>

          {/* Color legend */}
          <div className="rounded-xl bg-white border border-gray-100 px-4 py-3 mb-6 shadow-sm">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-2">Block Colors</p>
            <TemplateLegend />
          </div>

          <div className="grid gap-6 lg:grid-cols-[minmax(0,1.25fr)_minmax(320px,0.95fr)]">
            <div>

          {/* Default templates */}
          <section className="mb-8">
            <h2 className="text-sm font-semibold text-gray-700 mb-3">Default Templates</h2>
            <div className="grid gap-4 grid-cols-1 sm:grid-cols-2">
              {defaults.map((tpl, i) => (
                <TemplateCard
                  key={tpl.name}
                  name={tpl.name}
                  description={tpl.description}
                  blocks={instantiateBlogTemplate(tpl, targetWords)}
                  isDefault
                  selected={selectedIdx === i}
                  onClick={() => handleSelectDefault(i)}
                  eyebrow={getBlogTemplateVisuals(tpl.name).eyebrow}
                  accentClassName={getBlogTemplateVisuals(tpl.name).accentClassName}
                  surfaceClassName={getBlogTemplateVisuals(tpl.name).surfaceClassName}
                  badgeClassName={getBlogTemplateVisuals(tpl.name).badgeClassName}
                  stats={getBlogTemplateVisuals(tpl.name).stats}
                />
              ))}
            </div>
          </section>

          {/* Saved templates */}
          {!loadingSaved && savedTemplates.length > 0 && (
            <section className="mb-8">
              <h2 className="text-sm font-semibold text-gray-700 mb-3">Your Templates</h2>
              <div className="grid gap-4 grid-cols-1 sm:grid-cols-2">
                {savedTemplates.map((tpl) => (
                  <TemplateCard
                    key={tpl.id}
                    name={tpl.name}
                    description={tpl.description || ''}
                    blocks={tpl.content_blocks}
                    usageCount={tpl.usage_count}
                    selected={customBlocks === tpl.content_blocks}
                    onClick={() => handleSelectSaved(tpl)}
                  />
                ))}
              </div>
            </section>
          )}
          {loadingSaved && (
            <div className="text-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-gray-400 mx-auto" />
              <p className="text-xs text-gray-400 mt-1">Loading saved templates...</p>
            </div>
          )}

          {/* Action bar */}
          {customBlocks.length > 0 && !previewTpl && (
            <div className="sticky bottom-6 flex justify-center gap-3 mt-8">
              <button
                type="button"
                onClick={() => setPreviewTpl({
                  name: selectedTemplateName || 'Template Preview',
                  description: 'Expanded block-by-block view of the currently selected layout.',
                  blocks: customBlocks,
                  formatType: selectedFormatType,
                  isDefault: selectedIdx != null,
                })}
                className="inline-flex items-center gap-2 rounded-xl border border-gray-300 bg-white px-5 py-3 text-sm font-medium text-gray-700 shadow-md hover:shadow-lg hover:border-purple-300 transition-all lg:hidden"
              >
                <Eye className="h-4 w-4" /> Full Preview
              </button>
              <button
                type="button"
                onClick={handleCustomize}
                className="inline-flex items-center gap-2 rounded-xl border border-gray-300 bg-white px-5 py-3 text-sm font-medium text-gray-700 shadow-md hover:shadow-lg hover:border-purple-300 transition-all"
              >
                <Pencil className="h-4 w-4" /> Customize
              </button>
              <button
                type="button"
                onClick={() => handleUseTemplate(customBlocks, selectedFormatType)}
                className="inline-flex items-center gap-2 rounded-xl bg-purple-600 px-6 py-3 text-sm font-semibold text-white shadow-md hover:shadow-lg hover:bg-purple-700 transition-all"
              >
                Use This Template →
              </button>
            </div>
          )}
            </div>

            <div className="hidden lg:block">
              <TemplatePreviewPanel
                name={selectedTemplateName || undefined}
                description={selectedTemplateName
                  ? `Dummy preview of the selected ${selectedTemplateName} layout for ${words}+ words.`
                  : undefined}
                blocks={customBlocks.length > 0 ? customBlocks : undefined}
                isDefault={selectedIdx != null}
                eyebrow={selectedTemplateName ? getBlogTemplateVisuals(selectedTemplateName).eyebrow : undefined}
                accentClassName={selectedTemplateName ? getBlogTemplateVisuals(selectedTemplateName).accentClassName : undefined}
                stats={selectedTemplateName ? getBlogTemplateVisuals(selectedTemplateName).stats : undefined}
                emptyDescription="Choose any template on the left and we’ll show a dummy layout preview here so the user can compare structure before selecting it."
              />
            </div>
          </div>
        </div>
      </div>

      {/* Template preview modal */}
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
            handleCustomize();
          }}
        />
      )}
    </>
  );
}
