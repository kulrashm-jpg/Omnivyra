/**
 * Phase 2 — Listening configuration dialog.
 *
 * Compact modal — NOT a redesign. Mounted from
 * LeadsCapabilityStatusPanel via the "Configure listening" button.
 *
 * Activation flow:
 *   1. User picks a mode + platforms + keyword count + industry.
 *   2. POST /api/active-leads/credit-estimate → estimate + guidance.
 *   3. User reads warnings + explicit "I understand credit usage" +
 *      "I understand consent is required" checkboxes.
 *   4. POST /api/active-leads/configuration with the estimate_hash.
 *      Server refuses on stale hash, ineligible platforms, exceeded ceiling.
 *
 * No silent activation. Both acknowledgements are mandatory.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';

type ListeningMode = 'manual_only' | 'daily' | 'alternate_days' | 'weekly';
type IndustryVolatility = 'high' | 'moderate' | 'low';

type CreditEstimate = {
  per_run: number;
  runs_per_month: number;
  monthly_min: number;
  monthly_max: number;
  monthly_expected: number;
  industry_volatility: IndustryVolatility;
  high_activity_warning: boolean;
  estimate_hash: string;
  inputs_snapshot: {
    mode: ListeningMode;
    platforms: string[];
    keyword_count: number;
    industry_volatility: IndustryVolatility;
    source_count: number;
  };
};

type Guidance = {
  recommended_mode: ListeningMode;
  signal_density_expectation: 'low' | 'moderate' | 'high';
  rationale: string;
  industry_volatility: IndustryVolatility;
  warnings: string[];
};

type EstimateResponse = {
  estimate: CreditEstimate;
  guidance: Guidance;
  readiness_warnings: string[];
};

type ConfigurationRow = {
  id: string;
  organization_id: string;
  mode: ListeningMode;
  platforms: string[];
  keyword_count: number;
  industry_category: string | null;
  industry_volatility: IndustryVolatility | null;
  monthly_credit_ceiling: number;
  daily_run_ceiling: number;
  cooldown_minutes: number;
  estimated_monthly_credits_min: number;
  estimated_monthly_credits_max: number;
  estimated_credits_per_run: number;
  next_planned_run_at: string | null;
  last_confirmation_at: string | null;
};

type MonitoringStatus = {
  organization_id: string;
  window_hours: number;
  generated_at: string;
  totals_by_status: Record<string, number>;
  totals_by_block_reason: Record<string, number>;
  next_planned_run_at: string | null;
  last_completed_run_at: string | null;
};

type FetchWithAuth = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

type Props = {
  companyId: string;
  fetchWithAuth: FetchWithAuth;
  isOpen: boolean;
  onClose: () => void;
  onActivated?: () => void;
  /** Platforms that the user has already enabled listening on. Pre-fills the form. */
  availablePlatforms: string[];
};

const MODE_LABELS: Record<ListeningMode, string> = {
  manual_only: 'Manual only',
  daily: 'Daily',
  alternate_days: 'Alternate days',
  weekly: 'Weekly',
};

const MODE_DESCRIPTIONS: Record<ListeningMode, string> = {
  manual_only: 'No scheduled monitoring. You trigger every scan from /api/leads/job/create.',
  daily: '~30 runs/month. Best for high-velocity industries.',
  alternate_days: '~15 runs/month. Balanced cadence for most B2B.',
  weekly: '~4 runs/month. Sufficient for slow-moving industries.',
};

