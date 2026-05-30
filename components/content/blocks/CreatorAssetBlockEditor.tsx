'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Badge, BarChart3, Image, Layers, LayoutTemplate, Loader2, PanelsTopLeft, Plus, RefreshCw, Trash2 } from 'lucide-react';
import type { CreatorAssetBlock, CreatorAssetBlockType, CreatorAssetVariantEntry } from '../../../lib/blog/blockTypes';
import { fetchWithAuth } from '../../community-ai/fetchWithAuth';
// Variant Experience Embedding — Writer add-asset flow
import { VariantExperienceEntryCard } from '../../variant-experience/VariantExperienceEntryCard';
import { VariantComparisonView } from '../../variant-experience/VariantComparisonView';
import { useSharedStrategyAnalytics } from '../../variant-experience/VariantContexts';
import type { VariantExecutionResult } from '../../variant-experience/useVariantApi';
import { buildComparisonRowsForStrategy } from '../../../lib/variants/profileAdapter';
import { runVariantFanOut } from '../../../lib/variants/fanOutRunner';
// P2-5 — shared purpose registry (lib/variants/purposeOptions). The
// Writer + Creator + any future surface read from the same module to
// prevent drift.
import { PURPOSE_OPTIONS as SHARED_PURPOSE_OPTIONS } from '../../../lib/variants/purposeOptions';
// Creator Company-Context Strategy Bridge — Phase 3. Picker reads the
// company-reordered options when available, falls back to native order
// when not.
import { useRecommendedPurposeOptions } from '../../variant-experience/useRecommendedPurposeOptions';
import { apiFetch } from '../../../lib/apiFetch';
import {
  annotateVariantsWithMetrics,
  applyFanOutToBlock,
  blockHasVariants,
  clearVariantsOnBlock,
  selectVariantOnBlock,
} from '../../../lib/variants/writerVariantStore';

type CreatorAssetRecord = {
  id: string;
  creatorType: string;
  title: string;
  url?: string;
  files?: string[];
  previewKind?: string;
  blockTemplateId?: string;
  metadata?: Record<string, unknown>;
  createdAt?: string;
};

type Props = {
  block: CreatorAssetBlock;
  companyId?: string;
  onChange: (block: CreatorAssetBlock) => void;
  /** P1-5 — parent surface (post / thread) supplies its title here so
   *  the Writer's variant brief defaults `topic` to it without
   *  forcing the operator to re-type. Operator can still edit. */
  parentContext?: {
    title?: string;
    objective?: string;
    audience?: string;
  };
};

// Required minimum of a brief the Writer's direct fan-out path needs.
// The Writer doesn't collect the rich creator-card answers the
// dedicated Creator page does — operators get a one-textarea brief
// inline so the fan-out request still carries enough context to
// satisfy the existing generation endpoint.
type WriterBriefInputs = {
  topic: string;
  objective: string;
  audience: string;
};

// Taxonomy consolidation — primary picker chips reduced to 3 main
// types (plus brand_card which is a canonical writer-side subtype, not
// part of the banner/slider consolidation). Operators wanting a wide
// banner pick Image → Wide Banner layout; operators wanting a slider
// pick Carousel → Widescreen Presentation layout. Historical
// banner / slider creator_assets rows still load + render normally —
// the API alias map and `assetLabel()` still recognize them; only
// the AUTHORING entry points are consolidated.
const ASSET_TYPES: Array<{ type: CreatorAssetBlockType; label: string; description: string; Icon: typeof Image; route: string }> = [
  { type: 'supporting_image', label: 'Image', description: 'Static visual — promotional, quote, educational, brand focus, or wide banner', Icon: Image, route: 'image' },
  { type: 'carousel', label: 'Carousel', description: 'Multi-slide asset — standard carousel or widescreen presentation deck', Icon: PanelsTopLeft, route: 'carousel' },
  { type: 'infographic', label: 'Infographic', description: 'Statistics, process, timeline, comparison, framework, or roadmap', Icon: BarChart3, route: 'infographic' },
  { type: 'brand_card', label: 'Brand Card', description: 'Quote, proof, or branded authority card', Icon: Badge, route: 'image' },
];

function previewUrl(asset: CreatorAssetRecord | CreatorAssetBlock): string {
  return asset.url || (Array.isArray(asset.files) ? asset.files.find(Boolean) || '' : '');
}

function captionFromAsset(asset: CreatorAssetRecord): string {
  const metadata = asset.metadata || {};
  const packaging = metadata.packaging && typeof metadata.packaging === 'object' ? metadata.packaging as Record<string, unknown> : {};
  return typeof packaging.caption === 'string' ? packaging.caption : '';
}

