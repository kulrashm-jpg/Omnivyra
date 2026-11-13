import React from 'react';
import EmptyState from '@/components/shared/EmptyState';
import ExamplePreview from '@/components/shared/ExamplePreview';
import type { AIProvider, CampaignLearning } from './types';

type CampaignAIInfoPanelsProps = {
  showLearning: boolean;
  campaignLearnings: CampaignLearning[];
  /**
   * Retired 2026-11-13 (e9 ruling): the "AI Provider" settings panel is hidden. The
   * provider choice was never sent to the server (it picks the model), and "Demo AI"
   * presented canned replies as AI. Still accepted so callers don't change.
   */
  showSettings?: boolean;
  selectedProvider?: AIProvider;
  onProviderChange?: (provider: AIProvider) => void;
};

export function CampaignAIInfoPanels({
  showLearning,
  campaignLearnings,
}: CampaignAIInfoPanelsProps) {
  return (
    <>
      {showLearning && (
        <div className="bg-blue-50 border-b border-blue-200 p-4">
          <h4 className="font-semibold text-blue-900 mb-2">Campaign Learnings ({campaignLearnings.length})</h4>
          <div className="space-y-2 max-h-32 overflow-y-auto">
            {campaignLearnings.length > 0 ? campaignLearnings.map((learning, index) => (
              <div key={index} className="text-sm text-blue-800 bg-blue-100 p-2 rounded">
                <strong>{learning.campaignName}:</strong> {learning.learnings[0] || 'No learnings available'}
              </div>
            )) : (
              <EmptyState
                title="Run your first campaign to unlock learnings"
                description="This panel starts surfacing the hooks, themes, and messaging patterns worth repeating as soon as your first campaign produces signals."
                primaryAction={{ label: 'Launch first campaign', href: '/campaigns?sample=1' }}
                examplePreview={(
                  <ExamplePreview variant="insight" />
                )}
              />
            )}
          </div>
        </div>
      )}

    </>
  );
}
