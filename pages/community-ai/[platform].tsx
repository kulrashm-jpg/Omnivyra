import React, { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import { useCompanyContext } from '../../components/CompanyContext';
import CommunityAiLayout from '../../components/community-ai/CommunityAiLayout';
import SectionCard from '../../components/community-ai/SectionCard';
import type { PendingAction } from '../../components/community-ai/types';
import { fetchWithAuth } from '../../components/community-ai/fetchWithAuth';

const tabTypes = ['Text', 'Image', 'Video', 'Banner', 'Threads'];

const normalizeType = (value: string) => value.trim().toLowerCase();

type PlatformResponse = {
  posts_by_content_type: Array<{
    content_type: string;
    posts: Array<{
      post_id: string;
      post_url: string;
      content_text: string;
      content_type: string;
      posted_at: string;
      status: string;
      pending_actions_count: number;
      metrics: {
        likes: number;
        comments: number;
        shares: number;
        views: number;
      } | null;
    }>;
  }>;
  engagement_metrics: Array<Record<string, unknown>>;
  goals: Array<Record<string, unknown>>;
};

type PlatformKpiSummary = {
  goal_hit_rate: number;
  avg_engagement: number;
  underperforming_count: number;
};

export default function CommunityAiPlatform() {
  const router = useRouter();
  const { selectedCompanyId } = useCompanyContext();
  const tenantId = selectedCompanyId || '';
  const platform = typeof router.query.platform === 'string' ? router.query.platform : '';

  const [platformData, setPlatformData] = useState<PlatformResponse | null>(null);
  const [platformKpi, setPlatformKpi] = useState<PlatformKpiSummary | null>(null);
  const [pendingActions] = useState<PendingAction[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState(tabTypes[0]);

  const context = useMemo(
    () => ({
      tenant_id: tenantId,
      organization_id: tenantId,
      platform,
      platform_data: platformData,
      platform_kpis: platformKpi,
      pending_actions: pendingActions,
      active_tab: activeTab,
    }),
    [tenantId, platform, platformData, platformKpi, pendingActions, activeTab]
  );

  useEffect(() => {
    const loadPlatform = async () => {
      if (!tenantId || !platform) {
        setPlatformData(null);
        return;
      }
      setIsLoading(true);
      setErrorMessage(null);
      try {
        const response = await fetchWithAuth(
          `/api/community-ai/platform/${encodeURIComponent(
            platform
          )}?tenant_id=${encodeURIComponent(tenantId)}&organization_id=${encodeURIComponent(
            tenantId
          )}`
        );
        if (!response.ok) {
          const data = await response.json().catch(() => null);
          throw new Error(data?.error || 'Failed to load platform data');
        }
        const data = await response.json();
        setPlatformData(data);
      } catch (error: any) {
        setErrorMessage(error?.message || 'Failed to load platform data');
      } finally {
        setIsLoading(false);
      }
    };
    loadPlatform();
  }, [tenantId, platform]);

  useEffect(() => {
    const loadKpis = async () => {
      if (!tenantId || !platform) {
        setPlatformKpi(null);
        return;
      }
      try {
        const response = await fetchWithAuth(
          `/api/community-ai/content-kpis?tenant_id=${encodeURIComponent(
            tenantId
          )}&organization_id=${encodeURIComponent(tenantId)}&platform=${encodeURIComponent(
            platform
          )}`
        );
        if (!response.ok) {
          return;
        }
        const data = await response.json();
        const entry = (data?.by_platform || [])[0];
        if (entry) {
          const avgEngagement = (entry.avg_likes || 0) + (entry.avg_comments || 0) + (entry.avg_shares || 0);
          setPlatformKpi({
            goal_hit_rate: entry.goal_hit_rate || 0,
            avg_engagement: avgEngagement,
            underperforming_count: entry.underperforming_count || 0,
          });
        } else {
          setPlatformKpi(null);
        }
      } catch {
        setPlatformKpi(null);
      }
    };
    loadKpis();
  }, [tenantId, platform]);

  const postsByType = platformData?.posts_by_content_type || [];
  const activeGroup = postsByType.find(
    (entry) => normalizeType(entry.content_type) === activeTab.toLowerCase()
  );
  const filteredContent = activeGroup?.posts || [];

  return (
    <CommunityAiLayout title={`Platform: ${platform || '—'}`} context={context}>
      {errorMessage && (
        <div className="bg-red-50 border border-red-200 text-red-800 text-sm rounded-lg p-3">
          {errorMessage}
        </div>
      )}

      <SectionCard title="Platform Metrics vs Goals">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
          <div className="border rounded-lg p-4">
            <div className="text-xs text-gray-500">Goal hit rate</div>
            <div className="text-lg font-semibold text-gray-900">
              {platformKpi ? `${platformKpi.goal_hit_rate}%` : '—'}
            </div>
          </div>
          <div className="border rounded-lg p-4">
            <div className="text-xs text-gray-500">Avg engagement</div>
            <div className="text-lg font-semibold text-gray-900">
              {platformKpi ? platformKpi.avg_engagement : '—'}
            </div>
          </div>
          <div className="border rounded-lg p-4">
            <div className="text-xs text-gray-500">Underperforming</div>
            <div className="text-lg font-semibold text-gray-900">
              {platformKpi ? platformKpi.underperforming_count : '—'}
            </div>
          </div>
        </div>
      </SectionCard>

      <SectionCard title="Content Types">
        <div className="flex flex-wrap gap-2 text-sm">
          {tabTypes.map((type) => (
            <button
              key={type}
              onClick={() => setActiveTab(type)}
              className={`px-3 py-2 rounded-lg border ${
                activeTab === type ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-700'
              }`}
            >
              {type}
            </button>
          ))}
        </div>
      </SectionCard>

      <SectionCard title={`${activeTab} Posts`}>
        <div className="space-y-3 text-sm">
          {filteredContent.map((item) => {
            const pendingCount = item.pending_actions_count ?? 0;
            return (
              <div key={item.post_id} className="border rounded-lg p-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="font-semibold text-gray-900">{item.content_text || '—'}</div>
                    <div className="text-xs text-gray-500">Posted at: {item.posted_at || '—'}</div>
                    <div className="text-xs text-gray-500">Status: {item.status || '—'}</div>
                  </div>
                  <div className="text-xs text-gray-500 text-right">
                    Pending actions: {pendingCount}
                  </div>
                </div>
                <div className="mt-3 text-xs text-gray-500">
                  Likes: {item.metrics?.likes ?? '—'} • Comments: {item.metrics?.comments ?? '—'} •
                  Shares: {item.metrics?.shares ?? '—'} • Views: {item.metrics?.views ?? '—'}
                </div>
                <div className="mt-3">
                  <Link
                    href={{
                      pathname: '/community-ai/[platform]/[postId]',
                      query: tenantId
                        ? {
                            platform,
                            postId: item.post_id,
                            tenant_id: tenantId,
                            organization_id: tenantId,
                          }
                        : { platform, postId: item.post_id },
                    }}
                    className="text-indigo-600 text-xs"
                  >
                    View details
                  </Link>
                </div>
              </div>
            );
          })}
          {!isLoading && filteredContent.length === 0 && (
            <div className="text-sm text-gray-400">No posts in this content type.</div>
          )}
        </div>
      </SectionCard>
    </CommunityAiLayout>
  );
}

