/**
 * Unified Campaign Wizard Store (Zustand)
 * Single source of truth for wizard state used by campaign-details and campaign-planner.
 * Persisted per campaign via localStorage: campaign_wizard_state_v2_${campaignId}
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface WizardContentMix {
  post_per_week: number;
  video_per_week: number;
  blog_per_week: number;
  reel_per_week: number;
}

export interface WizardQuestionnaireAnswers {
  availableVideo: number;
  availablePost: number;
  availableBlog: number;
  availableSong: number;
  contentSuited: boolean | null;
  videoPerWeek: number;
  postPerWeek: number;
  blogPerWeek: number;
  songPerWeek: number;
  inHouseNotes: string;
}

export interface WizardFrequencySummary {
  weekly_unique_content_required?: number;
  total_content_required?: number;
  weekly_total_posts?: number;
  weekly_total_videos?: number;
  weekly_total_blogs?: number;
}

export interface WizardValidation {
  valid?: boolean;
  warnings?: Array<{ code: string; message: string }>;
  errors?: Array<{ code: string; message: string }>;
}

export interface CampaignWizardState {
  campaignId: string | undefined;
  step: number;
  durationWeeks: number;
  platforms: string[];
  contentMix: WizardContentMix;
  crossPlatformSharingEnabled: boolean;
  questionnaireAnswers: WizardQuestionnaireAnswers;
  plannedStartDate: string;
  prePlanningResult: Record<string, unknown> | null;
  frequencySummary: WizardFrequencySummary | undefined;
  validation: WizardValidation | undefined;
}

const defaultContentMix: WizardContentMix = {
  post_per_week: 3,
  video_per_week: 2,
  blog_per_week: 0,
  reel_per_week: 0,
};

const defaultQuestionnaireAnswers: WizardQuestionnaireAnswers = {
  availableVideo: 0,
  availablePost: 0,
  availableBlog: 0,
  availableSong: 0,
  contentSuited: null,
  videoPerWeek: 2,
  postPerWeek: 3,
  blogPerWeek: 0,
  songPerWeek: 0,
  inHouseNotes: '',
};

function getDefaultPlannedStartDate(): string {
  if (typeof window === 'undefined') return new Date().toISOString().split('T')[0];
  const d = new Date();
  d.setDate(d.getDate() + 7);
  return d.toISOString().split('T')[0];
}

const initialState: CampaignWizardState = {
  campaignId: undefined,
  step: 0,
  durationWeeks: 12,
  platforms: ['linkedin'],
  contentMix: { ...defaultContentMix },
  crossPlatformSharingEnabled: true,
  questionnaireAnswers: { ...defaultQuestionnaireAnswers },
  plannedStartDate: getDefaultPlannedStartDate(),
  prePlanningResult: null,
  frequencySummary: undefined,
  validation: undefined,
};

export type CampaignWizardActions = {
  setCampaignId: (id: string | undefined) => void;
  setStep: (step: number) => void;
  setDurationWeeks: (weeks: number) => void;
  setPlatforms: (platforms: string[]) => void;
  setContentMix: (mix: Partial<WizardContentMix>) => void;
  setDistributionMode: (enabled: boolean) => void;
  setQuestionnaireAnswers: (answers: Partial<WizardQuestionnaireAnswers>) => void;
  setPlannedStartDate: (date: string) => void;
  setPrePlanningResult: (result: Record<string, unknown> | null) => void;
  setValidation: (validation: WizardValidation | undefined) => void;
  setFrequencySummary: (summary: WizardFrequencySummary | undefined) => void;
  resetWizard: () => void;
};

function getStorageKey(campaignId: string): string {
  return `campaign_wizard_state_v2_${campaignId}`;
}

export function getWizardStorageKey(campaignId: string): string {
  return getStorageKey(campaignId);
}

type WizardStore = ReturnType<typeof createWizardStoreInner>;

function createWizardStoreInner(name: string) {
  return create<CampaignWizardState & CampaignWizardActions>()(
    persist(
      (set) => ({
        ...initialState,
        campaignId: undefined,

        setCampaignId: (id) => set({ campaignId: id }),

        setStep: (step) => set({ step }),

        setDurationWeeks: (durationWeeks) => set({ durationWeeks }),

        setPlatforms: (platforms) => set({ platforms }),

        setContentMix: (mix) =>
          set((s) => ({
            contentMix: { ...s.contentMix, ...mix },
          })),

        setDistributionMode: (enabled) => set({ crossPlatformSharingEnabled: enabled }),

        setQuestionnaireAnswers: (answers) =>
          set((s) => ({
            questionnaireAnswers: { ...s.questionnaireAnswers, ...answers },
          })),

        setPlannedStartDate: (plannedStartDate) => set({ plannedStartDate }),

        setPrePlanningResult: (prePlanningResult) => set({ prePlanningResult }),

        setValidation: (validation) => set({ validation }),

        setFrequencySummary: (frequencySummary) => set({ frequencySummary }),

        resetWizard: () =>
          set({
            ...initialState,
            plannedStartDate: getDefaultPlannedStartDate(),
          }),
      }),
      {
        name,
        partialize: (s) => ({
          step: s.step,
          durationWeeks: s.durationWeeks,
          platforms: s.platforms,
          contentMix: s.contentMix,
          crossPlatformSharingEnabled: s.crossPlatformSharingEnabled,
          questionnaireAnswers: s.questionnaireAnswers,
          plannedStartDate: s.plannedStartDate,
          prePlanningResult: s.prePlanningResult,
          frequencySummary: s.frequencySummary,
          validation: s.validation,
        }),
      }
    )
  );
}

const storeMap = new Map<string, WizardStore>();

function getOrCreateStore(campaignId: string): WizardStore {
  let store = storeMap.get(campaignId);
  if (!store) {
    const key = getStorageKey(campaignId);
    store = createWizardStoreInner(key);
    store.setState({ campaignId });
    storeMap.set(campaignId, store);
  }
  return store;
}

/** Global store for when no campaignId (e.g. planner before campaign exists). */
const globalStore = createWizardStoreInner('campaign_wizard_state_v2_global');