export default function ListeningConfigurationDialog({
  companyId,
  fetchWithAuth,
  isOpen,
  onClose,
  onActivated,
  availablePlatforms,
}: Props) {
  const [mode, setMode] = useState<ListeningMode>('manual_only');
  const [platforms, setPlatforms] = useState<string[]>([]);
  const [keywordCount, setKeywordCount] = useState<number>(5);
  const [industryCategory, setIndustryCategory] = useState<string>('');
  const [industryVolatility, setIndustryVolatility] = useState<IndustryVolatility | ''>('');
  const [monthlyCeiling, setMonthlyCeiling] = useState<number>(2000);
  const [dailyCeiling, setDailyCeiling] = useState<number>(1);
  const [cooldown, setCooldown] = useState<number>(60);
  const [estimate, setEstimate] = useState<EstimateResponse | null>(null);
  const [loadingEstimate, setLoadingEstimate] = useState<boolean>(false);
  const [activating, setActivating] = useState<boolean>(false);
  const [ackCredit, setAckCredit] = useState<boolean>(false);
  const [ackConsent, setAckConsent] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Reset acknowledgements whenever the estimate inputs change — a stale ack
  // on a new estimate would defeat the whole confirmation contract.
  useEffect(() => {
    setAckCredit(false);
    setAckConsent(false);
  }, [mode, platforms.join(','), keywordCount, industryCategory, industryVolatility]);

  useEffect(() => {
    if (!isOpen) return;
    setPlatforms(availablePlatforms.slice(0, 5));
  }, [isOpen, availablePlatforms]);

  const fetchEstimate = useCallback(async () => {
    if (!companyId) return;
    setLoadingEstimate(true);
    setErrorMsg(null);
    try {
      const response = await fetchWithAuth('/api/active-leads/credit-estimate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId,
          mode,
          platforms,
          keywordCount,
          industryCategory: industryCategory || null,
          industryVolatility: industryVolatility || null,
        }),
      });
      if (!response.ok) {
        const body = await response.text();
        throw new Error(`Failed to load estimate (${response.status}): ${body}`);
      }
      const json: EstimateResponse = await response.json();
      setEstimate(json);
    } catch (err: any) {
      setErrorMsg(err?.message ?? 'Failed to load estimate');
      setEstimate(null);
    } finally {
      setLoadingEstimate(false);
    }
  }, [companyId, fetchWithAuth, mode, platforms, keywordCount, industryCategory, industryVolatility]);

  useEffect(() => {
    if (!isOpen) return;
    void fetchEstimate();
  }, [isOpen, fetchEstimate]);

  const onTogglePlatform = useCallback((platform: string) => {
    setPlatforms((prev) => (prev.includes(platform) ? prev.filter((p) => p !== platform) : [...prev, platform]));
  }, []);

  const canActivate = useMemo(() => {
    if (!estimate) return false;
    if (mode === 'manual_only') return true;
    if (!ackCredit || !ackConsent) return false;
    if (platforms.length === 0) return false;
    if (monthlyCeiling > 0 && estimate.estimate.monthly_max > monthlyCeiling) return false;
    return true;
  }, [estimate, mode, ackCredit, ackConsent, platforms.length, monthlyCeiling]);

  const onActivate = useCallback(async () => {
    if (!estimate || !companyId) return;
    setActivating(true);
    setErrorMsg(null);
    try {
      const response = await fetchWithAuth('/api/active-leads/configuration', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId,
          mode,
          platforms,
          keywordCount,
          industryCategory: industryCategory || null,
          industryVolatility: industryVolatility || null,
          monthlyCreditCeiling: monthlyCeiling,
          dailyRunCeiling: dailyCeiling,
          cooldownMinutes: cooldown,
          estimateHash: estimate.estimate.estimate_hash,
          acknowledgeCreditEstimate: ackCredit,
          acknowledgeConsentRequirement: ackConsent,
        }),
      });
      const json = await response.json();
      if (!response.ok || json.ok === false) {
        const detail = json?.detail ?? json?.error ?? 'Activation failed';
        throw new Error(detail);
      }
      onActivated?.();
      onClose();
    } catch (err: any) {
      setErrorMsg(err?.message ?? 'Activation failed');
    } finally {
      setActivating(false);
    }
  }, [estimate, companyId, fetchWithAuth, mode, platforms, keywordCount, industryCategory, industryVolatility, monthlyCeiling, dailyCeiling, cooldown, ackCredit, ackConsent, onActivated, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={onClose}>
      <div
        className="w-full max-w-2xl rounded-lg border border-slate-200 bg-white shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-slate-200 px-4 py-3">
          <h3 className="text-sm font-semibold text-slate-900">Configure autonomous listening</h3>
          <p className="text-xs text-slate-500">
            Nothing is monitored until you explicitly confirm. You can return to manual any time.
          </p>
        </div>

        <div className="max-h-[70vh] overflow-y-auto px-4 py-3 text-sm text-slate-800">
          <fieldset className="mb-4">
            <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Mode</legend>
            <div className="grid grid-cols-2 gap-2">
              {(Object.keys(MODE_LABELS) as ListeningMode[]).map((m) => (
                <label
                  key={m}
                  className={`flex cursor-pointer items-start gap-2 rounded border p-2 ${
                    mode === m ? 'border-emerald-500 bg-emerald-50' : 'border-slate-200'
                  }`}
                >
                  <input type="radio" name="mode" value={m} checked={mode === m} onChange={() => setMode(m)} />
                  <span>
                    <span className="block text-sm font-medium">{MODE_LABELS[m]}</span>
                    <span className="block text-xs text-slate-500">{MODE_DESCRIPTIONS[m]}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          {mode !== 'manual_only' && (
            <>
              <fieldset className="mb-4">
                <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Platforms</legend>
                <div className="flex flex-wrap gap-2">
                  {availablePlatforms.length === 0 && (
                    <span className="text-xs text-rose-700">No listening-enabled platforms available.</span>
                  )}
                  {availablePlatforms.map((p) => (
                    <label key={p} className="inline-flex items-center gap-1 rounded border border-slate-200 px-2 py-1 text-xs">
                      <input
                        type="checkbox"
                        checked={platforms.includes(p)}
                        onChange={() => onTogglePlatform(p)}
                      />
                      <span>{p}</span>
                    </label>
                  ))}
                </div>
              </fieldset>

              <div className="mb-4 grid grid-cols-2 gap-3">
                <label className="text-xs text-slate-600">
                  <span className="block">Keyword count</span>
                  <input
                    type="number"
                    min={0}
                    max={500}
                    value={keywordCount}
                    onChange={(e) => setKeywordCount(parseInt(e.target.value || '0', 10))}
                    className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm"
                  />
                </label>
                <label className="text-xs text-slate-600">
                  <span className="block">Industry category</span>
                  <input
                    type="text"
                    value={industryCategory}
                    placeholder="e.g. SaaS, e-commerce, fintech"
                    onChange={(e) => setIndustryCategory(e.target.value)}
                    className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm"
                  />
                </label>
                <label className="text-xs text-slate-600">
                  <span className="block">Industry volatility (optional)</span>
                  <select
                    value={industryVolatility}
                    onChange={(e) => setIndustryVolatility((e.target.value || '') as IndustryVolatility | '')}
                    className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm"
                  >
                    <option value="">Auto-infer</option>
                    <option value="high">High</option>
                    <option value="moderate">Moderate</option>
                    <option value="low">Low</option>
                  </select>
                </label>
                <label className="text-xs text-slate-600">
                  <span className="block">Monthly credit ceiling</span>
                  <input
                    type="number"
                    min={0}
                    value={monthlyCeiling}
                    onChange={(e) => setMonthlyCeiling(parseInt(e.target.value || '0', 10))}
                    className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm"
                  />
                </label>
                <label className="text-xs text-slate-600">
                  <span className="block">Daily run ceiling</span>
                  <input
                    type="number"
                    min={1}
                    max={24}
                    value={dailyCeiling}
                    onChange={(e) => setDailyCeiling(parseInt(e.target.value || '1', 10))}
                    className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm"
                  />
                </label>
                <label className="text-xs text-slate-600">
                  <span className="block">Cooldown (minutes)</span>
                  <input
                    type="number"
                    min={0}
                    value={cooldown}
                    onChange={(e) => setCooldown(parseInt(e.target.value || '0', 10))}
                    className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm"
                  />
                </label>
              </div>
            </>
          )}

          {loadingEstimate && (
            <div className="mb-3 rounded border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
              Estimating credit burn…
            </div>
          )}

          {estimate && (
            <div className="mb-3 rounded border border-slate-200 bg-slate-50 px-3 py-2 text-xs">
              <div className="font-semibold text-slate-700">Estimate</div>
              <div className="mt-1 grid grid-cols-2 gap-1 text-slate-700">
                <div>Per run: <strong>{estimate.estimate.per_run}</strong></div>
                <div>Runs/month: <strong>{estimate.estimate.runs_per_month}</strong></div>
                <div>Monthly min: <strong>{estimate.estimate.monthly_min}</strong></div>
                <div>Monthly max: <strong>{estimate.estimate.monthly_max}</strong></div>
              </div>
              <div className="mt-2 text-slate-600">
                <strong>Recommendation:</strong> {MODE_LABELS[estimate.guidance.recommended_mode]} — {estimate.guidance.rationale}
              </div>
              {estimate.estimate.high_activity_warning && (
                <div className="mt-1 text-amber-700">⚠ High-activity industry — credit burn may run near the upper bound.</div>
              )}
              {estimate.readiness_warnings.length > 0 && (
                <ul className="mt-1 list-disc pl-4 text-amber-700">
                  {estimate.readiness_warnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              )}
              {estimate.guidance.warnings.length > 0 && (
                <ul className="mt-1 list-disc pl-4 text-rose-700">
                  {estimate.guidance.warnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              )}
              {monthlyCeiling > 0 && estimate.estimate.monthly_max > monthlyCeiling && (
                <div className="mt-1 text-rose-700">
                  Projected monthly max ({estimate.estimate.monthly_max}) exceeds your ceiling ({monthlyCeiling}).
                </div>
              )}
            </div>
          )}

          {mode !== 'manual_only' && (
            <div className="mb-3 space-y-2 rounded border border-slate-200 px-3 py-2 text-xs">
              <label className="flex items-start gap-2">
                <input type="checkbox" checked={ackCredit} onChange={(e) => setAckCredit(e.target.checked)} />
                <span>
                  I understand the credit burn estimate and accept the monthly ceiling above.
                </span>
              </label>
              <label className="flex items-start gap-2">
                <input type="checkbox" checked={ackConsent} onChange={(e) => setAckConsent(e.target.checked)} />
                <span>
                  I confirm consent has been recorded for the selected platforms and that monitoring may be
                  blocked if consent becomes stale (180 days) or scopes are revoked.
                </span>
              </label>
            </div>
          )}

          {errorMsg && (
            <div className="mb-3 rounded border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
              {errorMsg}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-200 px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
            disabled={activating}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onActivate}
            disabled={!canActivate || activating}
            className="rounded bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {activating ? 'Activating…' : mode === 'manual_only' ? 'Save (manual only)' : 'Activate monitoring'}
          </button>
        </div>
      </div>
    </div>
  );
}
