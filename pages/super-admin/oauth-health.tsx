/**
 * /super-admin/oauth-health — read-only OAuth diagnostics.
 *
 * Fetches the aggregated view from /api/super-admin/oauth-health (which
 * enforces SUPER_ADMIN_DASHBOARD_VIEW server-side). The page renders
 * what we CAN show without persisting log events:
 *   - Per-provider callback URL + canonical-host validation
 *   - Env presence booleans (never the value)
 *   - DB integration rollup counts (connected / disconnected / error)
 *   - Recent analytics_integrations rows (last 20)
 *
 * No tokens, secrets, OAuth codes, or refresh tokens appear anywhere
 * in the response or this UI.
 */
import React, { useEffect, useState } from 'react';
import Head from 'next/head';
import { apiFetch } from '../../lib/apiFetch';

type EnvPresent =
  | { client_id: boolean; client_secret: boolean }
  | { config_source: 'db'; note: string };

type ProviderHealth = {
  provider: string;
  display_name: string;
  callback_url: string;
  callback_url_ok: boolean;
  callback_url_notes: string[];
  env_present: EnvPresent;
  integrations: {
    connected: number;
    disconnected: number;
    error: number;
    other: number;
    last_updated_at: string | null;
  };
};

type RecentIntegrationRow = {
  id: string;
  provider: string;
  company_id: string;
  status: string;
  updated_at: string;
  last_provider_error: string | null;
};

type HealthResponse = {
  status: 'ok';
  canonical_host: string;
  providers: ProviderHealth[];
  recent_integrations: RecentIntegrationRow[];
  observability: { log_tag: string; note: string };
};

type IntegrationHealthState =
  | 'healthy' | 'degraded' | 'disconnected' | 'invalid_credentials'
  | 'quota_limited' | 'permission_lost' | 'validation_failed' | 'retrying';

type IntegrationHealth = {
  state: IntegrationHealthState;
  score: number;
  last_success_at: string | null;
  last_failure_at: string | null;
  last_validation_at: string | null;
  last_error_code: string | null;
  last_error_message: string | null;
  retry_count: number;
  age_hours: number | null;
  reasons: string[];
};

type IntegrationAuditRow = {
  id: string;
  company_id: string;
  type: string;
  name: string;
  status: string;
  website_connection_id: string | null;
  last_tested_at: string | null;
  updated_at: string;
  health: IntegrationHealth;
};

type TimelineEvent = {
  id: string;
  integration_id: string;
  provider: string;
  event_type: string;
  event_status: 'info' | 'success' | 'warning' | 'error';
  message: string | null;
  created_at: string;
};

type IntegrationAuditResponse = {
  status: 'ok';
  rollup: {
    total: number;
    by_state: Record<IntegrationHealthState, number>;
    by_type: Record<string, { total: number; healthy: number; broken: number }>;
  };
  rows: IntegrationAuditRow[];
  recent_events: TimelineEvent[];
  timeline_table_available: boolean;
};

const STATUS_COLOR: Record<string, string> = {
  connected: 'text-green-700 bg-green-50 border-green-200',
  disconnected: 'text-amber-700 bg-amber-50 border-amber-200',
  error: 'text-red-700 bg-red-50 border-red-200',
};

