'use client';

import React from 'react';
import type { ContentBlock, BlockType } from '../../lib/blog/blockTypes';
import { BLOCK_LABELS } from '../../lib/blog/blockTypes';

type Props = {
  name: string;
  description: string;
  blocks: ContentBlock[];
  usageCount?: number;
  isDefault?: boolean;
  selected?: boolean;
  onClick: () => void;
  eyebrow?: string;
  accentClassName?: string;
  surfaceClassName?: string;
  badgeClassName?: string;
  stats?: Array<{ label: string; value: string }>;
};

const MINI_COLORS: Record<BlockType, string> = {
  paragraph:     'bg-gray-200',
  heading:       'bg-indigo-300',
  key_insights:  'bg-blue-300',
  callout:       'bg-amber-300',
  quote:         'bg-violet-300',
  image:         'bg-emerald-300',
  media:         'bg-pink-300',
  divider:       'bg-gray-300',
  list:          'bg-orange-300',
  references:    'bg-teal-300',
  internal_link: 'bg-sky-300',
  summary:       'bg-blue-300',
  columns:       'bg-cyan-300',
};

const LEGEND_ITEMS: { type: BlockType; label: string }[] = [
  { type: 'heading',      label: 'Heading' },
  { type: 'paragraph',    label: 'Text' },
  { type: 'key_insights', label: 'Key Insights' },
  { type: 'image',        label: 'Image' },
  { type: 'list',         label: 'List' },
  { type: 'callout',      label: 'Callout' },
  { type: 'quote',        label: 'Quote' },
  { type: 'summary',      label: 'Summary' },
  { type: 'references',   label: 'References' },
  { type: 'columns',      label: 'Columns' },
  { type: 'divider',      label: 'Divider' },
];

/** Color legend for mini template previews */
export function TemplateLegend() {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
      {LEGEND_ITEMS.map(({ type, label }) => (
        <span key={type} className="inline-flex items-center gap-1.5 text-[11px] text-gray-500">
          <span className={`inline-block h-2.5 w-5 rounded-sm ${MINI_COLORS[type]}`} />
          {label}
        </span>
      ))}
    </div>
  );
}

/** Mini visual preview of a block layout */
function BlockMiniPreview({ blocks }: { blocks: ContentBlock[] }) {
  return (
    <div className="flex flex-col gap-0.5 px-2 py-1.5">
      {blocks.slice(0, 10).map((block) => {
        if (block.type === 'columns') {
          return (
            <div key={block.id} className="flex gap-0.5">
              {block.columns.map((col) => (
                <div key={col.id} className="flex-1 flex flex-col gap-0.5">
                  {col.blocks.slice(0, 3).map((inner) => (
                    <div
                      key={inner.id}
                      className={`h-2 rounded-sm ${MINI_COLORS[inner.type] ?? 'bg-gray-200'}`}
                      title={BLOCK_LABELS[inner.type]}
                    />
                  ))}
                  {col.blocks.length === 0 && (
                    <div className="h-2 rounded-sm bg-gray-100 border border-dashed border-gray-300" />
                  )}
                </div>
              ))}
            </div>
          );
        }
        return (
          <div
            key={block.id}
            className={`h-2 rounded-sm ${MINI_COLORS[block.type] ?? 'bg-gray-200'}`}
            title={BLOCK_LABELS[block.type]}
          />
        );
      })}
      {blocks.length > 10 && (
        <p className="text-[9px] text-gray-400 text-center">+{blocks.length - 10} more</p>
      )}
    </div>
  );
}

