import React from 'react';
import { AlertCircle, CheckCircle, Sparkles, Zap } from 'lucide-react';
import EmptyState from '@/components/shared/EmptyState';
import ExamplePreview from '@/components/shared/ExamplePreview';
import type { AIProvider, CampaignLearning } from './types';

type CampaignAIInfoPanelsProps = {
  showLearning: boolean;
  showSettings: boolean;
  campaignLearnings: CampaignLearning[];
  selectedProvider: AIProvider;
  onProviderChange: (provider: AIProvider) => void;
};

export function CampaignAIInfoPanels({
  showLearning,
  showSettings,
  campaignLearnings,
  selectedProvider,
  onProviderChange,
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

      {showSettings && (
        <div className="bg-gray-50 border-b border-gray-200 p-4">
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">AI Provider</label>
              <div className="flex gap-2">
                {[
                  { id: 'demo', name: 'Demo AI', icon: Sparkles, status: 'Always Available' },
                  { id: 'gpt', name: 'AI Assistant', icon: Zap, status: 'Use if configured' },
                ].map((provider) => {
                  const Icon = provider.icon;
                  return (
                    <button
                      key={provider.id}
                      onClick={() => onProviderChange(provider.id as AIProvider)}
                      className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-200 ${
                        selectedProvider === provider.id
                          ? 'bg-indigo-600 text-white shadow-sm'
                          : 'bg-white border border-gray-300 text-gray-700 hover:bg-gray-50'
                      }`}
                    >
                      <Icon className="h-4 w-4" />
                      <div className="text-left">
                        <div>{provider.name}</div>
                        <div className={`text-xs ${selectedProvider === provider.id ? 'text-white/80' : 'text-gray-500'}`}>
                          {provider.status}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>

              <div className="mt-3 p-3 bg-blue-50 rounded-lg">
                <div className="flex items-center gap-2 mb-2">
                  <CheckCircle className="h-4 w-4 text-blue-600" />
                  <span className="text-sm font-medium text-blue-900">AI Assistant Configuration</span>
                </div>
                <div className="text-sm text-blue-800">
                  {selectedProvider === 'gpt' && (
                    <div>
                      <strong>Company-configured AI assistant</strong>
                      <br />
                      <span className="text-blue-600">Provider credentials are validated when you send a message.</span>
                    </div>
                  )}
                  {selectedProvider === 'demo' && (
                    <div>
                      <strong>Demo Mode</strong> - No API configuration detected
                      <br />
                      <span className="text-orange-600">Using simulated responses</span>
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="text-xs text-gray-600">
              {selectedProvider === 'demo' ? (
                <span className="flex items-center gap-1">
                  <CheckCircle className="h-3 w-3 text-green-500" />
                  Demo mode with campaign learning simulation
                </span>
              ) : (
                <span className="flex items-center gap-1">
                  <AlertCircle className="h-3 w-3 text-orange-500" />
                  AI provider with campaign context
                </span>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
