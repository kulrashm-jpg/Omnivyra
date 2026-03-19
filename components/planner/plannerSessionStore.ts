/**
 * Campaign Planner Session State
 * Stores idea spine, strategy context, and entry mode during planner flow.
 * Persists to localStorage for durability across reloads.
 * Key is company-scoped to prevent cross-company session collisions.
 * Session expires after 24 hours (TTL).
 * Store is framework-independent; companyId passed explicitly by parent.
 * When ENABLE_UNIFIED_CAMPAIGN_WIZARD: mirrors state into campaign wizard store.
 */

import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { ENABLE_UNIFIED_CAMPAIGN_WIZARD } from '../../config/featureFlags';
import { hydrateWizardFromPlannerSession } from '../../lib/wizard/campaignWizardAdapter';
import { createCampaignWizardStore } from '../../store/campaignWizardStore';
import { AccountContext } from '../../backend/types/accountContext';

const PLANNER_STORAGE_KEY_PREFIX = 'omnivyra_planner_session_';
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

function getPlannerStorageKey(companyId: string | null | undefined): string {
  const id = typeof companyId === 'string' && companyId.trim() ? companyId.trim() : 'default';
  return `${PLANNER_STORAGE_KEY_PREFIX}${id}`;
}

export type PlannerEntryMode = 'direct' | 'turbo' | 'recommendation' | 'opportunity' | 'campaign';

export interface IdeaSpine {
  title: string;
  description: string;
  origin: 'direct' | 'recommendation' | 'opportunity';
  source_id?: string | null;
  /** Raw user input before AI refinement */
  raw_input?: string | null;
  /** AI-refined title (when user accepted refinement) */
  refined_title?: string | null;
  /** AI-refined description (when user accepted refinement) */
  refined_description?: string | null;
  /** User-selected campaign direction angle */
  selected_angle?: string | null;
}

export interface StrategyContext {
  duration_weeks: number;
  platforms: string[];
  posting_frequency: Record<string, number>;
  content_mix: string[];
  campaign_goal: string;
  /** Target audience(s). UI uses string[]; API accepts string (comma-joined). */
  target_audience: string | string[];
  /** Start date for campaign (YYYY-MM-DD); used for calendar date blocks */
  planned_start_date?: string;
  /** Key message or call-to-action for campaign */
  key_message?: string;
  /** Strategic aspects selected for this campaign (from company profile). */
  selected_aspects?: string[];
  /** Offerings selected within the chosen strategic aspects. */
  selected_offerings?: string[];
}

export interface CampaignBrief {
  summary?: string;
  objectives?: string[];
  target_audience?: string;
}

export interface CampaignStructurePhase {
  id?: string;
  label?: string;
  week_start?: number;
  week_end?: number;
  narrative_hint?: string;
  objective?: string;
  content_focus?: string;
  cta_focus?: string;
}

export interface CampaignStructure {
  phases?: CampaignStructurePhase[];
  narrative?: string;
}

export interface CalendarPlanActivity {
  execution_id?: string;
  week_number?: number;
  platform?: string;
  content_type?: string;
  title?: string;
  theme?: string;
  day?: string;
  phase?: string;
  objective?: string;
  /** Creator asset when uploaded; used for CREATOR READY badge */
  creator_asset?: Record<string, unknown> | null;
  /** READY_FOR_PROMOTION when creator asset uploaded */
  content_status?: string;
}

export interface CalendarPlanDay {
  week_number: number;
  day: string;
  activities: CalendarPlanActivity[];
}

export interface CalendarPlan {
  weeks?: unknown[];
  days?: CalendarPlanDay[];
  activities?: CalendarPlanActivity[];
}

export type CompanyContextMode = 'full_company_context' | 'minimal' | 'none' | 'trend_campaign';
export type FocusModule = string;

export interface TrendContext {
  recommendation_id?: string | null;
  trend_topic?: string | null;
  trend_source?: string | null;
  [key: string]: unknown;
}

export interface CampaignDesign {
  idea_spine?: IdeaSpine | null;
  campaign_brief?: CampaignBrief | null;
  campaign_structure?: CampaignStructure | null;
  company_context_mode?: CompanyContextMode;
  focus_modules?: FocusModule[];
  /** Populated when company_context_mode is trend_campaign; e.g. from recommendationId URL */
  trend_context?: TrendContext | null;
}

