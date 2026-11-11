/**
 * Billing: the tenant chooses PAID central data-vendor access (mode B).
 *
 * Shows, per vendor, the exact conversion at THIS organisation's credit rate
 * and lets a tenant admin opt in or out. Your own vendor key, when stored,
 * always wins and costs no Omnivyra credits. Credits come from the plan
 * allowance plus top-ups.
 */
import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/apiFetch';
import { useCompanyContext } from '@/components/CompanyContext';

interface VendorRow { vendor: string; unit: string; creditsPerUnit: number | null; available: boolean; optedIn: boolean }
const VENDOR_LABEL: Record<string, string> = { apollo: 'Apollo' };

export default function CentralVendorAccessPanel() {
  const { selectedCompanyId: companyId } = useCompanyContext();
  const [rows, setRows] = useState<VendorRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const url = companyId ? `/api/billing/central-vendor-access?companyId=${encodeURIComponent(companyId)}` : null;

  useEffect(() => {
    if (!url) return;
    let live = true;
    apiFetch(url).then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((b) => { if (live) setRows(Array.isArray(b.vendors) ? b.vendors : []); })
      .catch(() => { if (live) setError('Central data access could not be read.'); });
    return () => { live = false; };
  }, [url]);

  if (!companyId) return null;
  if (error) return <p className="text-sm text-rose-600">{error}</p>;
  if (!rows || rows.length === 0) return null;

  const toggle = async (vendor: string, on: boolean) => {
    setSaving(true); setError(null);
    const next = rows.filter((r) => (r.vendor === vendor ? on : r.optedIn)).map((r) => r.vendor);
    const res = await apiFetch(url!, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ vendors: next }) });
    if (res.ok) setRows(rows.map((r) => (r.vendor === vendor ? { ...r, optedIn: on } : r)));
    else setError('Not saved. Only an admin who manages external APIs can change this.');
    setSaving(false);
  };

  return (
    <section aria-labelledby="central-access-heading" data-testid="central-vendor-access-panel">
      <h2 id="central-access-heading">Central data access</h2>
      <p>Use Omnivyra&apos;s own vendor account instead of yours, paid in credits. Your own key, if stored, always takes precedence and costs no credits.</p>
      <ul>
        {rows.map((r) => {
          const label = VENDOR_LABEL[r.vendor] ?? r.vendor;
          return (
            <li key={r.vendor}>
              <label>
                <input
                  type="checkbox"
                  disabled={saving || !r.available}
                  checked={r.optedIn && r.available}
                  onChange={(e) => toggle(r.vendor, e.target.checked)}
                />{' '}
                Centralized {label} access
                {r.available && r.creditsPerUnit != null
                  ? `: ${r.creditsPerUnit} Omnivyra credits = 1 ${label} ${r.unit}`
                  : ' (not available yet)'}
              </label>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
