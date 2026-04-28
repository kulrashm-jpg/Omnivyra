import React, { useCallback, useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import {
  Building2,
  Calendar,
  FileText,
  LayoutGrid,
  Search,
  Loader2,
  ExternalLink,
  MessageSquare,
  Save,
  FolderOpen,
  CalendarDays,
  ListTodo,
  Target,
  Plus,
  X,
} from 'lucide-react';
import { useCompanyContext } from '../components/CompanyContext';
import RecommendationBlueprintCard from '../components/recommendations/cards/RecommendationBlueprintCard';

type CompanyHit = { company_id: string; name: string };
type CampaignHit = { id: string; name: string; company_id: string };
type RecommendationHit = {
  id: string;
  campaign_id: string | null;
  company_id: string;
  trend_topic: string;
};

type WeekPlan = { weekNumber?: number; week?: number; theme?: string; focusArea?: string };
type DailyActivity = {
  id: string;
  execution_id: string;
  week_number: number;
  day: string;
  title: string;
  platform: string;
  content_type: string;
};

const TABS = [
  { id: 'company-profile', label: 'Company profile', icon: Building2 },
  { id: 'strategic-inputs', label: 'Strategic inputs', icon: Target },
  { id: 'campaigns', label: 'Campaigns', icon: FolderOpen },
  { id: 'recommendation-cards', label: 'Recommendation cards', icon: MessageSquare },
  { id: 'weekly-plan', label: 'Weekly plan', icon: Calendar },
  { id: 'daily-plan', label: 'Daily plan', icon: CalendarDays },
  { id: 'activity-workspace', label: 'Activity workspace', icon: LayoutGrid },
] as const;

type TabId = (typeof TABS)[number]['id'];

/** Which tab is the "furthest" unlocked based on current selection. Flow: company → campaigns → recommendation cards → weekly plan → daily plan → activity workspace. */
function getUnlockedTab(
  currentCompanyId: string | null,
  currentCampaignId: string | null,
  selectedWeek: number | null,
  selectedActivity: DailyActivity | null
): TabId {
  if (selectedActivity) return 'activity-workspace';
  if (selectedWeek != null) return 'daily-plan';
  if (currentCampaignId) return 'weekly-plan';
  if (currentCompanyId) return 'campaigns'; // after company profile only Campaigns is active; rest frozen
  return 'company-profile';
}

const TAB_ORDER: TabId[] = [
  'company-profile',
  'strategic-inputs',
  'campaigns',
  'recommendation-cards',
  'weekly-plan',
  'daily-plan',
  'activity-workspace',
];

function isTabUnlocked(tabId: TabId, unlocked: TabId): boolean {
  const idx = TAB_ORDER.indexOf(tabId);
  const unlockedIdx = TAB_ORDER.indexOf(unlocked);
  return idx <= unlockedIdx;
}

import { useContentArchitect } from '../hooks/useContentArchitect';
import ContentArchitectView from '../components/ContentArchitectView';
export default function ContentArchitectPage() {
  const d = useContentArchitect();
  if (d._ef1) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-sm text-gray-600">Loading content architect access...</div>
      </div>
    );
  }
  if (d._ef2) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-6">
        <div className="max-w-md w-full rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          Content Architect access was not detected. Please sign in again at <a className="font-medium underline" href="/super-admin/login">/super-admin/login</a>.
        </div>
      </div>
    );
  }
  return <ContentArchitectView d={d} />;
}