export function CreatorAssetBlockEditor({ block, companyId, onChange, parentContext }: Props) {
  const [selectedType, setSelectedType] = useState<CreatorAssetBlockType>(block.creatorType || 'supporting_image');
  const [assets, setAssets] = useState<CreatorAssetRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedTypeMeta = useMemo(
    () => ASSET_TYPES.find((item) => item.type === selectedType) || ASSET_TYPES[0],
    [selectedType],
  );
  const SelectedTypeIcon = selectedTypeMeta.Icon;

  const loadAssets = useCallback(async (type: CreatorAssetBlockType) => {
    if (!companyId) {
      setAssets([]);
      setError('Select a company to browse saved Creator assets.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        company_id: companyId,
        creator_type: type,
        limit: '48',
      });
      const response = await fetchWithAuth(`/api/creator-assets?${params.toString()}`);
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error || 'Failed to load Creator assets.');
      setAssets(Array.isArray(data.assets) ? data.assets : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load Creator assets.');
      setAssets([]);
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => {
    void loadAssets(selectedType);
  }, [loadAssets, selectedType]);

  const selectAsset = (asset: CreatorAssetRecord) => {
    onChange({
      ...block,
      creatorType: selectedType,
      assetId: asset.id,
      title: asset.title,
      url: asset.url,
      files: Array.isArray(asset.files) ? asset.files.filter(Boolean) : [],
      previewKind: asset.previewKind,
      caption: captionFromAsset(asset),
      blockTemplateId: asset.blockTemplateId,
      metadata: asset.metadata || {},
    });
  };

  const deleteAsset = async (asset: CreatorAssetRecord) => {
    if (typeof window === 'undefined') return;
    if (!companyId) {
      window.alert('Select a company before deleting assets.');
      return;
    }
    if (!window.confirm(`Delete "${asset.title}"? This cannot be undone.`)) return;
    try {
      const url = `/api/creator-assets?company_id=${encodeURIComponent(companyId)}&id=${encodeURIComponent(asset.id)}`;
      const res = await fetchWithAuth(url, {
        method: 'DELETE',
        headers: { Accept: 'application/json' },
      });
      if (!res.ok) {
        const raw = await res.text().catch(() => '');
        let parsedError: string | null = null;
        try {
          const json = raw ? JSON.parse(raw) : null;
          parsedError = json && typeof json.error === 'string' ? json.error : null;
        } catch { /* not JSON */ }
        const isHtml = !parsedError && /^\s*<(!doctype|html)/i.test(raw);
        const diagnostic = isHtml
          ? 'dev server is serving an HTML page instead of JSON. Save any file in the editor to trigger a recompile, then try again.'
          : (parsedError || `server returned HTTP ${res.status}.`);
        window.alert(`Failed to delete asset — ${diagnostic}`);
        return;
      }
      // Drop the deleted asset from local state. If the currently-
      // selected block referenced this asset, clear the block too so
      // the editor doesn't keep a dead reference.
      setAssets((prev) => prev.filter((row) => row.id !== asset.id));
      if (block.assetId === asset.id) {
        onChange({
          ...block,
          assetId: undefined,
          title: '',
          url: undefined,
          files: [],
          previewKind: undefined,
          caption: undefined,
          blockTemplateId: undefined,
          metadata: {},
        });
      }
    } catch (err) {
      window.alert(err instanceof Error ? `Failed to delete asset: ${err.message}` : 'Failed to delete asset. Please try again.');
    }
  };

  const createHref = `/command-center/creator-content/${selectedTypeMeta.route}`;
  const currentPreview = previewUrl(block);

  return (
    <div className="space-y-4">
      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Asset type</p>
        <div className="grid gap-2 grid-cols-3 sm:grid-cols-6">
          {ASSET_TYPES.map(({ type, label, Icon }) => (
            <button
              key={type}
              type="button"
              onClick={() => {
                setSelectedType(type);
                if (block.creatorType !== type) {
                  onChange({
                    ...block,
                    creatorType: type,
                    assetId: undefined,
                    title: '',
                    url: undefined,
                    files: [],
                    previewKind: undefined,
                    caption: undefined,
                    blockTemplateId: undefined,
                    metadata: {},
                  });
                }
              }}
              className={`flex min-h-[58px] flex-col items-center justify-center gap-1 rounded-lg border px-2 py-2 text-xs font-semibold transition-colors ${
                selectedType === type
                  ? 'border-violet-400 bg-violet-50 text-violet-800'
                  : 'border-gray-200 bg-white text-gray-600 hover:border-violet-200 hover:bg-violet-50/50'
              }`}
            >
              <Icon className="h-4 w-4" />
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Variant Experience Embedding (PHASE 3) — surfaces variant
          planner + comparison view when the operator has picked
          Image, Carousel, or Infographic. Brand Card uses the image
          renderer but is a specialized writer-side subtype, so we
          skip it here. */}
      {(selectedType === 'supporting_image' || selectedType === 'carousel' || selectedType === 'infographic') ? (
        <WriterVariantSection
          companyId={companyId ?? ''}
          creatorType={selectedType === 'supporting_image' ? 'image' : selectedType}
          block={block}
          onChange={onChange}
          parentContext={parentContext}
        />
      ) : null}

      {block.assetId && (
        <div className="rounded-lg border border-violet-100 bg-violet-50/60 p-3">
          <div className="flex gap-3">
            {currentPreview ? (
              <img src={currentPreview} alt={block.title || 'Selected asset'} className="h-20 w-24 rounded-md object-cover" />
            ) : (
              <div className="flex h-20 w-24 items-center justify-center rounded-md bg-white text-violet-500">
                <SelectedTypeIcon className="h-6 w-6" />
              </div>
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-gray-900">{block.title || 'Selected Creator asset'}</p>
              <p className="mt-1 text-xs text-gray-500">{selectedTypeMeta.label}{block.previewKind ? ` - ${block.previewKind.replace(/_/g, ' ')}` : ''}</p>
              {block.caption && <p className="mt-1 line-clamp-2 text-xs text-gray-600">{block.caption}</p>}
            </div>
          </div>
        </div>
      )}

      {/* Repository — collapsed by default. The full gallery grid is
          tall (especially with many saved assets), so it dominated
          the block. Hidden behind a single-line header that the
          operator clicks to expand when they're ready to browse and
          pick. `open` is uncontrolled so each block-instance tracks
          its own state without React plumbing. */}
      <details className="rounded-xl border border-gray-200 bg-gray-50 group">
        <summary className="flex cursor-pointer items-center justify-between gap-2 px-3 py-2 list-none [&::-webkit-details-marker]:hidden">
          <div className="flex items-center gap-2">
            <span className="text-gray-400 transition-transform group-open:rotate-90 select-none">▸</span>
            <div>
              <p className="text-sm font-semibold text-gray-900">{selectedTypeMeta.label} repository</p>
              <p className="text-xs text-gray-500">{selectedTypeMeta.description}{assets.length > 0 ? ` · ${assets.length} saved` : ''}</p>
            </div>
          </div>
          <div className="flex gap-2" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              onClick={() => void loadAssets(selectedType)}
              className="inline-flex items-center gap-1 rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-gray-600 hover:bg-gray-100"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Refresh
            </button>
            <a
              href={createHref}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 rounded-md bg-violet-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-violet-700"
            >
              <Plus className="h-3.5 w-3.5" />
              Create
            </a>
          </div>
        </summary>

        <div className="px-3 pb-3">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-8 text-sm text-gray-500">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading saved assets...
          </div>
        ) : error ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">{error}</div>
        ) : assets.length === 0 ? (
          <div className="rounded-lg border border-dashed border-gray-300 bg-white p-5 text-center">
            <SelectedTypeIcon className="mx-auto h-6 w-6 text-gray-400" />
            <p className="mt-2 text-sm font-medium text-gray-700">No saved {selectedTypeMeta.label.toLowerCase()} assets yet.</p>
            <p className="mt-1 text-xs text-gray-500">Create one in Creator Content, save it as an asset, then return here and refresh.</p>
          </div>
        ) : (
          <div className="grid max-h-80 gap-2 overflow-y-auto sm:grid-cols-2 lg:grid-cols-3">
            {assets.map((asset) => {
              const isSelected = block.assetId === asset.id;
              const url = previewUrl(asset);
              return (
                <div
                  key={asset.id}
                  className={`group relative overflow-hidden rounded-lg border bg-white transition-all ${
                    isSelected ? 'border-violet-500 ring-2 ring-violet-200' : 'border-gray-200 hover:border-violet-300 hover:shadow-sm'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => selectAsset(asset)}
                    className="block w-full text-left"
                  >
                    {url ? (
                      <img src={url} alt={asset.title} className="h-28 w-full object-cover" />
                    ) : (
                      <div className="flex h-28 items-center justify-center bg-gray-100 text-gray-400">
                        <SelectedTypeIcon className="h-6 w-6" />
                      </div>
                    )}
                    <div className="p-2">
                      <p className="truncate text-xs font-semibold text-gray-900">{asset.title}</p>
                      <p className="mt-0.5 truncate text-[11px] text-gray-500">{asset.previewKind || asset.creatorType}</p>
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      void deleteAsset(asset);
                    }}
                    aria-label={`Delete ${asset.title}`}
                    title="Delete asset"
                    className="absolute right-1.5 top-1.5 z-10 inline-flex h-7 w-7 items-center justify-center rounded-full border border-gray-200 bg-white/95 text-gray-500 opacity-0 shadow-sm transition-opacity hover:border-red-300 hover:bg-red-50 hover:text-red-600 focus:opacity-100 group-hover:opacity-100"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              );
            })}
          </div>
        )}
        </div>
      </details>
    </div>
  );
}

/* ── Writer Variant Section ──────────────────────────────────────────
 * Drop-in variant subsurface for the Writer add-asset flow. Renders:
 *
 *   - A small purpose picker (the Writer flow doesn't collect a
 *     purpose subtype, so we surface the registry's allowed values
 *     inline). When the operator picks a purpose, the variant entry
 *     card resolves a strategy id and the comparison view paints
 *     V1 / V2 / V3 with performance + render-profile data.
 *
 *   - VariantExperienceEntryCard — operator plans variants and
 *     follows the "Continue in dashboard" CTA (or sees the inline
 *     plan preview).
 *
 *   - VariantComparisonView — V1/V2/V3 side-by-side with profile
 *     strings + engagement / save / share rates when available.
 *
 * Renders nothing when companyId is missing — the Writer's main
 * picker is still functional in unauthenticated states.
 */
// P2-5 — purpose options live in lib/variants/purposeOptions. The
// local alias keeps the existing call sites working with a single
// rename in case the shared module's surface changes.
const PURPOSE_OPTIONS_BY_TYPE = SHARED_PURPOSE_OPTIONS;

function WriterVariantSection({ companyId, creatorType, block, onChange, parentContext }: {
  companyId: string;
  creatorType: 'image' | 'carousel' | 'infographic';
  block: CreatorAssetBlock;
  onChange: (block: CreatorAssetBlock) => void;
  parentContext?: { title?: string; objective?: string; audience?: string };
}) {
  // Creator Company-Context Strategy Bridge — Phase 3. The picker now
  // reads the company-context-reordered options when available;
  // otherwise it falls back to the native PURPOSE_OPTIONS order.
  const recommendedOptions = useRecommendedPurposeOptions({ companyId, enabled: !!companyId });
  // Creator Compliance-Aware Strategy Governance — Phase 3+5. Governance
  // overlay reclassifies each option as recommended/allowed/restricted.
  // The picker hides restricted options by default; operators can reveal
  // them via the "Show restricted strategies" toggle, which fires an
  // audit event for the compliance trail.
  const governancePerType = recommendedOptions.governance.per_content_type[creatorType];
  const allOptionsForType = governancePerType.options;
  const restrictedForType = governancePerType.restricted;
  const hasRestricted = restrictedForType.length > 0;
  const [showRestricted, setShowRestricted] = useState<boolean>(false);
  // Visible options = all when revealed, otherwise exclude restricted.
  const visibleOptions = showRestricted
    ? allOptionsForType
    : allOptionsForType.filter((o) => o.classification !== 'restricted');
  // Fallback to native ordering when governance fallback yields zero
  // visible options (defensive).
  const optionsForType = visibleOptions.length > 0
    ? visibleOptions
    : recommendedOptions.recommended[creatorType];
  // Pre-select the governance-policy default when present; otherwise
  // the top-ranked recommendation; otherwise the native first option.
  const initialPurpose =
    governancePerType.default_strategy_override
      ?? optionsForType[0]?.value
      ?? PURPOSE_OPTIONS_BY_TYPE[creatorType][0].value;
  const [purpose, setPurpose] = useState<string>(initialPurpose);
  // When the governance + recommended order arrives AFTER initial
  // render and the operator has not yet touched the picker, swap to
  // the policy default (or top-ranked recommendation). Operator edits
  // stick — "untouched" is detected by comparing against the native
  // first entry.
  useEffect(() => {
    if (recommendedOptions.loading) return;
    if (purpose !== PURPOSE_OPTIONS_BY_TYPE[creatorType][0].value) return;
    const policyDefault = governancePerType.default_strategy_override;
    const top = policyDefault ?? optionsForType[0]?.value;
    if (top && top !== purpose) setPurpose(top);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recommendedOptions.loading, recommendedOptions.has_profile, creatorType]);
  // Reset showRestricted when content type changes.
  useEffect(() => {
    setShowRestricted(false);
  }, [creatorType]);
  // Fire the audit event when the operator picks a restricted strategy.
  const handlePurposeChange = (next: string) => {
    setPurpose(next);
    const selected = allOptionsForType.find((o) => o.value === next);
    if (selected && selected.classification === 'restricted' && selected.restriction_reason && companyId) {
      void apiFetch('/api/creator-intelligence/restricted-strategy-audit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event: 'selected',
          company_id: companyId,
          industry: recommendedOptions.governance.industry,
          risk_level: recommendedOptions.governance.risk_level,
          content_type: creatorType,
          strategy_id: next,
          restriction_reason: selected.restriction_reason,
        }),
      }).catch(() => { /* best-effort */ });
    }
  };
  const handleRevealRestricted = () => {
    setShowRestricted(true);
    if (companyId) {
      void apiFetch('/api/creator-intelligence/restricted-strategy-audit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event: 'revealed',
          company_id: companyId,
          industry: recommendedOptions.governance.industry,
          risk_level: recommendedOptions.governance.risk_level,
          content_type: creatorType,
        }),
      }).catch(() => { /* best-effort */ });
    }
  };
  const [plan, setPlan] = useState<VariantExecutionResult | null>(null);
  // P1-5 — inherit topic / objective / audience from the surrounding
  // post or thread when the operator opens this section. We seed via
  // useState's initializer so the value populates on first render.
  // The operator can still edit each field directly; a refresh path
  // below also pulls the latest parent title into empty topic fields
  // when the parent title arrives after the block was added.
  const [brief, setBrief] = useState<WriterBriefInputs>(() => ({
    topic: parentContext?.title ?? '',
    objective: parentContext?.objective ?? '',
    audience: parentContext?.audience ?? '',
  }));
  // Pull in the parent title when it changes IF the topic is currently
  // empty (operator hasn't typed anything yet). Avoids clobbering
  // operator edits while still inheriting late-arriving titles.
  useEffect(() => {
    const incoming = parentContext?.title ?? '';
    if (!incoming) return;
    setBrief((current) => (current.topic.trim() === '' ? { ...current, topic: incoming } : current));
  }, [parentContext?.title]);
  const [fanOutInFlight, setFanOutInFlight] = useState(false);
  const [fanOutSummary, setFanOutSummary] = useState<string | null>(null);
  // P2-3 — lazy analytics. The variant section ships collapsed inside
  // a `<details>` element. We only fetch analytics when the operator
  // opens it (sets sectionOpened to true) — the inert collapsed state
  // costs zero network. Once opened, subsequent opens reuse the
  // cached data via the provider (P2-1).
  const [sectionOpened, setSectionOpened] = useState(false);
  const analytics = useSharedStrategyAnalytics({ companyId, enabled: sectionOpened });
  // Strategy id resolution is centralized in lib/variants so the
  // Writer + Creator stay consistent.
  const strategyId = (() => {
    if (!purpose) return null;
    if (creatorType === 'infographic') return `infographic:${purpose}`;
    return `${creatorType}:${purpose}-${creatorType}`;
  })();
  // Reset plan + fan-out state when the operator switches scope.
  useEffect(() => { setPlan(null); setFanOutSummary(null); }, [creatorType, purpose]);
  // Comparison rows — populated via the profile adapter.
  const comparisonRows = useMemo(() => {
    if (!strategyId) return [];
    return buildComparisonRowsForStrategy({ strategyId, analytics: analytics.data });
  }, [analytics.data, strategyId]);
  // Variant winner for the active strategy — annotates each variant
  // entry's metrics + powers the "Winner" badge in the preview grid.
  const winnerForStrategy = useMemo(() => {
    if (!strategyId) return null;
    return analytics.data?.execution.winner_recommendations.find((w) => w.strategy_id === strategyId)
      ?? analytics.data?.variants.winners.find((w) => w.strategy_id === strategyId)
      ?? null;
  }, [analytics.data, strategyId]);
  // Block already carries variant collection? Use it. Otherwise show
  // empty grid until fan-out runs.
  const annotatedVariants = useMemo(
    () => annotateVariantsWithMetrics(block.variants ?? [], winnerForStrategy),
    [block.variants, winnerForStrategy],
  );

  const handleFanOut = async (currentPlan: VariantExecutionResult) => {
    if (!companyId || !strategyId) return;
    if (!brief.topic.trim()) {
      setFanOutSummary('Add a topic to the brief before fanning out.');
      return;
    }
    setFanOutInFlight(true);
    setFanOutSummary(null);
    try {
      // The Writer's brief is a thin shell of the Creator's
      // creator_card. The renderer endpoint accepts the same shape —
      // missing fields fall through to the strategy + brand kit
      // resolution path.
      const basePayload: Record<string, unknown> = {
        company_id: companyId,
        creator_type: creatorType,
        content_type: creatorType === 'image' ? 'image' : creatorType,
        topic: brief.topic.trim(),
        objective: brief.objective.trim(),
        audience: brief.audience.trim(),
        summary: brief.topic.trim(),
        creator_card: {
          objective: brief.objective.trim(),
          audience: brief.audience.trim(),
          asset_type: creatorType,
          purpose: purpose,
          subtype: purpose,
        },
        target_platforms: ['linkedin'],
      };
      const result = await runVariantFanOut({
        companyId,
        plan: currentPlan,
        request: { basePayload },
      });
      const nextBlock = applyFanOutToBlock(block, result);
      onChange(nextBlock);
      setFanOutSummary(
        `${result.successCount} of ${result.outcomes.length} variants generated`
        + (result.failureCount > 0 ? ` · ${result.failureCount} failed` : ''),
      );
    } catch (err) {
      setFanOutSummary(err instanceof Error ? err.message : 'Variant fan-out failed.');
    } finally {
      setFanOutInFlight(false);
    }
  };

  const handleSelect = (variantId: string) => {
    onChange(selectVariantOnBlock(block, variantId));
  };

  const handleClear = () => {
    onChange(clearVariantsOnBlock(block));
    setPlan(null);
    setFanOutSummary(null);
  };

  if (!companyId) return null;
  return (
    <details
      className="rounded-xl border border-indigo-100 bg-indigo-50/30 group"
      onToggle={(e) => setSectionOpened((e.target as HTMLDetailsElement).open)}
    >
      <summary className="flex cursor-pointer items-center justify-between gap-2 px-3 py-2 list-none [&::-webkit-details-marker]:hidden">
        <div className="flex items-center gap-2">
          <span className="text-gray-400 transition-transform group-open:rotate-90 select-none">▸</span>
          <div>
            <p className="text-sm font-semibold text-gray-900">Variant Experience</p>
            <p className="text-xs text-gray-500">
              Plan V1 / V2 / V3 for this {creatorType} and generate alternatives directly.
            </p>
          </div>
        </div>
        {blockHasVariants(block) ? (
          <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-indigo-700">
            {(block.variants ?? []).length} variants attached
          </span>
        ) : null}
      </summary>
      <div className="space-y-3 px-3 pb-3">
        <div>
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">Purpose</p>
          <select
            value={purpose}
            onChange={(e) => handlePurposeChange(e.target.value)}
            className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          >
            {optionsForType.map((opt) => {
              const isGoverned = 'classification' in opt;
              const cls = isGoverned ? (opt as any).classification : 'allowed';
              const learningApplied = (opt as any).learning_applied === true;
              const cls_tag =
                cls === 'restricted' ? ' · Restricted'
                  : cls === 'recommended' ? ' · Recommended'
                    : opt.score > 0 ? ' · Recommended'
                      : '';
              // Creator Validation P1 Remediation — Phase 3. Surface the
              // learning signal alongside the governance classification
              // so operators see which strategies are trending in their
              // own org's analytics history.
              const learning_tag = learningApplied ? ' · Trending' : '';
              return (
                <option key={opt.value} value={opt.value}>
                  {opt.label}{cls_tag}{learning_tag}
                </option>
              );
            })}
          </select>
          {/* Reveal toggle for restricted strategies. Hidden when no
              policy applies. */}
          {hasRestricted ? (
            !showRestricted ? (
              <button
                type="button"
                onClick={handleRevealRestricted}
                className="mt-2 text-[11px] font-semibold text-amber-700 underline hover:text-amber-800"
              >
                Show restricted strategies ({restrictedForType.length})
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setShowRestricted(false)}
                className="mt-2 text-[11px] font-semibold text-gray-600 underline hover:text-gray-800"
              >
                Hide restricted strategies
              </button>
            )
          ) : null}
          {/* Required warnings — rendered when policy applies. */}
          {recommendedOptions.governance.required_warnings.length > 0 ? (
            <ul className="mt-2 space-y-0.5 text-[11px] text-amber-800">
              {recommendedOptions.governance.required_warnings.map((w, i) => (
                <li key={i}>⚠ {w}</li>
              ))}
            </ul>
          ) : null}
          {/* Creator Validation P2 Hardening — Phase 4. Industry
              Contributions panel. Rendered when at least one industry
              rule fired; collapsed for cold-start companies. */}
          {recommendedOptions.industry_analysis.all.length > 0 ? (
            <details className="mt-2 text-[11px] text-gray-600">
              <summary className="cursor-pointer font-semibold text-gray-700">
                Industry Contributions
                {recommendedOptions.industry_analysis.is_multi_industry ? (
                  <span className="ml-1 rounded-full bg-indigo-50 px-1.5 py-0.5 text-[10px] font-medium text-indigo-700">
                    Multi-industry
                  </span>
                ) : null}
              </summary>
              <ul className="mt-1 space-y-0.5 pl-2">
                {recommendedOptions.industry_analysis.all.map((c) => (
                  <li key={c.industry}>
                    <span className="font-medium">{c.label}</span>{' '}
                    <span className="text-emerald-700">(+{c.total_score})</span>
                    {c.matched_triggers.length > 0 ? (
                      <span className="text-gray-400"> · matched: {c.matched_triggers.join(', ')}</span>
                    ) : null}
                  </li>
                ))}
                <li className="mt-1 font-semibold text-gray-800">
                  Combined influence: +{recommendedOptions.industry_analysis.combined_influence}
                </li>
              </ul>
            </details>
          ) : null}
          {(() => {
            const selected = allOptionsForType.find((o) => o.value === purpose);
            if (!selected) return null;
            // Restricted: explain why it's restricted.
            if (selected.classification === 'restricted' && selected.restriction_reason) {
              return (
                <p className="mt-1 text-[11px] font-medium text-rose-700">
                  <span className="font-semibold">Restricted because:</span>{' '}
                  {selected.restriction_reason}
                </p>
              );
            }
            // Deprioritized: surface the reason but don't color-warn.
            if (selected.deprioritized && selected.restriction_reason) {
              return (
                <p className="mt-1 text-[11px] text-amber-700">
                  <span className="font-semibold">Note:</span>{' '}
                  {selected.restriction_reason}
                </p>
              );
            }
            // Recommended: surface the recommendation reasons.
            // Creator Validation P1 Remediation — Phase 3. Also surface
            // the learning_reasons separately so operators can see WHY
            // a strategy is trending (e.g. "Above-average engagement
            // rate vs lane median").
            const learningReasons = ((selected as any).learning_reasons as string[] | undefined) ?? [];
            if (selected.reasons.length > 0 || learningReasons.length > 0) {
              return (
                <div className="mt-1 space-y-0.5">
                  {selected.reasons.length > 0 ? (
                    <p className="text-[11px] text-gray-500">
                      <span className="font-semibold text-gray-600">Recommended because:</span>{' '}
                      {selected.reasons.join(' · ')}
                    </p>
                  ) : null}
                  {learningReasons.length > 0 ? (
                    <p className="text-[11px] text-emerald-700">
                      <span className="font-semibold">Performance:</span>{' '}
                      {learningReasons.join(' · ')}
                    </p>
                  ) : null}
                </div>
              );
            }
            return null;
          })()}
        </div>
        {strategyId ? (
          <>
            <VariantExperienceEntryCard
              companyId={companyId}
              strategyId={strategyId}
              contentType={creatorType}
              onPlanComplete={setPlan}
            />
            {/* Writer brief — minimum context the fan-out runner
                needs. Shown when the plan returns >1 decision so
                operators don't see it for single-variant pins. */}
            {plan && plan.decisions.length > 1 ? (
              <div className="rounded-lg border border-indigo-200 bg-white p-3 space-y-2">
                <p className="text-xs font-semibold text-indigo-700">Brief for fan-out</p>
                <input
                  type="text"
                  value={brief.topic}
                  onChange={(e) => setBrief((b) => ({ ...b, topic: e.target.value }))}
                  placeholder="Topic (required)"
                  className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
                <input
                  type="text"
                  value={brief.objective}
                  onChange={(e) => setBrief((b) => ({ ...b, objective: e.target.value }))}
                  placeholder="Objective"
                  className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
                <input
                  type="text"
                  value={brief.audience}
                  onChange={(e) => setBrief((b) => ({ ...b, audience: e.target.value }))}
                  placeholder="Audience"
                  className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void handleFanOut(plan)}
                    disabled={fanOutInFlight || !brief.topic.trim()}
                    className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-indigo-500 disabled:opacity-50"
                  >
                    {fanOutInFlight ? 'Generating…' : `Generate ${plan.decisions.length} variants`}
                  </button>
                  {fanOutSummary ? (
                    <span className="text-xs text-gray-600">{fanOutSummary}</span>
                  ) : null}
                </div>
                <p className="text-[11px] italic text-gray-500">
                  Fan-out runs through the existing generation pipeline — every variant goes through governance + QA + moderation.
                </p>
              </div>
            ) : null}
            {/* PHASE 5 + 6: Generated Variants preview + selection */}
            {blockHasVariants(block) ? (
              <WriterVariantPreview
                variants={annotatedVariants}
                selectedVariantId={block.selectedVariantId ?? null}
                winnerVariantId={winnerForStrategy?.winner?.variant_id ?? null}
                publishAllVariants={Boolean(block.publishAllVariants)}
                onTogglePublishAll={(next) => onChange({ ...block, publishAllVariants: next })}
                onSelect={handleSelect}
                onClear={handleClear}
              />
            ) : null}
            {comparisonRows.length > 0 ? (
              <VariantComparisonView strategyId={strategyId} rows={comparisonRows} />
            ) : null}
          </>
        ) : null}
      </div>
    </details>
  );
}

function WriterVariantPreview({ variants, selectedVariantId, winnerVariantId, publishAllVariants, onTogglePublishAll, onSelect, onClear }: {
  variants: ReadonlyArray<CreatorAssetVariantEntry>;
  selectedVariantId: string | null;
  winnerVariantId: string | null;
  publishAllVariants: boolean;
  onTogglePublishAll: (next: boolean) => void;
  onSelect: (variantId: string) => void;
  onClear: () => void;
}) {
  return (
    <div className="rounded-lg border border-indigo-200 bg-white p-3 space-y-2">
      <header className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold text-indigo-700">Generated variants</p>
        <div className="flex items-center gap-2">
          {/* P3-5 — multi-variant publish toggle. When ON, the
              publisher iterates `block.variants[]` and attaches every
              successfully-generated variant as its own asset. When
              OFF (default), only the selected primary publishes. */}
          <label className="flex items-center gap-1 text-[11px] font-semibold text-indigo-700">
            <input
              type="checkbox"
              checked={publishAllVariants}
              onChange={(e) => onTogglePublishAll(e.target.checked)}
              className="h-3 w-3 rounded border-indigo-300 text-indigo-600 focus:ring-indigo-500"
            />
            Publish all
          </label>
          <button
            type="button"
            onClick={onClear}
            className="text-[11px] font-semibold text-gray-500 hover:text-rose-700"
          >
            Clear variants
          </button>
        </div>
      </header>
      <div className="grid gap-2 sm:grid-cols-3">
        {variants.map((variant) => {
          const isSelected = variant.variant_id === selectedVariantId;
          const isWinner = variant.variant_id === winnerVariantId;
          return (
            <button
              type="button"
              key={variant.variant_id}
              onClick={() => variant.state === 'generated' ? onSelect(variant.variant_id) : undefined}
              disabled={variant.state !== 'generated'}
              className={`flex flex-col text-left rounded-md border bg-white shadow-sm transition disabled:opacity-50 ${
                isSelected ? 'border-indigo-500 ring-2 ring-indigo-200' : 'border-gray-200 hover:border-indigo-300'
              }`}
            >
              <div className="relative">
                {variant.url ? (
                  <img src={variant.url} alt={variant.variant_id} className="h-24 w-full rounded-t-md object-cover" />
                ) : (
                  <div className="flex h-24 w-full items-center justify-center rounded-t-md bg-gray-50 text-xs text-gray-400">
                    {variant.state === 'failed' ? 'Generation failed' : 'No preview'}
                  </div>
                )}
                {isWinner ? (
                  <span className="absolute left-1 top-1 rounded-full bg-emerald-600 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-white">
                    Winner
                  </span>
                ) : null}
                {isSelected ? (
                  <span className="absolute right-1 top-1 rounded-full bg-indigo-600 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-white">
                    Selected
                  </span>
                ) : null}
              </div>
              <div className="px-2 py-2">
                <p className="text-xs font-semibold text-gray-900">{variant.variant_family.toUpperCase()}</p>
                {variant.metrics ? (
                  <p className="mt-0.5 text-[11px] text-gray-600">
                    {((variant.metrics.engagementRate ?? 0) * 100).toFixed(1)}% engagement · n={Math.round(variant.metrics.sampleSize ?? 0)}
                  </p>
                ) : (
                  <p className="mt-0.5 text-[11px] italic text-gray-500">No metrics yet</p>
                )}
              </div>
            </button>
          );
        })}
      </div>
      <p className="text-[11px] italic text-gray-500">
        Click a variant to make it the primary asset for this block. Alternatives remain attached so you can attach multiple at publish time.
      </p>
    </div>
  );
}
