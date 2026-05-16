/**
 * /internal/render-ops — Step-R7 enterprise render operations console.
 * ──────────────────────────────────────────────────────────────────────────
 * Internal-only operator tooling (server enforces super-admin on the
 * /api/internal/render-ops endpoint). READ-FIRST: loads a snapshot;
 * destructive actions require an explicit confirm. NO rendering/runtime
 * internals are touched — this only calls the R7 ops API.
 */

import React, { useCallback, useEffect, useState } from 'react';

type Snapshot = any;

const card = 'rounded-xl border border-gray-200 bg-white p-4';
const h2 = 'mb-2 text-sm font-semibold text-gray-900';

export default function RenderOpsConsole() {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [err, setErr] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setErr('');
    try {
      const r = await fetch('/api/internal/render-ops', { credentials: 'include' });
      const j = await r.json();
      if (r.status === 403) { setErr('Operator access required (super-admin only).'); setSnap(null); }
      else if (!j.ok) { setErr(j.error || j.code || 'Failed to load'); setSnap(null); }
      else setSnap(j);
    } catch (e) { setErr(e instanceof Error ? e.message : 'Failed'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const act = async (action: string, body: Record<string, unknown>, destructive = false) => {
    if (destructive && !window.confirm(`Confirm: ${action} — ${JSON.stringify(body)}`)) return;
    setBusy(action);
    try {
      const r = await fetch('/api/internal/render-ops', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...body }),
      });
      const j = await r.json();
      if (!j.ok) alert(`Rejected: ${j.reason || j.code || 'error'}`);
      await load();
    } catch (e) { alert(e instanceof Error ? e.message : 'Action failed'); }
    finally { setBusy(''); }
  };

  if (err) {
    return (
      <div className="min-h-screen bg-gray-50 p-8">
        <div className="mx-auto max-w-md rounded-xl border border-red-200 bg-white p-6 text-center">
          <h1 className="text-lg font-semibold text-gray-900">Render Ops</h1>
          <p className="mt-2 text-sm text-red-700">{err}</p>
          <button onClick={load} className="mt-4 rounded-lg bg-gray-900 px-4 py-2 text-sm text-white">Retry</button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-6xl space-y-5 px-6 py-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-gray-900">Render Operations Console</h1>
          <button onClick={load} disabled={loading}
            className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 hover:bg-gray-100 disabled:opacity-50">
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
        {!snap ? <div className="text-sm text-gray-500">Loading snapshot…</div> : (
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            {/* 1 Queue Overview */}
            <section className={card}>
              <h2 className={h2}>Queue Overview</h2>
              <pre className="overflow-auto rounded bg-gray-900 p-3 text-[11px] text-gray-100">
{JSON.stringify({ depth: snap.queue?.depth_by_state, in_flight: snap.queue?.in_flight_by_provider, stale_leases: snap.queue?.stale_leases }, null, 2)}
              </pre>
              <p className="mt-1 text-xs text-gray-500">Stuck jobs: {snap.queue?.stuck_jobs?.length ?? 0}</p>
            </section>

            {/* 7 Worker Health */}
            <section className={card}>
              <h2 className={h2}>Worker Health</h2>
              <pre className="overflow-auto rounded bg-gray-900 p-3 text-[11px] text-gray-100">
{JSON.stringify(snap.workers, null, 2)}
              </pre>
            </section>

            {/* 4 Provider Health */}
            <section className={card}>
              <h2 className={h2}>Provider Health</h2>
              <div className="space-y-2">
                {(snap.providers ?? []).map((p: any) => (
                  <div key={p.provider_key} className="flex items-center justify-between rounded border border-gray-200 p-2 text-xs">
                    <span><b>{p.provider_key}</b> · {p.health_state} · w{p.priority_weight}</span>
                    <span className="flex gap-1">
                      <button onClick={() => act('provider.maintenance', { provider_key: p.provider_key }, true)}
                        className="rounded border border-gray-300 px-2 py-0.5 hover:bg-gray-50">Maint.</button>
                      <button onClick={() => act('provider.disable', { provider_key: p.provider_key }, true)}
                        className="rounded border border-red-300 px-2 py-0.5 text-red-700 hover:bg-red-50">Disable</button>
                    </span>
                  </div>
                ))}
              </div>
            </section>

            {/* 3 Governance Controls */}
            <section className={card}>
              <h2 className={h2}>Governance Controls</h2>
              <div className="mb-2 flex flex-wrap gap-2 text-xs">
                <button onClick={() => act('governance.set', { organization_id: '00000000-0000-0000-0000-000000000000', patch: { emergency_stop: true } }, true)}
                  className="rounded border border-red-300 px-2 py-1 text-red-700 hover:bg-red-50">GLOBAL Emergency Stop</button>
                <button onClick={() => act('governance.set', { organization_id: '00000000-0000-0000-0000-000000000000', patch: { emergency_stop: false } }, true)}
                  className="rounded border border-emerald-300 px-2 py-1 text-emerald-700 hover:bg-emerald-50">Clear Emergency</button>
                <button onClick={() => act('governance.set', { organization_id: '00000000-0000-0000-0000-000000000000', patch: { queue_paused: true } }, true)}
                  className="rounded border border-amber-300 px-2 py-1 text-amber-700 hover:bg-amber-50">Pause Queue (global)</button>
                <button onClick={() => act('governance.set', { organization_id: '00000000-0000-0000-0000-000000000000', patch: { queue_paused: false } }, true)}
                  className="rounded border border-gray-300 px-2 py-1 hover:bg-gray-50">Resume Queue</button>
              </div>
              <pre className="max-h-48 overflow-auto rounded bg-gray-900 p-3 text-[11px] text-gray-100">
{JSON.stringify((snap.governance ?? []).map((g: any) => ({ org: g.organization_id, enabled: g.rendering_enabled, stop: g.emergency_stop, paused: g.queue_paused, daily: g.max_daily_renders, conc: g.max_concurrent_renders })), null, 2)}
              </pre>
            </section>

            {/* 5 Render Analytics */}
            <section className={card}>
              <h2 className={h2}>Render Analytics (24h, no PII)</h2>
              <pre className="overflow-auto rounded bg-gray-900 p-3 text-[11px] text-gray-100">
{JSON.stringify(snap.analytics, null, 2)}
              </pre>
            </section>

            {/* 6 Moderation Events */}
            <section className={card}>
              <h2 className={h2}>Moderation Events</h2>
              <pre className="max-h-48 overflow-auto rounded bg-gray-900 p-3 text-[11px] text-gray-100">
{JSON.stringify(snap.moderation_events, null, 2)}
              </pre>
            </section>

            {/* 2/6 Failed Render Recovery */}
            <section className={`${card} lg:col-span-2`}>
              <h2 className={h2}>Failed Render Recovery</h2>
              <div className="space-y-1">
                {(snap.failed_recovery ?? []).length === 0 && <p className="text-xs text-gray-500">No failed jobs.</p>}
                {(snap.failed_recovery ?? []).map((f: any) => (
                  <div key={f.id} className="flex items-center justify-between rounded border border-gray-200 p-2 text-xs">
                    <span className="truncate">job {String(f.render_job_id).slice(0, 12)} · {f.provider_key} · r{f.retry_count} · {f.last_error}</span>
                    <span className="flex gap-1">
                      <button disabled={busy !== ''} onClick={() => act('queue.retry', { queue_job_id: f.id })}
                        className="rounded border border-indigo-300 px-2 py-0.5 text-indigo-700 hover:bg-indigo-50">Retry</button>
                      <button disabled={busy !== ''} onClick={() => act('queue.cancel', { queue_job_id: f.id }, true)}
                        className="rounded border border-gray-300 px-2 py-0.5 hover:bg-gray-50">Cancel</button>
                    </span>
                  </div>
                ))}
              </div>
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
