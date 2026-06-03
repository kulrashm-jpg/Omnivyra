/**
 * Command Center → Intelligent Mix Strategy
 *
 * Collects: goals, audience, format mix (text + creator), per-format frequency,
 * campaign start date and duration (1–12 weeks) — then hands off to the
 * Trend Campaigns page where AI enriches the plan further.
 */

import React, { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/router';
import { useCompanyContext } from '../../components/CompanyContext';
import { fetchWithAuth } from '../../components/community-ai/fetchWithAuth';
import UnifiedContextModeSelector, {
  type ContextMode,
  type FocusModule,
} from '../../components/recommendations/engine-framework/UnifiedContextModeSelector';
import StrategicAspectSelector from '../../components/recommendations/engine-framework/StrategicAspectSelector';
import OfferingFacetSelector from '../../components/recommendations/engine-framework/OfferingFacetSelector';
import { BoltCampaignChat } from '../../components/bolt/BoltCampaignChat';
import { readCampaignSourcePayload } from '../../lib/content/launchCampaignFromContent';
import {
  PRIMARY_OPTIONS,
  PERSONAL_BRAND_SECONDARY_GROUPS,
  getSecondaryOptionsForPrimary,
  isPersonalBrandPrimary,
  getDilutionSeverity,
  type PrimaryCampaignTypeId,
  type SecondaryOptionId,
} from '../../lib/campaignTypeHierarchy';

type TextFormat = 'post' | 'article' | 'newsletter' | 'short_story' | 'white_paper';
type CreatorFormat = 'video' | 'reel' | 'carousel' | 'image' | 'podcast' | 'short' | 'story';

export const INTELLIGENT_MIX_STATE_KEY = 'intelligent-mix-strategy-state';

export type IntelligentMixState = {
  audience: string[];
  textFormats: TextFormat[];
  creatorFormats: CreatorFormat[];
  textFrequency: Record<string, number>;
  creatorFrequency: Record<string, number>;
  duration: number;
  startDate: string;
  extraContext: string;
  communicationStyle: string[];
  primaryCampaignType: PrimaryCampaignTypeId;
  secondaryCampaignTypes?: SecondaryOptionId[];
  contextMode?: ContextMode;
  focusedModules?: FocusModule[];
  additionalDirection?: string;
  selectedAspects?: string[];
  selectedFacets?: string[];
  strategicText?: string;
  regionsInput?: string;
  autoGenerateThemes?: boolean;
};

type StrategicConfig = {
  strategic_aspects: string[];
  aspect_offerings_map: Record<string, string[]>;
  offerings_by_aspect?: Record<string, string[]>;
};

type Suggestion = {
  id: string;
  topic: string;
  suggested_campaign_title: string;
  opportunity_score: number | null;
  suggested_duration: number;
};

const AUDIENCE_OPTIONS = [
  'B2B Marketers', 'Founders / Entrepreneurs', 'Marketing Leaders',
  'Sales Teams', 'Product Managers', 'Developers', 'General Consumers',
];

const TEXT_FORMATS: { value: TextFormat; label: string; icon: string }[] = [
  { value: 'post',        label: 'Post',        icon: '📝' },
  { value: 'article',     label: 'Article',     icon: '🗞️' },
  { value: 'newsletter',  label: 'Newsletter',  icon: '✉️' },
  { value: 'short_story', label: 'Short Story', icon: '📖' },
  { value: 'white_paper', label: 'White Paper', icon: '📄' },
];

const CREATOR_FORMATS: { value: CreatorFormat; label: string; icon: string }[] = [
  { value: 'video',    label: 'Video',    icon: '🎬' },
  { value: 'reel',     label: 'Reel',     icon: '🎥' },
  { value: 'carousel', label: 'Carousel', icon: '🖼️' },
  { value: 'image',    label: 'Image',    icon: '📸' },
  { value: 'podcast',  label: 'Podcast',  icon: '🎙️' },
  { value: 'short',    label: 'Short',    icon: '⚡' },
  { value: 'story',    label: 'Story',    icon: '📱' },
];

function toggle<T>(arr: T[], val: T): T[] {
  return arr.includes(val) ? arr.filter((x) => x !== val) : [...arr, val];
}

const ISO_COUNTRIES = [
  { name: 'India', code: 'IN' },
  { name: 'United States', code: 'US' },
  { name: 'United Kingdom', code: 'GB' },
  { name: 'Germany', code: 'DE' },
  { name: 'France', code: 'FR' },
  { name: 'Canada', code: 'CA' },
  { name: 'Australia', code: 'AU' },
  { name: 'Singapore', code: 'SG' },
  { name: 'UAE', code: 'AE' },
  { name: 'Japan', code: 'JP' },
  { name: 'Indonesia', code: 'ID' },
  { name: 'Italy', code: 'IT' },
  { name: 'Spain', code: 'ES' },
  { name: 'Brazil', code: 'BR' },
  { name: 'Mexico', code: 'MX' },
  { name: 'Netherlands', code: 'NL' },
];

function matchCountry(input: string, country: { name: string; code: string }): boolean {
  const q = input.trim().toLowerCase();
  if (!q) return false;
  if (country.code.toLowerCase() === q) return true;
  if (q.length <= 2) return false;
  return country.name.toLowerCase().startsWith(q);
}

function ChipButton({
  label, selected, onClick, icon,
}: { label: string; selected: boolean; onClick: () => void; icon?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium border transition-all ${
        selected
          ? 'bg-teal-600 text-white border-teal-600 shadow-sm'
          : 'bg-white text-gray-700 border-gray-300 hover:border-teal-400 hover:text-teal-700'
      }`}
    >
      {icon && <span>{icon}</span>}
      {label}
    </button>
  );
}

function FreqStepper({
  value, onChange, min = 1, max = 7,
}: { value: number; onChange: (v: number) => void; min?: number; max?: number }) {
  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={() => onChange(Math.max(min, value - 1))}
        disabled={value <= min}
        className="w-6 h-6 rounded-full border border-gray-300 text-gray-600 flex items-center justify-center text-sm hover:bg-gray-50 disabled:opacity-30"
      >−</button>
      <span className="w-6 text-center text-sm font-semibold text-gray-800">{value}</span>
      <button
        type="button"
        onClick={() => onChange(Math.min(max, value + 1))}
        disabled={value >= max}
        className="w-6 h-6 rounded-full border border-gray-300 text-gray-600 flex items-center justify-center text-sm hover:bg-gray-50 disabled:opacity-30"
      >+</button>
      <span className="text-xs text-gray-400 ml-0.5">/wk</span>
    </div>
  );
}

import { useIntelMix } from '../../hooks/useIntelMix';
import IntelMixView from '../../components/IntelMixView';
import PageLoader from '../../components/PageLoader';
export default function IntelMixPage() {
  const d = useIntelMix();
  if (d._ef1) return <PageLoader message="Loading Intelligent Mix…" />;
  if (d._ef2) return <PageLoader message="Loading Intelligent Mix…" />;
  return <IntelMixView d={d} />;
}
