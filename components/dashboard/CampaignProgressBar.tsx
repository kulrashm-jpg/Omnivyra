import React, { useState, useEffect } from 'react';
import { getAuthToken } from '../../utils/getAuthToken';

interface ProgressData {
  percentage: number;
  contentCount: number;
  scheduledCount: number;
  publishedCount: number;
}

interface CampaignProgressBarProps {
  campaignId: string;
  companyId?: string | null;
}

const CampaignProgressBar: React.FC<CampaignProgressBarProps> = ({ campaignId, companyId }) => {
  const [progress, setProgress] = useState<ProgressData>({
    percentage: 0,
    contentCount: 0,
    scheduledCount: 0,
    publishedCount: 0,
  });
  const [isLoadingProgress, setIsLoadingProgress] = useState(true);

  useEffect(() => {
    const loadProgress = async () => {
      try {
        if (!companyId) {
          setIsLoadingProgress(false);
          return;
        }
        const progressUrl = `/api/campaigns/${campaignId}/progress?companyId=${companyId}`;
        const token = await getAuthToken();
        const response = await fetch(progressUrl, {
          headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        });
        if (!response.ok) { setIsLoadingProgress(false); return; }
        const progressData = await response.json();
        if (progressData.success && progressData.data?.progress) {
          setProgress({
            percentage: progressData.data.progress.percentage || 0,
            contentCount: progressData.data.progress.contentCount || 0,
            scheduledCount: progressData.data.progress.scheduledCount || 0,
            publishedCount: progressData.data.progress.publishedCount || 0,
          });
        }
      } catch {
        // keep defaults
      } finally {
        setIsLoadingProgress(false);
      }
    };
    loadProgress();
  }, [campaignId, companyId]);

  if (isLoadingProgress) {
    return (
      <div className="flex items-center">
        <div className="w-16 bg-gray-200 rounded-full h-2 mr-2">
          <div className="bg-gray-400 h-2 rounded-full animate-pulse" style={{ width: '20%' }} />
        </div>
        <span className="text-sm text-gray-400">Loading...</span>
      </div>
    );
  }

  const percentage = progress.percentage ?? 0;
  const progressColor = percentage === 0
    ? 'bg-gray-400'
    : percentage < 30
    ? 'bg-red-500'
    : percentage < 70
    ? 'bg-yellow-500'
    : 'bg-green-500';

  return (
    <div className="flex items-center">
      <div className="w-16 bg-gray-200 rounded-full h-2 mr-2">
        <div
          className={`h-2 rounded-full transition-all duration-300 ${progressColor}`}
          style={{ width: `${Math.max(percentage, 5)}%` }}
        />
      </div>
      <span className="text-sm text-gray-900">{percentage}%</span>
    </div>
  );
};

export default CampaignProgressBar;
