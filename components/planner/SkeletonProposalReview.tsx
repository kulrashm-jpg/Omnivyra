/**
 * P4.1 — AI skeleton proposal review.
 *
 * The pause between "the AI answered" and "the campaign changed". Everything
 * shown here is computed from the ephemeral proposal value held by the parent;
 * this component persists nothing and can persist nothing — Accept calls back
 * to the parent, which runs the EXISTING canonical write path.
 *
 *   Review · Edit · Regenerate · Reject · Accept
 *
 * Two honesty rules it follows:
 *   • an inconsistent proposal is REPORTED, never silently repaired
 *   • the downstream impact is shown BEFORE accepting, including anything
 *     already approved, assigned or scheduled that the change would disturb
 */

import React, { useMemo, useState } from 'react';
import { AlertTriangle, Check, Pencil, RotateCcw, Sparkles, X } from 'lucide-react';
import {
  applyProposalEdit,
  validateProposal,
  proposalToPlanLike,
  deriveSkeletonImpact,
  describeAtRiskWork,
  type SkeletonProposal,
} from '../../lib/campaign/skeletonProposal';
import type { ContentPlanLike } from '../../lib/campaign/campaignContentModel';
import type { CampaignAssignment } from '../../lib/campaign/campaignAssignments';

export interface SkeletonProposalReviewProps {
  proposal: SkeletonProposal;
  /** The committed plan, for the impact comparison. */
  currentPlan: ContentPlanLike | null | undefined;
  assignments?: CampaignAssignment[] | null;
  onAccept: (accepted: SkeletonProposal) => void;
  onReject: () => void;
  onRegenerate: () => void;
  regenerating?: boolean;
}

