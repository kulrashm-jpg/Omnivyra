/**
 * The tenant DATA-CONTROLLER notice (owner requirement, 2026-11-11).
 *
 * Shown on every connect and fetch for the categories involved. Informational
 * once accepted; when a category needs an acceptance (never accepted, a new
 * category, a lapsed or changed wording) a tenant ADMIN can tick "I accept".
 * In GRACE (updated wording, not yet re-accepted) it says so prominently and
 * by when. The server enforces; this only shows and records.
 */
import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '@/lib/apiFetch';
import { useCompanyContext } from '@/components/CompanyContext';

type Category = 'vendor_data' | 'salesnav_capture' | 'contact_data';
type State = 'required' | 'current' | 'grace' | 'expired' | 'text_changed' | 'unknown';
interface Notice { version: string; status: string; title: string; intro: string; categories: Record<Category, string>; textSha256: string }
interface CatStatus { state: State; allowed: boolean; acceptedAt: string | null; graceEndsAt: string | null }
interface Payload { notice: Notice; readable: boolean; categories: Record<Category, CatStatus> }

const NEEDS_TICK: State[] = ['required', 'grace', 'expired', 'text_changed'];

/** For pages under CompanyProvider: the notice for the SELECTED company. */
export function TenantDataNoticeForSelectedCompany({ categories }: { categories: Category[] }) {
  const { selectedCompanyId } = useCompanyContext();
  return <TenantDataNotice companyId={selectedCompanyId ?? null} categories={categories} />;
}

export default function TenantDataNotice({ companyId, categories }: { companyId: string | null; categories: Category[] }) {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ticked, setTicked] = useState(false);
  const [saving, setSaving] = useState(false);
  const url = companyId ? `/api/compliance/tenant-data-ack?companyId=${encodeURIComponent(companyId)}` : null;

  const load = useCallback(() => {
    if (!url) return () => undefined;
    let live = true;
    apiFetch(url).then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((b: Payload) => { if (live && b?.notice && b?.categories) setData(b); else if (live) setError('The data notice could not be loaded.'); })
      .catch(() => { if (live) setError('The data notice could not be loaded.'); });
    return () => { live = false; };
  }, [url]);
  useEffect(() => load(), [load]);

  if (!companyId) return null;
  if (error) return <p className="text-sm text-rose-600" role="alert">{error}</p>;
  if (!data) return null;

  const due = categories.filter((c) => NEEDS_TICK.includes(data.categories[c]?.state));
  const blocking = categories.filter((c) => !data.categories[c]?.allowed);
  const grace = categories.filter((c) => data.categories[c]?.state === 'grace');

  const accept = async () => {
    setSaving(true); setError(null);
    const res = await apiFetch(url!, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ categories: due, shownVersion: data.notice.version, shownTextSha256: data.notice.textSha256 }),
    });
    if (res.ok) { setTicked(false); load(); }
    else {
      const b = await res.json().catch(() => ({}));
      setError(b?.code === 'not_company_admin' ? 'Only a company admin can accept this notice.'
        : b?.code === 'stale_notice' ? 'The notice changed while you were reading it. Please review it again.'
          : 'Your acceptance could not be recorded. Please try again.');
    }
    setSaving(false);
  };

  return (
    <section className="mb-4 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm" data-testid="tenant-data-notice" aria-labelledby="tdn-title">
      <h3 id="tdn-title" className="font-semibold text-slate-900">{data.notice.title}</h3>
      {data.notice.status && <p className="text-xs text-amber-700">{data.notice.status}</p>}
      <p className="mt-1 text-slate-700">{data.notice.intro}</p>
      <ul className="mt-1 list-disc pl-5 text-slate-700">
        {categories.map((c) => <li key={c}>{data.notice.categories[c]}</li>)}
      </ul>
      {grace.length > 0 && (
        <p className="mt-2 font-medium text-amber-800" data-testid="tdn-grace">
          Updated terms: please re-accept by {new Date(data.categories[grace[0]].graceEndsAt ?? '').toLocaleDateString()}. Until then this keeps working.
        </p>
      )}
      {blocking.length > 0 && (
        <p className="mt-2 font-medium text-rose-700" data-testid="tdn-blocked">
          A company admin must accept this notice before these data sources can be used.
        </p>
      )}
      {due.length > 0 ? (
        <div className="mt-2">
          <label className="flex items-start gap-2">
            <input type="checkbox" checked={ticked} onChange={(e) => setTicked(e.target.checked)} data-testid="tdn-tick" />
            <span>I accept, on behalf of my organisation, that we are the data controller for this data and responsible for compliance.</span>
          </label>
          <button type="button" disabled={!ticked || saving} onClick={accept}
            className="mt-2 rounded bg-indigo-600 px-3 py-1 text-white disabled:opacity-50" data-testid="tdn-accept">
            Accept
          </button>
        </div>
      ) : (
        <p className="mt-2 text-xs text-slate-500" data-testid="tdn-accepted">
          Accepted by your organisation (notice version {data.notice.version}).
        </p>
      )}
    </section>
  );
}
