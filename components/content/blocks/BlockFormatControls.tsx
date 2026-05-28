'use client';

import React from 'react';
import type {
  BlockFormat,
  BlockListStyle,
  BlockSurface,
  BlockTextAlign,
  BlockTone,
  BlockWeight,
  ContentBlock,
} from '../../../lib/content/blockTypes';

type Props<T extends ContentBlock> = {
  block: T;
  onChange: (block: T) => void;
  showListStyle?: boolean;
};

const ALIGN_OPTIONS: Array<{ value: BlockTextAlign; label: string }> = [
  { value: 'left', label: 'Left' },
  { value: 'center', label: 'Center' },
  { value: 'justify', label: 'Justify' },
  { value: 'right', label: 'Right' },
];

const WEIGHT_OPTIONS: BlockWeight[] = ['regular', 'medium', 'semibold', 'bold'];
const TONE_OPTIONS: BlockTone[] = ['default', 'brand', 'muted', 'accent', 'success', 'warning', 'danger'];
const SURFACE_OPTIONS: BlockSurface[] = ['none', 'subtle', 'soft', 'strong'];
const LIST_STYLE_OPTIONS: BlockListStyle[] = ['default', 'disc', 'circle', 'square', 'decimal', 'upper-roman'];
const SPACING_OPTIONS = ['none', 'xs', 'sm', 'md', 'lg'] as const;

function mergeFormat<T extends ContentBlock>(block: T, next: Partial<BlockFormat>): T {
  return {
    ...block,
    format: {
      ...(block.format ?? {}),
      ...next,
    },
  };
}

export function BlockFormatControls<T extends ContentBlock>({
  block,
  onChange,
  showListStyle = false,
}: Props<T>) {
  const format = block.format ?? {};

  return (
    <details className="rounded-lg border border-dashed border-gray-200 bg-gray-50/70 group">
      {/* Collapsed by default — the formatting panel was a major
          source of visual stretch in the editor since EVERY block
          carried it expanded. The <details> wrapper keeps every
          control reachable in one click while removing the wall of
          dropdowns from the default editor view. */}
      <summary className="flex cursor-pointer items-center justify-between px-3 py-2 list-none [&::-webkit-details-marker]:hidden">
        <p className="text-[11px] font-semibold uppercase tracking-widest text-gray-500 select-none">
          Format
          <span className="ml-2 inline-block text-gray-400 transition-transform group-open:rotate-90">▸</span>
        </p>
        <label className="flex items-center gap-2 text-xs text-gray-600" onClick={(e) => e.stopPropagation()}>
          <input
            type="checkbox"
            checked={!!format.lead}
            onChange={(e) => onChange(mergeFormat(block, { lead: e.target.checked }))}
            className="rounded border-gray-300 text-[#0A66C2] focus:ring-[#0A66C2]"
          />
          Lead emphasis
        </label>
      </summary>

      <div className="space-y-3 px-3 pb-3 pt-1">
        <div>
          <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-gray-400">Alignment</p>
          <div className="grid grid-cols-4 gap-1">
            {ALIGN_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => onChange(mergeFormat(block, { align: option.value }))}
                className={`rounded-md px-2 py-1.5 text-[11px] font-semibold transition-colors ${
                  (format.align ?? 'left') === option.value
                    ? 'bg-[#0A66C2] text-white'
                    : 'bg-white text-gray-600 hover:bg-gray-100'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <label className="text-xs text-gray-600">
            <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-gray-400">Weight</span>
            <select
              value={format.weight ?? 'regular'}
              onChange={(e) => onChange(mergeFormat(block, { weight: e.target.value as BlockWeight }))}
              className="w-full rounded-md border border-gray-200 bg-white px-2 py-1.5 text-sm text-gray-700 focus:border-[#0A66C2] focus:outline-none"
            >
              {WEIGHT_OPTIONS.map((value) => (
                <option key={value} value={value}>{value}</option>
              ))}
            </select>
          </label>

          <label className="text-xs text-gray-600">
            <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-gray-400">Indent</span>
            <select
              value={format.indent ?? 0}
              onChange={(e) => onChange(mergeFormat(block, { indent: Number(e.target.value) as 0 | 1 | 2 | 3 }))}
              className="w-full rounded-md border border-gray-200 bg-white px-2 py-1.5 text-sm text-gray-700 focus:border-[#0A66C2] focus:outline-none"
            >
              <option value={0}>None</option>
              <option value={1}>Small</option>
              <option value={2}>Medium</option>
              <option value={3}>Large</option>
            </select>
          </label>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <label className="text-xs text-gray-600">
            <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-gray-400">Tone</span>
            <select
              value={format.tone ?? 'default'}
              onChange={(e) => onChange(mergeFormat(block, { tone: e.target.value as BlockTone }))}
              className="w-full rounded-md border border-gray-200 bg-white px-2 py-1.5 text-sm text-gray-700 focus:border-[#0A66C2] focus:outline-none"
            >
              {TONE_OPTIONS.map((value) => (
                <option key={value} value={value}>{value}</option>
              ))}
            </select>
          </label>

          <label className="text-xs text-gray-600">
            <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-gray-400">Surface</span>
            <select
              value={format.surface ?? 'none'}
              onChange={(e) => onChange(mergeFormat(block, { surface: e.target.value as BlockSurface }))}
              className="w-full rounded-md border border-gray-200 bg-white px-2 py-1.5 text-sm text-gray-700 focus:border-[#0A66C2] focus:outline-none"
            >
              {SURFACE_OPTIONS.map((value) => (
                <option key={value} value={value}>{value}</option>
              ))}
            </select>
          </label>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <label className="text-xs text-gray-600">
            <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-gray-400">Top spacing</span>
            <select
              value={format.spacingTop ?? 'none'}
              onChange={(e) => onChange(mergeFormat(block, { spacingTop: e.target.value as BlockFormat['spacingTop'] }))}
              className="w-full rounded-md border border-gray-200 bg-white px-2 py-1.5 text-sm text-gray-700 focus:border-[#0A66C2] focus:outline-none"
            >
              {SPACING_OPTIONS.map((value) => (
                <option key={value} value={value}>{value}</option>
              ))}
            </select>
          </label>

          <label className="text-xs text-gray-600">
            <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-gray-400">Bottom spacing</span>
            <select
              value={format.spacingBottom ?? 'none'}
              onChange={(e) => onChange(mergeFormat(block, { spacingBottom: e.target.value as BlockFormat['spacingBottom'] }))}
              className="w-full rounded-md border border-gray-200 bg-white px-2 py-1.5 text-sm text-gray-700 focus:border-[#0A66C2] focus:outline-none"
            >
              {SPACING_OPTIONS.map((value) => (
                <option key={value} value={value}>{value}</option>
              ))}
            </select>
          </label>
        </div>

        {showListStyle && (
          <label className="text-xs text-gray-600">
            <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-gray-400">List style</span>
            <select
              value={format.listStyle ?? 'default'}
              onChange={(e) => onChange(mergeFormat(block, { listStyle: e.target.value as BlockListStyle }))}
              className="w-full rounded-md border border-gray-200 bg-white px-2 py-1.5 text-sm text-gray-700 focus:border-[#0A66C2] focus:outline-none"
            >
              {LIST_STYLE_OPTIONS.map((value) => (
                <option key={value} value={value}>{value}</option>
              ))}
            </select>
          </label>
        )}
      </div>
    </details>
  );
}
