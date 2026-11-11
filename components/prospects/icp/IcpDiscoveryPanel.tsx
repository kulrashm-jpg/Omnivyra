/**
 * PI R2: "Find people matching this ICP", from the RATIFIED version only.
 *
 * Two-step, and every step is the tenant's own decision:
 *  1. Ask. The server translates the ratified ICP into provider filters. If
 *     any criterion could not be applied (soft criteria, or something the
 *     provider cannot express) or could only be applied APPROXIMATELY
 *     (industry, via the provider's keyword tags; owner decision R2-a), the
 *     server refuses and returns exactly which criteria and why.
 *  2. Confirm. The tenant sees that list and acknowledges it explicitly; only
 *     then is the search run.
 *
 * The result reports what was found, what was imported, and what the
 * duplicate screen (R3) skipped or held for review.
 */
import React, { useState } from 'react';
import { apiFetch } from '@/lib/apiFetch';
import TenantDataNotice from '@/components/compliance/TenantDataNotice';

interface Blocking { criterionId: string; subject: string; attribute: string; kind: string; reason: string }
interface RunView {
  status: string; outcome: string | null; stopReason: string | null;
  resultsObserved: number; resultsIngested: number;
  screening: { skippedDuplicates: number; heldForReview: number; probeUnknown: number } | null;
}

const MAX_RESULTS_CAP = 500;

export default function IcpDiscoveryPanel({ companyId, versionId, version }: {
  companyId: string; versionId: string; version: number;
}) {
  const [maxResults, setMaxResults] = useState(25);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<{ omissions: Blocking[]; approximations: Blocking[] } | null>(null);
  const [ackOmissions, setAckOmissions] = useState(false);
  const [ackApprox, setAckApprox] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [run, setRun] = useState<RunView | null>(null);

  const search = async (acks: { omissions: boolean; approximations: boolean }) => {
    setBusy(true); setError(null); setRun(null);
    try {
      const bounded = Math.min(Math.max(1, Math.floor(maxResults) || 1), MAX_RESULTS_CAP);
      const res = await apiFetch(`/api/prospect-sources/discovery?company_id=${encodeURIComponent(companyId)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          provider: 'apollo',
          icpVersionId: versionId,
          bounds: { maxPages: Math.ceil(bounded / 100), maxResults: bounded, maxProviderCalls: Math.ceil(bounded / 100) },
          ...(acks.omissions ? { acknowledgeOmissions: true } : {}),
          ...(acks.approximations ? { acknowledgeApproximations: true } : {}),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.status === 400 && (body?.code === 'omissions_unacknowledged' || body?.code === 'approximations_unacknowledged')) {
        // Accumulate both lists: the server reports one gate at a time.
        setPending((prev) => ({
          omissions: body.code === 'omissions_unacknowledged' ? body.blocking ?? [] : prev?.omissions ?? [],
          approximations: body.code === 'approximations_unacknowledged' ? body.blocking ?? [] : prev?.approximations ?? [],
        }));
        return;
      }
      if (!res.ok && res.status !== 201) {
        setError(typeof body?.error === 'string' ? body.error : 'The search could not be run. Nothing was imported.');
        return;
      }
      setPending(null); setAckOmissions(false); setAckApprox(false);
      setRun(body?.run ?? null);
      if (!body?.run) setError('The search was recorded but not run. See the execution details for why.');
    } finally {
      setBusy(false);
    }
  };

  const needsOmissionAck = (pending?.omissions.length ?? 0) > 0;
  const needsApproxAck = (pending?.approximations.length ?? 0) > 0;
  const canConfirm = (!needsOmissionAck || ackOmissions) && (!needsApproxAck || ackApprox);

  return (
    <div className="mt-4 rounded-xl border border-purple-200 bg-white p-4" data-testid="icp-discovery-panel">
      {/* Data-controller notice: shown on every search (owner, 2026-11-11). */}
      <TenantDataNotice companyId={companyId} categories={['vendor_data']} />
      <h3 className="text-sm font-semibold text-gray-900">Find people matching ICP version {version} (Apollo)</h3>
      <p className="mt-1 text-xs text-gray-600">
        Only mandatory criteria become search filters. Leads that look like someone you already have are
        not imported; they wait in the review list on the Prospects page.
      </p>
      <label className="mt-3 block text-xs text-gray-700">
        At most
        <input
          type="number" min={1} max={MAX_RESULTS_CAP} value={maxResults}
          onChange={(e) => setMaxResults(Number(e.target.value))}
          className="mx-2 w-20 rounded border border-gray-300 px-2 py-1 text-sm"
        />
        people (up to {MAX_RESULTS_CAP})
      </label>

      {pending ? (
        <div className="mt-3 space-y-3 rounded-lg bg-amber-50 p-3 text-xs text-gray-800">
          {needsApproxAck ? (
            <div>
              <p className="font-semibold">Searched only approximately:</p>
              <ul className="ml-4 list-disc">
                {pending.approximations.map((b) => <li key={b.criterionId}>{b.subject}.{b.attribute}: {b.reason}</li>)}
              </ul>
              <label className="mt-1 flex items-center gap-2">
                <input type="checkbox" checked={ackApprox} onChange={(e) => setAckApprox(e.target.checked)} />
                I understand these criteria are searched approximately.
              </label>
            </div>
          ) : null}
          {needsOmissionAck ? (
            <div>
              <p className="font-semibold">Not applied to the search:</p>
              <ul className="ml-4 list-disc">
                {pending.omissions.map((b) => <li key={b.criterionId}>{b.subject}.{b.attribute}: {b.reason}</li>)}
              </ul>
              <label className="mt-1 flex items-center gap-2">
                <input type="checkbox" checked={ackOmissions} onChange={(e) => setAckOmissions(e.target.checked)} />
                I understand the search is broader than my ICP for these criteria.
              </label>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="mt-3 flex gap-2">
        <button
          type="button"
          disabled={busy || (pending !== null && !canConfirm)}
          onClick={() => search({ omissions: ackOmissions, approximations: ackApprox })}
          className="rounded-lg bg-purple-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-purple-700 disabled:opacity-50"
        >
          {busy ? 'Searching…' : pending ? 'Confirm and search' : 'Find people'}
        </button>
        {pending ? (
          <button type="button" disabled={busy} onClick={() => { setPending(null); setAckOmissions(false); setAckApprox(false); }}
            className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700">
            Cancel
          </button>
        ) : null}
      </div>

      {error ? <p className="mt-3 text-sm text-rose-600" role="alert">{error}</p> : null}
      {run ? (
        <p className="mt-3 text-sm text-gray-800" role="status" data-testid="icp-discovery-result">
          Found {run.resultsObserved}, imported {run.resultsIngested}
          {run.screening ? `, skipped ${run.screening.skippedDuplicates} duplicate(s), held ${run.screening.heldForReview} for review`
            + (run.screening.probeUnknown ? `, ${run.screening.probeUnknown} could not be checked (will be reconsidered next search)` : '') : ''}
          . Status: {run.status}{run.stopReason ? ` (${run.stopReason})` : ''}.
        </p>
      ) : null}
    </div>
  );
}
