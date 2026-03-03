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

export default function ContentArchitectPage() {
  const router = useRouter();
  const { userRole, setSelectedCompanyId, isLoading: isContextLoading } = useCompanyContext();
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
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('selected_company_id', c.company_id);
      window.localStorage.setItem('company_id', c.company_id);
    }
  };

  const handleSelectCampaign = (c: CampaignHit) => {
    setSelectedCampaign(c);
    setSelectedRecommendation(null);
    setSelectedWeek(null);
    setSelectedActivity(null);
    setSelectedCompany({ company_id: c.company_id, name: '' });
    setSelectedCompanyId(c.company_id);
    setActiveTab('recommendation-cards');
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('selected_company_id', c.company_id);
      window.localStorage.setItem('company_id', c.company_id);
    }
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
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('selected_company_id', r.company_id);
      window.localStorage.setItem('company_id', r.company_id);
    }
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
            platform: String((item?.platform ?? 'linkedin') ?? '').toLowerCase(),
            content_type: String((item?.content_type ?? 'post') ?? '').toLowerCase(),
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

  if (isContextLoading) {
    return (
      <>
        <Head><title>Content Architect</title></Head>
        <Header />
        <div className="max-w-2xl mx-auto px-4 py-12 text-center">
          <Loader2 className="h-8 w-8 animate-spin text-indigo-600 mx-auto mb-4" />
          <p className="text-gray-600">Loading…</p>
        </div>
      </>
    );
  }

  if (!isContentArchitect) {
    return (
      <>
        <Head><title>Content Architect</title></Head>
        <Header />
        <div className="max-w-2xl mx-auto px-4 py-12 text-center">
          <p className="text-gray-600">This page is for Content Architect only. Log in as Content Architect from the Super Admin login page.</p>
          <button
            type="button"
            onClick={() => router.push('/super-admin/login')}
            className="mt-4 px-4 py-2 bg-indigo-600 text-white rounded-lg"
          >
            Go to login
          </button>
        </div>
      </>
    );
  }

  return (
    <>
      <Head>
        <title>Content Architect — Search &amp; open by ID</title>
      </Head>
      <Header />
      <div className="max-w-4xl mx-auto px-4 py-6">
        <h1 className="text-2xl font-bold text-gray-900 mb-2">Content Architect</h1>
        <p className="text-gray-600 mb-6">
          Search by <strong>company ID</strong>, name, or website URL; <strong>campaign ID</strong> or name; or <strong>recommendation ID</strong>. You can paste any ID directly (e.g. company ID or campaign ID) and it will find that entity. Select a company, campaign, or recommendation to open the tabs: Company profile, Recommendation cards, Weekly plan, Activity workspace.
        </p>

        <div className="flex gap-2 mb-6">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && runSearch()}
              placeholder="Paste company ID, campaign ID, or recommendation ID; or type name/URL..."
              className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
            />
          </div>
          <button
            type="button"
            onClick={runSearch}
            disabled={searching}
            className="px-5 py-3 bg-indigo-600 text-white rounded-xl font-medium disabled:opacity-50 flex items-center gap-2"
          >
            {searching ? <Loader2 className="h-5 w-5 animate-spin" /> : <Search className="h-5 w-5" />}
            Search
          </button>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800">
            {error}
          </div>
        )}

        {(companies.length > 0 || campaigns.length > 0 || recommendations.length > 0) && (
          <div className="mb-6 grid grid-cols-1 md:grid-cols-3 gap-4">
            {companies.length > 0 && (
              <div className="border border-gray-200 rounded-xl p-4">
                <h3 className="text-sm font-semibold text-gray-700 mb-2">Companies</h3>
                <ul className="space-y-1">
                  {companies.map((c) => (
                    <li key={c.company_id}>
                      <button
                        type="button"
                        onClick={() => handleSelectCompany(c)}
                        className={`w-full text-left px-3 py-2 rounded-lg text-sm flex items-center justify-between gap-2 ${
                          selectedCompany?.company_id === c.company_id
                            ? 'bg-indigo-100 text-indigo-800 font-medium'
                            : 'hover:bg-gray-100 text-gray-800'
                        }`}
                      >
                        <span className="truncate">{c.name || c.company_id}</span>
                        <span className="text-xs text-gray-500 font-mono shrink-0">{c.company_id.slice(0, 8)}…</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {campaigns.length > 0 && (
              <div className="border border-gray-200 rounded-xl p-4">
                <h3 className="text-sm font-semibold text-gray-700 mb-2">Campaigns</h3>
                <ul className="space-y-1">
                  {campaigns.map((c) => (
                    <li key={c.id}>
                      <button
                        type="button"
                        onClick={() => handleSelectCampaign(c)}
                        className={`w-full text-left px-3 py-2 rounded-lg text-sm flex items-center justify-between gap-2 ${
                          selectedCampaign?.id === c.id ? 'bg-indigo-100 text-indigo-800 font-medium' : 'hover:bg-gray-100 text-gray-800'
                        }`}
                      >
                        <span className="truncate">{c.name}</span>
                        <span className="text-xs text-gray-500 font-mono shrink-0">{c.id.slice(0, 8)}…</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {recommendations.length > 0 && (
              <div className="border border-gray-200 rounded-xl p-4">
                <h3 className="text-sm font-semibold text-gray-700 mb-2">Recommendations (by ID)</h3>
                <ul className="space-y-1">
                  {recommendations.map((r) => (
                    <li key={r.id}>
                      <button
                        type="button"
                        onClick={() => handleSelectRecommendation(r)}
                        className={`w-full text-left px-3 py-2 rounded-lg text-sm flex flex-col gap-0.5 ${
                          selectedRecommendation?.id === r.id ? 'bg-indigo-100 text-indigo-800 font-medium' : 'hover:bg-gray-100 text-gray-800'
                        }`}
                      >
                        <span className="truncate text-xs font-mono text-gray-500">{r.id.slice(0, 8)}…</span>
                        <span className="truncate">{r.trend_topic || 'Recommendation'}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {currentCompanyId && (() => {
          const unlocked = getUnlockedTab(currentCompanyId, currentCampaignId, selectedWeek, selectedActivity);
          return (
          <>
            <div className="border-b border-gray-200 mb-4">
              <nav className="flex flex-wrap gap-1">
                {TABS.map((tab) => {
                  const enabled = isTabUnlocked(tab.id, unlocked);
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => enabled && setActiveTab(tab.id)}
                      disabled={!enabled}
                      className={`flex items-center gap-2 px-3 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
                        activeTab === tab.id
                          ? 'border-indigo-600 text-indigo-600'
                          : enabled
                            ? 'border-transparent text-gray-600 hover:text-gray-900 hover:border-gray-300'
                            : 'border-transparent text-gray-400 cursor-not-allowed'
                      }`}
                    >
                      <tab.icon className="h-4 w-4 shrink-0" />
                      {tab.label}
                    </button>
                  );
                })}
              </nav>
            </div>

            <div className="bg-white border border-gray-200 rounded-xl p-6 min-h-[280px]">
              {activeTab === 'company-profile' && (
                <div>
                  <p className="text-gray-600 mb-4">
                    Open the full company profile to view and refine company details.
                  </p>
                  <a
                    href={`/company-profile?companyId=${encodeURIComponent(currentCompanyId)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700"
                  >
                    <FileText className="h-4 w-4" />
                    Open company profile
                    <ExternalLink className="h-4 w-4" />
                  </a>
                </div>
              )}

              {activeTab === 'strategic-inputs' && (
                <div className="space-y-6">
                  <p className="text-gray-600">
                    Structure strategic aspects, offering focus, and objectives for this company. These will appear on the Trend Campaigns page for company admins.
                  </p>
                  {!strategicInputsLoaded ? (
                    <div className="flex items-center gap-2 text-gray-500 py-6">
                      <Loader2 className="h-5 w-5 animate-spin" />
                      <span>Loading…</span>
                    </div>
                  ) : (
                    <>
                      <div className="flex flex-wrap gap-1 border-b border-gray-200 pb-2">
                        {(['aspect', 'offering', 'objectives', 'geography'] as const).map((tab) => (
                          <button
                            key={tab}
                            type="button"
                            onClick={() => setStrategicInputSubTab(tab)}
                            className={`px-4 py-2 rounded-t-lg text-sm font-medium transition-colors ${
                              strategicInputSubTab === tab
                                ? 'bg-indigo-100 text-indigo-800 border border-b-0 border-gray-200 -mb-px'
                                : 'bg-gray-100 text-gray-600 hover:bg-gray-200 border border-transparent'
                            }`}
                          >
                            {tab === 'aspect' && 'Strategic aspect'}
                            {tab === 'offering' && 'Offering focus'}
                            {tab === 'objectives' && 'Strategic objectives'}
                            {tab === 'geography' && 'Geography'}
                          </button>
                        ))}
                      </div>

                      {strategicInputSubTab === 'aspect' && (
                        <section className="border border-gray-200 rounded-xl p-5 bg-gray-50/50">
                          <h3 className="text-sm font-semibold text-gray-800 mb-2">Strategic aspect</h3>
                          <p className="text-xs text-gray-500 mb-3">Add or remove aspects. These options will appear on Trend Campaigns.</p>
                          <ul className="space-y-2 mb-3">
                            {[...strategicAspects]
                              .map((item, idx) => ({ item, idx }))
                              .sort((a, b) => String(a.item).trim().toLowerCase().localeCompare(String(b.item).trim().toLowerCase()))
                              .map(({ item, idx }) => (
                                <li key={idx} className="flex items-center gap-2">
                                  <input
                                    type="text"
                                    value={item}
                                    onChange={(e) => setStrategicAspects((prev) => prev.map((x, i) => (i === idx ? e.target.value : x)))}
                                    placeholder="Aspect label"
                                    className="flex-1 px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm"
                                  />
                                  <button type="button" onClick={() => setStrategicAspects((prev) => prev.filter((_, i) => i !== idx))} className="p-2 text-red-600 hover:bg-red-50 rounded-lg" aria-label="Delete"><X className="h-4 w-4" /></button>
                                </li>
                              ))}
                          </ul>
                          <button type="button" onClick={() => setStrategicAspects((prev) => [...prev, ''])} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-100"><Plus className="h-4 w-4" /> Add</button>
                        </section>
                      )}

                      {strategicInputSubTab === 'offering' && (
                        <section className="border border-gray-200 rounded-xl p-5 bg-gray-50/50">
                          <h3 className="text-sm font-semibold text-gray-800 mb-2">Offering focus</h3>
                          <p className="text-xs text-gray-500 mb-3">Per strategic aspect: add or remove offering options.</p>
                          {strategicAspects.filter(Boolean).length === 0 ? (
                            <p className="text-sm text-gray-500">Add at least one strategic aspect in the Strategic aspect tab first.</p>
                          ) : (
                            <div className="space-y-4">
                              {[...strategicAspects]
                                .filter(Boolean)
                                .sort((a, b) => String(a).trim().toLowerCase().localeCompare(String(b).trim().toLowerCase()))
                                .map((aspect) => (
                                  <div key={aspect} className="bg-white rounded-lg border border-gray-200 p-3">
                                    <h4 className="text-xs font-medium text-gray-600 mb-2">{aspect}</h4>
                                    <ul className="space-y-1.5 mb-2">
                                      {[...(offeringsByAspect[aspect] ?? [])]
                                        .map((off, oidx) => ({ off, oidx }))
                                        .sort((a, b) => String(a.off).trim().toLowerCase().localeCompare(String(b.off).trim().toLowerCase()))
                                        .map(({ off, oidx }) => (
                                          <li key={oidx} className="flex items-center gap-2">
                                            <input
                                              type="text"
                                              value={off}
                                              onChange={(e) => setOfferingsByAspect((prev) => ({
                                                ...prev,
                                                [aspect]: (prev[aspect] ?? []).map((x, i) => (i === oidx ? e.target.value : x)),
                                              }))}
                                              placeholder="Offering"
                                              className="flex-1 px-2 py-1.5 bg-gray-50 border border-gray-200 rounded text-sm"
                                            />
                                            <button type="button" onClick={() => setOfferingsByAspect((prev) => ({ ...prev, [aspect]: (prev[aspect] ?? []).filter((_, i) => i !== oidx) }))} className="p-1.5 text-red-600 hover:bg-red-50 rounded" aria-label="Delete"><X className="h-3.5 w-3.5" /></button>
                                          </li>
                                        ))}
                                    </ul>
                                    <button type="button" onClick={() => setOfferingsByAspect((prev) => ({ ...prev, [aspect]: [...(prev[aspect] ?? []), ''] }))} className="inline-flex items-center gap-1 text-xs font-medium text-gray-600 hover:text-gray-800"><Plus className="h-3.5 w-3.5" /> Add offering</button>
                                  </div>
                                ))}
                            </div>
                          )}
                        </section>
                      )}

                      {strategicInputSubTab === 'objectives' && (
                        <section className="border border-gray-200 rounded-xl p-5 bg-gray-50/50">
                          <h3 className="text-sm font-semibold text-gray-800 mb-2">Strategic objectives</h3>
                          <p className="text-xs text-gray-500 mb-3">Add or remove objectives. These options will appear on Trend Campaigns.</p>
                          <ul className="space-y-2 mb-3">
                            {[...strategicObjectives]
                              .map((item, idx) => ({ item, idx }))
                              .sort((a, b) => String(a.item).trim().toLowerCase().localeCompare(String(b.item).trim().toLowerCase()))
                              .map(({ item, idx }) => (
                                <li key={idx} className="flex items-center gap-2">
                                  <input
                                    type="text"
                                    value={item}
                                    onChange={(e) => setStrategicObjectives((prev) => prev.map((x, i) => (i === idx ? e.target.value : x)))}
                                    placeholder="Objective label"
                                    className="flex-1 px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm"
                                  />
                                  <button type="button" onClick={() => setStrategicObjectives((prev) => prev.filter((_, i) => i !== idx))} className="p-2 text-red-600 hover:bg-red-50 rounded-lg" aria-label="Delete"><X className="h-4 w-4" /></button>
                                </li>
                              ))}
                          </ul>
                          <button type="button" onClick={() => setStrategicObjectives((prev) => [...prev, ''])} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-100"><Plus className="h-4 w-4" /> Add</button>
                        </section>
                      )}

                      {strategicInputSubTab === 'geography' && (
                        <section className="border border-gray-200 rounded-xl p-5 bg-gray-50/50">
                          <h3 className="text-sm font-semibold text-gray-800 mb-2">Geography</h3>
                          <p className="text-xs text-gray-500 mb-2">Fixed from company profile (read-only). Edit on Company profile if needed.</p>
                          <p className="px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm text-gray-700">{geographyDisplay || '—'}</p>
                        </section>
                      )}

                      <div className="flex items-center gap-3">
                        <button type="button" onClick={saveStrategicInputs} disabled={strategicInputsSaving} className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700 disabled:opacity-50">
                          {strategicInputsSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save
                        </button>
                        {strategicInputsSaveMessage === 'saved' && <span className="text-sm text-green-600">Saved. Changes will reflect on Trend Campaigns.</span>}
                        {strategicInputsSaveMessage === 'error' && (
                          <span className="text-sm text-red-600">
                            Failed to save.{strategicInputsSaveErrorDetail ? ` ${strategicInputsSaveErrorDetail}` : ''}
                          </span>
                        )}
                      </div>
                    </>
                  )}
                </div>
              )}

              {activeTab === 'campaigns' && (
                <div>
                  <p className="text-gray-600 mb-4">
                    Select a campaign to open recommendation cards for that campaign.
                  </p>
                  {companyCampaignsLoading ? (
                    <div className="flex items-center gap-2 text-gray-500 py-6">
                      <Loader2 className="h-5 w-5 animate-spin" />
                      <span>Loading campaigns…</span>
                    </div>
                  ) : companyCampaignsLoadError ? (
                    <p className="text-red-600 py-4">{companyCampaignsLoadError}</p>
                  ) : companyCampaigns.length === 0 ? (
                    <div className="text-gray-500 py-4 space-y-2">
                      <p>No campaigns found for this company. Create one from the company profile or recommendations.</p>
                      <p className="text-sm">
                        Or search above by <strong>campaign ID</strong> or <strong>campaign name</strong> to open a campaign directly (paste any ID or type a name and select from results).
                      </p>
                    </div>
                  ) : (
                    <ul className="space-y-2">
                      {companyCampaigns.map((c) => (
                        <li key={c.id}>
                          <button
                            type="button"
                            onClick={() => handleSelectCampaign(c)}
                            className={`w-full text-left px-4 py-3 rounded-xl border text-sm flex items-center justify-between gap-2 transition-colors ${
                              selectedCampaign?.id === c.id
                                ? 'border-indigo-500 bg-indigo-50 text-indigo-800 font-medium'
                                : 'border-gray-200 hover:border-indigo-300 hover:bg-gray-50 text-gray-800'
                            }`}
                          >
                            <span className="truncate">{c.name}</span>
                            <span className="text-xs text-gray-500 font-mono shrink-0">{c.id.slice(0, 8)}…</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              {activeTab === 'recommendation-cards' && (
                <div className="space-y-6">
                  <div className="border border-gray-200 rounded-xl p-5 bg-gray-50/50">
                    <h3 className="text-sm font-semibold text-gray-800 mb-1">
                      Company context for recommendations (this company only)
                    </h3>
                    <p className="text-xs text-gray-500 mb-3">
                      Add or edit context that will be used only for this company when generating Trend Campaigns and recommendations. Saved here and applied from the next run onwards.
                    </p>
                    {!recommendationContextLoaded ? (
                      <div className="flex items-center gap-2 text-gray-500 py-4">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        <span className="text-sm">Loading…</span>
                      </div>
                    ) : (
                      <>
                        <textarea
                          value={recommendationContext}
                          onChange={(e) => setRecommendationContext(e.target.value)}
                          placeholder="e.g. Prefer B2B angles; avoid crypto. Focus on SMB pain points in EMEA."
                          rows={4}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 resize-y"
                        />
                        <div className="mt-3 flex items-center gap-3">
                          <button
                            type="button"
                            onClick={saveRecommendationContext}
                            disabled={savingContext}
                            className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700 disabled:opacity-50"
                          >
                            {savingContext ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                            Save
                          </button>
                          {contextSaveMessage === 'saved' && (
                            <span className="text-sm text-green-600">Saved. Used for this company from next run.</span>
                          )}
                          {contextSaveMessage === 'error' && (
                            <span className="text-sm text-red-600">Failed to save. Try again.</span>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                  <div>
                    <p className="text-gray-600 mb-3">
                      {currentCampaignId
                        ? 'Recommendation cards for the selected campaign. Use the option below to view the strategic theme card linked to this campaign.'
                        : 'Select a campaign from the Campaigns tab (or from search) to see recommendation cards.'}
                    </p>
                    {currentCampaignId && (
                      <>
                        {sourceRecommendationCardLoading ? (
                          <div className="mb-4 rounded-xl border border-gray-200 bg-white p-4 flex items-center gap-2 text-gray-500">
                            <Loader2 className="h-4 w-4 animate-spin" />
                            <span className="text-sm">Checking for linked strategic theme card…</span>
                          </div>
                        ) : sourceRecommendationCard?.source_strategic_theme ? (
                          <div className="mb-6">
                            <button
                              type="button"
                              onClick={() => setShowStoredCard((v) => !v)}
                              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg font-medium border border-indigo-600 text-indigo-600 bg-indigo-50 hover:bg-indigo-100"
                            >
                              <MessageSquare className="h-4 w-4" />
                              {showStoredCard ? 'Hide strategic theme card' : 'View strategic theme card'}
                            </button>
                            {showStoredCard && (
                              <div className="mt-4">
                                <p className="text-sm text-gray-600 mb-3">
                                  Strategic theme card stored when &quot;Build Campaign Blueprint&quot; was clicked. This is the card used to create this campaign&apos;s blueprint.
                                </p>
                                <RecommendationBlueprintCard
                                  recommendation={{
                                    ...sourceRecommendationCard.source_strategic_theme,
                                    ...(sourceRecommendationCard.source_recommendation_id
                                      ? { id: sourceRecommendationCard.source_recommendation_id }
                                      : {}),
                                  }}
                                  onBuildCampaignBlueprint={undefined}
                                  onMarkLongTerm={undefined}
                                  onArchive={undefined}
                                  viewMode="FULL"
                                />
                              </div>
                            )}
                          </div>
                        ) : sourceRecommendationCard?.source_recommendation_id ? (
                          <div className="mb-4 rounded-xl border border-gray-200 bg-white p-4">
                            <p className="text-sm text-gray-500">Recommendation ID linked: {sourceRecommendationCard.source_recommendation_id}</p>
                            <p className="text-xs text-gray-400 mt-1">Full card data was not stored for this campaign.</p>
                          </div>
                        ) : !sourceRecommendationCardLoading && sourceRecommendationCard === null ? (
                          <p className="text-sm text-gray-500 mb-4">
                            No strategic theme card stored for this campaign. Create a campaign from a recommendation card (use &quot;Build Campaign Blueprint&quot; on Trend Campaigns) to link one.
                          </p>
                        ) : null}
                        <div className="flex flex-wrap gap-3 items-center">
                          <button
                            type="button"
                            onClick={() => setActiveTab('weekly-plan')}
                            className="inline-flex items-center gap-2 px-4 py-2 bg-gray-100 text-gray-800 rounded-lg font-medium hover:bg-gray-200 border border-gray-300"
                          >
                            <Calendar className="h-4 w-4" />
                            View weekly plan
                          </button>
                        </div>
                      </>
                    )}
                    {!currentCampaignId && (
                      <p className="text-gray-500 text-sm">Go to the Campaigns tab and select a campaign first.</p>
                    )}
                  </div>
                </div>
              )}

              {activeTab === 'weekly-plan' && (
                <div>
                  <p className="text-gray-600 mb-4">
                    {currentCampaignId
                      ? 'Select a week to open the daily plan for that week.'
                      : 'Select a campaign from the Campaigns tab first.'}
                  </p>
                  {currentCampaignId && (
                    <>
                      {weeklyPlansLoading ? (
                        <div className="flex items-center gap-2 text-gray-500 py-6">
                          <Loader2 className="h-5 w-5 animate-spin" />
                          <span>Loading weekly plan…</span>
                        </div>
                      ) : weeklyPlans.length === 0 ? (
                        <p className="text-gray-500 py-4">No weekly plan yet. Open the daily plan page to generate one, or create a blueprint from recommendations.</p>
                      ) : (
                        <ul className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                          {weeklyPlans.map((w) => {
                            const weekNum = w.weekNumber ?? w.week ?? 0;
                            return (
                              <li key={weekNum}>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setSelectedWeek(weekNum);
                                    setActiveTab('daily-plan');
                                  }}
                                  className={`w-full text-left px-4 py-3 rounded-xl border text-sm transition-colors ${
                                    selectedWeek === weekNum
                                      ? 'border-indigo-500 bg-indigo-50 text-indigo-800 font-medium'
                                      : 'border-gray-200 hover:border-indigo-300 hover:bg-gray-50 text-gray-800'
                                  }`}
                                >
                                  <span className="font-medium">Week {weekNum}</span>
                                  {w.theme && <span className="block text-xs text-gray-500 truncate mt-0.5">{w.theme}</span>}
                                </button>
                              </li>
                            );
                          })}
                        </ul>
                      )}
                      <a
                        href={`/campaign-daily-plan/${currentCampaignId}?companyId=${encodeURIComponent(currentCompanyId || '')}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-2 mt-4 text-sm text-indigo-600 hover:text-indigo-700"
                      >
                        Open full weekly / daily plan in new tab
                        <ExternalLink className="h-4 w-4" />
                      </a>
                    </>
                  )}
                </div>
              )}

              {activeTab === 'daily-plan' && (
                <div>
                  <p className="text-gray-600 mb-4">
                    {selectedWeek != null
                      ? `Activities for Week ${selectedWeek}. Click an activity to open its workspace.`
                      : 'Select a week in the Weekly plan tab first.'}
                  </p>
                  {selectedWeek != null && currentCampaignId && (
                    <>
                      {dailyActivitiesLoading ? (
                        <div className="flex items-center gap-2 text-gray-500 py-6">
                          <Loader2 className="h-5 w-5 animate-spin" />
                          <span>Loading activities…</span>
                        </div>
                      ) : dailyActivities.length === 0 ? (
                        <p className="text-gray-500 py-4">No activities for this week yet. Generate the weekly structure from the daily plan page.</p>
                      ) : (
                        <ul className="space-y-2">
                          {dailyActivities.map((a) => (
                            <li key={a.execution_id}>
                              <button
                                type="button"
                                onClick={() => {
                                  setSelectedActivity(a);
                                  setActiveTab('activity-workspace');
                                }}
                                className={`w-full text-left px-4 py-3 rounded-xl border text-sm flex items-center justify-between gap-2 transition-colors ${
                                  selectedActivity?.execution_id === a.execution_id
                                    ? 'border-indigo-500 bg-indigo-50 text-indigo-800 font-medium'
                                    : 'border-gray-200 hover:border-indigo-300 hover:bg-gray-50 text-gray-800'
                                }`}
                              >
                                <span className="truncate">{a.title}</span>
                                <span className="text-xs text-gray-500 shrink-0">
                                  {a.day} · {a.platform} · {a.content_type}
                                </span>
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                      <button
                        type="button"
                        onClick={() => setSelectedWeek(null)}
                        className="mt-4 text-sm text-gray-500 hover:text-gray-700"
                      >
                        ← Back to weekly plan
                      </button>
                    </>
                  )}
                </div>
              )}

              {activeTab === 'activity-workspace' && (
                <div className="min-h-[400px] flex flex-col">
                  {selectedActivity && currentCampaignId ? (
                    <>
                      <p className="text-gray-600 mb-3">
                        Activity: <strong>{selectedActivity.title}</strong> (Week {selectedActivity.week_number}, {selectedActivity.day})
                      </p>
                      <div className="flex-1 min-h-[360px] rounded-lg border border-gray-200 overflow-hidden bg-gray-50">
                        <iframe
                          title="Activity workspace"
                          src={`/activity-workspace?workspaceKey=${encodeURIComponent(`activity-workspace-${currentCampaignId}-${selectedActivity.execution_id}`)}`}
                          className="w-full h-full min-h-[360px] border-0"
                        />
                      </div>
                      <button
                        type="button"
                        onClick={() => setSelectedActivity(null)}
                        className="mt-3 text-sm text-gray-500 hover:text-gray-700"
                      >
                        ← Back to daily plan
                      </button>
                    </>
                  ) : (
                    <div>
                      <p className="text-gray-600 mb-4">
                        Click an activity in the Daily plan tab to open its workspace here.
                      </p>
                      {currentCampaignId && (
                        <button
                          type="button"
                          onClick={() => setActiveTab('daily-plan')}
                          className="inline-flex items-center gap-2 px-4 py-2 bg-gray-100 text-gray-800 rounded-lg font-medium hover:bg-gray-200"
                        >
                          <ListTodo className="h-4 w-4" />
                          Go to Daily plan
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </>
          );
        })()}

        {!currentCompanyId && (companies.length > 0 || campaigns.length > 0 || recommendations.length > 0) && (
          <p className="text-sm text-gray-500 mt-4">Select a company, campaign, or recommendation above to see tabs.</p>
        )}
      </div>
    </>
  );
}
