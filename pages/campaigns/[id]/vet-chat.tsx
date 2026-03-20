import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { useCompanyContext } from '../../../components/CompanyContext';
import { fetchWithAuth } from '../../../components/community-ai/fetchWithAuth';
import CampaignAIChat from '../../../components/CampaignAIChat';
import Header from '../../../components/Header';

interface RecWeek {
  id: string;
  week_number: number;
  session_id: string;
  status: string;
  topics_to_cover?: string[] | null;
  primary_objective?: string | null;
  summary?: string | null;
  objectives?: string[] | null;
  goals?: string[] | null;
  suggested_days_to_post?: string[] | null;
  platform_allocation?: Record<string, number> | null;
  platform_content_breakdown?: Record<string, any[]> | null;
  content_type_mix?: string[] | null;
}

export default function VetChatPage() {
  const router = useRouter();
  const { id } = router.query;
  const { selectedCompanyId } = useCompanyContext();
  const campaignId = typeof id === 'string' ? id : null;
  const sessionId = typeof router.query.sessionId === 'string' ? router.query.sessionId : undefined;
  const weeksParam = typeof router.query.weeks === 'string' ? router.query.weeks : undefined;
  const areasByWeekParam = typeof router.query.areasByWeek === 'string' ? router.query.areasByWeek : undefined;
  let parsedAreas: Record<number, string[]> | undefined;
  if (areasByWeekParam) {
    try {
      parsedAreas = JSON.parse(decodeURIComponent(areasByWeekParam)) as Record<number, string[]>;
    } catch {
      parsedAreas = undefined;
    }
  }
  const vetScope =
    weeksParam || parsedAreas
      ? {
          selectedWeeks: weeksParam ? weeksParam.split(',').map(Number).filter(Boolean) : [],
          areasByWeek: parsedAreas,
        }
      : undefined;

  const [campaign, setCampaign] = useState<{ id: string; name: string; company_id?: string } | null>(null);
  const [recommendations, setRecommendations] = useState<RecWeek[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!campaignId) return;
    Promise.all([
      fetchWithAuth(`/api/campaigns/${campaignId}`).then((r) => (r.ok ? r.json() : null)),
      fetchWithAuth(`/api/campaigns/${campaignId}/recommendations?status=pending${sessionId ? `&sessionId=${sessionId}` : ''}`).then((r) => (r.ok ? r.json() : null)),
    ])
      .then(([campRes, recRes]) => {
        setCampaign(campRes?.campaign || { id: campaignId, name: 'Campaign' });
        setRecommendations(recRes?.recommendations || []);
      })
      .catch(() => setCampaign({ id: campaignId, name: 'Campaign' }))
      .finally(() => setLoading(false));
  }, [campaignId, sessionId]);

  const initialPlan =
    recommendations.length > 0
      ? {
          weeks: recommendations.map((r) => ({
            week: r.week_number,
            week_number: r.week_number,
            theme: r.primary_objective ?? `Week ${r.week_number}`,
            primary_objective: r.primary_objective ?? '',
            topics_to_cover: r.topics_to_cover ?? [],
            platform_allocation: r.platform_allocation ?? undefined,
            platform_content_breakdown: r.platform_content_breakdown ?? undefined,
            content_type_mix: r.content_type_mix ?? [],
            summary: r.summary ?? undefined,
            objectives: r.objectives ?? undefined,
            goals: r.goals ?? undefined,
            suggested_days_to_post: r.suggested_days_to_post ?? undefined,
          })),
        }
      : undefined;

  if (!campaignId) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-gray-600">Campaign ID required</p>
      </div>
    );
  }

  return (
    <>
      <Head>
        <title>Vet Recommendations – {campaign?.name || 'Campaign'}</title>
      </Head>
      <Header />
      <div className="min-h-screen bg-gradient-to-br from-emerald-50 to-teal-50 flex flex-col">
        <div className="p-4 border-b border-emerald-200 bg-white/80 backdrop-blur-sm">
          <Link
            href={`/campaigns/${campaignId}/recommendations${sessionId ? `?sessionId=${sessionId}` : ''}`}
            className="inline-flex items-center gap-2 text-emerald-700 hover:text-emerald-900 font-medium"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Expert Recommendations
          </Link>
          <p className="text-sm text-gray-500 mt-1">
            Keep the recommendations page open in another tab to easily compare while vetting.
          </p>
        </div>
        <div className="flex-1 min-h-0">
          {loading ? (
            <div className="flex items-center justify-center h-64">
              <div className="animate-spin w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full" />
            </div>
          ) : !(selectedCompanyId || campaign?.company_id) ? (
            <div className="flex items-center justify-center h-64 text-gray-600">
              Select a company to use the vet chat.
            </div>
          ) : (
            <CampaignAIChat
                isOpen={true}
                onClose={() => router.push(`/campaigns/${campaignId}/recommendations`)}
                onMinimize={() => router.push(`/campaigns/${campaignId}/recommendations`)}
                context="campaign-recommendations"
                companyId={selectedCompanyId || campaign?.company_id}
                campaignId={campaignId}
                campaignData={campaign ?? { id: campaignId, name: 'Campaign' }}
                initialPlan={initialPlan}
                standalone={true}
                vetScope={vetScope}
              />
          )}
        </div>
      </div>
    </>
  );
}
