/**
 * Campaign Wizard State Persistence (localStorage)
 * Enables recovery of pre-planning wizard state on refresh or return.
 * Key: campaign_wizard_state_${campaignId}
 * TTL: 24 hours
 */

const WIZARD_STORAGE_KEY_PREFIX = 'campaign_wizard_state_';
const TTL_MS = 24 * 60 * 60 * 1000;

export interface QuestionnaireAnswers {
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

export interface PrePlanningResult {
  status: string;
  requested_weeks: number;
  recommended_duration: number;
  max_weeks_allowed: number;
  min_weeks_required?: number;
  limiting_constraints: Array<{ name: string; reasoning: string }>;
  blocking_constraints: Array<{ name: string; reasoning: string }>;
  trade_off_options: Array<{ type: string; newDurationWeeks?: number; reasoning: string; [k: string]: unknown }>;
  explanation_summary: string;
}

export interface WizardState {
  wizard_state_version: number;
  step: number;
  questionnaireAnswers: QuestionnaireAnswers;
  plannedStartDate: string;
  prePlanningResult: PrePlanningResult | null;
  crossPlatformSharingEnabled?: boolean;
  updatedAt: string;
}

function getStorageKey(campaignId: string): string {
  return `${WIZARD_STORAGE_KEY_PREFIX}${campaignId}`;
}

const defaultQuestionnaireAnswers: QuestionnaireAnswers = {
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

/** Persist wizard state to localStorage. */
export function saveWizardState(campaignId: string, state: Partial<WizardState>): void {
  if (typeof window === 'undefined') return;
  try {
    const key = getStorageKey(campaignId);
    const payload: WizardState = {
      wizard_state_version: 1,
      step: typeof state.step === 'number' ? state.step : 0,
      questionnaireAnswers: state.questionnaireAnswers ?? defaultQuestionnaireAnswers,
      plannedStartDate: state.plannedStartDate ?? new Date().toISOString().split('T')[0],
      prePlanningResult: state.prePlanningResult ?? null,
      crossPlatformSharingEnabled: state.crossPlatformSharingEnabled !== false,
      updatedAt: new Date().toISOString(),
    };
    localStorage.setItem(key, JSON.stringify(payload));
  } catch {
    // ignore storage errors
  }
}

/** Load wizard state from localStorage. Returns null if expired or missing. */
export function loadWizardState(campaignId: string): WizardState | null {
  if (typeof window === 'undefined') return null;
  try {
    const key = getStorageKey(campaignId);
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as WizardState & { updatedAt?: string };
    const updatedAt = parsed?.updatedAt ? new Date(parsed.updatedAt).getTime() : 0;
    if (Date.now() - updatedAt > TTL_MS) {
      localStorage.removeItem(key);
      return null;
    }
    if (parsed?.wizard_state_version !== 1) return null;
    return {
      wizard_state_version: 1,
      step: typeof parsed.step === 'number' ? parsed.step : 0,
      questionnaireAnswers:
        parsed.questionnaireAnswers && typeof parsed.questionnaireAnswers === 'object'
          ? { ...defaultQuestionnaireAnswers, ...parsed.questionnaireAnswers }
          : defaultQuestionnaireAnswers,
      plannedStartDate: typeof parsed.plannedStartDate === 'string' ? parsed.plannedStartDate : new Date().toISOString().split('T')[0],
      prePlanningResult: parsed.prePlanningResult && typeof parsed.prePlanningResult === 'object' ? parsed.prePlanningResult : null,
      crossPlatformSharingEnabled: parsed.crossPlatformSharingEnabled !== false,
      updatedAt: parsed.updatedAt ?? new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

/** Remove wizard state from localStorage. */
export function clearWizardState(campaignId: string): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(getStorageKey(campaignId));
  } catch {
    // ignore
  }
}

export { defaultQuestionnaireAnswers };
