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

export default function EngagementHealthPage() {
  const [data, setData] = useState<HealthData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  useEffect(() => {
    fetchHealth();
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
