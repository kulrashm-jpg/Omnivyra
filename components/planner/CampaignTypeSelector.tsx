/**
 * Campaign Type Selector
 * Radio cards for TEXT, CREATOR, HYBRID campaign types.
 * Stores value in planner session state.
 */

import React from 'react';
import { usePlannerSession } from './plannerSessionStore';
import { FileText, Video, Layers } from 'lucide-react';

export type CampaignType = 'TEXT' | 'CREATOR' | 'HYBRID';

const OPTIONS: { value: CampaignType; label: string; description: string; icon: React.ReactNode }[] = [
  { value: 'TEXT', label: 'Text Campaign', description: 'AI-generated content only', icon: <FileText className="h-4 w-4" /> },
  { value: 'CREATOR', label: 'Creator Campaign', description: 'Video, carousel, images', icon: <Video className="h-4 w-4" /> },
  { value: 'HYBRID', label: 'Hybrid Campaign', description: 'Creator + text distribution', icon: <Layers className="h-4 w-4" /> },
];

export interface CampaignTypeSelectorProps {
  className?: string;
}

export function CampaignTypeSelector({ className = '' }: CampaignTypeSelectorProps) {
  const { state, setCampaignType } = usePlannerSession();
  const value = state.campaign_type ?? 'TEXT';

  return (
    <div className={className}>
      <label className="block text-sm font-medium text-gray-700 mb-2">Campaign Type</label>
      <div className="grid grid-cols-3 gap-2">
        {OPTIONS.map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => setCampaignType(opt.value)}
            className={`flex flex-col items-center gap-1 p-3 rounded-lg border-2 text-left transition-colors ${
              value === opt.value
                ? 'border-indigo-500 bg-indigo-50 text-indigo-700'
                : 'border-gray-200 hover:border-gray-300 text-gray-700'
            }`}
          >
            <span className="text-indigo-600">{opt.icon}</span>
            <span className="text-sm font-medium">{opt.label}</span>
            <span className="text-xs text-gray-500">{opt.description}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
