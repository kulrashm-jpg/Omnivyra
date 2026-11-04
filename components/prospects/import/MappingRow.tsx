/**
 * One source column, its proposed destination, and the tenant's correction.
 *
 * ─── CORRECTION IS LOCAL, ALWAYS ──────────────────────────────────────────
 * Changing the `<select>` raises `onChange` and nothing else. The wizard holds
 * the parsed rows, so the preview and the validation counts recompute from
 * memory. No upload, no re-parse, no round trip — this is the mechanism behind
 * the "correct an ambiguous field without re-uploading" requirement.
 *
 * ─── THE OPTIONS COME FROM THE SERVER ─────────────────────────────────────
 * `allowedTargets` is supplied by the proposal endpoint. The browser holds no
 * copy of the canonical vocabulary, so it structurally cannot offer a
 * destination the server would refuse. A destination the registry knows but
 * the ingestion contract cannot carry is shown as disabled WITH ITS REASON,
 * rather than being hidden — a tenant who was looking for "company
 * description" deserves to learn why it is unavailable, not to wonder whether
 * they missed it.
 *
 * ─── STATUS IS REPORTED, NOT RE-DERIVED ───────────────────────────────────
 * The badge reflects the engine's `status` and `provenance`. This component
 * computes no score and overrides no verdict; where the engine said a human
 * must decide, the row says so.
 */

import React from 'react';
import { AlertTriangle, Ban, CheckCircle2, CircleDashed, Lock } from 'lucide-react';
import type {
  AllowedTargetView,
  FieldMappingProposalView,
  MappingStatus,
} from '@/lib/prospects/import/types';

export const IGNORE_VALUE = '__ignore__';

/** How each engine status reads to a tenant, and how it looks. */
const STATUS_PRESENTATION: Record<
  MappingStatus,
  { label: string; className: string; icon: React.ComponentType<{ className?: string }> }
> = {
  approved_profile_match: {
    label: 'From your saved mapping',
    className: 'bg-emerald-100 text-emerald-700',
    icon: CheckCircle2,
  },
  high_confidence_suggestion: {
    label: 'Matched',
    className: 'bg-emerald-100 text-emerald-700',
    icon: CheckCircle2,
  },
  review_required: {
    label: 'Needs your decision',
    className: 'bg-amber-100 text-amber-700',
    icon: AlertTriangle,
  },
  unmapped: {
    label: 'No destination',
    className: 'bg-gray-100 text-gray-600',
    icon: CircleDashed,
  },
  validation_failed: {
    label: 'Values do not fit',
    className: 'bg-rose-100 text-rose-700',
    icon: Ban,
  },
  rejected_by_tenant: {
    label: 'Previously rejected',
    className: 'bg-gray-100 text-gray-600',
    icon: Ban,
  },
};

export default function MappingRow({
  proposal,
  allowedTargets,
  selected,
  samples,
  blockedReason,
  keepAsNote,
  onChange,
  onKeepAsNoteChange,
}: {
  proposal: FieldMappingProposalView;
  allowedTargets: readonly AllowedTargetView[];
  /** The tenant's effective choice: a target key, or `null` for ignore. */
  selected: string | null;
  samples: readonly string[];
  /** Set when the chosen destination cannot be submitted. */
  blockedReason: string | null;
  keepAsNote: boolean;
  onChange: (target: string | null) => void;
  onKeepAsNoteChange: (keep: boolean) => void;
}) {
  const presentation = STATUS_PRESENTATION[proposal.status] ?? STATUS_PRESENTATION.unmapped;
  const StatusIcon = presentation.icon;

  // Group the dropdown so a 27-entry list is navigable, and so the person /
  // employer distinction the registry cares about is visible while choosing.
  const contactTargets = allowedTargets.filter((t) => t.entity === 'contact');
  const companyTargets = allowedTargets.filter((t) => t.entity === 'company');

  const option = (target: AllowedTargetView) => (
    <option key={target.key} value={target.key} disabled={!target.submittable}>
      {target.label}
      {target.submittable ? '' : ' — not importable yet'}
    </option>
  );

  const isIgnored = selected === null;

  return (
    <tr className="border-b border-gray-100 align-top last:border-0">
      {/* Source column */}
      <td className="py-3 pr-4">
        <p className="font-medium text-gray-900">{proposal.sourceField}</p>
        {samples.length > 0 ? (
          <p className="mt-0.5 truncate text-xs text-gray-400" title={samples.join(' · ')}>
            {samples.slice(0, 3).join(' · ')}
          </p>
        ) : (
          <p className="mt-0.5 text-xs text-gray-400">No values in this column</p>
        )}
      </td>

      {/* Destination */}
      <td className="py-3 pr-4">
        <label className="sr-only" htmlFor={`target-${proposal.sourceField}`}>
          Destination for {proposal.sourceField}
        </label>
        <select
          id={`target-${proposal.sourceField}`}
          className={`w-full rounded-lg border px-2 py-1.5 text-sm ${
            blockedReason
              ? 'border-rose-300 bg-rose-50 text-rose-800'
              : isIgnored
                ? 'border-gray-200 bg-gray-50 text-gray-500'
                : 'border-gray-300 bg-white text-gray-900'
          }`}
          value={selected === null ? IGNORE_VALUE : selected}
          onChange={(e) =>
            onChange(e.target.value === IGNORE_VALUE ? null : e.target.value)
          }
        >
          <option value={IGNORE_VALUE}>Ignore this column</option>
          <optgroup label="About the person">{contactTargets.map(option)}</optgroup>
          <optgroup label="About their employer">{companyTargets.map(option)}</optgroup>
        </select>

        {blockedReason ? (
          <p role="alert" className="mt-1 text-xs font-medium text-rose-600">
            {blockedReason}
          </p>
        ) : null}

        {isIgnored ? (
          <label className="mt-2 flex items-center gap-2 text-xs text-gray-600">
            <input
              type="checkbox"
              checked={keepAsNote}
              onChange={(e) => onKeepAsNoteChange(e.target.checked)}
            />
            Keep the values as a note
          </label>
        ) : null}
      </td>

      {/* What the engine thought */}
      <td className="py-3 pr-4">
        <span
          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${presentation.className}`}
        >
          <StatusIcon className="h-3 w-3" />
          {presentation.label}
        </span>

        {proposal.requiresTenantApproval ? (
          <span
            className="mt-1 flex items-center gap-1 text-xs text-gray-500"
            title="Identity fields are never applied without confirmation."
          >
            <Lock className="h-3 w-3" aria-hidden="true" />
            Confirmation required
          </span>
        ) : null}

        {proposal.validation ? (
          <p className="mt-1 text-xs text-rose-600">
            {proposal.validation.samplesFailed} of {proposal.validation.samplesConsidered} sample
            values failed ({proposal.validation.failureKind})
          </p>
        ) : null}

        <p className="mt-1 text-xs text-gray-500">{proposal.reasoning}</p>
      </td>
    </tr>
  );
}
