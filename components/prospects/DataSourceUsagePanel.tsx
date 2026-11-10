/**
 * "Data sources & usage" (owner, 2026-11-10): what every data source cost and
 * what it brought in, per source, per user, per day and per run.
 *
 * Vendor units are shown in the vendor's own unit so the tenant can reconcile
 * with the vendor's usage page; Omnivyra credits are charged only for central
 * (platform-key) access. A ledger that cannot be read says so; it is never
 * shown as zero.
 */
import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/apiFetch';
import { useCompanyContext } from '@/components/CompanyContext';

interface Totals {
  runs: number; vendorUnits: number; vendorUnitsUnknownRuns: number; creditsCharged: number;
  leadsReceived: number; leadsAdded: number; leadsUpdated: number; heldForReview: number; skippedDuplicates: number;
}
interface Run {
  kind: 'enrichment' | 'discovery' | 'capture'; source: string; runId: string; at: string; userId: string | null;
  funding: 'tenant' | 'platform' | null; vendorUnits: number | null; creditsCharged: number | null; outcome: string | null;
  leadsReceived: number; leadsAdded: number; heldForReview: number; skippedDuplicates: number;
}
interface Report {
  window: { from: string; to: string };
  ledgers: Record<'enrichment' | 'discovery' | 'capture', 'ok' | 'unavailable' | 'truncated'>;
  totals: Totals;
  bySource: Array<{ source: string; kind: string } & Totals>;
  byUser: Array<{ userId: string | null; label: string } & Totals>;
  byDay: Array<{ day: string } & Totals>;
  runs: Run[];
}

const SOURCE_LABEL: Record<string, string> = { apollo: 'Apollo', linkedin_sales_navigator: 'Sales Navigator' };
const KIND_LABEL: Record<string, string> = { enrichment: 'Enrichment', discovery: 'Search', capture: 'Capture' };
const LEDGER_LABEL: Record<string, string> = { enrichment: 'enrichment', discovery: 'search', capture: 'Sales Navigator capture' };
const PERIODS = [7, 30, 90] as const;

const label = (s: string) => SOURCE_LABEL[s] ?? s;
const units = (t: Pick<Totals, 'vendorUnits' | 'vendorUnitsUnknownRuns'>) =>
  t.vendorUnitsUnknownRuns > 0 ? `${t.vendorUnits} (+${t.vendorUnitsUnknownRuns} unrecorded)` : String(t.vendorUnits);

