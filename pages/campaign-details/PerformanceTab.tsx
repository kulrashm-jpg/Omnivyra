import React from 'react';
import type { PerformanceSummary } from './types';

interface Props {
  performanceSummary: PerformanceSummary | null;
}

export default function PerformanceTab({ performanceSummary }: Props) {
  return (
    <div className="bg-white rounded-xl p-4 sm:p-6 shadow-sm border">
      <h2 className="text-xl font-semibold mb-4">Performance</h2>
      {performanceSummary ? (
        <div className="space-y-6 text-sm text-gray-700">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <div className="font-medium text-gray-900">Expected reach</div>
              <div>{performanceSummary.expected_reach ?? '—'}</div>
            </div>
            <div>
              <div className="font-medium text-gray-900">Actual impressions</div>
              <div>{performanceSummary.impressions}</div>
            </div>
            <div>
              <div className="font-medium text-gray-900">Accuracy</div>
              <div>{Math.round(performanceSummary.accuracy_score * 100)}%</div>
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <div className="text-gray-500">Likes</div>
              <div className="font-medium">{performanceSummary.likes}</div>
            </div>
            <div>
              <div className="text-gray-500">Shares</div>
              <div className="font-medium">{performanceSummary.shares}</div>
            </div>
            <div>
              <div className="text-gray-500">Comments</div>
              <div className="font-medium">{performanceSummary.comments}</div>
            </div>
            <div>
              <div className="text-gray-500">Clicks</div>
              <div className="font-medium">{performanceSummary.clicks}</div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <div className="font-medium text-gray-900">Engagement rate</div>
              <div>{(performanceSummary.engagement_rate * 100).toFixed(2)}%</div>
            </div>
            <div>
              <div className="font-medium text-gray-900">Recommendation confidence</div>
              <div>{performanceSummary.recommendation_confidence ?? '—'}</div>
            </div>
            <div>
              <div className="font-medium text-gray-900">Last collected</div>
              <div>
                {performanceSummary.last_collected_at
                  ? new Date(performanceSummary.last_collected_at).toLocaleString()
                  : '—'}
              </div>
            </div>
          </div>
        </div>
      ) : (
        <p className="text-sm text-gray-500">No performance data available yet.</p>
      )}
    </div>
  );
}