export interface ExecutionPlan {
  strategy_context?: StrategyContext | null;
  calendar_plan?: CalendarPlan | null;
  activity_cards?: CalendarPlanActivity[];
}

/** Skeleton config: campaign type + platform/content matrix (replaces content_mix + posting_frequency for skeleton). */
export type CampaignType = 'TEXT' | 'CREATOR' | 'HYBRID';
export type PlatformContentRequests = Record<string, Record<string, number>>;

/** Strategic theme per week. Future-proof structure for extensions (e.g. description, objectives). */
export interface StrategicThemeEntry {
  week: number;
  title: string;
}

export interface PlannerSessionState {
  idea_spine: IdeaSpine | null;
  strategy_context: StrategyContext | null;
  planner_entry_mode: PlannerEntryMode;
  /** Campaign type for execution_mode assignment. Default: TEXT */
  campaign_type: CampaignType;
  /** Platform → content_type → frequency_per_week. Used for deterministic skeleton. */
  platform_content_requests: PlatformContentRequests | null;
  source_ids: {
    recommendation_id?: string | null;
    campaign_id?: string | null;
    source_opportunity_id?: string | null;
    /** Opportunity score (0–1) for AI copilot context when source is opportunity */
    opportunity_score?: number | null;
  };
  /** Plan preview (from ai/plan or retrieve-plan) — read-only */
  plan_preview: { weeks?: unknown[] } | null;
  /** Hash/identifier for plan snapshot (for persistence) */
  plan_snapshot_hash?: string | null;
  /** Campaign structure (phases, narrative) — scheduling layer */
  campaign_structure?: CampaignStructure | null;
  /** Calendar plan (weeks, days, activities) — scheduling layer */
  calendar_plan?: CalendarPlan | null;
  /** Selected activity for ContentTab editor; set on calendar activity click */
  selected_activity?: CalendarPlanActivity | null;
  /** AI/theme recommended goal (transient, not persisted) */
  recommended_goal?: string | null;
  /** AI/theme recommended audience (transient, not persisted) */
  recommended_audience?: string[] | null;
  /** Company context mode for plan generation (FULL/FOCUSED/NONE). Persisted. */
  company_context_mode?: CompanyContextMode;
  /** Focus modules when mode is minimal (FOCUSED). Persisted. */
  focus_modules?: FocusModule[];
  /** When company_context_mode is trend_campaign. Persisted. */
  trend_context?: TrendContext | null;
  /** Strategic themes (weekly) for skeleton generation. Optional; from generate-themes or Trend card. */
  strategic_themes?: StrategicThemeEntry[];
  /** Last fetched campaign health report (UI-only, not persisted). */
  health_report?: Record<string, unknown> | null;
  /** Account context for planning influence (maturity, performance, recommendations). */
  account_context?: AccountContext | null;
}

const defaultStrategyContext: StrategyContext = {
  duration_weeks: 12,
  platforms: [],
  posting_frequency: {},
  content_mix: [],
  campaign_goal: '',
  planned_start_date: undefined,
  target_audience: '',
};

const defaultState: PlannerSessionState = {
  idea_spine: null,
  strategy_context: null,
  planner_entry_mode: 'direct',
  campaign_type: 'TEXT',
  platform_content_requests: null,
  source_ids: {},
  plan_preview: null,
  campaign_structure: null,
  calendar_plan: null,
  company_context_mode: 'full_company_context',
  focus_modules: [],
};

