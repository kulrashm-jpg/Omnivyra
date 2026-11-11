/**
 * Super Admin: what each provider costs Omnivyra per unit.
 *
 * Two consumers, ONE pricing engine (vendor cost x the action's cost
 * multiplier, converted at each organisation's credit rate):
 *  - data vendors (central access, mode B) - action `prospect_enrichment`;
 *  - image generation (owner ruling 2026-11-11: charge image credits before
 *    launch) - action `image_generation`, clamped to the catalog's 2-12 credits.
 * Until a cost is set here the matching call REFUSES (fail closed): no
 * central vendor call, no image.
 *
 * Writes go through the existing, audited POST /api/admin/pricing/update
 * (target 'model', kind 'unit'; stored per 1,000 units). That route needs
 * BILLING_PLAN_MANAGE with a passkey step-up, which performSuperAdminWrite runs.
 */
import React, { useState } from 'react';
import useSWR from 'swr';
import { apiFetch } from '@/lib/apiFetch';
import { performSuperAdminWrite, freshIdempotencyHeaders } from '@/lib/security/superAdminWrite';

interface Row { provider: string; unit: string; usdPerUnit: number; effectiveFrom: string; notes: string | null }
interface Rule { cost_multiplier: number; minimum_charge_usd: number; ceiling_usd: number | null }
interface ImageSku { provider: string; model: string; size: string; quality: string; usedBy: string; unit: string; priced: boolean }
interface Payload {
  vendorUnitCosts: Row[];
  pricingRule: Rule | null;
  pricingRules?: Record<string, Rule | null>;
  requiredImageSkus?: ImageSku[];
}

const SAMPLE_CREDIT_RATE_USD = 0.02;

/**
 * USD per unit (as typed) -> USD per 1,000 units, EXACTLY: the decimal point is
 * shifted in the string, never multiplied in binary float (0.0407 * 1000 is
 * 40.699999999999996; this returns 40.7, which serialises as "40.7" into the
 * numeric column). Null for anything that is not a plain positive decimal.
 */
