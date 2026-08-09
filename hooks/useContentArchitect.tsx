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
import Header from '../components/Header';
import RecommendationBlueprintCard from '../components/recommendations/cards/RecommendationBlueprintCard';
import { setUserScopedLocalStorage } from '../utils/authStorage';

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


export function useContentArchitect() {
  const router = useRouter();
  const { user, userRole, setSelectedCompanyId, isLoading: isContextLoading } = useCompanyContext();
  const [searchQuery, setSearchQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [companies, setCompanies] = useState<CompanyHit[]>([]);
  const [campaigns, setCampaigns] = useState<CampaignHit[]>([]);
  const [recommendations, setRecommendations] = useState<RecommendationHit[]>([]);
  const [selectedCompany, setSelectedCompany] = useState<CompanyHit | null>(null);
  const [selectedCampaign, setSelectedCampaign] = useState<CampaignHit | null>(null);
  const [selectedRecommendation, setSelectedRecommendation] = useState<RecommendationHit | null>(null);
  const [activeTab, setActiveTab] = useState<TabId>('company-profile');
  const [error, setError] = useState<string | null>(null);
  const [recommendationContext, setRecommendationContext] = useState('');
  const [recommendationContextLoaded, setRecommendationContextLoaded] = useState(false);
  const [savingContext, setSavingContext] = useState(false);
  const [contextSaveMessage, setContextSaveMessage] = useState<'saved' | 'error' | null>(null);
  const [companyCampaigns, setCompanyCampaigns] = useState<CampaignHit[]>([]);
  const [companyCampaignsLoading, setCompanyCampaignsLoading] = useState(false);
  const [companyCampaignsLoadError, setCompanyCampaignsLoadError] = useState<string | null>(null);
  const [weeklyPlans, setWeeklyPlans] = useState<WeekPlan[]>([]);
  const [weeklyPlansLoading, setWeeklyPlansLoading] = useState(false);
  const [selectedWeek, setSelectedWeek] = useState<number | null>(null);
  const [dailyActivities, setDailyActivities] = useState<DailyActivity[]>([]);
  const [dailyActivitiesLoading, setDailyActivitiesLoading] = useState(false);
  const [selectedActivity, setSelectedActivity] = useState<DailyActivity | null>(null);
  const [strategicAspects, setStrategicAspects] = useState<string[]>([]);
  const [offeringsByAspect, setOfferingsByAspect] = useState<Record<string, string[]>>({});
  const [strategicObjectives, setStrategicObjectives] = useState<string[]>([]);
  const [strategicInputsLoaded, setStrategicInputsLoaded] = useState(false);
  const [strategicInputsSaving, setStrategicInputsSaving] = useState(false);
  const [strategicInputsSaveMessage, setStrategicInputsSaveMessage] = useState<'saved' | 'error' | null>(null);
  const [geographyDisplay, setGeographyDisplay] = useState<string>('');
  const [sourceRecommendationCard, setSourceRecommendationCard] = useState<{
    source_recommendation_id: string | null;
    source_strategic_theme: Record<string, unknown> | null;
  } | null>(null);
  const [sourceRecommendationCardLoading, setSourceRecommendationCardLoading] = useState(false);
  const [showStoredCard, setShowStoredCard] = useState(false);
  type StrategicInputSubTab = 'aspect' | 'offering' | 'objectives' | 'geography';
  const [strategicInputSubTab, setStrategicInputSubTab] = useState<StrategicInputSubTab>('aspect');

  const isContentArchitect = userRole === 'CONTENT_ARCHITECT';

  const runSearch = useCallback(async () => {
    const q = searchQuery.trim();
    if (!q) {
      setCompanies([]);
      setCampaigns([]);
      setRecommendations([]);
      return;
    }
    setError(null);
    setSearching(true);
    try {
      const res = await fetch(`/api/content-architect/search?q=${encodeURIComponent(q)}`, {
        credentials: 'include',
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error || 'Search failed');
      }
      const data = await res.json();
      setCompanies(data.companies || []);
      setCampaigns(data.campaigns || []);
      setRecommendations(data.recommendations || []);
      const hasAny =
        (data.companies?.length || 0) +
        (data.campaigns?.length || 0) +
        (data.recommendations?.length || 0);
      if (hasAny === 0) {
        setError('No companies, campaigns, or recommendations found. Try another ID or name.');
      }
    } catch (e) {
      setError((e as Error).message || 'Search failed');
      setCompanies([]);
      setCampaigns([]);
      setRecommendations([]);
    } finally {
      setSearching(false);
    }
  }, [searchQuery]);

  const handleSelectCompany = (c: CompanyHit) => {
    setSelectedCompany(c);
    setSelectedCampaign(null);
    setSelectedCompanyId(c.company_id);
    setUserScopedLocalStorage('selected_company_id', user?.userId ?? null, c.company_id);
    setUserScopedLocalStorage('company_id', user?.userId ?? null, c.company_id);
  };

  const handleSelectCampaign = (c: CampaignHit) => {
    setSelectedCampaign(c);
    setSelectedRecommendation(null);
    setSelectedWeek(null);
    setSelectedActivity(null);
    setSelectedCompany({ company_id: c.company_id, name: '' });
    setSelectedCompanyId(c.company_id);
    setActiveTab('recommendation-cards');
    setUserScopedLocalStorage('selected_company_id', user?.userId ?? null, c.company_id);
    setUserScopedLocalStorage('company_id', user?.userId ?? null, c.company_id);
  };

  const handleSelectRecommendation = (r: RecommendationHit) => {
    setSelectedRecommendation(r);
    setSelectedCompany({ company_id: r.company_id, name: '' });
    setSelectedCompanyId(r.company_id);
    if (r.campaign_id) {
      setSelectedCampaign({
        id: r.campaign_id,
        name: '',
        company_id: r.company_id,
      });
    } else {
      setSelectedCampaign(null);
    }
    setSelectedWeek(null);
    setSelectedActivity(null);
    setActiveTab('weekly-plan');
    setUserScopedLocalStorage('selected_company_id', user?.userId ?? null, r.company_id);
    setUserScopedLocalStorage('company_id', user?.userId ?? null, r.company_id);
  };

  const currentCompanyId =
    selectedCompany?.company_id || selectedCampaign?.company_id || selectedRecommendation?.company_id;
  const currentCampaignId = selectedCampaign?.id ?? selectedRecommendation?.campaign_id ?? null;

  useEffect(() => {
    if (activeTab !== 'recommendation-cards' || !currentCompanyId) {
      setRecommendationContextLoaded(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/company-profile?companyId=${encodeURIComponent(currentCompanyId)}&includeCompleteness=0`,
          { credentials: 'include' }
        );
        if (!res.ok || cancelled) return;
        const data = await res.json();
        const ctx = data?.profile?.recommendation_context ?? '';
        if (!cancelled) {
          setRecommendationContext(typeof ctx === 'string' ? ctx : '');
          setRecommendationContextLoaded(true);
        }
      } catch {
        if (!cancelled) setRecommendationContextLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeTab, currentCompanyId]);

  useEffect(() => {
    if (activeTab !== 'strategic-inputs' || !currentCompanyId) {
      setStrategicInputsLoaded(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/company-profile?companyId=${encodeURIComponent(currentCompanyId)}&includeCompleteness=0`,
          { credentials: 'include' }
        );
        if (!res.ok || cancelled) return;
        const data = await res.json();
        const profile = data?.profile ?? {};
        const si = profile?.strategic_inputs;
        const config = data?.recommendation_strategic_config;
        if (!cancelled) {
          if (si && (Array.isArray(si.strategic_aspects) || (si.offerings_by_aspect && typeof si.offerings_by_aspect === 'object') || Array.isArray(si.strategic_objectives))) {
            setStrategicAspects(Array.isArray(si.strategic_aspects) ? si.strategic_aspects : []);
            setOfferingsByAspect(si.offerings_by_aspect && typeof si.offerings_by_aspect === 'object' ? { ...si.offerings_by_aspect } : {});
            setStrategicObjectives(Array.isArray(si.strategic_objectives) ? si.strategic_objectives : []);
          } else if (config) {
            setStrategicAspects(Array.isArray(config.strategic_aspects) ? config.strategic_aspects : []);
            setOfferingsByAspect(config.offerings_by_aspect && typeof config.offerings_by_aspect === 'object' ? { ...config.offerings_by_aspect } : {});
            setStrategicObjectives(Array.isArray(config.strategic_objectives) ? config.strategic_objectives : []);
          } else {
            setStrategicAspects([]);
            setOfferingsByAspect({});
            setStrategicObjectives([]);
          }
          const geo = profile?.geography ?? profile?.geography_list;
          setGeographyDisplay(
            Array.isArray(geo) ? geo.join(', ') : typeof geo === 'string' ? geo : ''
          );
          setStrategicInputsLoaded(true);
        }
      } catch {
        if (!cancelled) setStrategicInputsLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeTab, currentCompanyId]);

  const [strategicInputsSaveErrorDetail, setStrategicInputsSaveErrorDetail] = useState<string | null>(null);
  const saveStrategicInputs = useCallback(async () => {
    if (!currentCompanyId) return;
    setStrategicInputsSaving(true);
    setStrategicInputsSaveMessage(null);
    setStrategicInputsSaveErrorDetail(null);
    try {
      const res = await fetch('/api/company-profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          company_id: currentCompanyId,
          strategic_inputs: {
            strategic_aspects: strategicAspects.map((s) => s.trim()).filter(Boolean).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' })),
            offerings_by_aspect: Object.fromEntries(
              Object.entries(offeringsByAspect)
                .filter(([k]) => strategicAspects.includes(k))
                .map(([k, v]) => [k, (v ?? []).map((s) => String(s).trim()).filter(Boolean).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))])
            ),
            strategic_objectives: strategicObjectives.map((s) => s.trim()).filter(Boolean).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' })),
          },
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg = typeof data?.error === 'string' ? data.error : 'Save failed';
        setStrategicInputsSaveErrorDetail(msg);
        throw new Error(msg);
      }
      setStrategicInputsSaveMessage('saved');
      setStrategicInputsSaveErrorDetail(null);
      setTimeout(() => setStrategicInputsSaveMessage(null), 3000);
    } catch (e) {
      setStrategicInputsSaveMessage('error');
      if (!strategicInputsSaveErrorDetail && e instanceof Error) {
        setStrategicInputsSaveErrorDetail(e.message);
      }
    } finally {
      setStrategicInputsSaving(false);
    }
  }, [currentCompanyId, strategicAspects, offeringsByAspect, strategicObjectives]);

  useEffect(() => {
    if (!currentCompanyId) {
      setCompanyCampaigns([]);
      setCompanyCampaignsLoadError(null);
      return;
    }
    let cancelled = false;
    setCompanyCampaignsLoading(true);
    setCompanyCampaignsLoadError(null);
    fetch(`/api/campaigns/list?companyId=${encodeURIComponent(currentCompanyId)}`, { credentials: 'include' })
      .then(async (res) => {
        const data = await (res.ok ? res.json() : res.json().catch(() => ({})));
        if (!res.ok) {
          const msg = typeof data?.error === 'string' ? data.error : 'Could not load campaigns';
          if (!cancelled) setCompanyCampaignsLoadError(msg);
          return { campaigns: [] };
        }
        if (!cancelled) setCompanyCampaignsLoadError(null);
        return data;
      })
      .then((data) => {
        if (cancelled) return;
        const list = Array.isArray(data?.campaigns) ? data.campaigns : [];
        setCompanyCampaigns(
          list.map((c: any) => ({
            id: c.id,
            name: c.name || `Campaign ${(c.id || '').slice(0, 8)}`,
            company_id: currentCompanyId,
          }))
        );
      })
      .catch(() => {
        if (!cancelled) {
          setCompanyCampaigns([]);
          setCompanyCampaignsLoadError('Could not load campaigns');
        }
      })
      .finally(() => {
        if (!cancelled) setCompanyCampaignsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [currentCompanyId]);

  useEffect(() => {
    if (!currentCampaignId || !currentCompanyId) {
      setSourceRecommendationCard(null);
      setShowStoredCard(false);
      return;
    }
    setShowStoredCard(false);
    let cancelled = false;
    setSourceRecommendationCardLoading(true);
    fetch(
      `/api/campaigns?type=campaign&campaignId=${encodeURIComponent(currentCampaignId)}&companyId=${encodeURIComponent(currentCompanyId)}`,
      { credentials: 'include' }
    )
      .then((res) => (res.ok ? res.json() : {}))
      .then((data: { sourceRecommendationCard?: { source_recommendation_id?: string; source_strategic_theme?: Record<string, unknown> | string } }) => {
        if (cancelled) return;
        const card = data?.sourceRecommendationCard;
        if (card && (card.source_recommendation_id || card.source_strategic_theme)) {
          const theme = card.source_strategic_theme;
          setSourceRecommendationCard({
            source_recommendation_id: card.source_recommendation_id ?? null,
            source_strategic_theme: theme != null && typeof theme === 'object' && !Array.isArray(theme) ? theme : null,
          });
        } else {
          setSourceRecommendationCard(null);
        }
      })
      .catch(() => {
        if (!cancelled) setSourceRecommendationCard(null);
      })
      .finally(() => {
        if (!cancelled) setSourceRecommendationCardLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [currentCampaignId, currentCompanyId]);

  useEffect(() => {
    if (!currentCampaignId) {
      setWeeklyPlans([]);
      setSelectedWeek(null);
      return;
    }
    let cancelled = false;
    setWeeklyPlansLoading(true);
    fetch(
      `/api/campaigns/get-weekly-plans?campaignId=${encodeURIComponent(currentCampaignId)}${currentCompanyId ? `&companyId=${encodeURIComponent(currentCompanyId)}` : ''}`,
      { credentials: 'include' }
    )
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => {
        if (cancelled) return;
        const list = Array.isArray(data) ? data : [];
        setWeeklyPlans(
          list.map((w: any) => ({
            weekNumber: w.weekNumber ?? w.week_number ?? w.week,
            week: w.weekNumber ?? w.week_number ?? w.week,
            theme: w.theme ?? w.phase ?? w.focusArea ?? w.focus_area,
            focusArea: w.focusArea ?? w.focus_area ?? w.theme,
          }))
        );
      })
      .catch(() => {
        if (!cancelled) setWeeklyPlans([]);
      })
      .finally(() => {
        if (!cancelled) setWeeklyPlansLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [currentCampaignId, currentCompanyId]);

  useEffect(() => {
    if (!currentCampaignId || selectedWeek == null) {
      setDailyActivities([]);
      return;
    }
    let cancelled = false;
    setDailyActivitiesLoading(true);
    fetch(
      `/api/campaigns/retrieve-plan?campaignId=${encodeURIComponent(currentCampaignId)}`,
      { credentials: 'include' }
    )
      .then((res) => (res.ok ? res.json() : {}))
      .then((payload: { draftPlan?: { weeks?: unknown[] }; committedPlan?: { weeks?: unknown[] } }) => {
        if (cancelled) return;
        const planWeeks =
          (Array.isArray(payload?.draftPlan?.weeks) && payload.draftPlan.weeks.length > 0
            ? payload.draftPlan.weeks
            : Array.isArray(payload?.committedPlan?.weeks)
              ? payload.committedPlan.weeks
              : []) || [];
        const week = planWeeks.find(
          (w: any) => Number((w as any)?.week ?? (w as any)?.week_number ?? 0) === selectedWeek
        );
        const items =
          Array.isArray((week as any)?.daily_execution_items)
            ? (week as any).daily_execution_items
            : Array.isArray((week as any)?.daily)
              ? (week as any).daily
              : [];
        const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
        const mapped: DailyActivity[] = items.map((item: any, itemIndex: number) => {
          const execution_id =
            String((item?.execution_id ?? item?.execution_id) || '').trim() || `execution-${selectedWeek}-${itemIndex}`;
          const dayRaw = String((item?.day ?? item?.dayOfWeek) ?? '').trim();
          const day = dayRaw || DAYS[itemIndex % 7];
          const title =
            String((item?.title ?? item?.topic ?? item?.writer_content_brief?.topicTitle) ?? '').trim() || 'Untitled';
          return {
            id: execution_id,
            execution_id,
            week_number: selectedWeek,
            day,
            title,
            platform: String(item?.platform ?? 'linkedin').toLowerCase(),
            content_type: String(item?.content_type ?? 'post').toLowerCase(),
          };
        });
        setDailyActivities(mapped);
      })
      .catch(() => {
        if (!cancelled) setDailyActivities([]);
      })
      .finally(() => {
        if (!cancelled) setDailyActivitiesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [currentCampaignId, selectedWeek]);

  const saveRecommendationContext = useCallback(async () => {
    if (!currentCompanyId) return;
    setSavingContext(true);
    setContextSaveMessage(null);
    try {
      const res = await fetch('/api/company-profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          company_id: currentCompanyId,
          recommendation_context: recommendationContext.trim() || null,
        }),
      });
      if (!res.ok) throw new Error('Save failed');
      setContextSaveMessage('saved');
      setTimeout(() => setContextSaveMessage(null), 3000);
    } catch {
      setContextSaveMessage('error');
    } finally {
      setSavingContext(false);
    }
  }, [currentCompanyId, recommendationContext]);

  const _ef1 = isContextLoading;

  const _ef2 = !isContentArchitect;


  return {
    isLoading: isContextLoading,
    _ef1,
    _ef2,
    activeTab,
    campaigns,
    companies,
    companyCampaigns,
    companyCampaignsLoadError,
    companyCampaignsLoading,
    contextSaveMessage,
    currentCampaignId,
    currentCompanyId,
    dailyActivities,
    dailyActivitiesLoading,
    error,
    geographyDisplay,
    handleSelectCampaign,
    handleSelectCompany,
    handleSelectRecommendation,
    isContentArchitect,
    offeringsByAspect,
    recommendationContext,
    recommendationContextLoaded,
    recommendations,
    router,
    runSearch,
    saveRecommendationContext,
    saveStrategicInputs,
    savingContext,
    searchQuery,
    searching,
    selectedActivity,
    selectedCampaign,
    selectedCompany,
    selectedRecommendation,
    selectedWeek,
    setActiveTab,
    setCampaigns,
    setCompanies,
    setCompanyCampaigns,
    setCompanyCampaignsLoadError,
    setCompanyCampaignsLoading,
    setContextSaveMessage,
    setDailyActivities,
    setDailyActivitiesLoading,
    setError,
    setGeographyDisplay,
    setOfferingsByAspect,
    setRecommendationContext,
    setRecommendationContextLoaded,
    setRecommendations,
    setSavingContext,
    setSearchQuery,
    setSearching,
    setSelectedActivity,
    setSelectedCampaign,
    setSelectedCompany,
    setSelectedCompanyId,
    setSelectedRecommendation,
    setSelectedWeek,
    setShowStoredCard,
    setSourceRecommendationCard,
    setSourceRecommendationCardLoading,
    setStrategicAspects,
    setStrategicInputSubTab,
    setStrategicInputsLoaded,
    setStrategicInputsSaveErrorDetail,
    setStrategicInputsSaveMessage,
    setStrategicInputsSaving,
    setStrategicObjectives,
    setWeeklyPlans,
    setWeeklyPlansLoading,
    showStoredCard,
    sourceRecommendationCard,
    sourceRecommendationCardLoading,
    strategicAspects,
    strategicInputSubTab,
    strategicInputsLoaded,
    strategicInputsSaveErrorDetail,
    strategicInputsSaveMessage,
    strategicInputsSaving,
    strategicObjectives,
    userRole,
    weeklyPlans,
    weeklyPlansLoading,
  };
}