export function TemplateCard({
  name,
  description,
  blocks,
  usageCount,
  isDefault,
  selected,
  onClick,
  eyebrow,
  accentClassName,
  surfaceClassName,
  badgeClassName,
  stats,
}: Props) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`group text-left rounded-xl border-2 p-4 shadow-sm hover:shadow-md transition-all duration-200 ${
        surfaceClassName || 'bg-white'
      } ${
        selected
          ? 'border-purple-500 ring-2 ring-purple-200'
          : 'border-gray-100 hover:border-purple-200'
      }`}
    >
      {accentClassName && (
        <div className={`mb-3 h-1.5 w-full rounded-full bg-gradient-to-r ${accentClassName}`} />
      )}

      {eyebrow && (
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-gray-400">
          {eyebrow}
        </p>
      )}

      {/* Mini block preview */}
      <div className="w-full h-24 rounded-lg bg-gray-50 border border-gray-100 mb-3 overflow-hidden">
        <BlockMiniPreview blocks={blocks} />
      </div>

      {/* Name + badges */}
      <div className="flex items-start justify-between mb-1">
        <h3 className="text-sm font-semibold text-gray-900 group-hover:text-purple-700 transition-colors">
          {name}
        </h3>
        <div className="flex gap-1 ml-2">
          {isDefault && (
            <span className={`shrink-0 text-[10px] font-medium px-1.5 py-0.5 rounded-full ${badgeClassName || 'bg-blue-100 text-blue-700'}`}>
              Default
            </span>
          )}
          {usageCount != null && usageCount >= 2 && (
            <span className="shrink-0 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-600">
              {usageCount} uses
            </span>
          )}
        </div>
      </div>

      <p className="text-xs text-gray-500 leading-relaxed line-clamp-2">{description}</p>

      {stats && stats.length > 0 && (
        <div className="mt-3 grid grid-cols-2 gap-2">
          {stats.slice(0, 2).map((stat) => (
            <div key={`${name}-${stat.label}`} className="rounded-lg border border-white/70 bg-white/80 px-2.5 py-2">
              <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-gray-400">{stat.label}</p>
              <p className="mt-1 text-[11px] font-medium text-gray-700">{stat.value}</p>
            </div>
          ))}
        </div>
      )}

      {/* Block count */}
      <p className="mt-2 text-[10px] text-gray-400">
        {blocks.length} blocks
        {blocks.some((b) => b.type === 'columns') && ' · has columns'}
      </p>
    </button>
  );
}

// ── Preview colors for block types (light bg + text) ─────────────────────────

const PREVIEW_STYLE: Record<BlockType, { bg: string; text: string; icon: string }> = {
  heading:       { bg: 'bg-indigo-50 border-indigo-200', text: 'text-indigo-700', icon: 'H' },
  paragraph:     { bg: 'bg-gray-50 border-gray-200',     text: 'text-gray-600',   icon: '¶' },
  key_insights:  { bg: 'bg-blue-50 border-blue-200',     text: 'text-blue-700',   icon: '◆' },
  callout:       { bg: 'bg-amber-50 border-amber-200',   text: 'text-amber-700',  icon: '!' },
  quote:         { bg: 'bg-violet-50 border-violet-200', text: 'text-violet-700', icon: '"' },
  image:         { bg: 'bg-emerald-50 border-emerald-200', text: 'text-emerald-700', icon: '▣' },
  media:         { bg: 'bg-pink-50 border-pink-200',     text: 'text-pink-700',   icon: '▶' },
  divider:       { bg: 'bg-gray-50 border-gray-200',     text: 'text-gray-400',   icon: '—' },
  list:          { bg: 'bg-orange-50 border-orange-200', text: 'text-orange-700', icon: '≡' },
  references:    { bg: 'bg-teal-50 border-teal-200',     text: 'text-teal-700',   icon: '⁂' },
  internal_link: { bg: 'bg-sky-50 border-sky-200',       text: 'text-sky-700',    icon: '⇢' },
  summary:       { bg: 'bg-blue-50 border-blue-200',     text: 'text-blue-700',   icon: '✦' },
  columns:       { bg: 'bg-cyan-50 border-cyan-200',     text: 'text-cyan-700',   icon: '▥' },
};

