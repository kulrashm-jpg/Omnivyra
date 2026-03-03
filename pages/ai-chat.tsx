import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { useCompanyContext } from '../components/CompanyContext';
import { fetchWithAuth } from '../components/community-ai/fetchWithAuth';
import CampaignAIChat from '../components/CampaignAIChat';
import Header from '../components/Header';

export default function AIChatPage() {
  const router = useRouter();
  const { selectedCompanyId } = useCompanyContext();
  const campaignId = typeof router.query.campaignId === 'string' ? router.query.campaignId : null;
  const context = typeof router.query.context === 'string' ? router.query.context : 'blueprint-plan';

  const [campaign, setCampaign] = useState<Record<string, unknown> | null>(null);
  const [initialPlan, setInitialPlan] = useState<{ weeks: unknown[] } | null>(null);
  const [recommendationContext, setRecommendationContext] = useState<unknown>(null);
  const [prefilledPlanning, setPrefilledPlanning] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!campaignId || !selectedCompanyId) {
      setLoading(false);
      return;
    }
    (async () => {
      try {
        const [campRes, weeklyRes] = await Promise.all([
          fetchWithAuth(
            `/api/campaigns?type=campaign&campaignId=${encodeURIComponent(campaignId)}&companyId=${encodeURIComponent(selectedCompanyId)}`
          ),
          fetchWithAuth(
            `/api/campaigns/get-weekly-plans?campaignId=${encodeURIComponent(campaignId)}&companyId=${encodeURIComponent(selectedCompanyId)}`
          ),
        ]);
        if (campRes.ok) {
          const data = await campRes.json();
          setCampaign(data.campaign ?? null);
          setRecommendationContext(data.recommendationContext ?? null);
          setPrefilledPlanning(data.prefilledPlanning ?? null);
        }
        if (weeklyRes.ok) {
          const weeklyData = await weeklyRes.json();
          const raw = Array.isArray(weeklyData) ? weeklyData : [];
          const weeks = raw.map((w: Record<string, unknown>) => ({
            week_number: w.week_number ?? w.weekNumber,
            theme: w.theme ?? `Week ${w.week_number ?? w.weekNumber}`,
            focusArea: w.focusArea ?? w.focus_area,
            topics_to_cover: Array.isArray(w.topics) ? w.topics : (Array.isArray(w.topics_to_cover) ? w.topics_to_cover : []),
            ...w,
          }));
          setInitialPlan(weeks.length > 0 ? { weeks } : null);
        }
      } catch {
        setCampaign({ id: campaignId, name: 'Campaign' } as Record<string, unknown>);
      } finally {
        setLoading(false);
      }
    })();
  }, [campaignId, selectedCompanyId]);

  const campaignData = campaign ?? (campaignId ? { id: campaignId, name: 'Campaign' } : null);
  const backHref = campaignId ? `/campaign-details/${campaignId}` : '/campaigns';

  if (!campaignId) {
    return (
      <>
        <Head><title>AI Chat – Campaign required</title></Head>
        <Header />
        <div className="min-h-screen flex items-center justify-center bg-gray-50">
          <div className="text-center">
            <p className="text-gray-600 mb-4">Campaign ID is required.</p>
            <Link href="/campaigns" className="text-indigo-600 hover:underline">Back to campaigns</Link>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <Head>
        <title>AI Enhance – {(campaignData as { name?: string })?.name ?? 'Campaign'}</title>
      </Head>
      <Header />
      <div className="min-h-screen bg-gradient-to-br from-indigo-50 to-purple-50 flex flex-col">
        <div className="p-4 border-b border-indigo-200 bg-white/80 backdrop-blur-sm shrink-0">
          <Link
            href={backHref}
            className="inline-flex items-center gap-2 text-indigo-700 hover:text-indigo-900 font-medium"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to campaign
          </Link>
          <p className="text-sm text-gray-500 mt-1">
            Refine your campaign blueprint with AI. Describe changes (e.g. add topics, change themes, adjust platforms) and they’ll be applied to your plan.
          </p>
        </div>
        <div className="flex-1 min-h-0">
          {loading ? (
            <div className="flex items-center justify-center h-64">
              <div className="animate-spin w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full" />
            </div>
          ) : !selectedCompanyId ? (
            <div className="flex items-center justify-center h-64 text-gray-600">
              Select a company to use the AI chat.
            </div>
          ) : (
            <CampaignAIChat
              isOpen={true}
              onClose={() => router.push(backHref)}
              onMinimize={() => router.push(backHref)}
              context={context}
              companyId={selectedCompanyId}
              campaignId={campaignId}
              campaignData={campaignData as Record<string, unknown>}
              recommendationContext={recommendationContext}
              prefilledPlanning={prefilledPlanning}
              initialPlan={initialPlan}
              standalone={true}
            />
          )}
        </div>
      </div>
    </>
  );
}
