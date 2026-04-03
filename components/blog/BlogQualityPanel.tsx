'use client';

import React, { useMemo, useState } from 'react';
import {
  CheckCircle2,
  XCircle,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  BarChart2,
} from 'lucide-react';
import type { ContentBlock } from '../../lib/blog/blockTypes';
import type { FormMeta } from '../../lib/blog/blogValidation';
import { calculateQualityScore, getPublishBlockers } from '../../lib/blog/blogValidation';

export type ImproveArea = 'structure' | 'depth' | 'seo' | 'geo' | 'linking';

// ── Score colour ──────────────────────────────────────────────────────────────

function scoreColour(n: number): string {
  if (n >= 75) return '#16a34a';
  if (n >= 50) return '#d97706';
  return '#dc2626';
}

function scoreLabel(n: number): string {
  if (n >= 80) return 'Excellent';
  if (n >= 65) return 'Good';
  if (n >= 45) return 'Fair';
  return 'Needs work';
}

// ── Mini progress bar ─────────────────────────────────────────────────────────

function MiniBar({ value, max, colour }: { value: number; max: number; colour: string }) {
  const pct = Math.round((value / max) * 100);
  return (
    <div className="h-1.5 w-full rounded-full bg-gray-100">
      <div
        className="h-1.5 rounded-full transition-all"
        style={{ width: `${pct}%`, backgroundColor: colour }}
      />
    </div>
  );
}

// ── Collapsible section ───────────────────────────────────────────────────────

