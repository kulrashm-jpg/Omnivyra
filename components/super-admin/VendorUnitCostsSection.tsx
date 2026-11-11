/**
 * Super Admin: what each DATA VENDOR costs Omnivyra per unit (mode B).
 *
 * Central vendor access (e.g. Omnivyra's Apollo key) is charged to tenants in
 * credits at vendor cost x the `prospect_enrichment` cost multiplier (1.5),
 * converted at each organisation's credit rate. Until a vendor's unit cost is
 * set here, central access for that vendor REFUSES.
 *
 * Writes go through the existing, audited POST /api/admin/pricing/update
 * (target 'model', kind 'unit'); the cost is stored per 1,000 units.
 */
import React, { useState } from 'react';
import useSWR from 'swr';
import { apiFetch } from '@/lib/apiFetch';

interface Row { provider: string; unit: string; usdPerUnit: number; effectiveFrom: string; notes: string | null }
interface Payload {
  vendorUnitCosts: Row[];
  pricingRule: { cost_multiplier: number; minimum_charge_usd: number; ceiling_usd: number | null } | null;
}

const SAMPLE_CREDIT_RATE_USD = 0.02;

export default function VendorUnitCostsSection() {
  const { data, error, mutate } = useSWR<Payload>('/api/admin/pricing/vendor-unit-costs',
    (u: string) => apiFetch(u).then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.json(); }));
  const [provider, setProvider] = useState('apollo');
  const [unit, setUnit] = useState('credit');
  const [usd, setUsd] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  const multiplier = data?.pricingRule?.cost_multiplier ?? null;
  const creditsPerUnit = (usdPerUnit: number) => (multiplier == null ? null
    : Math.ceil(Number(((usdPerUnit * multiplier) / SAMPLE_CREDIT_RATE_USD).toFixed(9))));

  const save = async () => {
    setMessage(null);
    const value = Number(usd);
    if (!(value > 0)) { setMessage('Enter a cost greater than zero.'); return; }
    const res = await apiFetch('/api/admin/pricing/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `vendor-unit:${provider}:${unit}:${value}:${Date.now()}` },
      body: JSON.stringify({
        target: 'model', provider: provider.trim().toLowerCase(), model_name: unit.trim().toLowerCase(), kind: 'unit',
        input_per_1k_usd: value * 1000, output_per_1k_usd: 0,
        notes: 'Data vendor unit cost (mode B central access).',
      }),
    });
    setMessage(res.ok ? 'Saved as a new version. Central access now prices from this cost.' : 'Not saved.');
    if (res.ok) { setUsd(''); await mutate(); }
  };

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-4" data-testid="vendor-unit-costs">
      <h2 className="text-base font-semibold text-gray-900">Provider unit costs (data vendors)</h2>
      <p className="mt-1 text-sm text-gray-600">
        What Omnivyra pays each data vendor per unit when a tenant uses central access.
        Tenants are charged this cost x {multiplier ?? '—'} in credits, at their own credit rate.
        A vendor without a cost here cannot be used centrally.
      </p>
      {error ? <p className="mt-2 text-sm text-rose-600">Could not load vendor costs.</p> : null}
      {data?.pricingRule == null && data ? (
        <p className="mt-2 text-sm text-amber-700">The prospect_enrichment pricing rule is not configured; central access will refuse.</p>
      ) : null}
      <table className="mt-3 w-full text-left text-sm">
        <thead><tr className="text-xs uppercase text-gray-500">
          <th className="py-1">Vendor</th><th className="py-1">Unit</th><th className="py-1">USD per unit</th>
          <th className="py-1">Credits per unit at ${SAMPLE_CREDIT_RATE_USD}/credit</th><th className="py-1">Since</th>
        </tr></thead>
        <tbody>
          {(data?.vendorUnitCosts ?? []).map((r) => (
            <tr key={`${r.provider}:${r.unit}`} className="border-t border-gray-100">
              <td className="py-1">{r.provider}</td><td className="py-1">{r.unit}</td>
              <td className="py-1">${r.usdPerUnit.toFixed(4)}</td>
              <td className="py-1">{creditsPerUnit(r.usdPerUnit) ?? '—'}</td>
              <td className="py-1">{new Date(r.effectiveFrom).toLocaleDateString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-3 flex flex-wrap items-end gap-2 text-sm">
        <label>Vendor<input aria-label="Vendor" value={provider} onChange={(e) => setProvider(e.target.value)} className="ml-1 w-28 rounded border px-2 py-1" /></label>
        <label>Unit<input aria-label="Unit" value={unit} onChange={(e) => setUnit(e.target.value)} className="ml-1 w-24 rounded border px-2 py-1" /></label>
        <label>USD per unit<input aria-label="USD per unit" type="number" step="0.0001" min="0" value={usd} onChange={(e) => setUsd(e.target.value)} className="ml-1 w-28 rounded border px-2 py-1" /></label>
        <button type="button" onClick={save} className="rounded bg-indigo-600 px-3 py-1.5 font-medium text-white">Save new version</button>
      </div>
      {message ? <p className="mt-2 text-sm text-gray-700" role="status">{message}</p> : null}
    </section>
  );
}
