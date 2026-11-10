/**
 * PI R1: enrich the selected prospects from Apollo, SHOWING THE COST FIRST.
 *
 *   Preview  -> how many Apollo calls, which attributes per call, which data
 *               groups the tenant chose, and the funding (on the tenant's own
 *               Apollo key: Apollo bills the tenant; no Omnivyra credits).
 *   Confirm  -> runs only that estimate (the server refuses if it changed).
 */
import React, { useState } from 'react';
import { apiFetch } from '@/lib/apiFetch';

interface Estimate { estimatedProviderCalls: number; calls: Array<{ prospectId: string; subject: string; attributes: string[] }>; unreadable: string[]; estimateHash: string }
interface Preview {
  fieldGroups: string[];
  funding: 'tenant_apollo_key' | 'central_apollo_access' | 'no_apollo_access' | string;
  vendorUnits?: number;
  omnivyraCredits: number | null;
  estimate: Estimate;
}

const GROUP_LABEL: Record<string, string> = {
  job_role: 'job and role', company_firmographics: 'company firmographics', technologies: 'technologies',
  contact_email: 'work email', contact_phone: 'phone',
};
const MAX_PROSPECTS = 25;

export default function ApolloEnrichBar({ companyId, prospectIds, onDone }: {
  companyId: string; prospectIds: string[]; onDone?: () => void;
}) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const url = `/api/prospect-sources/apollo-enrich?companyId=${encodeURIComponent(companyId)}`;
  const ids = prospectIds.slice(0, MAX_PROSPECTS);
  const maxProviderCalls = Math.min(ids.length * 2, 50);

  const post = async (body: Record<string, unknown>) => {
    const res = await apiFetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    return { res, json: await res.json().catch(() => ({})) };
  };

  const askPreview = async () => {
    setBusy(true); setMessage(null);
    try {
      const { res, json } = await post({ mode: 'preview', prospectIds: ids, maxProviderCalls });
      if (!res.ok) { setMessage('The preview could not be prepared. Nothing was spent.'); return; }
      setPreview(json as Preview);
    } finally { setBusy(false); }
  };

  const run = async () => {
    if (!preview) return;
    setBusy(true); setMessage(null);
    try {
      const { res, json } = await post({ mode: 'run', prospectIds: ids, maxProviderCalls, estimateHash: preview.estimate.estimateHash });
      if (res.status === 409) {
        setPreview(json?.estimate ? { ...preview, estimate: json.estimate } : null);
        setMessage('Something changed since the preview. Review the new estimate and confirm again. Nothing was spent.');
        return;
      }
      if (!res.ok) { setMessage('Enrichment could not be run.'); return; }
      const r = json?.result;
      setPreview(null);
      setMessage(`Done: ${r?.providerCalls ?? 0} Apollo call(s) made${r?.budgetExhausted ? ' (budget reached; the rest were skipped)' : ''}.`);
      onDone?.();
    } finally { setBusy(false); }
  };

  return (
    <div className="mb-4 rounded-xl border border-indigo-200 bg-indigo-50 p-3 text-sm" data-testid="apollo-enrich-bar">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-gray-800">
          {ids.length} prospect{ids.length === 1 ? '' : 's'} selected
          {prospectIds.length > MAX_PROSPECTS ? ` (only the first ${MAX_PROSPECTS} are used)` : ''}
        </span>
        {!preview ? (
          <button type="button" disabled={busy || ids.length === 0} onClick={askPreview}
            className="rounded-lg bg-indigo-600 px-3 py-1.5 font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
            Enrich with Apollo…
          </button>
        ) : null}
      </div>
      {preview ? (
        <div className="mt-3 rounded-lg bg-white p-3" data-testid="apollo-enrich-preview">
          <p className="text-gray-900">
            This makes <strong>{preview.estimate.estimatedProviderCalls}</strong> Apollo call
            {preview.estimate.estimatedProviderCalls === 1 ? '' : 's'}, filling:{' '}
            {preview.fieldGroups.map((g) => GROUP_LABEL[g] ?? g).join(', ')}.
          </p>
          <p className="mt-1 text-xs text-gray-600" data-testid="apollo-enrich-cost">
            {preview.funding === 'tenant_apollo_key'
              ? `This run: ~${preview.vendorUnits ?? preview.estimate.estimatedProviderCalls} Apollo credit(s), billed to your own Apollo account. No Omnivyra credits are charged.`
              : preview.funding === 'central_apollo_access'
                ? (preview.omnivyraCredits == null
                  ? 'Central Apollo access is not priced yet, so this run cannot use it.'
                  : `This run: ~${preview.vendorUnits ?? preview.estimate.estimatedProviderCalls} Apollo credit(s) = ${preview.omnivyraCredits} Omnivyra credits (central Apollo access).`)
                : 'No Apollo access: add your own Apollo key, or opt into central Apollo access in Billing.'}
            {preview.estimate.unreadable.length ? ` ${preview.estimate.unreadable.length} prospect(s) could not be read and will be skipped.` : ''}
          </p>
          <div className="mt-2 flex gap-2">
            <button type="button"
              disabled={busy || preview.estimate.estimatedProviderCalls === 0 || preview.funding === 'no_apollo_access'
                || (preview.funding === 'central_apollo_access' && preview.omnivyraCredits == null)}
              onClick={run}
              className="rounded-lg bg-indigo-600 px-3 py-1.5 font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
              Confirm
            </button>
            <button type="button" disabled={busy} onClick={() => setPreview(null)}
              className="rounded-lg border border-gray-300 px-3 py-1.5 text-gray-700">
              Cancel
            </button>
          </div>
        </div>
      ) : null}
      {message ? <p className="mt-2 text-gray-800" role="status">{message}</p> : null}
    </div>
  );
}
