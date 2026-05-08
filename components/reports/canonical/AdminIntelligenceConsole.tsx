'use client';

type ProviderObservability = {
  observed_at: string;
  window_hours: number;
  providers: Array<{
    provider_id: string;
    state: 'healthy' | 'degraded' | 'down' | 'no_data';
    uptime_pct: number | null;
    total_calls: number;
    cache_hit_ratio: number | null;
    mean_latency_ms: number | null;
    p95_latency_ms: number | null;
    freshness_lag_hours: number | null;
    circuit_breaker_state: 'closed' | 'open' | 'half_open' | 'unknown';
  }>;
};

type ScanMetadata = {
  scan_profile: 'lightweight' | 'standard' | 'deep' | 'manual_refresh' | 'delta_only';
  persisted: boolean;
  persisted_at: string | null;
  cost_summary: {
    total_requests: number;
    total_cost_usd: number;
    cost_known_count: number;
    cost_unknown_count: number;
    per_provider: Record<string, { requests: number; cost_usd: number; cache_hit_ratio: number }>;
  } | null;
};

type Governance = {
  tenant_id: string;
  plan_tier: string;
  policy_revision: string;
  enabled_providers: string[];
  excluded_providers: string[];
  external_calls_forbidden: boolean;
  allowed_scan_profiles: string[];
};

type Props = {
  observability: ProviderObservability;
  scanMetadata: ScanMetadata;
  governance: Governance;
};

const STATE_TONE = {
  healthy: 'bg-emerald-100 text-emerald-800',
  degraded: 'bg-amber-100 text-amber-800',
  down: 'bg-rose-100 text-rose-800',
  no_data: 'bg-slate-100 text-slate-600',
} as const;

const BREAKER_TONE = {
  closed: 'bg-emerald-100 text-emerald-800',
  half_open: 'bg-amber-100 text-amber-800',
  open: 'bg-rose-100 text-rose-800',
  unknown: 'bg-slate-100 text-slate-600',
} as const;

/**
 * Admin Intelligence Console. Renders inside the report (gated by tenant
 * permission) so analysts and admins can inspect provider health, scan cost,
 * and the active tenant policy without leaving the page.
 */
export default function AdminIntelligenceConsole({ observability, scanMetadata, governance }: Props) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Admin Intelligence Console</p>
          <h3 className="mt-1 text-xl font-bold text-slate-900">Provider health, cost, and tenant governance</h3>
          <p className="mt-2 text-sm text-slate-600">
            Operational visibility for the team running this report. Provider health, scan budget, and tenant policy in one panel.
          </p>
        </div>
        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold uppercase text-slate-700">
          tenant: {governance.tenant_id} · plan: {governance.plan_tier}
        </span>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        {/* Provider health */}
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Provider health · last {observability.window_hours}h
          </p>
          <div className="mt-3 overflow-hidden rounded-lg border border-slate-200">
            <table className="w-full border-collapse text-xs">
              <thead className="bg-slate-50">
                <tr>
                  <th className="border-b border-slate-200 px-2 py-1.5 text-left font-semibold text-slate-600">Provider</th>
                  <th className="border-b border-slate-200 px-2 py-1.5 text-center font-semibold text-slate-600">State</th>
                  <th className="border-b border-slate-200 px-2 py-1.5 text-center font-semibold text-slate-600">Uptime</th>
                  <th className="border-b border-slate-200 px-2 py-1.5 text-center font-semibold text-slate-600">Cache</th>
                  <th className="border-b border-slate-200 px-2 py-1.5 text-center font-semibold text-slate-600">P95</th>
                  <th className="border-b border-slate-200 px-2 py-1.5 text-center font-semibold text-slate-600">Breaker</th>
                </tr>
              </thead>
              <tbody>
                {observability.providers.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-3 py-4 text-center text-slate-500">
                      No provider activity in the last {observability.window_hours} hours.
                    </td>
                  </tr>
                ) : (
                  observability.providers.map((p) => (
                    <tr key={p.provider_id}>
                      <td className="border-b border-slate-200 px-2 py-1.5 font-mono text-[11px] text-slate-800">
                        {p.provider_id}
                      </td>
                      <td className="border-b border-slate-200 px-2 py-1.5 text-center">
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${STATE_TONE[p.state]}`}>
                          {p.state}
                        </span>
                      </td>
                      <td className="border-b border-slate-200 px-2 py-1.5 text-center text-[11px] text-slate-700">
                        {p.uptime_pct != null ? `${p.uptime_pct}%` : '—'}
                      </td>
                      <td className="border-b border-slate-200 px-2 py-1.5 text-center text-[11px] text-slate-700">
                        {p.cache_hit_ratio != null ? `${Math.round(p.cache_hit_ratio * 100)}%` : '—'}
                      </td>
                      <td className="border-b border-slate-200 px-2 py-1.5 text-center text-[11px] text-slate-700">
                        {p.p95_latency_ms != null ? `${p.p95_latency_ms}ms` : '—'}
                      </td>
                      <td className="border-b border-slate-200 px-2 py-1.5 text-center">
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${BREAKER_TONE[p.circuit_breaker_state]}`}>
                          {p.circuit_breaker_state}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Cost & policy */}
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">This scan</p>
          <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
            <p>
              <span className="font-semibold">Profile:</span> {scanMetadata.scan_profile}
            </p>
            <p>
              <span className="font-semibold">Persisted:</span>{' '}
              {scanMetadata.persisted ? `yes · ${scanMetadata.persisted_at}` : 'no'}
            </p>
            {scanMetadata.cost_summary ? (
              <>
                <p>
                  <span className="font-semibold">Requests:</span> {scanMetadata.cost_summary.total_requests}
                </p>
                <p>
                  <span className="font-semibold">Cost (known):</span> ${scanMetadata.cost_summary.total_cost_usd.toFixed(4)}{' '}
                  {scanMetadata.cost_summary.cost_unknown_count > 0
                    ? `(${scanMetadata.cost_summary.cost_unknown_count} requests with unknown pricing)`
                    : ''}
                </p>
                {Object.keys(scanMetadata.cost_summary.per_provider).length > 0 ? (
                  <ul className="mt-2 list-disc pl-4">
                    {Object.entries(scanMetadata.cost_summary.per_provider).map(([provider, metrics]) => (
                      <li key={provider}>
                        {provider}: {metrics.requests} req · ${metrics.cost_usd.toFixed(4)} · cache {Math.round(metrics.cache_hit_ratio * 100)}%
                      </li>
                    ))}
                  </ul>
                ) : null}
              </>
            ) : null}
          </div>

          <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-slate-500">Tenant policy</p>
          <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
            <p>
              <span className="font-semibold">Policy revision:</span> {governance.policy_revision}
            </p>
            <p>
              <span className="font-semibold">External calls forbidden:</span>{' '}
              {governance.external_calls_forbidden ? 'yes' : 'no'}
            </p>
            <p>
              <span className="font-semibold">Allowed scan profiles:</span> {governance.allowed_scan_profiles.join(', ')}
            </p>
            <p>
              <span className="font-semibold">Enabled providers:</span> {governance.enabled_providers.join(', ') || 'all'}
            </p>
            {governance.excluded_providers.length > 0 ? (
              <p>
                <span className="font-semibold">Excluded providers:</span> {governance.excluded_providers.join(', ')}
              </p>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}
