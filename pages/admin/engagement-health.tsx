/**
 * Admin: Engagement Signal Health Dashboard
 */

import React, { useEffect, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { ArrowLeft, RefreshCw } from 'lucide-react';

type HealthData = {
  signalsCollectedLast24h: number;
  signalsByPlatform: Record<string, number>;
  collectorErrors: string[];
  lastRunTime: string | null;
  queueSize: number;
};

/**
 * A browser dispatch an extension claimed and may have executed, whose result
 * never arrived. The platform action may or may not have happened — nothing in
 * the system can tell which, so `delivery` is always 'unknown'.
 */
type ClaimedUnknown = {
  action_id: string;
  organization_id: string | null;
  platform: string | null;
  action_type: string | null;
  target_id: string | null;
  claimed_at: string | null;
  lease_expires_at: string | null;
  acknowledged: boolean;
  delivery: 'unknown';
};

export default function EngagementHealthPage() {
  const [data, setData] = useState<HealthData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [claimedUnknown, setClaimedUnknown] = useState<ClaimedUnknown[]>([]);

  const fetchHealth = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/engagement-signal-health', { credentials: 'include' });
      if (!res.ok) throw new Error(res.statusText);
      const json = await res.json();
      setData(json);
    } catch (err) {
      setError((err as Error)?.message ?? 'Failed to load');
    } finally {
      setLoading(false);
    }
  };

  // Read-only. There is deliberately no retry and no mark-sent control: retrying
  // could send the same message twice, and marking it sent would assert a
  // delivery nobody has observed. Resolution requires checking the platform.
  const fetchClaimedUnknown = async () => {
    try {
      const res = await fetch('/api/admin/engagement-claimed-unknown', { credentials: 'include' });
      if (!res.ok) return;
      const json = await res.json();
      setClaimedUnknown(Array.isArray(json?.dispatches) ? json.dispatches : []);
    } catch {
      /* non-fatal: the primary health view must still render */
    }
  };

  useEffect(() => {
    fetchHealth();
    fetchClaimedUnknown();
  }, []);

  return (
    <>
      <Head>
        <title>Engagement Signal Health</title>
      </Head>
      <div className="min-h-screen bg-gray-50">
        <header className="bg-white border-b border-gray-200 px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Link
                href="/admin/users"
                className="p-1 rounded hover:bg-gray-100"
              >
                <ArrowLeft className="h-5 w-5 text-gray-600" />
              </Link>
              <div>
                <h1 className="text-xl font-semibold text-gray-900">Engagement Signal Health</h1>
                <p className="text-sm text-gray-500">Collection status, platform breakdown, errors</p>
              </div>
            </div>
            <button
              onClick={fetchHealth}
              disabled={loading}
              className="px-3 py-2 rounded-lg border border-gray-300 text-sm hover:bg-gray-50 flex items-center gap-2"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
          </div>
        </header>

        <main className="max-w-4xl mx-auto px-6 py-6">
          {loading && !data ? (
            <div className="text-gray-500">Loading...</div>
          ) : error ? (
            <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-800">{error}</div>
          ) : data ? (
            <div className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="bg-white rounded-lg border border-gray-200 p-4">
                  <div className="text-sm text-gray-500">Signals (24h)</div>
                  <div className="text-2xl font-semibold text-gray-900">
                    {data.signalsCollectedLast24h}
                  </div>
                </div>
                <div className="bg-white rounded-lg border border-gray-200 p-4">
                  <div className="text-sm text-gray-500">Queue Size</div>
                  <div className="text-2xl font-semibold text-gray-900">{data.queueSize}</div>
                </div>
                <div className="bg-white rounded-lg border border-gray-200 p-4">
                  <div className="text-sm text-gray-500">Last Run</div>
                  <div className="text-sm font-medium text-gray-900">
                    {data.lastRunTime
                      ? new Date(data.lastRunTime).toLocaleString()
                      : '—'}
                  </div>
                </div>
                <div className="bg-white rounded-lg border border-gray-200 p-4">
                  <div className="text-sm text-gray-500">Errors</div>
                  <div className="text-2xl font-semibold text-gray-900">
                    {data.collectorErrors?.length ?? 0}
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-lg border border-gray-200 p-4">
                <h2 className="text-sm font-semibold text-gray-900 mb-3">Platform Breakdown</h2>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(data.signalsByPlatform ?? {}).map(([platform, count]) => (
                    <span
                      key={platform}
                      className="px-3 py-1 rounded-full bg-indigo-100 text-indigo-800 text-sm"
                    >
                      {platform}: {count}
                    </span>
                  ))}
                  {(!data.signalsByPlatform || Object.keys(data.signalsByPlatform).length === 0) && (
                    <span className="text-gray-500 text-sm">No signals</span>
                  )}
                </div>
              </div>

              <div className="bg-white rounded-lg border border-amber-200 p-4">
                <div className="flex items-baseline justify-between mb-1">
                  <h2 className="text-sm font-semibold text-amber-900">
                    Browser dispatches — delivery unknown
                  </h2>
                  <span className="text-sm text-amber-800">{claimedUnknown.length}</span>
                </div>
                <p className="text-xs text-amber-800 mb-3">
                  An extension claimed these and may have executed them, but no result was ever
                  reported. <strong>Delivery is UNKNOWN.</strong> They are never retried and never
                  marked failed automatically — retrying could send the same message twice. Confirm
                  on the platform whether the message was actually sent before acting.
                </p>
                {claimedUnknown.length === 0 ? (
                  <span className="text-gray-500 text-sm">None</span>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="min-w-full text-sm">
                      <thead>
                        <tr className="text-left text-gray-500">
                          <th className="py-1 pr-4">Command</th>
                          <th className="py-1 pr-4">Org</th>
                          <th className="py-1 pr-4">Platform</th>
                          <th className="py-1 pr-4">Action</th>
                          <th className="py-1 pr-4">Target</th>
                          <th className="py-1 pr-4">Claimed</th>
                          <th className="py-1 pr-4">Lease expired</th>
                          <th className="py-1 pr-4">Ack</th>
                          <th className="py-1">Delivery</th>
                        </tr>
                      </thead>
                      <tbody className="text-gray-800">
                        {claimedUnknown.map((d) => (
                          <tr key={d.action_id} className="border-t border-gray-100">
                            <td className="py-1 pr-4 font-mono text-xs">{d.action_id.slice(0, 8)}…</td>
                            <td className="py-1 pr-4 font-mono text-xs">
                              {(d.organization_id ?? '—').slice(0, 8)}
                            </td>
                            <td className="py-1 pr-4">{d.platform ?? '—'}</td>
                            <td className="py-1 pr-4">{d.action_type ?? '—'}</td>
                            <td className="py-1 pr-4 font-mono text-xs max-w-[16rem] truncate">
                              {d.target_id ?? '—'}
                            </td>
                            <td className="py-1 pr-4">
                              {d.claimed_at ? new Date(d.claimed_at).toLocaleString() : '—'}
                            </td>
                            <td className="py-1 pr-4">
                              {d.lease_expires_at ? new Date(d.lease_expires_at).toLocaleString() : '—'}
                            </td>
                            <td className="py-1 pr-4">{d.acknowledged ? 'yes' : 'no'}</td>
                            <td className="py-1">
                              <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-900 text-xs">
                                unknown
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {data.collectorErrors && data.collectorErrors.length > 0 && (
                <div className="bg-white rounded-lg border border-red-200 p-4">
                  <h2 className="text-sm font-semibold text-red-800 mb-2">Collector Errors</h2>
                  <ul className="space-y-1 text-sm text-red-700 max-h-48 overflow-y-auto">
                    {data.collectorErrors.map((e, i) => (
                      <li key={i}>{e}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ) : null}
        </main>
      </div>
    </>
  );
}
