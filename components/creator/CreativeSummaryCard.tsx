'use client';

/**
 * "Here's what we'll make" — the last thing before a generation is spent.
 *
 * A generation costs the user credits and about a minute, and until now the
 * only way to discover what the system had decided was to spend both and look
 * at the result. Several of those decisions were never shown at all: which look
 * was chosen, whether anyone would be in the frame, whether the uploaded
 * photograph would be reproduced or reinterpreted.
 *
 * This is deliberately a SUMMARY and not an editor. A live mockup would have to
 * re-implement the renderer in the browser, and a mockup that disagreed with
 * the render would be worse than no mockup at all. Every line below is read
 * from the state that is about to be submitted — nothing is illustrative, and
 * nothing is inferred a second time for display.
 */

import React from 'react';
import { Sparkles } from 'lucide-react';
import {
  getVisualDirection,
  SUBJECT_OPTIONS,
  type GuidedCreativeChoices,
} from '../../lib/content/guidedCreativeDirection';
import { creatorAssetUsageLabel } from '../../lib/content/creatorCompositionAsset';
import type { CompositionAssetPurpose } from '../../lib/content/compositionAssetReference';

export interface CreativeSummaryProps {
  /** The design the user picked. */
  templateName: string | null;
  /** The goal they started from. */
  goalLabel?: string | null;
  choices: GuidedCreativeChoices;
  /** The attached image, if there is one. */
  attachment?: {
    filename: string | null;
    purpose: CompositionAssetPurpose;
    /** True when the exact pixels are placed; false when it informs generation. */
    placedExactly: boolean;
    instruction?: string | null;
  } | null;
  headline?: string | null;
  subheadline?: string | null;
  cta?: string | null;
  platform?: string | null;
  /** Rendered dimensions, when the platform resolves to a known size. */
  dimensions?: string | null;
  brandAware?: boolean;
}

interface Row { label: string; value: string; chosenByUser: boolean }

/**
 * Build the summary rows.
 *
 * Exported and pure so the contents can be asserted directly: a summary that
 * drifts from the payload is the one failure this component must not have, and
 * that is a property of this function rather than of the markup.
 */
export function buildCreativeSummaryRows(props: CreativeSummaryProps): Row[] {
  const rows: Row[] = [];
  if (props.goalLabel) rows.push({ label: 'Goal', value: props.goalLabel, chosenByUser: true });
  if (props.templateName) rows.push({ label: 'Design', value: props.templateName, chosenByUser: true });

  const direction = getVisualDirection(props.choices.visualDirectionId ?? null);
  rows.push(direction
    ? { label: 'Look', value: direction.title, chosenByUser: true }
    : { label: 'Look', value: 'Chosen by AI from your brief', chosenByUser: false });

  const subject = SUBJECT_OPTIONS.find((o) => o.choice === props.choices.subject);
  rows.push(subject
    ? { label: 'Featured', value: subject.label, chosenByUser: true }
    : { label: 'Featured', value: 'Chosen by AI from your brief', chosenByUser: false });

  if (props.attachment) {
    // Say what will actually happen to their picture. "Reference" and
    // "placed as uploaded" are different promises and the user is entitled to
    // know which one they are getting before paying for it.
    const usage = creatorAssetUsageLabel(props.attachment.purpose);
    const treatment = props.attachment.placedExactly
      ? 'placed exactly as uploaded'
      : 'used as a reference, so the result may differ';
    rows.push({
      label: 'Your image',
      value: `${props.attachment.filename || 'Your upload'} — as ${usage.toLowerCase()}, ${treatment}`,
      chosenByUser: true,
    });
    if (props.attachment.instruction) {
      rows.push({ label: 'Your note', value: `“${props.attachment.instruction}”`, chosenByUser: true });
    }
  }

  if (props.choices.visualInstruction) {
    rows.push({ label: 'Your direction', value: `“${props.choices.visualInstruction}”`, chosenByUser: true });
  }
  if (props.headline) rows.push({ label: 'Headline', value: `“${props.headline}”`, chosenByUser: true });
  if (props.subheadline) rows.push({ label: 'Subheadline', value: `“${props.subheadline}”`, chosenByUser: true });
  if (props.cta) rows.push({ label: 'Button text', value: `“${props.cta}”`, chosenByUser: true });

  const size = [props.platform, props.dimensions].filter(Boolean).join(' · ');
  if (size) rows.push({ label: 'Size', value: size, chosenByUser: true });
  if (props.brandAware) rows.push({ label: 'Brand', value: 'Your brand colours and logo', chosenByUser: true });
  return rows;
}

export default function CreativeSummaryCard(props: CreativeSummaryProps & { previewUrl?: string | null }) {
  const rows = buildCreativeSummaryRows(props);
  const direction = getVisualDirection(props.choices.visualDirectionId ?? null);
  const preview = props.previewUrl ?? direction?.previewUrl ?? null;

  return (
    <div className="rounded-2xl border border-slate-200 bg-white px-4 py-4">
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
        Here&rsquo;s what we&rsquo;ll make
      </p>
      <div className="mt-3 flex flex-wrap items-start gap-4">
        {preview ? (
          <img
            src={preview}
            alt=""
            className="h-24 w-24 shrink-0 rounded-xl object-cover"
          />
        ) : null}
        <dl className="min-w-[240px] flex-1 space-y-1.5">
          {rows.map((row) => (
            <div key={row.label} className="flex gap-3 text-xs">
              <dt className="w-24 shrink-0 font-semibold text-slate-500">{row.label}</dt>
              <dd className={row.chosenByUser ? 'text-slate-900' : 'text-slate-500 italic'}>
                {row.value}
              </dd>
            </div>
          ))}
        </dl>
      </div>
      <p className="mt-3 inline-flex items-center gap-1.5 text-[11px] text-slate-400">
        <Sparkles className="h-3 w-3" />
        Anything not chosen above is decided by AI from your brief. Scroll up to change any of it.
      </p>
    </div>
  );
}