function Section({
  title,
  score,
  max,
  colour,
  onImprove,
  children,
}: {
  title: string;
  score: number;
  max: number;
  colour: string;
  onImprove?: () => void;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(true);
  const needsImprovement = score < max;
  return (
    <div className="border border-gray-100 rounded-xl overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-2 px-3 py-2.5 bg-gray-50 hover:bg-gray-100 transition-colors"
      >
        <span className="text-xs font-semibold text-gray-700">{title}</span>
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold" style={{ color: colour }}>
            {score}/{max}
          </span>
          {open ? (
            <ChevronUp className="h-3.5 w-3.5 text-gray-400" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5 text-gray-400" />
          )}
        </div>
      </button>
      {open && <div className="px-3 py-2.5 space-y-1.5">{children}</div>}
      {open && needsImprovement && onImprove && (
        <div className="px-3 pb-3">
          <button
            type="button"
            onClick={onImprove}
            className="w-full rounded-lg border border-[#0B5ED7]/30 bg-[#0B5ED7]/5 px-2.5 py-1.5 text-[11px] font-semibold text-[#0B5ED7] hover:bg-[#0B5ED7]/10"
          >
            Improve This Section
          </button>
        </div>
      )}
    </div>
  );
}

// ── Check row ─────────────────────────────────────────────────────────────────

function CheckRow({
  ok,
  label,
  warn,
}: {
  ok: boolean;
  label: string;
  warn?: boolean;
}) {
  return (
    <div className="flex items-start gap-2">
      {ok ? (
        <CheckCircle2 className="h-3.5 w-3.5 shrink-0 mt-0.5 text-green-500" />
      ) : warn ? (
        <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5 text-amber-500" />
      ) : (
        <XCircle className="h-3.5 w-3.5 shrink-0 mt-0.5 text-red-500" />
      )}
      <span className={`text-[11px] leading-snug ${ok ? 'text-gray-500' : warn ? 'text-amber-700' : 'text-red-700'}`}>
        {label}
      </span>
    </div>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────

export function BlogQualityPanel({
  blocks,
  formState,
  onImprove,
  onAutoImprove,
  improvingArea,
}: {
  blocks: ContentBlock[];
  formState: FormMeta;
  onImprove?: (area: ImproveArea) => void;
  onAutoImprove?: (area: ImproveArea) => void;
  improvingArea?: ImproveArea | null;
}) {
  const score = useMemo(
    () => calculateQualityScore(blocks, formState),
    [blocks, formState],
  );

  const blockers = getPublishBlockers(score);
  const warnings = score.issues.filter((i) => i.severity === 'warning');
  const { meta, breakdown } = score;
  const colour = scoreColour(score.total);
  const weakAreas = ([
    ['structure', breakdown.structure, 25, 'Structure'],
    ['depth', breakdown.depth, 25, 'Content Depth'],
    ['seo', breakdown.seo, 25, 'SEO'],
    ['geo', breakdown.geo, 15, 'GEO Readiness'],
    ['linking', breakdown.linking, 10, 'Internal Linking'],
  ] as [ImproveArea, number, number, string][]).filter(([, val, max]) => val < max);

  return (
    <div className="space-y-3">
      {/* ── Overall score ────────────────────────────────────────────────── */}
      <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
        <div className="flex items-center gap-2 mb-3">
          <BarChart2 className="h-4 w-4 text-gray-400" />
          <span className="text-xs font-bold uppercase tracking-widest text-gray-500">Quality Score</span>
        </div>

        {/* Big score */}
        <div className="flex items-end gap-2 mb-2">
          <span className="text-4xl font-black leading-none" style={{ color: colour }}>
            {score.total}
          </span>
          <span className="text-lg text-gray-300 font-light mb-0.5">/100</span>
          <span className="ml-auto text-xs font-semibold px-2 py-0.5 rounded-full"
            style={{ backgroundColor: `${colour}15`, color: colour }}>
            {scoreLabel(score.total)}
          </span>
        </div>

        {/* Overall bar */}
        <div className="h-2 w-full rounded-full bg-gray-100 mb-4">
          <div
            className="h-2 rounded-full transition-all duration-500"
            style={{ width: `${score.total}%`, backgroundColor: colour }}
          />
        </div>

        {/* Breakdown bars */}
        <div className="space-y-2">
          {([
            ['Structure', breakdown.structure, 25],
            ['Depth',     breakdown.depth,     25],
            ['SEO',       breakdown.seo,       25],
            ['GEO',       breakdown.geo,       15],
            ['Linking',   breakdown.linking,   10],
          ] as [string, number, number][]).map(([label, val, max]) => {
            const c = scoreColour(Math.round((val / max) * 100));
            return (
              <div key={label} className="flex items-center gap-2">
                <span className="w-14 text-[10px] text-gray-500 shrink-0">{label}</span>
                <div className="flex-1">
                  <MiniBar value={val} max={max} colour={c} />
                </div>
                <span className="w-8 text-right text-[10px] font-medium" style={{ color: c }}>
                  {val}/{max}
                </span>
              </div>
            );
          })}
        </div>

        {/* Blocker / warning summary */}
        {(blockers.length > 0 || warnings.length > 0) && (
          <div className="mt-3 pt-3 border-t border-gray-100 space-y-1">
            {blockers.length > 0 && (
              <p className="text-[10px] font-semibold text-red-600 flex items-center gap-1">
                <XCircle className="h-3 w-3" />
                {blockers.length} error{blockers.length > 1 ? 's' : ''} blocking publish
              </p>
            )}
            {warnings.length > 0 && (
              <p className="text-[10px] text-amber-600 flex items-center gap-1">
                <AlertTriangle className="h-3 w-3" />
                {warnings.length} improvement{warnings.length > 1 ? 's' : ''} suggested
              </p>
            )}
          </div>
        )}

        {weakAreas.length > 0 && (onImprove || onAutoImprove) && (
          <div className="mt-3 pt-3 border-t border-gray-100 space-y-2">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Improve Score Fast</p>
            <div className="space-y-1.5">
              {weakAreas.slice(0, 3).map(([area, val, max, label]) => (
                <button
                  key={area}
                  type="button"
                  onClick={() => (onAutoImprove ? onAutoImprove(area) : onImprove?.(area))}
                  disabled={!!improvingArea}
                  className="flex w-full items-center justify-between rounded-md border border-gray-200 px-2.5 py-1.5 text-left text-[11px] text-gray-700 hover:border-[#0B5ED7]/40 hover:bg-[#0B5ED7]/5"
                >
                  <span>{improvingArea === area ? 'Improving with AI...' : `Improve ${label}`}</span>
                  <span className="text-[10px] text-gray-400">{val}/{max}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ── Structure check ──────────────────────────────────────────────── */}
      <Section
        title="Structure"
        score={breakdown.structure}
        max={25}
        colour={scoreColour(Math.round((breakdown.structure / 25) * 100))}
        onImprove={(onAutoImprove || onImprove) ? () => (onAutoImprove ? onAutoImprove('structure') : onImprove?.('structure')) : undefined}
      >
        <CheckRow ok={meta.h2Count >= 3}   label={`H2 sections: ${meta.h2Count} / 3 required`} warn={meta.h2Count < 3} />
        <CheckRow ok={meta.hasKeyInsights} label="Key Insights block filled"   warn={!meta.hasKeyInsights} />
        <CheckRow ok={meta.hasSummary}     label="Summary block filled"         warn={!meta.hasSummary} />
        <CheckRow ok={meta.hasReferences}  label="References block present"     warn={!meta.hasReferences} />
        {meta.h3Count > 0 && (
          <CheckRow ok label={`${meta.h3Count} H3 sub-heading${meta.h3Count > 1 ? 's' : ''}`} />
        )}
      </Section>

      {/* ── Content depth ────────────────────────────────────────────────── */}
      <Section
        title="Content Depth"
        score={breakdown.depth}
        max={25}
        colour={scoreColour(Math.round((breakdown.depth / 25) * 100))}
        onImprove={(onAutoImprove || onImprove) ? () => (onAutoImprove ? onAutoImprove('depth') : onImprove?.('depth')) : undefined}
      >
        <CheckRow
          ok={meta.wordCount >= 800}
          warn={meta.wordCount < 800}
          label={`${meta.wordCount} words (target: 800+)`}
        />
        <CheckRow
          ok={meta.shortParaCount === 0 && meta.wordCount >= 800}
          warn={meta.shortParaCount > 0 || meta.wordCount < 800}
          label={meta.shortParaCount > 0
            ? `${meta.shortParaCount} thin section${meta.shortParaCount > 1 ? 's' : ''} (< 50 words)`
            : (meta.wordCount < 800
              ? 'No thin sections, but overall length is low — add/expand sections for depth'
              : 'All sections have enough depth')}
        />
      </Section>

      {/* ── SEO check ────────────────────────────────────────────────────── */}
      <Section
        title="SEO"
        score={breakdown.seo}
        max={25}
        colour={scoreColour(Math.round((breakdown.seo / 25) * 100))}
        onImprove={(onAutoImprove || onImprove) ? () => (onAutoImprove ? onAutoImprove('seo') : onImprove?.('seo')) : undefined}
      >
        <CheckRow
          ok={formState.title.length >= 20 && formState.title.length <= 70}
          warn={formState.title.length > 0 && (formState.title.length < 20 || formState.title.length > 70)}
          label={`Title: ${formState.title.length} chars (target 20–70)`}
        />
        <CheckRow
          ok={formState.excerpt.trim().length >= 80}
          warn={formState.excerpt.trim().length > 0 && formState.excerpt.trim().length < 80}
          label={formState.excerpt.trim() ? `Excerpt: ${formState.excerpt.trim().length} chars` : 'Excerpt missing'}
        />
        <CheckRow ok={!!formState.seo_meta_title?.trim()}       warn={!formState.seo_meta_title?.trim()}       label="Custom meta title" />
        <CheckRow ok={!!formState.seo_meta_description?.trim()} warn={!formState.seo_meta_description?.trim()} label="Meta description" />
        <CheckRow ok={meta.imagesMissingAlt === 0}              warn={false}
          label={meta.imagesMissingAlt === 0 ? 'All images have alt text' : `${meta.imagesMissingAlt} image(s) missing alt text`}
        />
      </Section>

      {/* ── GEO readiness ────────────────────────────────────────────────── */}
      <Section
        title="GEO Readiness"
        score={breakdown.geo}
        max={15}
        colour={scoreColour(Math.round((breakdown.geo / 15) * 100))}
        onImprove={(onAutoImprove || onImprove) ? () => (onAutoImprove ? onAutoImprove('geo') : onImprove?.('geo')) : undefined}
      >
        <CheckRow ok={meta.hasKeyInsights} warn={!meta.hasKeyInsights} label="Key Insights (AI extraction target)" />
        <CheckRow ok={meta.hasSummary}     warn={!meta.hasSummary}     label="Article Summary (LLM-readable)" />
        <CheckRow ok={meta.h2Count >= 3}   warn={meta.h2Count < 3}     label="Structured sections (H2 anchors)" />
        <CheckRow
          ok={meta.refsCount >= 3}
          warn={meta.refsCount < 3}
          label={`References: ${meta.refsCount} / 3 (authority signal)`}
        />
      </Section>

      {/* ── Linking ──────────────────────────────────────────────────────── */}
      <Section
        title="Internal Linking"
        score={breakdown.linking}
        max={10}
        colour={scoreColour(Math.round((breakdown.linking / 10) * 100))}
        onImprove={(onAutoImprove || onImprove) ? () => (onAutoImprove ? onAutoImprove('linking') : onImprove?.('linking')) : undefined}
      >
        <CheckRow
          ok={meta.internalLinks >= 2}
          warn={meta.internalLinks < 2}
          label={`${meta.internalLinks} internal link${meta.internalLinks !== 1 ? 's' : ''} (target: 2+)`}
        />
        {meta.internalLinks === 0 && (
          <p className="text-[10px] text-gray-400 pl-5">Add an "Internal Link" block to link to related articles.</p>
        )}
      </Section>
    </div>
  );
}
