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
import { AccountContext } from '../../lib/shared/accountContext';
import { type PlannerStrategicCard, syncPlannerStrategicCardThemes } from '../../lib/plannerStrategicCard';
import {
  createOrResumePlannerDraft,
  fetchPlannerDraftState,
  savePlannerDraftState,
  serializePlannerState,
  type PlannerDraftState,
} from './plannerDraftPersistence';

const PLANNER_STORAGE_KEY_PREFIX = 'omnivyra_planner_session_';
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const PLANNER_DAY_ORDER = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

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

/** Strategic theme per week — carries full phase metadata for AI context and card display. */
export interface StrategicThemeEntry {
  week: number;
  title: string;
  /** Marketing phase label e.g. "Awareness", "Education", "Solution" */
  phase_label?: string;
  /** What this week achieves for the audience */
  objective?: string;
  /** Primary content angle and format for the week */
  content_focus?: string;
  /** Call-to-action direction for the week */
  cta_focus?: string;
}

export interface PlannerSessionState {
  idea_spine: IdeaSpine | null;
  strategy_context: StrategyContext | null;
  skeleton_confirmed?: boolean;
  strategy_confirmed?: boolean;
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
  /** Campaign-level strategic card that weekly themes are derived from. */
  strategic_card?: PlannerStrategicCard | null;
  /** Last fetched campaign health report (UI-only, not persisted). */
  health_report?: Record<string, unknown> | null;
  /** Account context for planning influence (maturity, performance, recommendations). */
  account_context?: AccountContext | null;
  /**
   * Strategic Mix P1 — the server Draft Campaign that OWNS this session
   * (SPEC-001 I-1/I-2). Distinct from source_ids.campaign_id (an EXISTING
   * campaign opened in 'campaign' entry mode) so no existing-campaign branch
   * changes behavior. Null until the draft bootstrap completes.
   */
  draft_campaign_id?: string | null;
}