function StatusBadge({ s }: { s: string }) {
  const cls = STATUS_COLOR[s.toLowerCase()] ?? 'text-gray-700 bg-gray-50 border-gray-200';
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${cls}`}>{s}</span>
  );
}

function YesNo({ ok, true_label, false_label }: { ok: boolean; true_label: string; false_label: string }) {
  return (
    <span className={ok ? 'text-green-700' : 'text-red-700'}>
      {ok ? '✓ ' + true_label : '✗ ' + false_label}
    </span>
  );
}

const HEALTH_STATE_COLOR: Record<IntegrationHealthState, string> = {
  healthy: 'text-green-700 bg-green-50 border-green-200',
  degraded: 'text-amber-700 bg-amber-50 border-amber-200',
  retrying: 'text-blue-700 bg-blue-50 border-blue-200',
  quota_limited: 'text-orange-700 bg-orange-50 border-orange-200',
  permission_lost: 'text-red-700 bg-red-50 border-red-200',
  invalid_credentials: 'text-red-700 bg-red-50 border-red-200',
  validation_failed: 'text-red-700 bg-red-50 border-red-200',
  disconnected: 'text-gray-700 bg-gray-50 border-gray-200',
};

function HealthStateBadge({ s }: { s: IntegrationHealthState }) {
  const cls = HEALTH_STATE_COLOR[s] ?? 'text-gray-700 bg-gray-50 border-gray-200';
  return <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${cls}`}>{s.replace(/_/g, ' ')}</span>;
}