export default function DataSourceUsagePanel() {
  const { selectedCompanyId: companyId } = useCompanyContext();
  const [days, setDays] = useState<number>(30);
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!companyId) return;
    let live = true;
    setError(null);
    const to = new Date();
    const from = new Date(to.getTime() - days * 86_400_000);
    const url = `/api/prospect-sources/usage?companyId=${encodeURIComponent(companyId)}`
      + `&from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`;
    apiFetch(url).then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((b: unknown) => {
        if (!live) return;
        // Render only a well-formed report; anything else is a failed read,
        // never a crash and never a partial page that looks like zero usage.
        const r = b as Partial<Report> | null;
        const ok = !!r && typeof r === 'object' && !!r.ledgers && typeof r.ledgers === 'object' && !!r.totals
          && Array.isArray(r.bySource) && Array.isArray(r.byUser) && Array.isArray(r.byDay) && Array.isArray(r.runs);
        if (ok) setReport(r as Report);
        else { setReport(null); setError('Usage could not be read.'); }
      })
      .catch(() => { if (live) { setReport(null); setError('Usage could not be read.'); } });
    return () => { live = false; };
  }, [companyId, days]);

  if (!companyId) return null;

  const gaps = report ? Object.entries(report.ledgers).filter(([, s]) => s !== 'ok') : [];

  return (
    <section className="mb-8" aria-labelledby="usage-heading" data-testid="data-source-usage-panel">
      <h2 id="usage-heading" className="mb-1 text-base font-semibold text-gray-900">Data sources &amp; usage</h2>
      <p className="mb-3 text-sm text-gray-500">
        What each data source used and what it brought in. Vendor units are in the vendor&apos;s own unit, so
        you can match them against the vendor&apos;s usage page. Omnivyra credits are charged only for
        centralized access; your own key costs no credits.
      </p>
      <div className="mb-3 flex gap-2" role="group" aria-label="Period">
        {PERIODS.map((d) => (
          <button key={d} type="button" aria-pressed={days === d} onClick={() => setDays(d)}
            className={`rounded px-2 py-1 text-sm ${days === d ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-700'}`}>
            Last {d} days
          </button>
        ))}
      </div>

      {error && <p className="text-sm text-rose-600">{error}</p>}
      {gaps.map(([k, s]) => (
        <p key={k} className="text-sm text-amber-700" data-testid={`usage-gap-${k}`}>
          {s === 'unavailable'
            ? `The ${LEDGER_LABEL[k]} usage record is not available yet; it is not counted below.`
            : `More ${LEDGER_LABEL[k]} activity exists than this view shows; choose a shorter period.`}
        </p>
      ))}

      {report && (
        <>
          <p className="mb-3 text-sm text-gray-800" data-testid="usage-totals">
            {report.totals.runs} runs · {units(report.totals)} vendor units · {report.totals.creditsCharged} Omnivyra credits ·{' '}
            {report.totals.leadsAdded} leads added · {report.totals.leadsUpdated} updated · {report.totals.heldForReview} held for review ·{' '}
            {report.totals.skippedDuplicates} duplicates skipped
          </p>

          <h3 className="mt-4 text-sm font-semibold text-gray-900">By source</h3>
          <table className="w-full text-sm" data-testid="usage-by-source">
            <thead><tr><th align="left">Source</th><th align="left">Type</th><th align="right">Runs</th><th align="right">Vendor units</th><th align="right">Credits</th><th align="right">Leads added</th></tr></thead>
            <tbody>
              {report.bySource.map((r) => (
                <tr key={`${r.kind}:${r.source}`}>
                  <td>{label(r.source)}</td><td>{KIND_LABEL[r.kind] ?? r.kind}</td><td align="right">{r.runs}</td>
                  <td align="right">{r.kind === 'capture' ? '-' : units(r)}</td><td align="right">{r.creditsCharged}</td><td align="right">{r.leadsAdded}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <h3 className="mt-4 text-sm font-semibold text-gray-900">By user</h3>
          <table className="w-full text-sm" data-testid="usage-by-user">
            <thead><tr><th align="left">User</th><th align="right">Runs</th><th align="right">Vendor units</th><th align="right">Credits</th><th align="right">Leads added</th></tr></thead>
            <tbody>
              {report.byUser.map((r) => (
                <tr key={r.userId ?? 'system'}>
                  <td>{r.label}</td><td align="right">{r.runs}</td><td align="right">{units(r)}</td>
                  <td align="right">{r.creditsCharged}</td><td align="right">{r.leadsAdded}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <h3 className="mt-4 text-sm font-semibold text-gray-900">By day (UTC)</h3>
          <table className="w-full text-sm" data-testid="usage-by-day">
            <thead><tr><th align="left">Day</th><th align="right">Runs</th><th align="right">Vendor units</th><th align="right">Credits</th><th align="right">Leads added</th></tr></thead>
            <tbody>
              {report.byDay.map((r) => (
                <tr key={r.day}>
                  <td>{r.day}</td><td align="right">{r.runs}</td><td align="right">{units(r)}</td>
                  <td align="right">{r.creditsCharged}</td><td align="right">{r.leadsAdded}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <h3 className="mt-4 text-sm font-semibold text-gray-900">Recent runs</h3>
          <table className="w-full text-sm" data-testid="usage-runs">
            <thead><tr><th align="left">When (UTC)</th><th align="left">Source</th><th align="left">Paid by</th><th align="left">Result</th><th align="right">Vendor units</th><th align="right">Credits</th></tr></thead>
            <tbody>
              {report.runs.map((r) => (
                <tr key={`${r.kind}:${r.runId}`}>
                  <td>{r.at.slice(0, 16).replace('T', ' ')}</td>
                  <td>{label(r.source)} {KIND_LABEL[r.kind]?.toLowerCase()}</td>
                  <td>{r.funding === 'platform' ? 'Omnivyra credits' : r.funding === 'tenant' ? 'Your key' : '-'}</td>
                  <td>{r.outcome ?? '-'}</td>
                  <td align="right">{r.vendorUnits ?? (r.kind === 'capture' ? '-' : 'unrecorded')}</td>
                  <td align="right">{r.creditsCharged ?? '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}