/** Use campaign wizard store. When campaignId provided, returns campaign-scoped persisted store. */
export function useCampaignWizardStore(campaignId?: string | null): WizardStore {
  if (campaignId && typeof campaignId === 'string' && campaignId.trim()) {
    return getOrCreateStore(campaignId.trim());
  }
  return globalStore;
}

/** Create a campaign-scoped store (for non-React usage, e.g. adapters). */
export function createCampaignWizardStore(campaignId: string | undefined): WizardStore {
  if (campaignId && typeof campaignId === 'string' && campaignId.trim()) {
    return getOrCreateStore(campaignId.trim());
  }
  return globalStore;
}

/** React hook: returns { state, getState, setStep, ... } so components can read/write. Subscribes to state changes. */
export function useCampaignWizard(campaignId: string | null | undefined) {
  const store = useCampaignWizardStore(campaignId ?? undefined);
  const state = store((s) => s);
  return {
    ...state,
    getState: store.getState,
    setStep: store.getState().setStep,
    setDurationWeeks: store.getState().setDurationWeeks,
    setPlatforms: store.getState().setPlatforms,
    setContentMix: store.getState().setContentMix,
    setDistributionMode: store.getState().setDistributionMode,
    setQuestionnaireAnswers: store.getState().setQuestionnaireAnswers,
    setPlannedStartDate: store.getState().setPlannedStartDate,
    setPrePlanningResult: store.getState().setPrePlanningResult,
    setValidation: store.getState().setValidation,
    setFrequencySummary: store.getState().setFrequencySummary,
    resetWizard: store.getState().resetWizard,
  };
}
