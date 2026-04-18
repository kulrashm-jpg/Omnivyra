import React, { useState } from 'react';
import SocialPlatformsSection from './SocialPlatformsSection';
import ApiCatalogSection from './ApiCatalogSection';

interface ApisPlatformsTabProps {
  authError: string | null;
}

export default function ApisPlatformsTab({ authError }: ApisPlatformsTabProps) {
  const [apiSubTab, setApiSubTab] = useState<'social' | 'trend' | 'community' | 'llm' | 'image' | 'others'>('social');

  return (
    <div className="space-y-4">
      {authError && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-6 py-4 flex items-center justify-between">
          <span className="text-sm text-red-700">{authError}</span>
          <a href="/super-admin/login" className="ml-4 px-4 py-2 bg-red-600 text-white text-sm font-medium rounded-lg hover:bg-red-700 transition-colors whitespace-nowrap">
            Log in
          </a>
        </div>
      )}

      {/* Sub-tab bar */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 px-4 py-3 flex gap-1 flex-wrap">
        {([
          { id: 'social',    label: 'Social Platform APIs' },
          { id: 'trend',     label: 'Trend APIs' },
          { id: 'community', label: 'Community APIs' },
          { id: 'llm',       label: 'LLM APIs' },
          { id: 'image',     label: 'Image APIs' },
          { id: 'others',    label: 'Others' },
        ] as const).map((sub) => (
          <button
            key={sub.id}
            onClick={() => setApiSubTab(sub.id)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${apiSubTab === sub.id ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
          >
            {sub.label}
          </button>
        ))}
      </div>

      {apiSubTab === 'social' && <SocialPlatformsSection />}
      {apiSubTab !== 'social' && <ApiCatalogSection categoryKey={apiSubTab} />}
    </div>
  );
}
