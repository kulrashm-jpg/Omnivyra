/**
 * CMO Intelligence Dashboard
 * Executive view: Market Opportunities, Strategic Insights, Campaign Health, Trend Signals.
 * Render order: 1. Market Opportunities, 2. Strategic Insights, 3. Campaign Health, 4. Trend Signals
 */

import React, { useMemo, useCallback, useEffect, useState } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { useCompanyContext } from '@/components/CompanyContext';
import { CampaignHealthOverview } from '@/components/dashboard/CampaignHealthOverview';
import { CampaignAttributionPanel } from '@/components/dashboard/CampaignAttributionPanel';
import { StrategicInsightsPanel } from '@/components/dashboard/StrategicInsightsPanel';
import { OpportunityPanel } from '@/components/dashboard/OpportunityPanel';
import { TrendSignalsPanel } from '@/components/dashboard/TrendSignalsPanel';
import { MarketingMemoryPanel } from '@/components/dashboard/MarketingMemoryPanel';

function getQueryString(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (Array.isArray(value) && value[0]) return String(value[0]).trim();
  return '';
}

export default function CMOIntelligenceDashboard() {
  const router = useRouter();
  const { selectedCompanyId } = useCompanyContext();

  const companyId = useMemo(
    () => getQueryString(router.query.companyId) || selectedCompanyId || '',
    [router.query.companyId, selectedCompanyId]
  );

  const [data, setData] = useState<{
    campaign_health_reports: Array<{ campaign_id: string; campaign_name: string; health_score: number; health_status: string; issue_count: number }>;
    campaign_attribution?: { opportunity: number; trend: number; strategic_insight: number; manual: number };
    campaign_origins?: Array<{ campaign_id: string; campaign_name: string; origin_source: string }>;
    strategic_insights: Array<{ title: string; summary: string; confidence: number; recommended_action: string }>;
    opportunities: Array<{ title: string; description: string; opportunity_score: number; confidence: number; opportunity_type?: string }>;
    trend_signals: Array<{ topic: string; signal_strength: number; discussion_growth: number }>;
    scheduler_runs?: Array<{ id: string; job_name: string; started_at: string; status: string; is_stale: boolean }>;
    marketing_memory?: {
      top_content_formats?: Array<{ format: string; avg_engagement?: number }>;
      top_narratives?: Array<{ narrative: string; engagement_score?: number }>;
      audience_patterns?: string[];
    };
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    if (!companyId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/dashboard/intelligence?companyId=${encodeURIComponent(companyId)}`,
        { credentials: 'include' }
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || body.details || `HTTP ${res.status}`);
      }
      const json = await res.json();
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load dashboard');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  if (!companyId) {
    return (
      <>
        <Head>
          <title>CMO Intelligence Dashboard</title>
        </Head>
        <div className="container mx-auto max-w-6xl p-6">
          <h1 className="text-2xl font-semibold text-slate-900">CMO Intelligence Dashboard</h1>
          <p className="mt-2 text-slate-600">Select a company to view intelligence.</p>
        </div>
      </>
    );
  }

  return (
    <>
      <Head>
        <title>CMO Intelligence Dashboard</title>
      </Head>

      <div className="container mx-auto max-w-6xl space-y-6 p-6">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900">
              CMO Intelligence Dashboard
            </h1>
            <p className="mt-1 text-sm text-slate-600">
              Campaign health, strategic insights, market opportunities, and trend signals
            </p>
          </div>
        </header>

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-800">
            {error}
            <button
              type="button"
              onClick={fetchData}
              className="ml-2 text-sm font-medium underline"
            >
              Retry
            </button>
          </div>
        )}

        {!loading && data?.scheduler_runs?.some((r) => r.is_stale) && (
          <div
            className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-amber-800"
            role="alert"
          >
            <strong>Scheduler stale run detected.</strong> An intelligence job started over an hour ago is still marked as &quot;running&quot; and may have been interrupted. Check the scheduler process or consider restarting it.
          </div>
        )}

        <div className="grid gap-6 lg:grid-cols-2">
          {/* 1. Market Opportunities */}
          <OpportunityPanel
            companyId={companyId}
            opportunities={data?.opportunities}
            loading={loading}
            className="lg:col-span-2"
          />

          {/* 2. Strategic Insights */}
          <StrategicInsightsPanel
            insights={data?.strategic_insights}
            loading={loading}
            className="lg:col-span-2"
          />

          {/* 3. Campaign Health Overview */}
          <CampaignHealthOverview
            items={data?.campaign_health_reports ?? []}
            loading={loading}
            className="lg:col-span-2"
          />

          {/* 4. Campaign Attribution */}
          <CampaignAttributionPanel
            attribution={data?.campaign_attribution ?? null}
            campaigns={data?.campaign_origins ?? null}
            loading={loading}
            className="lg:col-span-2"
          />

          {/* 5. Trend Signals */}
          <TrendSignalsPanel
            signals={data?.trend_signals ?? []}
            loading={loading}
            className="lg:col-span-2"
          />

          {/* 6. Marketing Memory */}
          <MarketingMemoryPanel
            top_content_formats={data?.marketing_memory?.top_content_formats}
            top_narratives={data?.marketing_memory?.top_narratives}
            audience_patterns={data?.marketing_memory?.audience_patterns}
            loading={loading}
            className="lg:col-span-2"
          />
        </div>
      </div>
    </>
  );
}
