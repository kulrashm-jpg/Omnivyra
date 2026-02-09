import React, { useEffect, useMemo, useState } from 'react';
import { useCompanyContext } from '../../components/CompanyContext';
import CommunityAiLayout from '../../components/community-ai/CommunityAiLayout';
import SectionCard from '../../components/community-ai/SectionCard';
import type { InfluencerCandidate, NetworkOpportunity } from '../../components/community-ai/types';
import { fetchWithAuth } from '../../components/community-ai/fetchWithAuth';

export default function CommunityAiNetwork() {
  const { selectedCompanyId } = useCompanyContext();
  const tenantId = selectedCompanyId || '';
  const [networkOpportunities, setNetworkOpportunities] = useState<NetworkOpportunity[]>([]);
  const [influencers, setInfluencers] = useState<InfluencerCandidate[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    const loadNetwork = async () => {
      if (!tenantId) {
        setNetworkOpportunities([]);
        setInfluencers([]);
        return;
      }
      setIsLoading(true);
      setErrorMessage(null);
      try {
        const response = await fetchWithAuth(
          `/api/community-ai/network?tenant_id=${encodeURIComponent(
            tenantId
          )}&organization_id=${encodeURIComponent(tenantId)}`
        );
        if (!response.ok) {
          const data = await response.json().catch(() => null);
          throw new Error(data?.error || 'Failed to load network data');
        }
        const data = await response.json();
        setNetworkOpportunities(data.network_opportunities || []);
        setInfluencers(data.influencer_candidates || []);
      } catch (error: any) {
        setErrorMessage(error?.message || 'Failed to load network data');
      } finally {
        setIsLoading(false);
      }
    };
    loadNetwork();
  }, [tenantId]);

  const context = useMemo(
    () => ({
      tenant_id: tenantId,
      organization_id: tenantId,
      network_data: networkOpportunities,
      influencer_data: influencers,
    }),
    [tenantId, networkOpportunities, influencers]
  );

  return (
    <CommunityAiLayout title="Network & Influencer Hub" context={context}>
      {errorMessage && (
        <div className="bg-red-50 border border-red-200 text-red-800 text-sm rounded-lg p-3">
          {errorMessage}
        </div>
      )}

      <SectionCard title="Network Opportunities">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm text-left text-gray-700">
            <thead className="text-xs uppercase text-gray-500 border-b">
              <tr>
                <th className="px-3 py-2">platform</th>
                <th className="px-3 py-2">user_handle</th>
                <th className="px-3 py-2">topic</th>
                <th className="px-3 py-2">priority_score</th>
              </tr>
            </thead>
            <tbody>
              {networkOpportunities.map((item) => (
                <tr key={`${item.platform}-${item.user_handle}`} className="border-b">
                  <td className="px-3 py-2">{item.platform}</td>
                  <td className="px-3 py-2">{item.user_handle}</td>
                  <td className="px-3 py-2">{item.topic}</td>
                  <td className="px-3 py-2">{item.priority_score}</td>
                </tr>
              ))}
              {!isLoading && networkOpportunities.length === 0 && (
                <tr>
                  <td className="px-3 py-3 text-gray-400" colSpan={4}>
                    No network opportunities available.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </SectionCard>

      <SectionCard title="Influencer List">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm text-left text-gray-700">
            <thead className="text-xs uppercase text-gray-500 border-b">
              <tr>
                <th className="px-3 py-2">platform</th>
                <th className="px-3 py-2">profile_url</th>
                <th className="px-3 py-2">follower_count</th>
                <th className="px-3 py-2">engagement_rate</th>
                <th className="px-3 py-2">topic_match_score</th>
                <th className="px-3 py-2">status</th>
              </tr>
            </thead>
            <tbody>
              {influencers.map((item) => (
                <tr key={`${item.platform}-${item.profile_url}`} className="border-b">
                  <td className="px-3 py-2">{item.platform}</td>
                  <td className="px-3 py-2">{item.profile_url}</td>
                  <td className="px-3 py-2">{item.follower_count}</td>
                  <td className="px-3 py-2">{item.engagement_rate}</td>
                  <td className="px-3 py-2">{item.topic_match_score}</td>
                  <td className="px-3 py-2">{item.status}</td>
                </tr>
              ))}
              {!isLoading && influencers.length === 0 && (
                <tr>
                  <td className="px-3 py-3 text-gray-400" colSpan={6}>
                    No influencers available.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </SectionCard>
    </CommunityAiLayout>
  );
}