export function SkeletonProposalReview({
  proposal, currentPlan, assignments, onAccept, onReject, onRegenerate, regenerating,
}: SkeletonProposalReviewProps) {
  // Edits live here, on top of the proposal — never written anywhere.
  const [edited, setEdited] = useState<SkeletonProposal>(proposal);
  const [editing, setEditing] = useState(false);

  // A fresh proposal (e.g. after Regenerate) replaces any pending edit.
  React.useEffect(() => { setEdited(proposal); setEditing(false); }, [proposal]);

  const validation = useMemo(() => validateProposal(edited), [edited]);
  const impact = useMemo(
    () => deriveSkeletonImpact({
      current: currentPlan,
      candidate: proposalToPlanLike(edited),
      assignments,
    }),
    [currentPlan, edited, assignments],
  );
  const atRisk = useMemo(() => describeAtRiskWork(impact), [impact]);

  const edit = (patch: Parameters<typeof applyProposalEdit>[1]) =>
    setEdited((cur) => applyProposalEdit(cur, patch));

  return (
    <div className="rounded-xl border border-indigo-200 bg-indigo-50/50 p-3 space-y-3">
      <div className="flex items-start gap-2">
        <Sparkles className="h-4 w-4 text-indigo-600 mt-0.5 shrink-0" />
        <div className="min-w-0">
          <h4 className="text-sm font-semibold text-gray-900">AI suggested campaign structure</h4>
          <p className="text-[11px] text-gray-600">
            Nothing has changed yet — your campaign updates only when you accept this.
          </p>
        </div>
      </div>

      {/* What is proposed */}
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] text-gray-700">
        <dt>Duration</dt>
        <dd className="text-right font-medium">{edited.duration_weeks ?? '—'} weeks</dd>
        <dt>Platforms</dt>
        <dd className="text-right font-medium">{edited.platforms.join(', ') || '—'}</dd>
        <dt>Planned pieces</dt>
        <dd className="text-right font-medium">{edited.slot_count}</dd>
        <dt>Starts</dt>
        <dd className="text-right font-medium">{edited.start_date ?? '—'}</dd>
      </dl>

      {/* Per-week cadence, straight from the proposal's own matrix */}
      {Object.keys(edited.platform_content_requests).length > 0 && (
        <div className="rounded-lg border border-indigo-100 bg-white px-3 py-2">
          <p className="text-[10px] uppercase tracking-wide text-gray-500 mb-1">Per week</p>
          <ul className="space-y-0.5">
            {Object.entries(edited.platform_content_requests).map(([platform, types]) => (
              <li key={platform} className="text-[11px] text-gray-700">
                <span className="capitalize font-medium">{platform}</span>
                {' — '}
                {Object.entries(types).map(([t, n]) => `${n}× ${t}`).join(', ')}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Inconsistencies — reported, never silently fixed */}
      {!validation.ok && validation.issues.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
          <p className="text-[11px] font-semibold text-amber-900 flex items-center gap-1">
            <AlertTriangle className="h-3 w-3" />
            This proposal is inconsistent ({validation.issues.length})
          </p>
          <ul className="mt-1 space-y-0.5">
            {validation.issues.slice(0, 4).map((issue, i) => (
              <li key={i} className="text-[10px] text-amber-900/85">• {issue.message}</li>
            ))}
          </ul>
        </div>
      )}

      {/* What accepting would disturb */}
      <div className={`rounded-lg border px-3 py-2 ${impact.clean ? 'border-gray-200 bg-white' : 'border-amber-200 bg-amber-50'}`}>
        <p className="text-[11px] font-medium text-gray-800">{impact.summary}</p>
        {!impact.clean && (
          <ul className="mt-1 space-y-0.5 text-[10px] text-gray-700">
            {atRisk.released.length > 0 && (
              <li className="text-red-700 font-medium">
                {atRisk.released.length} already-scheduled slot(s) conflict — these need your decision.
              </li>
            )}
            {atRisk.approved_content.length > 0 && (
              <li>{atRisk.approved_content.length} approved item(s) affected — they will NOT be changed automatically.</li>
            )}
            {atRisk.with_assignments.length > 0 && (
              <li>{atRisk.with_assignments.length} slot(s) with assigned assets — assets stay attached.</li>
            )}
            {impact.affected_weeks.length > 0 && (
              <li>Affected weeks: {impact.affected_weeks.join(', ')}</li>
            )}
          </ul>
        )}
      </div>

      {/* Edit before accepting */}
      {editing && (
        <div className="rounded-lg border border-gray-200 bg-white px-3 py-2 space-y-2">
          <label className="flex items-center gap-2 text-[11px] text-gray-700">
            Duration
            <input
              type="number" min={1} max={52} value={edited.duration_weeks ?? 1}
              onChange={(e) => edit({ duration_weeks: Number(e.target.value) })}
              className="w-16 rounded border border-gray-300 px-1.5 py-0.5 text-xs"
            />
            weeks
          </label>
          {edited.platforms.length > 1 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] text-gray-700">Remove:</span>
              {edited.platforms.map((p) => (
                <button
                  key={p} type="button"
                  onClick={() => edit({ remove_platforms: [p] })}
                  className="text-[10px] px-1.5 py-0.5 rounded border border-gray-300 text-gray-600 hover:bg-gray-50 capitalize"
                >
                  {p} ×
                </button>
              ))}
            </div>
          )}
          <p className="text-[10px] text-gray-400">
            Day-level changes are made after accepting, in the skeleton chat.
          </p>
        </div>
      )}

      {/* Decision */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => onAccept(edited)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-medium hover:bg-indigo-700"
        >
          <Check className="h-3.5 w-3.5" /> Accept structure
        </button>
        <button
          type="button" onClick={() => setEditing((v) => !v)}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-gray-300 text-gray-700 text-xs hover:bg-white"
        >
          <Pencil className="h-3.5 w-3.5" /> {editing ? 'Done editing' : 'Edit'}
        </button>
        <button
          type="button" onClick={onRegenerate} disabled={regenerating}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-gray-300 text-gray-700 text-xs hover:bg-white disabled:opacity-50"
        >
          <RotateCcw className="h-3.5 w-3.5" /> {regenerating ? 'Regenerating…' : 'Regenerate'}
        </button>
        <button
          type="button" onClick={onReject}
          className="ml-auto flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-gray-500 text-xs hover:text-gray-800"
        >
          <X className="h-3.5 w-3.5" /> Discard
        </button>
      </div>
    </div>
  );
}

export default SkeletonProposalReview;