export function toPerThousand(usdPerUnit: string): number | null {
  const t = String(usdPerUnit ?? '').trim();
  const m = /^(\d*)(?:\.(\d+))?$/.exec(t);
  if (!m || (m[1] === '' && m[2] === undefined)) return null;
  const whole = m[1] || '0';
  const frac = (m[2] ?? '').padEnd(3, '0');
  const shifted = `${whole}${frac.slice(0, 3)}${frac.length > 3 ? `.${frac.slice(3)}` : ''}`;
  const n = Number(shifted);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** One save. The typed result is kept: callers branch on `ok`, never on wording. */
export async function saveUnitCost(provider: string, unit: string, usdPerUnit: string, notes: string): Promise<{ ok: boolean; message: string }> {
  const perThousand = toPerThousand(usdPerUnit);
  if (perThousand == null) return { ok: false, message: 'Enter a cost greater than zero.' };
  const r = await performSuperAdminWrite(() => apiFetch('/api/admin/pricing/update', {
    method: 'POST',
    headers: freshIdempotencyHeaders(),
    body: JSON.stringify({
      target: 'model', provider: provider.trim().toLowerCase(), model_name: unit.trim().toLowerCase(), kind: 'unit',
      input_per_1k_usd: perThousand, output_per_1k_usd: 0, notes,
    }),
  }));
  return r.ok ? { ok: true, message: 'Saved as a new version.' } : { ok: false, message: `Not saved: ${r.message}` };
}

export default function VendorUnitCostsSection() {
  const { data, error, mutate } = useSWR<Payload>('/api/admin/pricing/vendor-unit-costs',
    (u: string) => apiFetch(u).then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.json(); }));
  const [provider, setProvider] = useState('apollo');
  const [unit, setUnit] = useState('credit');
  const [usd, setUsd] = useState('');
  const [imageUsd, setImageUsd] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);

  const vendorMultiplier = data?.pricingRules?.prospect_enrichment?.cost_multiplier ?? data?.pricingRule?.cost_multiplier ?? null;
  const imageMultiplier = data?.pricingRules?.image_generation?.cost_multiplier ?? null;
  const creditsAt = (usdPerUnit: number, multiplier: number | null) => (multiplier == null ? null
    : Math.ceil(Number(((usdPerUnit * multiplier) / SAMPLE_CREDIT_RATE_USD).toFixed(9))));
  const costOf = (p: string, u: string) => data?.vendorUnitCosts.find((r) => String(r.provider).toLowerCase() === p && String(r.unit).toLowerCase() === u);

  const saveVendor = async () => {
    setMessage(null);
    const r = await saveUnitCost(provider, unit, usd, 'Data vendor unit cost (mode B central access).');
    setMessage(r.message);
    if (r.ok) { setUsd(''); await mutate(); }
  };

  const saveImage = async (sku: ImageSku) => {
    setMessage(null);
    const r = await saveUnitCost(sku.provider, sku.unit, imageUsd[sku.unit] ?? '', `Image generation unit cost (${sku.usedBy}).`);
    setMessage(`${sku.unit}: ${r.message}`);
    if (r.ok) { setImageUsd((m) => ({ ...m, [sku.unit]: '' })); await mutate(); }
  };

  const missingImage = (data?.requiredImageSkus ?? []).filter((k) => !k.priced);

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-4" data-testid="vendor-unit-costs">
      <h2 className="text-base font-semibold text-gray-900">Provider unit costs</h2>
      <p className="mt-1 text-sm text-gray-600">
        What Omnivyra pays each provider per unit. Tenants are charged cost x the action multiplier in credits,
        at their own credit rate. A provider unit without a cost here cannot be used.
      </p>
      {error ? <p className="mt-2 text-sm text-rose-600">Could not load provider costs.</p> : null}

      <h3 className="mt-4 text-sm font-semibold text-gray-900">Image generation (OpenAI)</h3>
      {data && data.pricingRules?.image_generation == null ? (
        <p className="mt-1 text-sm text-amber-700">The image_generation pricing rule is not configured; image generation will refuse.</p>
      ) : null}
      {data && missingImage.length > 0 ? (
        <p className="mt-1 text-sm text-amber-700" data-testid="image-skus-missing">
          {missingImage.length} image size/quality cost{missingImage.length === 1 ? '' : 's'} not set: those images are refused until set.
        </p>
      ) : null}
      <table className="mt-2 w-full text-left text-sm" data-testid="image-skus">
        <thead><tr className="text-xs uppercase text-gray-500">
          <th className="py-1">Model / size / quality</th><th className="py-1">Used by</th><th className="py-1">USD per image</th>
          <th className="py-1">Credits at ${SAMPLE_CREDIT_RATE_USD}/credit (x{imageMultiplier ?? '-'}, 2-12)</th><th className="py-1">Set</th>
        </tr></thead>
        <tbody>
          {(data?.requiredImageSkus ?? []).map((k) => {
            const cost = costOf(k.provider, k.unit);
            const credits = cost ? creditsAt(cost.usdPerUnit, imageMultiplier) : null;
            return (
              <tr key={k.unit} className="border-t border-gray-100">
                <td className="py-1 font-mono text-xs">{k.unit}</td>
                <td className="py-1">{k.usedBy}</td>
                <td className="py-1">{cost ? `$${cost.usdPerUnit.toFixed(4)}` : <span className="text-amber-700">not set</span>}</td>
                <td className="py-1">{credits == null ? '-' : Math.min(12, Math.max(2, credits))}</td>
                <td className="py-1">
                  <input aria-label={`USD per image ${k.unit}`} type="number" step="0.0001" min="0" value={imageUsd[k.unit] ?? ''}
                    onChange={(e) => setImageUsd((m) => ({ ...m, [k.unit]: e.target.value }))} className="w-24 rounded border px-2 py-1" />
                  <button type="button" onClick={() => saveImage(k)} className="ml-1 rounded bg-indigo-600 px-2 py-1 text-xs font-medium text-white">Save</button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <h3 className="mt-4 text-sm font-semibold text-gray-900">Data vendors (central access)</h3>
      {data?.pricingRule == null && data ? (
        <p className="mt-1 text-sm text-amber-700">The prospect_enrichment pricing rule is not configured; central access will refuse.</p>
      ) : null}
      <table className="mt-2 w-full text-left text-sm">
        <thead><tr className="text-xs uppercase text-gray-500">
          <th className="py-1">Vendor</th><th className="py-1">Unit</th><th className="py-1">USD per unit</th>
          <th className="py-1">Credits per unit at ${SAMPLE_CREDIT_RATE_USD}/credit</th><th className="py-1">Since</th>
        </tr></thead>
        <tbody>
          {(data?.vendorUnitCosts ?? []).filter((r) => String(r.provider).toLowerCase() !== 'openai').map((r) => (
            <tr key={`${r.provider}:${r.unit}`} className="border-t border-gray-100">
              <td className="py-1">{r.provider}</td><td className="py-1">{r.unit}</td>
              <td className="py-1">${r.usdPerUnit.toFixed(4)}</td>
              <td className="py-1">{creditsAt(r.usdPerUnit, vendorMultiplier) ?? '-'}</td>
              <td className="py-1">{new Date(r.effectiveFrom).toLocaleDateString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-3 flex flex-wrap items-end gap-2 text-sm">
        <label>Vendor<input aria-label="Vendor" value={provider} onChange={(e) => setProvider(e.target.value)} className="ml-1 w-28 rounded border px-2 py-1" /></label>
        <label>Unit<input aria-label="Unit" value={unit} onChange={(e) => setUnit(e.target.value)} className="ml-1 w-24 rounded border px-2 py-1" /></label>
        <label>USD per unit<input aria-label="USD per unit" type="number" step="0.0001" min="0" value={usd} onChange={(e) => setUsd(e.target.value)} className="ml-1 w-28 rounded border px-2 py-1" /></label>
        <button type="button" onClick={saveVendor} className="rounded bg-indigo-600 px-3 py-1.5 font-medium text-white">Save new version</button>
      </div>
      {message ? <p className="mt-2 text-sm text-gray-700" role="status">{message}</p> : null}
    </section>
  );
}
