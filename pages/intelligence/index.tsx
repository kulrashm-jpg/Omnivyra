/**
 * Strategic Intelligence Dashboard
 * AI Social Media Command Center — visualize opportunities, recommendations, correlations.
 */

import React, { useMemo, useState, useCallback } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { useCompanyContext } from '@/components/CompanyContext';
import {
  OpportunityPanel,
  RecommendationPanel,
  CorrelationPanel,
  IntelligenceTimeline,
} from '@/components/intelligence';
import { useIntelligenceDashboard } from '@/hooks/useIntelligenceDashboard';

const WINDOW_OPTIONS = [
  { value: 24, label: '24h' },
  { value: 48, label: '48h' },
  { value: 72, label: '72h' },
];

function getQueryString(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (Array.isArray(value) && value[0]) return String(value[0]).trim();
  return '';
}

export default function StrategicIntelligencePage() {
  const router = useRouter();
  const { selectedCompanyId } = useCompanyContext();

  const companyId = useMemo(
    () => getQueryString(router.query.companyId) || selectedCompanyId || '',
    [router.query.companyId, selectedCompanyId]
  );

  const [windowHours, setWindowHours] = useState(24);
  const [buildGraph, setBuildGraph] = useState(false);

  const {
    opportunities,
    recommendations,
    correlations,
    loading,
    error,
    refresh,
  } = useIntelligenceDashboard(companyId, windowHours, buildGraph);

  const handleWindowChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    const v = parseInt(e.target.value, 10);
    if (!isNaN(v)) setWindowHours(v);
  }, []);

  return (
    <>
      <Head>
        <title>Strategic Intelligence</title>
      </Head>

      <div className="container mx-auto max-w-6xl space-y-6 p-6">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900">
              Strategic Intelligence Dashboard
            </h1>
            <p className="mt-1 text-sm text-slate-600">
              Emerging trends, competitor insights, market gaps, and recommended actions
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <span>Window:</span>
              <select
                value={windowHours}
                onChange={handleWindowChange}
                className="rounded border border-slate-300 bg-white px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                {WINDOW_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={buildGraph}
                onChange={(e) => setBuildGraph(e.target.checked)}
                className="rounded border-slate-300"
              />
              Build graph
            </label>
            <button
              type="button"
              onClick={() => refresh()}
              disabled={loading}
              className="rounded bg-slate-800 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
            >
              {loading ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>
        </header>

        {!companyId && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-800 text-sm">
            Select a company or add <code className="px-1 rounded bg-amber-200">companyId</code> to the
            URL to view intelligence.
          </div>
        )}

        {companyId && error && (
          <div
            className="rounded-xl border border-red-200 bg-red-50 p-4 text-red-700 text-sm"
            role="alert"
          >
            {error}
          </div>
        )}

        {companyId && (
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
            <section className="xl:col-span-2 space-y-6">
              <OpportunityPanel opportunities={opportunities} loading={loading} />
              <RecommendationPanel recommendations={recommendations} loading={loading} />
              <CorrelationPanel correlations={correlations} loading={loading} />
            </section>

            <section>
              <IntelligenceTimeline
                opportunities={opportunities}
                recommendations={recommendations}
                correlations={correlations}
                loading={loading}
              />
            </section>
          </div>
        )}

        {companyId && !loading && !error && (
          <p className="text-xs text-slate-500">
            Auto-refreshes every 10 minutes. Last fetch: {new Date().toLocaleTimeString()}
          </p>
        )}
      </div>
    </>
  );
}
