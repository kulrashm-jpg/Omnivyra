import React, { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import { useCompanyContext } from '../../../components/CompanyContext';
import CommunityAiLayout from '../../../components/community-ai/CommunityAiLayout';
import SectionCard from '../../../components/community-ai/SectionCard';
import type { PendingAction } from '../../../components/community-ai/types';
import { fetchWithAuth } from '../../../components/community-ai/fetchWithAuth';

type PostResponse = {
  post_details: {
    content_text: string;
    content_type: string;
    posted_at: string;
    post_url: string;
  } | null;
  engagement_activity: Array<Record<string, unknown>>;
  suggested_actions: Array<PendingAction>;
  action_history: Array<Record<string, unknown>>;
  metrics?: {
    likes: number;
    comments: number;
    shares: number;
    views: number;
  } | null;
  goals?: {
    expected_likes: number;
    expected_comments: number;
    expected_shares: number;
    expected_views: number;
  } | null;
};

export default function CommunityAiPostDetail() {
  const router = useRouter();
  const { selectedCompanyId } = useCompanyContext();
  const tenantId = selectedCompanyId || '';
  const platform = typeof router.query.platform === 'string' ? router.query.platform : '';
  const postId = typeof router.query.postId === 'string' ? router.query.postId : '';

  const [postData, setPostData] = useState<PostResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const context = useMemo(
    () => ({
      tenant_id: tenantId,
      organization_id: tenantId,
      platform,
      post_id: postId,
      post_details: postData?.post_details || null,
      engagement_activity: postData?.engagement_activity || [],
      suggested_actions: postData?.suggested_actions || [],
      action_history: postData?.action_history || [],
    }),
    [tenantId, platform, postId, postData]
  );

  useEffect(() => {
    const loadPost = async () => {
      if (!tenantId || !platform || !postId) {
        setPostData(null);
        return;
      }
      setIsLoading(true);
      setErrorMessage(null);
      try {
        const response = await fetchWithAuth(
          `/api/community-ai/post/${encodeURIComponent(platform)}/${encodeURIComponent(
            postId
          )}?tenant_id=${encodeURIComponent(tenantId)}&organization_id=${encodeURIComponent(tenantId)}`
        );
        if (!response.ok) {
          const data = await response.json().catch(() => null);
          throw new Error(data?.error || 'Failed to load post details');
        }
        const data = await response.json();
        setPostData(data);
      } catch (error: any) {
        setErrorMessage(error?.message || 'Failed to load post details');
      } finally {
        setIsLoading(false);
      }
    };
    loadPost();
  }, [tenantId, platform, postId]);

  return (
    <CommunityAiLayout title={`Post Detail: ${postId || '—'}`} context={context}>
      {errorMessage && (
        <div className="bg-red-50 border border-red-200 text-red-800 text-sm rounded-lg p-3">
          {errorMessage}
        </div>
      )}

      <SectionCard title="Post Info">
        <div className="text-sm text-gray-700 space-y-2">
          <div>Platform: {platform || '—'}</div>
          <div>Content type: {postData?.post_details?.content_type || '—'}</div>
          <div>Posted at: {postData?.post_details?.posted_at || '—'}</div>
          <div>Post URL: {postData?.post_details?.post_url || '—'}</div>
          <div>Content: {postData?.post_details?.content_text || '—'}</div>
        </div>
      </SectionCard>

      <SectionCard title="Goals vs Actual">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm text-gray-700">
          <div className="border rounded-lg p-4">
            <div className="text-xs text-gray-500">Expected</div>
            <div>Likes: {postData?.goals?.expected_likes ?? '—'}</div>
            <div>Comments: {postData?.goals?.expected_comments ?? '—'}</div>
            <div>Shares: {postData?.goals?.expected_shares ?? '—'}</div>
            <div>Views: {postData?.goals?.expected_views ?? '—'}</div>
          </div>
          <div className="border rounded-lg p-4">
            <div className="text-xs text-gray-500">Actual</div>
            <div>Likes: {postData?.metrics?.likes ?? '—'}</div>
            <div>Comments: {postData?.metrics?.comments ?? '—'}</div>
            <div>Shares: {postData?.metrics?.shares ?? '—'}</div>
            <div>Views: {postData?.metrics?.views ?? '—'}</div>
          </div>
        </div>
      </SectionCard>

      <SectionCard title="Engagement Activity">
        <div className="text-sm text-gray-500">
          Comments, replies, likes, and shares will appear here once loaded.
        </div>
      </SectionCard>

      <SectionCard title="Suggested Actions">
        <div className="space-y-3 text-sm text-gray-700">
          {(postData?.suggested_actions || []).map((action) => (
            <div key={action.action_id} className="border rounded-lg p-4">
              <div className="font-semibold text-gray-900">{action.action_type}</div>
              <div className="text-xs text-gray-500">Risk: {action.risk_level}</div>
              <div className="text-xs text-gray-500">
                Requires approval: {action.requires_approval ? 'yes' : 'no'}
              </div>
            </div>
          ))}
          {!isLoading && (postData?.suggested_actions || []).length === 0 && (
            <div className="text-sm text-gray-400">No actions queued for this post.</div>
          )}
        </div>
      </SectionCard>

      <SectionCard title="Action History">
        <div className="text-sm text-gray-500">Action history will appear here.</div>
      </SectionCard>
    </CommunityAiLayout>
  );
}