type PlannerSessionContextValue = {
  state: PlannerSessionState & {
    campaign_design?: CampaignDesign;
    execution_plan?: ExecutionPlan;
    /** Currently selected activity for ContentTab editor (UI-only, not persisted) */
    selected_activity?: CalendarPlanActivity | null;
  };
  setIdeaSpine: (value: IdeaSpine | null) => void;
  setStrategyContext: (value: Partial<StrategyContext> | null) => void;
  setCampaignType: (value: CampaignType) => void;
  setPlatformContentRequests: (value: PlatformContentRequests | null) => void;
  setPlannerEntryMode: (mode: PlannerEntryMode) => void;
  setSourceIds: (ids: Partial<PlannerSessionState['source_ids']>) => void;
  setPlanPreview: (preview: { weeks?: unknown[] } | null) => void;
  setCampaignStructure: (value: CampaignStructure | null) => void;
  setCalendarPlan: (value: CalendarPlan | null) => void;
  setSelectedActivity: (value: CalendarPlanActivity | null) => void;
  setRecommendedSuggestions: (goal?: string | null, audience?: string[] | null) => void;
  setCampaignDesign: (partial: Partial<Pick<CampaignDesign, 'company_context_mode' | 'focus_modules' | 'trend_context'>>) => void;
  setStrategicThemes: (themes: StrategicThemeEntry[]) => void;
  clearStrategicThemes: () => void;
  setHealthReport: (report: Record<string, unknown> | null) => void;
  setAccountContext: (context: AccountContext | null) => void;
  reset: () => void;
};

const PlannerSessionContext = createContext<PlannerSessionContextValue | null>(null);

function loadPersistedSession(storageKey: string): Partial<PlannerSessionState> | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const storedAt = typeof parsed.stored_at === 'number' ? parsed.stored_at : 0;
    if (Date.now() - storedAt > SESSION_TTL_MS) {
      localStorage.removeItem(storageKey);
      return null;
    }
    const campaignId = parsed.campaign_id && typeof parsed.campaign_id === 'string' ? parsed.campaign_id : null;
    const cs = parsed.campaign_structure;
    const cp = parsed.calendar_plan;
    const campaign_type = (parsed.campaign_type === 'TEXT' || parsed.campaign_type === 'CREATOR' || parsed.campaign_type === 'HYBRID')
      ? parsed.campaign_type
      : 'TEXT';
    const platform_content_requests =
      parsed.platform_content_requests && typeof parsed.platform_content_requests === 'object' && !Array.isArray(parsed.platform_content_requests)
        ? (parsed.platform_content_requests as PlatformContentRequests)
        : null;
    const company_context_mode =
      parsed.company_context_mode === 'full_company_context' || parsed.company_context_mode === 'minimal' || parsed.company_context_mode === 'none' || parsed.company_context_mode === 'trend_campaign'
        ? parsed.company_context_mode
        : undefined;
    const focus_modules = Array.isArray(parsed.focus_modules) ? (parsed.focus_modules as FocusModule[]) : undefined;
    const rawThemes = parsed.strategic_themes;
    let strategic_themes: StrategicThemeEntry[] | undefined;
    if (Array.isArray(rawThemes) && rawThemes.length > 0) {
      const first = rawThemes[0];
      if (typeof first === 'string') {
        strategic_themes = (rawThemes as string[])
          .filter((s) => typeof s === 'string' && String(s).trim())
          .map((s, i) => ({ week: i + 1, title: String(s).trim() }));
      } else if (typeof first === 'object' && first && 'week' in first && 'title' in first) {
        strategic_themes = (rawThemes as Array<{ week: number; title: string }>)
          .filter((t) => typeof t?.week === 'number' && typeof t?.title === 'string')
          .map((t) => ({ week: t.week, title: String(t.title).trim() }));
      }
    }
    return {
      idea_spine: parsed.idea_spine && typeof parsed.idea_spine === 'object' ? (parsed.idea_spine as IdeaSpine) : null,
      strategy_context: parsed.strategy_context && typeof parsed.strategy_context === 'object' ? { ...defaultStrategyContext, ...parsed.strategy_context } : null,
      campaign_type,
      platform_content_requests,
      plan_snapshot_hash: typeof parsed.plan_snapshot_hash === 'string' ? parsed.plan_snapshot_hash : null,
      source_ids: campaignId ? { campaign_id: campaignId } : {},
      campaign_structure: cs && typeof cs === 'object' ? (cs as CampaignStructure) : null,
      calendar_plan: cp && typeof cp === 'object' ? (cp as CalendarPlan) : null,
      ...(company_context_mode ? { company_context_mode } : {}),
      ...(focus_modules ? { focus_modules } : {}),
      ...(strategic_themes ? { strategic_themes } : {}),
    };
  } catch {
    return null;
  }
}

