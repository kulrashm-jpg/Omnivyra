/**
 * Growth Intelligence Dashboard
 * Company and campaign views. Uses existing hooks and components.
 */

import React from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { useCompanyContext } from '@/components/CompanyContext';
import {
  CompanyGrowthOverview,
  GrowthScoreCard,
  GrowthMetricsGrid,
  GrowthScoreBreakdown,
} from '@/components/growth-intelligence';
import { useCampaignGrowthSummary } from '@/hooks/useGrowthIntelligence';

function getQueryString(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (Array.isArray(value) && value[0]) return String(value[0]).trim();
  return '';
}

export default function GrowthIntelligencePage() {
  const router = useRouter();
  const { selectedCompanyId } = useCompanyContext();

  const companyId =
    getQueryString(router.query.companyId) || selectedCompanyId || '';
  const campaignId = getQueryString(router.query.campaignId) || undefined;

  const { summary: campaignSummary, loading: campaignLoading, error: campaignError } =
    useCampaignGrowthSummary(companyId, campaignId);

  const hasCampaign = Boolean(campaignId && companyId);

  return (
    <>
      <Head>
        <title>Growth Intelligence</title>
      </Head>

      <div className="container mx-auto max-w-5xl space-y-6 p-6">
        <header>
          <h1 className="text-2xl font-semibold text-slate-900">
            Growth Intelligence
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Performance metrics and score breakdown across company and campaigns
          </p>
        </header>

        {/* Company Overview Section */}
        <section>
          <h2 className="text-lg font-medium text-slate-800 mb-4">
            Company Overview
          </h2>
          <CompanyGrowthOverview companyId={companyId} />
        </section>

        {/* Campaign Section (optional) */}
        {hasCampaign && (
          <section>
            <h2 className="text-lg font-medium text-slate-800 mb-4">
              Campaign Intelligence
            </h2>

            {campaignLoading && (
              <div
                className="p-6 rounded-xl border border-slate-200 bg-slate-50 animate-pulse"
                aria-busy="true"
              >
                <div className="h-8 w-32 bg-slate-200 rounded mb-4" />
                <div className="h-4 w-full bg-slate-200 rounded mb-2" />
                <div className="h-4 w-3/4 bg-slate-200 rounded" />
              </div>
            )}

            {campaignError && (
              <div
                className="p-4 rounded-xl border border-red-200 bg-red-50 text-red-700"
                role="alert"
              >
                {campaignError}
              </div>
            )}

            {!campaignLoading && !campaignError && campaignSummary && (
              <div className="space-y-4">
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <GrowthScoreCard summary={campaignSummary} />
                  <GrowthMetricsGrid summary={campaignSummary} />
                </div>
                <GrowthScoreBreakdown breakdown={campaignSummary.scoreBreakdown} />
              </div>
            )}
          </section>
        )}

        {!companyId && (
          <div className="p-4 rounded-xl border border-slate-200 bg-slate-50 text-slate-600 text-sm">
            Select a company or add <code className="px-1 bg-slate-200 rounded">companyId</code> to
            the URL to view growth intelligence.
          </div>
        )}
      </div>
    </>
  );
}