const defaultStrategyContext: StrategyContext = {
  duration_weeks: 4,
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
  skeleton_confirmed: false,
  strategy_confirmed: false,
  planner_entry_mode: 'direct',
  campaign_type: 'TEXT',
  platform_content_requests: null,
  source_ids: {},
  plan_preview: null,
  campaign_structure: null,
  calendar_plan: null,
  company_context_mode: 'full_company_context',
  focus_modules: [],
  draft_campaign_id: null,
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
  confirmSkeleton: () => void;
  confirmStrategy: () => void;
  setCampaignType: (value: CampaignType) => void;
  setPlatformContentRequests: (value: PlatformContentRequests | null) => void;
  setPlannerEntryMode: (mode: PlannerEntryMode) => void;
  setSourceIds: (ids: Partial<PlannerSessionState['source_ids']>) => void;
  setPlanPreview: (preview: { weeks?: unknown[] } | null) => void;
  setCampaignStructure: (value: CampaignStructure | null) => void;
  setCalendarPlan: (value: CalendarPlan | null) => void;
  mergePlanActivities: (activities: CalendarPlanActivity[]) => void;
  setSelectedActivity: (value: CalendarPlanActivity | null) => void;
  setRecommendedSuggestions: (goal?: string | null, audience?: string[] | null) => void;
  setCampaignDesign: (partial: Partial<Pick<CampaignDesign, 'company_context_mode' | 'focus_modules' | 'trend_context'>>) => void;
  setStrategicThemes: (themes: StrategicThemeEntry[]) => void;
  setStrategicCard: (card: PlannerStrategicCard | null) => void;
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
    const strategic_card =
      parsed.strategic_card && typeof parsed.strategic_card === 'object' && !Array.isArray(parsed.strategic_card)
        ? (parsed.strategic_card as PlannerStrategicCard)
        : null;
    let strategic_themes: StrategicThemeEntry[] | undefined;
    if (Array.isArray(rawThemes) && rawThemes.length > 0) {
      const first = rawThemes[0];
      if (typeof first === 'string') {
        strategic_themes = (rawThemes as string[])
          .filter((s) => typeof s === 'string' && String(s).trim())
          .map((s, i) => ({ week: i + 1, title: String(s).trim() }));
      } else if (typeof first === 'object' && first && 'week' in first && 'title' in first) {
        strategic_themes = (rawThemes as Array<StrategicThemeEntry>)
          .filter((t) => typeof t?.week === 'number' && typeof t?.title === 'string')
          .map((t) => ({
            week: t.week,
            title: String(t.title).trim(),
            ...(t.phase_label ? { phase_label: t.phase_label } : {}),
            ...(t.objective ? { objective: t.objective } : {}),
            ...(t.content_focus ? { content_focus: t.content_focus } : {}),
            ...(t.cta_focus ? { cta_focus: t.cta_focus } : {}),
          }));
      }
    }
    return {
      idea_spine: parsed.idea_spine && typeof parsed.idea_spine === 'object' ? (parsed.idea_spine as IdeaSpine) : null,
      strategy_context: parsed.strategy_context && typeof parsed.strategy_context === 'object' ? { ...defaultStrategyContext, ...parsed.strategy_context } : null,
      skeleton_confirmed: parsed.skeleton_confirmed === true,
      strategy_confirmed: parsed.strategy_confirmed === true,
      campaign_type,
      platform_content_requests,
      plan_snapshot_hash: typeof parsed.plan_snapshot_hash === 'string' ? parsed.plan_snapshot_hash : null,
      source_ids: campaignId ? { campaign_id: campaignId } : {},
      campaign_structure: cs && typeof cs === 'object' ? (cs as CampaignStructure) : null,
      calendar_plan: cp && typeof cp === 'object' ? (cp as CalendarPlan) : null,
      draft_campaign_id: typeof parsed.draft_campaign_id === 'string' && parsed.draft_campaign_id ? parsed.draft_campaign_id : null,
      ...(company_context_mode ? { company_context_mode } : {}),
      ...(focus_modules ? { focus_modules } : {}),
      ...(strategic_themes ? { strategic_themes } : {}),
      ...(strategic_card ? { strategic_card } : {}),
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
      skeleton_confirmed: s.skeleton_confirmed === true,
      strategy_confirmed: s.strategy_confirmed === true,
      campaign_type: s.campaign_type ?? 'TEXT',
      platform_content_requests: s.platform_content_requests ?? null,
      campaign_id: campaignId,
      plan_snapshot_hash: s.plan_snapshot_hash ?? null,
      campaign_structure: s.campaign_structure ?? null,
      calendar_plan: s.calendar_plan ?? null,
      company_context_mode: s.company_context_mode ?? 'full_company_context',
      focus_modules: s.focus_modules ?? [],
      strategic_themes: s.strategic_themes ?? [],
      strategic_card: s.strategic_card ?? null,
      draft_campaign_id: s.draft_campaign_id ?? null,
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
  /**
   * Strategic Mix P1 — server Draft Campaign persistence. When enabled, a
   * Draft Campaign is created/resumed on entry and becomes the SOURCE OF
   * TRUTH for planner state; localStorage remains a cache only. Disabled
   * (default) → behavior is byte-identical to before.
   */
  serverDraft?: {
    enabled: boolean;
    /** Draft id from the URL (?draftId=) for deep-link/refresh recovery. */
    urlDraftId?: string | null;
    /** Called when the draft id is established (page mirrors it to the URL). */
    onDraftIdChange?: (id: string) => void;
  };
}

/** In-flight create-or-resume per company — survives StrictMode double-mount
 *  and concurrent effects so at most ONE draft is created per entry. */
const draftBootstrapInFlight = new Map<string, Promise<{ campaignId: string; resumed: boolean } | null>>();

export function PlannerSessionProvider({ children, companyId, serverDraft }: PlannerSessionProviderProps) {
  const storageKey = getPlannerStorageKey(companyId ?? null);

  const [state, setState] = useState<PlannerSessionState>(defaultState);
  const [selectedActivity, setSelectedActivityState] = useState<CalendarPlanActivity | null>(null);
  const hasLoadedFromStorage = useRef(false);
  // ── Strategic Mix P1 refs (server draft sync) ───────────────────────────
  const [restoreTick, setRestoreTick] = useState(0);
  const localDraftIdRef = useRef<string | null>(null);
  const serverRevisionRef = useRef(0);
  const serverReadyRef = useRef(false);
  const lastSavedJsonRef = useRef<string | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const draftIdRef = useRef<string | null>(null);

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
    localDraftIdRef.current = (restored?.draft_campaign_id as string | null) ?? null;
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
    setRestoreTick((t) => t + 1);
  }, [storageKey]);

  // ── Strategic Mix P1: Draft Campaign bootstrap + server hydrate ─────────
  // Runs once per entry (after the localStorage cache restore). Order of
  // truth: URL draftId > cached draft id > create-or-resume on the server.
  // With an id, the SERVER state wins over the local cache whenever the
  // server has any saved planner_state (SPEC-001: server = source of truth;
  // browser storage = cache). A fresh/empty server draft keeps the local
  // state, and the first autosave migrates it up (pre-P1 sessions migrate
  // transparently).
  const serverDraftEnabled = serverDraft?.enabled === true;
  const urlDraftId = serverDraft?.urlDraftId ?? null;
  const onDraftIdChange = serverDraft?.onDraftIdChange;
  useEffect(() => {
    if (!serverDraftEnabled || !companyId || restoreTick === 0) return;
    if (draftIdRef.current) return; // already bootstrapped for this entry
    let cancelled = false;

    const adoptServerState = (plannerState: PlannerDraftState | null, revision: number, id: string) => {
      serverRevisionRef.current = revision;
      draftIdRef.current = id;
      if (plannerState) {
        const restoredServer = { ...plannerState, draft_campaign_id: id, stored_at: Date.now() };
        // Reuse the SAME normalizer as the localStorage cache so server and
        // cache payloads are interchangeable by construction.
        const normalized = ((): Partial<PlannerSessionState> | null => {
          try {
            localStorage.setItem(`${storageKey}__server_tmp`, JSON.stringify(restoredServer));
            const out = loadPersistedSession(`${storageKey}__server_tmp`);
            localStorage.removeItem(`${storageKey}__server_tmp`);
            return out;
          } catch { return null; }
        })();
        if (normalized) {
          lastSavedJsonRef.current = JSON.stringify(serializePlannerState({ ...defaultState, ...normalized } as PlannerSessionState));
          setState((prev) => ({
            ...prev,
            ...normalized,
            draft_campaign_id: id,
            // Entry-context fields stay owned by the live entry, not the draft.
            planner_entry_mode: prev.planner_entry_mode,
            source_ids: prev.source_ids,
            account_context: prev.account_context ?? (normalized as PlannerSessionState).account_context ?? null,
          }));
        } else {
          setState((prev) => ({ ...prev, draft_campaign_id: id }));
        }
      } else {
        lastSavedJsonRef.current = null; // fresh draft — first autosave migrates local state up
        setState((prev) => ({ ...prev, draft_campaign_id: id }));
      }
      serverReadyRef.current = true;
      onDraftIdChange?.(id);
    };

    (async () => {
      let id = urlDraftId || localDraftIdRef.current;
      if (!id) {
        let inFlight = draftBootstrapInFlight.get(companyId);
        if (!inFlight) {
          inFlight = createOrResumePlannerDraft(companyId);
          draftBootstrapInFlight.set(companyId, inFlight);
          inFlight.finally(() => draftBootstrapInFlight.delete(companyId));
        }
        const created = await inFlight;
        if (cancelled || !created) return; // offline → planner works on cache; next entry retries
        id = created.campaignId;
      }
      const server = await fetchPlannerDraftState(id);
      if (cancelled) return;
      adoptServerState(server?.plannerState ?? null, server?.revision ?? 0, id);
    })();

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverDraftEnabled, companyId, urlDraftId, restoreTick, storageKey]);

  // ── Strategic Mix P1: debounced autosave (server = source of truth) ─────
  // Deterministic conflict handling: a 409 means another tab/device advanced
  // the revision first — adopt the server copy wholesale and continue from
  // its revision. Offline/failed saves retry on the next state change.
  useEffect(() => {
    if (!serverDraftEnabled || !serverReadyRef.current || !draftIdRef.current) return;
    const draftId = draftIdRef.current;
    const payload = serializePlannerState(state);
    const json = JSON.stringify(payload);
    if (json === lastSavedJsonRef.current) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      const result = await savePlannerDraftState(draftId, payload, serverRevisionRef.current);
      if (result.ok) {
        serverRevisionRef.current = result.revision;
        lastSavedJsonRef.current = json;
      } else if (result.conflict === true) {
        serverRevisionRef.current = result.revision;
        if (result.plannerState) {
          const incoming = { ...result.plannerState, draft_campaign_id: draftId, stored_at: Date.now() };
          try {
            localStorage.setItem(`${storageKey}__server_tmp`, JSON.stringify(incoming));
            const normalized = loadPersistedSession(`${storageKey}__server_tmp`);
            localStorage.removeItem(`${storageKey}__server_tmp`);
            if (normalized) {
              lastSavedJsonRef.current = JSON.stringify(serializePlannerState({ ...defaultState, ...normalized } as PlannerSessionState));
              setState((prev) => ({
                ...prev,
                ...normalized,
                draft_campaign_id: draftId,
                planner_entry_mode: prev.planner_entry_mode,
                source_ids: prev.source_ids,
              }));
            }
          } catch { /* keep local; next change retries */ }
        }
      }
      // !ok && !conflict → transient/offline: retried on the next state change.
    }, 1500);
    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, serverDraftEnabled, storageKey]);

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
    setState((prev) => ({ ...prev, idea_spine: value, strategic_card: null, strategy_confirmed: false }));
  }, []);

  const setStrategyContext = useCallback((value: Partial<StrategyContext> | null) => {
    setState((prev) => ({
      ...prev,
      strategic_card: null,
      strategy_confirmed: false,
      strategy_context:
        value === null
          ? null
          : { ...defaultStrategyContext, ...(prev.strategy_context ?? {}), ...value },
    }));
  }, []);

  const confirmSkeleton = useCallback(() => {
    setState((prev) => ({ ...prev, skeleton_confirmed: true }));
  }, []);

  const confirmStrategy = useCallback(() => {
    setState((prev) => ({ ...prev, strategy_confirmed: true }));
  }, []);

  const setCampaignType = useCallback((value: CampaignType) => {
    setState((prev) => ({ ...prev, campaign_type: value, strategic_card: null, strategy_confirmed: false }));
  }, []);

  const setPlatformContentRequests = useCallback((value: PlatformContentRequests | null) => {
    setState((prev) => {
      // STEP 5: When platform_content_requests changes, reset calendar_plan and selected_activity
      // to prevent stale skeleton conflicts
      const next = { ...prev, platform_content_requests: value };
      if (prev.platform_content_requests !== value) {
        next.calendar_plan = null;
        next.campaign_structure = null;
        next.skeleton_confirmed = false;
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
    setState((prev) => ({ ...prev, campaign_structure: value ?? null, skeleton_confirmed: false }));
  }, []);

  const setCalendarPlan = useCallback((value: CalendarPlan | null) => {
    setState((prev) => ({
      ...prev,
      calendar_plan: value ?? null,
      skeleton_confirmed: false,
    }));
  }, []);

  // Daily-plan edits: replace activities + rebuild the days index WITHOUT
  // resetting skeleton_confirmed (the skeleton structure is unchanged — we are
  // only attaching topics/objectives onto its fixed slots).
  const mergePlanActivities = useCallback((activities: CalendarPlanActivity[]) => {
    setState((prev) => {
      const cp = (prev.calendar_plan ?? {}) as CalendarPlan;
      const dayMap = new Map<string, CalendarPlanDay>();
      for (const act of activities) {
        const wk = Number(act.week_number) || 1;
        const day = act.day ?? 'Monday';
        const key = `${wk}-${day}`;
        if (!dayMap.has(key)) dayMap.set(key, { week_number: wk, day, activities: [] });
        dayMap.get(key)!.activities.push(act);
      }
      const days = Array.from(dayMap.values()).sort(
        (a, b) =>
          a.week_number - b.week_number ||
          PLANNER_DAY_ORDER.indexOf(a.day) - PLANNER_DAY_ORDER.indexOf(b.day)
      );
      return {
        ...prev,
        calendar_plan: { ...cp, activities, days },
      };
    });
  }, []);

  const setCampaignDesign = useCallback((partial: Partial<Pick<CampaignDesign, 'company_context_mode' | 'focus_modules' | 'trend_context'>>) => {
    setState((prev) => ({
      ...prev,
      strategic_card: null,
      strategy_confirmed: false,
      ...(partial.company_context_mode !== undefined ? { company_context_mode: partial.company_context_mode } : {}),
      ...(partial.focus_modules !== undefined ? { focus_modules: partial.focus_modules } : {}),
      ...(partial.trend_context !== undefined ? { trend_context: partial.trend_context } : {}),
    }));
  }, []);

  const setStrategicThemes = useCallback((themes: StrategicThemeEntry[]) => {
    setState((prev) => ({
      ...prev,
      strategic_themes: themes,
      strategic_card: syncPlannerStrategicCardThemes(prev.strategic_card ?? null, themes),
      strategy_confirmed: false,
    }));
  }, []);

  const setStrategicCard = useCallback((card: PlannerStrategicCard | null) => {
    setState((prev) => ({
      ...prev,
      strategic_card: card,
      strategy_confirmed: false,
    }));
  }, []);

  const clearStrategicThemes = useCallback(() => {
    setState((prev) => ({ ...prev, strategic_themes: [], strategic_card: null, strategy_confirmed: false }));
  }, []);

  const setHealthReport = useCallback((report: Record<string, unknown> | null) => {
    setState((prev) => ({ ...prev, health_report: report }));
  }, []);

  const setAccountContext = useCallback((context: AccountContext | null) => {
    setState((prev) => ({ ...prev, account_context: context }));
  }, []);

  const reset = useCallback(() => {
    // Strategic Mix P1: keep the draft id through a reset so the emptied
    // state AUTOSAVES to the server draft (otherwise the old server copy
    // would resurrect on the next entry via create-or-resume).
    setState((prev) => ({ ...defaultState, draft_campaign_id: prev.draft_campaign_id ?? null }));
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
    confirmSkeleton,
    confirmStrategy,
    setCampaignType,
    setPlatformContentRequests,
    setPlannerEntryMode,
    setSourceIds,
    setPlanPreview,
    setCampaignStructure,
    setCalendarPlan,
    mergePlanActivities,
    setSelectedActivity,
    setRecommendedSuggestions,
    setCampaignDesign,
    setStrategicThemes,
    setStrategicCard,
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