function BlockPreviewRow({ block, depth = 0, index }: { block: ContentBlock; depth?: number; index?: number }) {
  const style = PREVIEW_STYLE[block.type] ?? PREVIEW_STYLE.paragraph;
  const label = BLOCK_LABELS[block.type] ?? block.type;

  if (block.type === 'columns') {
    return (
      <div className={`rounded-xl border-2 border-cyan-100 bg-gradient-to-r from-cyan-50/50 to-white p-3 ${depth > 0 ? 'ml-3' : ''}`}>
        <div className="flex items-center gap-2 mb-2">
          <span className="flex items-center justify-center h-5 w-5 rounded-md bg-cyan-100 text-[10px] font-bold text-cyan-700">{style.icon}</span>
          <p className="text-xs font-semibold text-cyan-700">{block.columnCount}-Column Layout</p>
        </div>
        <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${block.columnCount}, 1fr)` }}>
          {block.columns.map((col, ci) => (
            <div key={col.id} className="flex flex-col gap-1.5 bg-white rounded-lg p-2 border border-dashed border-cyan-200 min-h-[40px]">
              <p className="text-[9px] font-bold uppercase tracking-widest text-cyan-400 mb-0.5">Col {ci + 1}</p>
              {col.blocks.map((inner, ii) => (
                <BlockPreviewRow key={inner.id} block={inner} depth={depth + 1} index={ii} />
              ))}
              {col.blocks.length === 0 && (
                <p className="text-[10px] text-gray-300 text-center italic py-2">Empty</p>
              )}
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (block.type === 'divider') {
    return (
      <div className="flex items-center gap-2 py-1">
        <div className="flex-1 border-t-2 border-dashed border-gray-200" />
        <span className="text-[9px] uppercase tracking-wider text-gray-300 font-medium">Section Break</span>
        <div className="flex-1 border-t-2 border-dashed border-gray-200" />
      </div>
    );
  }

  const hint = block.hint;
  const isHeading = block.type === 'heading';
  const extra = isHeading ? ` (H${block.level})` : '';

  return (
    <div className={`rounded-lg border px-3 py-2 ${style.bg} ${depth > 0 ? '' : ''} ${
      isHeading ? 'border-l-4 border-l-indigo-400' : ''
    }`}>
      <div className="flex items-start gap-2">
        <span className={`flex items-center justify-center h-5 w-5 rounded-md ${
          isHeading ? 'bg-indigo-100' : 'bg-white/80'
        } text-[10px] font-bold ${style.text} shrink-0 mt-0.5`}>{style.icon}</span>
        <div className="min-w-0 flex-1">
          <p className={`text-xs font-semibold ${style.text} ${isHeading ? 'text-sm' : ''}`}>{label}{extra}</p>
          {hint && <p className="text-[11px] text-gray-400 leading-snug mt-0.5 line-clamp-2">{hint}</p>}
        </div>
      </div>
    </div>
  );
}

/** Full-screen preview modal for a template */
export function TemplatePreviewModal({
  name,
  description,
  blocks,
  isDefault,
  onClose,
  onSelect,
  onCustomize,
}: {
  name: string;
  description: string;
  blocks: ContentBlock[];
  isDefault?: boolean;
  onClose: () => void;
  onSelect: () => void;
  onCustomize: () => void;
}) {
  // Collect unique block types for the legend
  const usedTypes = new Set<BlockType>();
  const collectTypes = (bs: ContentBlock[]) => {
    for (const b of bs) {
      usedTypes.add(b.type);
      if (b.type === 'columns') b.columns.forEach((c) => collectTypes(c.blocks));
    }
  };
  collectTypes(blocks);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[85vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-6 pt-5 pb-4 border-b border-gray-100 bg-gradient-to-r from-purple-50/50 to-white">
          <div className="flex items-start justify-between">
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-bold text-gray-900">{name}</h2>
                {isDefault && (
                  <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700">Default</span>
                )}
              </div>
              <p className="text-sm text-gray-500 mt-0.5">{description}</p>
              <p className="text-xs text-gray-400 mt-1">{blocks.length} blocks{blocks.some(b => b.type === 'columns') ? ' · includes columns' : ''}</p>
            </div>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none p-1 -mr-1 -mt-1">×</button>
          </div>

          {/* Block type legend */}
          <div className="flex flex-wrap gap-1.5 mt-3">
            {Array.from(usedTypes).filter(t => t !== 'divider').map((t) => {
              const s = PREVIEW_STYLE[t] ?? PREVIEW_STYLE.paragraph;
              return (
                <span key={t} className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-medium ${s.bg} ${s.text}`}>
                  {s.icon} {BLOCK_LABELS[t]}
                </span>
              );
            })}
          </div>
        </div>

        {/* Block structure preview */}
        <div className="flex-1 overflow-y-auto px-6 py-4 bg-gray-50/30">
          <div className="flex flex-col gap-2">
            {blocks.map((block, i) => (
              <BlockPreviewRow key={block.id} block={block} index={i} />
            ))}
          </div>
        </div>

        {/* Footer actions */}
        <div className="flex justify-end gap-3 px-6 py-4 border-t border-gray-100 bg-white">
          <button
            type="button"
            onClick={onCustomize}
            className="inline-flex items-center gap-1.5 rounded-xl border border-gray-300 bg-white px-5 py-2.5 text-sm font-medium text-gray-700 hover:border-purple-300 hover:shadow-sm transition-all"
          >
            Customize
          </button>
          <button
            type="button"
            onClick={onSelect}
            className="inline-flex items-center gap-1.5 rounded-xl bg-purple-600 px-6 py-2.5 text-sm font-semibold text-white hover:bg-purple-700 shadow-sm transition-all"
          >
            Use This Template →
          </button>
        </div>
      </div>
    </div>
  );
}

