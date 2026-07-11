/**
 * @deprecated DEAD CODE — QUARANTINED (Strategic Mix P0, 2026-07-11).
 *
 * Companion hook of the quarantined `components/IntelMixView.tsx` — rendered
 * by NO route since `intelligent-mix-strategy.tsx` switched to
 * `<BoltCombinedStrategyPage/>`. Verified zero importers at quarantine time.
 * Do not re-wire; see IntelMixView.tsx banner for the full rationale.
 *
 * ── Original header ──
 * Command Center → Intelligent Mix Strategy
 * Collects: goals, audience, format mix (text + creator), per-format frequency,
 * campaign start date and duration (1–12 weeks) — then hands off to the
 * Trend Campaigns page where AI enriches the plan further.
 */

import React, { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/router';
import { CORE_AUDIENCE_LABELS } from '../lib/shared/audience/audienceRegistry';
import { useCompanyContext } from '../components/CompanyContext';
import { fetchWithAuth } from '../components/community-ai/fetchWithAuth';
import UnifiedContextModeSelector, {
  type ContextMode,
  type FocusModule,
} from '../components/recommendations/engine-framework/UnifiedContextModeSelector';
import StrategicAspectSelector from '../components/recommendations/engine-framework/StrategicAspectSelector';
import OfferingFacetSelector from '../components/recommendations/engine-framework/OfferingFacetSelector';
import { BoltCampaignChat } from '../components/bolt/BoltCampaignChat';
import { readCampaignSourcePayload } from '../lib/content/launchCampaignFromContent';
import { useBoltPlatformPicker } from './useBoltPlatformPicker';
import {
  PRIMARY_OPTIONS,
  PERSONAL_BRAND_SECONDARY_GROUPS,
  getSecondaryOptionsForPrimary,
  isPersonalBrandPrimary,
  getDilutionSeverity,
  type PrimaryCampaignTypeId,
  type SecondaryOptionId,
} from '../lib/campaignTypeHierarchy';

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

const AUDIENCE_OPTIONS = CORE_AUDIENCE_LABELS;

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


export function useIntelMix() {
  const router = useRouter();
  const { user, selectedCompanyId, selectedCompanyName, authChecked, isLoading } = useCompanyContext();
  const sourceContentToken = typeof router.query.sourceContentToken === 'string' ? router.query.sourceContentToken : null;
  const sourcePayload = readCampaignSourcePayload(sourceContentToken);

  const [primaryCampaignType, setPrimaryCampaignType] = useState<PrimaryCampaignTypeId>('brand_awareness');
  const [secondaryCampaignTypes, setSecondaryCampaignTypes] = useState<SecondaryOptionId[]>([]);
  const [audience, setAudience] = useState<string[]>(['B2B Marketers']);
  const [textFormats, setTextFormats] = useState<TextFormat[]>(['post', 'article']);
  const [creatorFormats, setCreatorFormats] = useState<CreatorFormat[]>(['video', 'carousel']);
  const [textFrequency, setTextFrequency] = useState<Record<string, number>>({ post: 3, article: 1 });
  const [creatorFrequency, setCreatorFrequency] = useState<Record<string, number>>({ video: 1, carousel: 1 });
  const [duration, setDuration] = useState(4);
  const [startDate, setStartDate] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() + 1);
    return d.toISOString().split('T')[0];
  });
  // Round-6: capability-aware platform picker (intelligent-mix = union of all
  // registry-known connected platforms; fail-closed on unknowns).
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>([]);
  const platformPicker = useBoltPlatformPicker(selectedCompanyId, 'intelligent-mix');
  const togglePlatform = (p: string) =>
    setSelectedPlatforms((prev) => (prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]));
  useEffect(() => {
    if (platformPicker.loading || platformPicker.supported.length === 0) return;
    setSelectedPlatforms((prev) => {
      const filtered = prev.filter((p) => platformPicker.supported.includes(p));
      return filtered.length > 0 ? filtered : platformPicker.supported;
    });
  }, [platformPicker.loading, platformPicker.supported]);

  const [extraContext, setExtraContext] = useState('');
  const [communicationStyle, setCommunicationStyle] = useState<string[]>([]);
  const [contextMode, setContextMode] = useState<ContextMode>('FULL');
  const [focusedModules, setFocusedModules] = useState<FocusModule[]>([]);
  const [additionalDirection, setAdditionalDirection] = useState('');
  const [selectedAspects, setSelectedAspects] = useState<string[]>([]);
  const [selectedFacets, setSelectedFacets] = useState<string[]>([]);
  const [strategicText, setStrategicText] = useState('');
  const [regionInput, setRegionInput] = useState('');
  const [strategicConfig, setStrategicConfig] = useState<StrategicConfig | null>(null);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [showChat, setShowChat] = useState(true);

  /* ── Restore draft ── */
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(INTELLIGENT_MIX_STATE_KEY);
      if (saved) {
        const s = JSON.parse(saved) as Partial<IntelligentMixState>;
        if (s.primaryCampaignType) setPrimaryCampaignType(s.primaryCampaignType);
        if (s.secondaryCampaignTypes?.length) setSecondaryCampaignTypes(s.secondaryCampaignTypes);
        if (s.audience?.length) setAudience(s.audience);
        if (s.textFormats?.length) setTextFormats(s.textFormats);
        if (s.creatorFormats?.length) setCreatorFormats(s.creatorFormats);
        if (s.textFrequency) setTextFrequency(s.textFrequency);
        if (s.creatorFrequency) setCreatorFrequency(s.creatorFrequency);
        if (s.duration) setDuration(s.duration);
        if (s.startDate) setStartDate(s.startDate);
        if (s.extraContext) setExtraContext(s.extraContext);
        if (s.communicationStyle?.length) setCommunicationStyle(s.communicationStyle);
        if (s.contextMode) setContextMode(s.contextMode);
        if (s.focusedModules?.length) setFocusedModules(s.focusedModules);
        if (s.additionalDirection) setAdditionalDirection(s.additionalDirection);
        if (s.selectedAspects?.length) setSelectedAspects(s.selectedAspects);
        if (s.selectedFacets?.length) setSelectedFacets(s.selectedFacets);
        if (s.strategicText) setStrategicText(s.strategicText);
        if (s.regionsInput) setRegionInput(s.regionsInput);
      }
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    if (!sourcePayload) return;
    setStrategicText((prev) => prev.trim() ? prev : sourcePayload.suggestedTopic);
    setExtraContext((prev) =>
      prev.trim()
        ? prev
        : sourcePayload.excerpt || `Repurpose this ${sourcePayload.contentType} into a mixed-format campaign.`,
    );
    setAdditionalDirection((prev) =>
      prev.trim()
        ? prev
        : `Use "${sourcePayload.title}" as the campaign seed and expand it into a broader strategic narrative.`,
    );
  }, [sourcePayload]);

  useEffect(() => {
    if (!selectedCompanyId) {
      setStrategicConfig(null);
      return;
    }
    let cancelled = false;
    fetchWithAuth(`/api/company-profile?companyId=${encodeURIComponent(selectedCompanyId)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled) return;
        const config = data?.recommendation_strategic_config;
        const map = config?.offerings_by_aspect ?? config?.aspect_offerings_map;
        if (config && Array.isArray(config.strategic_aspects) && typeof map === 'object') {
          setStrategicConfig({
            strategic_aspects: config.strategic_aspects,
            aspect_offerings_map: map,
            offerings_by_aspect: map,
          });
        } else {
          setStrategicConfig(null);
        }
      })
      .catch(() => {
        if (!cancelled) setStrategicConfig(null);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedCompanyId]);

  useEffect(() => {
    if (!selectedCompanyId) return;
    setSuggestionsLoading(true);
    fetchWithAuth('/api/planner/suggest-campaigns', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ companyId: selectedCompanyId }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.suggestions) setSuggestions(data.suggestions as Suggestion[]);
      })
      .catch(() => {
        setSuggestions([]);
      })
      .finally(() => setSuggestionsLoading(false));
  }, [selectedCompanyId]);

  useEffect(() => {
    if (authChecked && !user?.userId) router.replace('/login');
  }, [authChecked, user?.userId, router]);

  const _ef1 = !authChecked || isLoading;
  const _ef2 = !user?.userId;

  /* ── Campaign focus helpers ── */
  const selectPrimary = (id: PrimaryCampaignTypeId) => {
    setPrimaryCampaignType(id);
    setSecondaryCampaignTypes([]);
  };
  const toggleSecondary = (id: SecondaryOptionId) => {
    if (primaryCampaignType === 'third_party') return;
    setSecondaryCampaignTypes((prev) =>
      prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]
    );
  };
  const dilutionSeverity =
    primaryCampaignType && secondaryCampaignTypes.length > 0
      ? getDilutionSeverity(primaryCampaignType, secondaryCampaignTypes)
      : 'none';

  const aspects = strategicConfig?.strategic_aspects ?? [];
  const aspectOfferingsMap = strategicConfig?.aspect_offerings_map ?? strategicConfig?.offerings_by_aspect ?? {};

  const offeringsForSelectedAspect = useMemo(() => {
    if (selectedAspects.length === 0) return [];
    const seen = new Set<string>();
    for (const aspect of selectedAspects) {
      const ids = aspectOfferingsMap[aspect];
      if (Array.isArray(ids)) ids.forEach((id) => seen.add(id));
    }
    return Array.from(seen);
  }, [selectedAspects, aspectOfferingsMap]);

  const offeringFacetCards = useMemo(() => {
    return offeringsForSelectedAspect.map((id) => {
      const title = id.includes(':') ? id.split(':').slice(1).join(':').trim() || id : id;
      return { id, title, description: title };
    });
  }, [offeringsForSelectedAspect]);

  useEffect(() => {
    if (selectedAspects.length === 0 || selectedFacets.length === 0) return;
    const allowed = new Set<string>();
    for (const aspect of selectedAspects) {
      const ids = aspectOfferingsMap[aspect];
      if (Array.isArray(ids)) ids.forEach((id) => allowed.add(id));
    }
    const next = selectedFacets.filter((id) => allowed.has(id));
    if (next.length !== selectedFacets.length) setSelectedFacets(next);
  }, [selectedAspects, selectedFacets, aspectOfferingsMap]);

  /* ── Frequency helpers ── */
  const setTextFreq = (fmt: string, val: number) =>
    setTextFrequency((p) => ({ ...p, [fmt]: val }));
  const setCreatorFreq = (fmt: string, val: number) =>
    setCreatorFrequency((p) => ({ ...p, [fmt]: val }));

  /* ── Validation ── */
  const canContinue =
    !!primaryCampaignType &&
    audience.length > 0 &&
    communicationStyle.length > 0 &&
    (textFormats.length > 0 || creatorFormats.length > 0) &&
    !!startDate;

  /* ── Total weekly posts ── */
  const totalPerWeek =
    textFormats.reduce((s, f) => s + (textFrequency[f] ?? 1), 0) +
    creatorFormats.reduce((s, f) => s + (creatorFrequency[f] ?? 1), 0);

  const handleContinue = () => {
    const state: IntelligentMixState = {
      audience, textFormats, creatorFormats,
      textFrequency, creatorFrequency, duration, startDate, extraContext,
      communicationStyle, primaryCampaignType, secondaryCampaignTypes,
      contextMode,
      focusedModules,
      additionalDirection,
      selectedAspects,
      selectedFacets,
      strategicText,
      regionsInput: regionInput,
      autoGenerateThemes: true,
    };
    try { sessionStorage.setItem(INTELLIGENT_MIX_STATE_KEY, JSON.stringify(state)); } catch { /* ignore */ }

    const qs = new URLSearchParams({
      tab: 'TREND',
      intelligentMix: '1',
      ...(selectedCompanyId ? { companyId: selectedCompanyId } : {}),
    });
    router.push(`/recommendations?${qs.toString()}`);
  };

  const applySuggestion = (suggestion: Suggestion) => {
    setStrategicText(suggestion.suggested_campaign_title || suggestion.topic);
    if (suggestion.suggested_duration) setDuration(suggestion.suggested_duration);
  };

  /* ── Duration bar (1-12 weeks) ── */
  const durationWeeks = Array.from({ length: 12 }, (_, i) => i + 1);


  return {
    _ef1,
    _ef2,
    additionalDirection,
    applySuggestion,
    aspectOfferingsMap,
    aspects,
    audience,
    authChecked,
    canContinue,
    communicationStyle,
    contextMode,
    creatorFormats,
    creatorFrequency,
    dilutionSeverity,
    duration,
    durationWeeks,
    extraContext,
    focusedModules,
    handleContinue,
    isLoading,
    offeringFacetCards,
    offeringsForSelectedAspect,
    primaryCampaignType,
    regionInput,
    router,
    secondaryCampaignTypes,
    selectPrimary,
    selectedAspects,
    selectedCompanyId,
    selectedCompanyName,
    selectedFacets,
    setAdditionalDirection,
    setAudience,
    setCommunicationStyle,
    setContextMode,
    setCreatorFormats,
    setCreatorFreq,
    setCreatorFrequency,
    setDuration,
    setExtraContext,
    setFocusedModules,
    setPrimaryCampaignType,
    setRegionInput,
    setSecondaryCampaignTypes,
    setSelectedAspects,
    setSelectedFacets,
    setShowChat,
    setStartDate,
    setStrategicConfig,
    setStrategicText,
    setSuggestions,
    setSuggestionsLoading,
    setTextFormats,
    setTextFreq,
    setTextFrequency,
    showChat,
    sourceContentToken,
    sourcePayload,
    startDate,
    strategicConfig,
    strategicText,
    suggestions,
    suggestionsLoading,
    selectedPlatforms,
    togglePlatform,
    availablePlatforms: platformPicker.supported,
    platformHidden: platformPicker.hidden,
    platformsLoading: platformPicker.loading,
    platformBlocked: platformPicker.blocked,
    textFormats,
    textFrequency,
    toggleSecondary,
    totalPerWeek,
    user,
  };
}