function persistSession(s: PlannerSessionState, storageKey: string): void {
  if (typeof window === 'undefined') return;
  try {
    const campaignId = s.source_ids?.campaign_id ?? null;
    const payload = {
      idea_spine: s.idea_spine,
      strategy_context: s.strategy_context,
      campaign_type: s.campaign_type ?? 'TEXT',
      platform_content_requests: s.platform_content_requests ?? null,
      campaign_id: campaignId,
      plan_snapshot_hash: s.plan_snapshot_hash ?? null,
      campaign_structure: s.campaign_structure ?? null,
      calendar_plan: s.calendar_plan ?? null,
      company_context_mode: s.company_context_mode ?? 'full_company_context',
      focus_modules: s.focus_modules ?? [],
      strategic_themes: s.strategic_themes ?? [],
      stored_at: Date.now(),
    };
    localStorage.setItem(storageKey, JSON.stringify(payload));
  } catch {
    // ignore storage errors
  }
}

export interface PlannerSessionProviderProps {
  children: React.ReactNode;
  /** Company ID for session isolation. Passed explicitly by parent. */
  companyId?: string | null;
}

export function PlannerSessionProvider({ children, companyId }: PlannerSessionProviderProps) {
  const storageKey = getPlannerStorageKey(companyId ?? null);

  const [state, setState] = useState<PlannerSessionState>(defaultState);
  const [selectedActivity, setSelectedActivityState] = useState<CalendarPlanActivity | null>(null);
  const hasLoadedFromStorage = useRef(false);

  const setSelectedActivity = useCallback((value: CalendarPlanActivity | null) => {
    setSelectedActivityState(value);
  }, []);

  const setRecommendedSuggestions = useCallback((goal?: string | null, audience?: string[] | null) => {
    setState((prev) => ({
      ...prev,
      recommended_goal: goal ?? null,
      recommended_audience: audience ?? null,
    }));
  }, []);

  useEffect(() => {
    const restored = loadPersistedSession(storageKey);
    hasLoadedFromStorage.current = true;
    if (restored) {
      setState({
        ...defaultState,
        ...restored,
        source_ids: { ...defaultState.source_ids, ...restored.source_ids },
      });
      if (ENABLE_UNIFIED_CAMPAIGN_WIZARD && restored) {
        const hydrated = hydrateWizardFromPlannerSession(restored);
        if (Object.keys(hydrated).length > 0) {
          const campaignId = (restored as { source_ids?: { campaign_id?: string } })?.source_ids?.campaign_id;
          const wizardStore = createCampaignWizardStore(campaignId ?? undefined);
          wizardStore.setState(hydrated);
        }
      }
    }
  }, [storageKey]);

  useEffect(() => {
    if (!hasLoadedFromStorage.current) return;
    persistSession(state, storageKey);
    if (ENABLE_UNIFIED_CAMPAIGN_WIZARD && state.strategy_context) {
      const hydrated = hydrateWizardFromPlannerSession(state);
      if (Object.keys(hydrated).length > 0) {
        const campaignId = state.source_ids?.campaign_id ?? undefined;
        const wizardStore = createCampaignWizardStore(campaignId);
        wizardStore.setState(hydrated);
      }
    }
  }, [state, storageKey]);

  const setIdeaSpine = useCallback((value: IdeaSpine | null) => {
    setState((prev) => ({ ...prev, idea_spine: value }));
  }, []);

  const setStrategyContext = useCallback((value: Partial<StrategyContext> | null) => {
    setState((prev) => ({
      ...prev,
      strategy_context:
        value === null
          ? null
          : { ...defaultStrategyContext, ...(prev.strategy_context ?? {}), ...value },
    }));
  }, []);

  const setCampaignType = useCallback((value: CampaignType) => {
    setState((prev) => ({ ...prev, campaign_type: value }));
  }, []);

  const setPlatformContentRequests = useCallback((value: PlatformContentRequests | null) => {
    setState((prev) => {
      // STEP 5: When platform_content_requests changes, reset calendar_plan and selected_activity
      // to prevent stale skeleton conflicts
      const next = { ...prev, platform_content_requests: value };
      if (prev.platform_content_requests !== value) {
        next.calendar_plan = null;
        next.campaign_structure = null;
      }
      return next;
    });
    setSelectedActivityState(null);
  }, []);

  const setPlannerEntryMode = useCallback((mode: PlannerEntryMode) => {
    setState((prev) => ({ ...prev, planner_entry_mode: mode }));
  }, []);

  const setSourceIds = useCallback((ids: Partial<PlannerSessionState['source_ids']>) => {
    setState((prev) => ({
      ...prev,
      source_ids: { ...prev.source_ids, ...ids },
    }));
  }, []);

  const setPlanPreview = useCallback((preview: { weeks?: unknown[] } | null) => {
    setState((prev) => ({ ...prev, plan_preview: preview }));
  }, []);

  const setCampaignStructure = useCallback((value: CampaignStructure | null) => {
    setState((prev) => ({ ...prev, campaign_structure: value ?? null }));
  }, []);

  const setCalendarPlan = useCallback((value: CalendarPlan | null) => {
    setState((prev) => ({
      ...prev,
      calendar_plan: value ?? null,
    }));
  }, []);

  const setCampaignDesign = useCallback((partial: Partial<Pick<CampaignDesign, 'company_context_mode' | 'focus_modules' | 'trend_context'>>) => {
    setState((prev) => ({
      ...prev,
      ...(partial.company_context_mode !== undefined ? { company_context_mode: partial.company_context_mode } : {}),
      ...(partial.focus_modules !== undefined ? { focus_modules: partial.focus_modules } : {}),
      ...(partial.trend_context !== undefined ? { trend_context: partial.trend_context } : {}),
    }));
  }, []);

  const setStrategicThemes = useCallback((themes: StrategicThemeEntry[]) => {
    setState((prev) => ({ ...prev, strategic_themes: themes }));
  }, []);

  const clearStrategicThemes = useCallback(() => {
    setState((prev) => ({ ...prev, strategic_themes: [] }));
  }, []);

  const setHealthReport = useCallback((report: Record<string, unknown> | null) => {
    setState((prev) => ({ ...prev, health_report: report }));
  }, []);

  const setAccountContext = useCallback((context: AccountContext | null) => {
    setState((prev) => ({ ...prev, account_context: context }));
  }, []);

  const reset = useCallback(() => {
    setState(defaultState);
    if (typeof window !== 'undefined') {
      try {
        localStorage.removeItem(storageKey);
      } catch {
        // ignore
      }
    }
  }, [storageKey]);

  const stateWithNested: PlannerSessionContextValue['state'] = {
    ...state,
    selected_activity: selectedActivity,
    recommended_goal: state.recommended_goal ?? null,
    recommended_audience: state.recommended_audience ?? null,
    campaign_design: {
      idea_spine: state.idea_spine ?? undefined,
      campaign_brief: undefined,
      campaign_structure: state.campaign_structure ?? undefined,
      company_context_mode: state.company_context_mode ?? 'full_company_context',
      focus_modules: state.focus_modules ?? [],
      trend_context: state.trend_context ?? undefined,
    },
    execution_plan: {
      strategy_context: state.strategy_context ?? undefined,
      calendar_plan: state.calendar_plan ?? undefined,
      activity_cards: state.calendar_plan?.activities ?? undefined,
    },
  };

  const value: PlannerSessionContextValue = {
    state: stateWithNested,
    setIdeaSpine,
    setStrategyContext,
    setCampaignType,
    setPlatformContentRequests,
    setPlannerEntryMode,
    setSourceIds,
    setPlanPreview,
    setCampaignStructure,
    setCalendarPlan,
    setSelectedActivity,
    setRecommendedSuggestions,
    setCampaignDesign,
    setStrategicThemes,
    clearStrategicThemes,
    setHealthReport,
    setAccountContext,
    reset,
  };

  return React.createElement(
    PlannerSessionContext.Provider,
    { value },
    children
  );
}

export function usePlannerSession() {
  const ctx = useContext(PlannerSessionContext);
  if (!ctx) {
    throw new Error('usePlannerSession must be used within PlannerSessionProvider');
  }
  return ctx;
}