export function TemplatePreviewPanel({
  name,
  description,
  blocks,
  isDefault,
  eyebrow,
  accentClassName,
  stats,
  emptyTitle = 'Select a template',
  emptyDescription = 'Choose any layout on the left to preview a dummy version before you use or customize it.',
}: {
  name?: string;
  description?: string;
  blocks?: ContentBlock[];
  isDefault?: boolean;
  eyebrow?: string;
  accentClassName?: string;
  stats?: Array<{ label: string; value: string }>;
  emptyTitle?: string;
  emptyDescription?: string;
}) {
  const usedTypes = new Set<BlockType>();
  const collectTypes = (bs: ContentBlock[]) => {
    for (const b of bs) {
      usedTypes.add(b.type);
      if (b.type === 'columns') b.columns.forEach((c) => collectTypes(c.blocks));
    }
  };
  if (blocks) collectTypes(blocks);

  return (
    <div className="sticky top-6 rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden">
      <div className="border-b border-gray-100 bg-gradient-to-r from-purple-50/70 to-white px-5 py-4">
        {blocks && name ? (
          <>
            {accentClassName && (
              <div className={`mb-3 h-1.5 w-full rounded-full bg-gradient-to-r ${accentClassName}`} />
            )}
            {eyebrow && (
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-gray-400">
                {eyebrow}
              </p>
            )}
            <div className="flex items-center gap-2">
              <h3 className="text-base font-bold text-gray-900">{name}</h3>
              {isDefault && (
                <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700">Default</span>
              )}
            </div>
            {description && <p className="mt-1 text-sm text-gray-500">{description}</p>}
            <p className="mt-1 text-xs text-gray-400">
              {blocks.length} blocks{blocks.some((b) => b.type === 'columns') ? ' · includes columns' : ''}
            </p>
            {stats && stats.length > 0 && (
              <div className="mt-3 grid grid-cols-2 gap-2">
                {stats.slice(0, 4).map((stat) => (
                  <div key={`${name}-${stat.label}`} className="rounded-lg border border-white/70 bg-white/80 px-2.5 py-2">
                    <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-gray-400">{stat.label}</p>
                    <p className="mt-1 text-[11px] font-medium text-gray-700">{stat.value}</p>
                  </div>
                ))}
              </div>
            )}
            <div className="mt-3 flex flex-wrap gap-1.5">
              {Array.from(usedTypes).filter((t) => t !== 'divider').map((t) => {
                const s = PREVIEW_STYLE[t] ?? PREVIEW_STYLE.paragraph;
                return (
                  <span key={t} className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-medium ${s.bg} ${s.text}`}>
                    {s.icon} {BLOCK_LABELS[t]}
                  </span>
                );
              })}
            </div>
          </>
        ) : (
          <>
            <h3 className="text-base font-bold text-gray-900">{emptyTitle}</h3>
            <p className="mt-1 text-sm text-gray-500">{emptyDescription}</p>
          </>
        )}
      </div>

      <div className="max-h-[70vh] overflow-y-auto bg-gray-50/40 px-5 py-4">
        {blocks && blocks.length > 0 ? (
          <div className="flex flex-col gap-2">
            {blocks.map((block, i) => (
              <BlockPreviewRow key={block.id} block={block} index={i} />
            ))}
          </div>
        ) : (
          <div className="flex min-h-[320px] items-center justify-center rounded-xl border border-dashed border-gray-200 bg-white/80 px-6 text-center">
            <div>
              <p className="text-sm font-medium text-gray-600">No template selected yet</p>
              <p className="mt-1 text-xs text-gray-400">Click a template card to see how that layout is structured.</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