export default function OAuthHealthPage() {
  const [data, setData] = useState<HealthResponse | null>(null);
  const [audit, setAudit] = useState<IntegrationAuditResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [revalidatingId, setRevalidatingId] = useState<string | null>(null);

  const load = async (signal?: { cancelled: boolean }) => {
    try {
      const [res, auditRes] = await Promise.all([
        apiFetch('/api/super-admin/oauth-health'),
        apiFetch('/api/super-admin/integration-audit'),
      ]);
      if (signal?.cancelled) return;
      if (res.status === 401 || res.status === 403) {
        setError('Not authorized. This page requires SUPER_ADMIN_DASHBOARD_VIEW.');
        setLoading(false);
        return;
      }
      if (!res.ok) {
        setError(`Failed to load OAuth health (HTTP ${res.status}).`);
        setLoading(false);
        return;
      }
      setData((await res.json()) as HealthResponse);
      if (auditRes.ok) setAudit((await auditRes.json()) as IntegrationAuditResponse);
      setLoading(false);
    } catch (e) {
      if (signal?.cancelled) return;
      setError((e as Error).message || 'Network error');
      setLoading(false);
    }
  };

  useEffect(() => {
    const signal = { cancelled: false };
    void load(signal);
    return () => { signal.cancelled = true; };
  }, []);

  const revalidate = async (row: IntegrationAuditRow) => {
    setRevalidatingId(row.id);
    try {
      const res = await apiFetch('/api/super-admin/integration-audit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ integration_id: row.id, company_id: row.company_id }),
      });
      if (!res.ok) {
        console.warn(`Revalidate failed: HTTP ${res.status}`);
      }
      // Refresh the full audit table — single round-trip.
      const refresh = await apiFetch('/api/super-admin/integration-audit');
      if (refresh.ok) setAudit((await refresh.json()) as IntegrationAuditResponse);
    } finally {
      setRevalidatingId(null);
    }
  };

  return (
    <>
      <Head><title>OAuth health — Omnivyra</title></Head>
      <div className="max-w-7xl mx-auto px-6 py-8 space-y-6">
        <nav className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-gray-500">Health diagnostics:</span>
          <a href="/super-admin/oauth-health" className="rounded-full border border-indigo-200 bg-indigo-50 px-2.5 py-0.5 font-medium text-indigo-700">OAuth + Integration</a>
          <a href="/super-admin/system-health" className="rounded-full border border-gray-200 bg-white px-2.5 py-0.5 font-medium text-gray-700 hover:bg-gray-50">System</a>
          <a href="/super-admin/dashboard" className="rounded-full border border-gray-200 bg-white px-2.5 py-0.5 font-medium text-gray-700 hover:bg-gray-50">Dashboard</a>
        </nav>
        <header>
          <h1 className="text-2xl font-semibold text-gray-900">OAuth + Integration health</h1>
          <p className="text-sm text-gray-600 mt-1">
            Read-only diagnostics. Per-provider callback validation, env presence (boolean only),
            DB integration rollup, the 20 most recent analytics integrations, and the integration
            timeline. Never displays tokens, secrets, or OAuth codes.
          </p>
        </header>

        {loading && <div className="text-gray-500">Loading…</div>}
        {error && (
          <div className="rounded border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            {error}
          </div>
        )}

        {data && (
          <>
            <section className="rounded border border-gray-200 bg-white">
              <div className="px-4 py-3 border-b border-gray-200 flex items-baseline gap-3">
                <h2 className="text-lg font-medium text-gray-900">Providers</h2>
                <span className="text-xs text-gray-500">canonical host: {data.canonical_host}</span>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="bg-gray-50 text-gray-700">
                    <tr>
                      <th className="text-left px-4 py-2 font-medium">Provider</th>
                      <th className="text-left px-4 py-2 font-medium">Callback URL</th>
                      <th className="text-left px-4 py-2 font-medium">Validation</th>
                      <th className="text-left px-4 py-2 font-medium">Credentials</th>
                      <th className="text-right px-4 py-2 font-medium">Connected</th>
                      <th className="text-right px-4 py-2 font-medium">Disconnected</th>
                      <th className="text-right px-4 py-2 font-medium">Error</th>
                      <th className="text-left px-4 py-2 font-medium">Last updated</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.providers.map((p) => (
                      <tr key={p.provider} className="border-t border-gray-100">
                        <td className="px-4 py-2">
                          <div className="font-medium text-gray-900">{p.display_name}</div>
                          <div className="text-xs text-gray-500">{p.provider}</div>
                        </td>
                        <td className="px-4 py-2 font-mono text-xs text-gray-700 break-all">{p.callback_url}</td>
                        <td className="px-4 py-2">
                          <YesNo ok={p.callback_url_ok} true_label="canonical" false_label="invalid" />
                          {p.callback_url_notes.length > 0 && (
                            <ul className="mt-1 text-xs text-red-700 list-disc list-inside">
                              {p.callback_url_notes.map((n, i) => <li key={i}>{n}</li>)}
                            </ul>
                          )}
                        </td>
                        <td className="px-4 py-2 text-xs">
                          {'config_source' in p.env_present ? (
                            <span className="text-gray-600">{p.env_present.note}</span>
                          ) : (
                            <>
                              <div><YesNo ok={p.env_present.client_id} true_label="client_id" false_label="client_id MISSING" /></div>
                              <div><YesNo ok={p.env_present.client_secret} true_label="client_secret" false_label="client_secret MISSING" /></div>
                            </>
                          )}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums">{p.integrations.connected}</td>
                        <td className="px-4 py-2 text-right tabular-nums">{p.integrations.disconnected}</td>
                        <td className="px-4 py-2 text-right tabular-nums">{p.integrations.error}</td>
                        <td className="px-4 py-2 text-xs text-gray-600">{p.integrations.last_updated_at ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            {audit && (
              <section className="rounded border border-gray-200 bg-white">
                <div className="px-4 py-3 border-b border-gray-200 flex items-baseline gap-3">
                  <h2 className="text-lg font-medium text-gray-900">Integration health</h2>
                  <span className="text-xs text-gray-500">
                    {audit.rollup.total} integrations · {audit.rollup.by_state.healthy} healthy ·{' '}
                    {audit.rollup.by_state.degraded + audit.rollup.by_state.retrying} degraded ·{' '}
                    {audit.rollup.by_state.invalid_credentials + audit.rollup.by_state.permission_lost + audit.rollup.by_state.validation_failed} broken
                  </span>
                </div>
                <div className="overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead className="bg-gray-50 text-gray-700">
                      <tr>
                        <th className="text-left px-4 py-2 font-medium">Integration</th>
                        <th className="text-left px-4 py-2 font-medium">Type</th>
                        <th className="text-left px-4 py-2 font-medium">Health</th>
                        <th className="text-right px-4 py-2 font-medium">Score</th>
                        <th className="text-left px-4 py-2 font-medium">Last success</th>
                        <th className="text-left px-4 py-2 font-medium">Last failure</th>
                        <th className="text-left px-4 py-2 font-medium">Error</th>
                        <th className="text-right px-4 py-2 font-medium">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {audit.rows.map((r) => (
                        <tr key={r.id} className="border-t border-gray-100">
                          <td className="px-4 py-2">
                            <div className="font-medium text-gray-900">{r.name}</div>
                            <div className="text-xs text-gray-500 font-mono">{r.id.slice(0, 8)} · company {r.company_id.slice(0, 8)}</div>
                          </td>
                          <td className="px-4 py-2 text-gray-700">{r.type}</td>
                          <td className="px-4 py-2">
                            <HealthStateBadge s={r.health.state} />
                            {r.health.age_hours !== null && (
                              <div className="mt-1 text-xs text-gray-500">last validated {Math.round(r.health.age_hours)}h ago</div>
                            )}
                          </td>
                          <td className="px-4 py-2 text-right tabular-nums">{r.health.score}</td>
                          <td className="px-4 py-2 text-xs text-gray-600">{r.health.last_success_at ?? '—'}</td>
                          <td className="px-4 py-2 text-xs text-gray-600">{r.health.last_failure_at ?? '—'}</td>
                          <td className="px-4 py-2 text-xs text-gray-700">
                            {r.health.last_error_code && (
                              <div className="font-medium">{r.health.last_error_code}</div>
                            )}
                            {r.health.last_error_message && (
                              <div className="text-gray-500 truncate max-w-xs" title={r.health.last_error_message}>
                                {r.health.last_error_message}
                              </div>
                            )}
                            {!r.health.last_error_code && !r.health.last_error_message && '—'}
                          </td>
                          <td className="px-4 py-2 text-right">
                            <button
                              type="button"
                              onClick={() => revalidate(r)}
                              disabled={revalidatingId === r.id || !r.website_connection_id}
                              title={!r.website_connection_id ? 'No website_connection — cannot validate' : 'Run live validation against the provider'}
                              className="rounded border border-gray-300 bg-white px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              {revalidatingId === r.id ? 'Validating…' : 'Revalidate'}
                            </button>
                          </td>
                        </tr>
                      ))}
                      {audit.rows.length === 0 && (
                        <tr><td colSpan={8} className="px-4 py-6 text-center text-gray-500 text-sm">No integrations.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
                <div className="px-4 py-3 border-t border-gray-200 text-xs text-gray-600">
                  Health is derived from existing columns (no new DB schema). <code className="font-mono">retry_count</code> always shows 0 — persistent retry tracking would require a migration.
                </div>
              </section>
            )}

            <section className="rounded border border-gray-200 bg-white">
              <div className="px-4 py-3 border-b border-gray-200 flex items-baseline gap-3">
                <h2 className="text-lg font-medium text-gray-900">Recent analytics integrations</h2>
                <span className="text-xs text-gray-500">last {data.recent_integrations.length} rows</span>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="bg-gray-50 text-gray-700">
                    <tr>
                      <th className="text-left px-4 py-2 font-medium">Provider</th>
                      <th className="text-left px-4 py-2 font-medium">Company</th>
                      <th className="text-left px-4 py-2 font-medium">Status</th>
                      <th className="text-left px-4 py-2 font-medium">Updated</th>
                      <th className="text-left px-4 py-2 font-medium">Last provider error</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.recent_integrations.map((r) => (
                      <tr key={r.id} className="border-t border-gray-100">
                        <td className="px-4 py-2 font-medium">{r.provider}</td>
                        <td className="px-4 py-2 font-mono text-xs text-gray-600">{r.company_id}</td>
                        <td className="px-4 py-2"><StatusBadge s={r.status} /></td>
                        <td className="px-4 py-2 text-xs text-gray-600">{r.updated_at}</td>
                        <td className="px-4 py-2 text-xs text-gray-600">{r.last_provider_error ?? '—'}</td>
                      </tr>
                    ))}
                    {data.recent_integrations.length === 0 && (
                      <tr><td colSpan={5} className="px-4 py-6 text-center text-gray-500 text-sm">No recent integrations.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>

            {audit && (
              <section className="rounded border border-gray-200 bg-white">
                <div className="px-4 py-3 border-b border-gray-200 flex items-baseline gap-3">
                  <h2 className="text-lg font-medium text-gray-900">Integration activity timeline</h2>
                  <span className="text-xs text-gray-500">
                    {audit.timeline_table_available
                      ? `${audit.recent_events.length} most-recent events across all tenants`
                      : 'Timeline migration not yet applied — see report footer'}
                  </span>
                </div>
                {audit.timeline_table_available ? (
                  <div className="overflow-x-auto">
                    <table className="min-w-full text-sm">
                      <thead className="bg-gray-50 text-gray-700">
                        <tr>
                          <th className="text-left px-4 py-2 font-medium">When</th>
                          <th className="text-left px-4 py-2 font-medium">Provider</th>
                          <th className="text-left px-4 py-2 font-medium">Event</th>
                          <th className="text-left px-4 py-2 font-medium">Status</th>
                          <th className="text-left px-4 py-2 font-medium">Integration</th>
                          <th className="text-left px-4 py-2 font-medium">Message</th>
                        </tr>
                      </thead>
                      <tbody>
                        {audit.recent_events.map((e) => (
                          <tr key={e.id} className="border-t border-gray-100">
                            <td className="px-4 py-2 text-xs text-gray-600">{e.created_at}</td>
                            <td className="px-4 py-2 text-gray-700">{e.provider}</td>
                            <td className="px-4 py-2 font-medium text-gray-900">{e.event_type}</td>
                            <td className="px-4 py-2">
                              <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${
                                e.event_status === 'success' ? 'text-green-700 bg-green-50 border-green-200' :
                                e.event_status === 'warning' ? 'text-amber-700 bg-amber-50 border-amber-200' :
                                e.event_status === 'error'   ? 'text-red-700 bg-red-50 border-red-200'   :
                                                                'text-gray-700 bg-gray-50 border-gray-200'
                              }`}>{e.event_status}</span>
                            </td>
                            <td className="px-4 py-2 font-mono text-xs text-gray-600">{e.integration_id.slice(0, 8)}</td>
                            <td className="px-4 py-2 text-xs text-gray-700 truncate max-w-md" title={e.message ?? ''}>{e.message ?? '—'}</td>
                          </tr>
                        ))}
                        {audit.recent_events.length === 0 && (
                          <tr><td colSpan={6} className="px-4 py-6 text-center text-gray-500 text-sm">No events recorded yet — events accumulate as integrations are validated, refreshed, retried, or fail.</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="px-4 py-6 text-sm text-gray-600">
                    <p>
                      The <code className="font-mono">integration_activity_events</code> table has not been created yet.
                      Apply migration{' '}
                      <code className="font-mono">supabase/migrations/20260805_integration_activity_events.sql</code>{' '}
                      via your Supabase migration flow to enable the timeline. Writers in <code className="font-mono">backend/services/integrationEventService.ts</code> fail-soft until the table exists.
                    </p>
                  </div>
                )}
              </section>
            )}

            <section className="rounded border border-gray-200 bg-gray-50 px-4 py-3 text-xs text-gray-600">
              <div className="font-medium text-gray-800 mb-1">Observability</div>
              <p>
                Live OAuth events are emitted as single-line JSON tagged{' '}
                <code className="font-mono">{data.observability.log_tag}</code> in Vercel logs.
              </p>
              <p className="mt-1">{data.observability.note}</p>
              <p className="mt-2">
                Grep recipe:{' '}
                <code className="font-mono">vercel logs https://www.omnivyra.com --since 1h | grep -F &quot;[OAUTH]&quot;</code>
              </p>
            </section>
          </>
        )}
      </div>
    </>
  );
}
