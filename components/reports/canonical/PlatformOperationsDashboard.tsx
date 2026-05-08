'use client';

type ProviderRow = {
  provider_id: string;
  state: 'healthy' | 'degraded' | 'down' | 'no_data';
  total_calls: number;
  measured_calls: number;
  error_calls: number;
  cache_hit_ratio: number | null;
  p95_latency_ms: number | null;
  quota_pressure_ratio: number | null;
  circuit_breaker_state: 'closed' | 'open' | 'half_open' | 'unknown';
};

type Props = {
  data: {
    observed_at: string;
    window_hours: number;
    tenants_active: number;
    providers: ProviderRow[];
    queue: {
      queued: number;
      running: number;
      failed_in_window: number;
      skipped_in_window: number;
      avg_wait_ms: number | null;
    };
    per_tenant: Array<{
      tenant_id: string;
      scans_in_window: number;
      failed_scans: number;
      cancelled_scans: number;
    }>;
  };
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
 * Platform-wide Operations Dashboard.
 *
 * Cross-tenant operational nervous system. Mounts at /admin/operations and
 * subscribes (in production) to the realtime channel for live updates.
 */
export default function PlatformOperationsDashboard({ data }: Props) {
  return (
    <div className="space-y-6">
      <header>
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Platform Operations</p>
        <h1 className="mt-1 text-2xl font-bold text-slate-900">
          Cross-tenant intelligence operations · last {data.window_hours}h
        </h1>
        <p className="mt-2 text-sm text-slate-600">
          Provider health, scan queue depth, tenant activity. Updated {new Date(data.observed_at).toLocaleString()}.
        </p>
      </header>

      <section className="grid gap-3 sm:grid-cols-4">
        <SummaryStat label="Active tenants" value={data.tenants_active} />
        <SummaryStat label="Queued" value={data.queue.queued} />
        <SummaryStat label="Running" value={data.queue.running} />
        <SummaryStat
          label="Avg wait"
          value={data.queue.avg_wait_ms != null ? `${Math.round(data.queue.avg_wait_ms / 1000)}s` : '—'}
        />
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Provider health</p>
        <h3 className="mt-1 text-lg font-bold text-slate-900">Cross-tenant uptime, latency, breaker state</h3>
        <div className="mt-3 overflow-hidden rounded-lg border border-slate-200">
          <table className="w-full border-collapse text-xs">
            <thead className="bg-slate-50">
              <tr>
                <th className="border-b border-slate-200 px-3 py-2 text-left font-semibold text-slate-600">Provider</th>
                <th className="border-b border-slate-200 px-3 py-2 text-center font-semibold text-slate-600">State</th>
                <th className="border-b border-slate-200 px-3 py-2 text-center font-semibold text-slate-600">Calls</th>
                <th className="border-b border-slate-200 px-3 py-2 text-center font-semibold text-slate-600">Measured</th>
                <th className="border-b border-slate-200 px-3 py-2 text-center font-semibold text-slate-600">Cache</th>
                <th className="border-b border-slate-200 px-3 py-2 text-center font-semibold text-slate-600">P95</th>
                <th className="border-b border-slate-200 px-3 py-2 text-center font-semibold text-slate-600">Quota %</th>
                <th className="border-b border-slate-200 px-3 py-2 text-center font-semibold text-slate-600">Breaker</th>
              </tr>
            </thead>
            <tbody>
              {data.providers.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-3 py-6 text-center text-slate-500">
                    No provider activity in the last {data.window_hours} hours.
                  </td>
                </tr>
              ) : (
                data.providers.map((p) => (
                  <tr key={p.provider_id}>
                    <td className="border-b border-slate-200 px-3 py-2 font-mono text-[11px] text-slate-800">
                      {p.provider_id}
                    </td>
                    <td className="border-b border-slate-200 px-3 py-2 text-center">
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${STATE_TONE[p.state]}`}>
                        {p.state}
                      </span>
                    </td>
                    <td className="border-b border-slate-200 px-3 py-2 text-center text-slate-700">{p.total_calls}</td>
                    <td className="border-b border-slate-200 px-3 py-2 text-center text-slate-700">{p.measured_calls}</td>
                    <td className="border-b border-slate-200 px-3 py-2 text-center text-slate-700">
                      {p.cache_hit_ratio != null ? `${Math.round(p.cache_hit_ratio * 100)}%` : '—'}
                    </td>
                    <td className="border-b border-slate-200 px-3 py-2 text-center text-slate-700">
                      {p.p95_latency_ms != null ? `${p.p95_latency_ms}ms` : '—'}
                    </td>
                    <td className="border-b border-slate-200 px-3 py-2 text-center text-slate-700">
                      {p.quota_pressure_ratio != null ? `${Math.round(p.quota_pressure_ratio * 100)}%` : '—'}
                    </td>
                    <td className="border-b border-slate-200 px-3 py-2 text-center">
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
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Tenant activity</p>
        <h3 className="mt-1 text-lg font-bold text-slate-900">Per-tenant scan summary</h3>
        <div className="mt-3 overflow-hidden rounded-lg border border-slate-200">
          <table className="w-full border-collapse text-xs">
            <thead className="bg-slate-50">
              <tr>
                <th className="border-b border-slate-200 px-3 py-2 text-left font-semibold text-slate-600">Tenant</th>
                <th className="border-b border-slate-200 px-3 py-2 text-center font-semibold text-slate-600">Scans</th>
                <th className="border-b border-slate-200 px-3 py-2 text-center font-semibold text-slate-600">Failed</th>
                <th className="border-b border-slate-200 px-3 py-2 text-center font-semibold text-slate-600">Cancelled</th>
              </tr>
            </thead>
            <tbody>
              {data.per_tenant.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-3 py-6 text-center text-slate-500">
                    No tenant activity in this window.
                  </td>
                </tr>
              ) : (
                data.per_tenant.map((t) => (
                  <tr key={t.tenant_id}>
                    <td className="border-b border-slate-200 px-3 py-2 font-mono text-[11px] text-slate-800">{t.tenant_id}</td>
                    <td className="border-b border-slate-200 px-3 py-2 text-center text-slate-700">{t.scans_in_window}</td>
                    <td className="border-b border-slate-200 px-3 py-2 text-center text-slate-700">{t.failed_scans}</td>
                    <td className="border-b border-slate-200 px-3 py-2 text-center text-slate-700">{t.cancelled_scans}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function SummaryStat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-bold text-slate-900">{value}</p>
    </div>
  );
}
