import { useState, useEffect, useCallback } from 'react';
import { useCompanyContext } from '../components/CompanyContext';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type OnboardingStep = 1 | 2 | 3;

export interface OnboardingData {
  websiteUrl: string;
  companyName: string;
  industry: string;
  goal: 'traffic' | 'leads' | 'authority' | '';
}

export interface OnboardingState {
  currentStep: OnboardingStep;
  completed: boolean;
  dismissed: boolean; // user chose "skip"
  data: OnboardingData;
  startedAt: string | null;
  completedAt: string | null;
}

const STORAGE_KEY = 'omnivyra_onboarding';

const INITIAL_DATA: OnboardingData = {
  websiteUrl: '',
  companyName: '',
  industry: '',
  goal: '',
};

const INITIAL_STATE: OnboardingState = {
  currentStep: 1,
  completed: false,
  dismissed: false,
  data: INITIAL_DATA,
  startedAt: null,
  completedAt: null,
};

// ─────────────────────────────────────────────────────────────────────────────
// LocalStorage helpers
// ─────────────────────────────────────────────────────────────────────────────

function loadState(): OnboardingState {
  if (typeof window === 'undefined') return INITIAL_STATE;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return INITIAL_STATE;
    const parsed = JSON.parse(raw);
    return { ...INITIAL_STATE, ...parsed };
  } catch {
    return INITIAL_STATE;
  }
}

function saveState(state: OnboardingState): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch { /* quota exceeded — silently ignore */ }
}

// ─────────────────────────────────────────────────────────────────────────────
// Hook
// ─────────────────────────────────────────────────────────────────────────────

export function useOnboarding() {
  const { selectedCompanyId, selectedCompanyName } = useCompanyContext();
  const [state, setState] = useState<OnboardingState>(INITIAL_STATE);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Hydrate from localStorage on mount
  useEffect(() => {
    const stored = loadState();
    setState(stored);

    // Pre-fill company name if we already have one from context
    if (selectedCompanyName && !stored.data.companyName) {
      const updated = {
        ...stored,
        data: { ...stored.data, companyName: selectedCompanyName },
      };
      setState(updated);
      saveState(updated);
    }
  }, [selectedCompanyName]);

  // Persist every state change
  const updateState = useCallback((patch: Partial<OnboardingState>) => {
    setState((prev) => {
      const next = { ...prev, ...patch };
      saveState(next);
      return next;
    });
  }, []);

  const updateData = useCallback((patch: Partial<OnboardingData>) => {
    setState((prev) => {
      const next = {
        ...prev,
        data: { ...prev.data, ...patch },
      };
      saveState(next);
      return next;
    });
  }, []);

  // ── Actions ──────────────────────────────────────────────────────────────

  const startOnboarding = useCallback(() => {
    updateState({ startedAt: new Date().toISOString(), currentStep: 1 });
    setWizardOpen(true);
  }, [updateState]);

  const goToStep = useCallback((step: OnboardingStep) => {
    updateState({ currentStep: step });
  }, [updateState]);

  const nextStep = useCallback(() => {
    setState((prev) => {
      const next: OnboardingStep = prev.currentStep < 3
        ? ((prev.currentStep + 1) as OnboardingStep)
        : 3;
      const updated = { ...prev, currentStep: next };
      saveState(updated);
      return updated;
    });
  }, []);

  const prevStep = useCallback(() => {
    setState((prev) => {
      const next: OnboardingStep = prev.currentStep > 1
        ? ((prev.currentStep - 1) as OnboardingStep)
        : 1;
      const updated = { ...prev, currentStep: next };
      saveState(updated);
      return updated;
    });
  }, []);

  const completeOnboarding = useCallback(() => {
    updateState({
      completed: true,
      completedAt: new Date().toISOString(),
    });
    setWizardOpen(false);
  }, [updateState]);

  const dismissOnboarding = useCallback(() => {
    updateState({ dismissed: true });
    setWizardOpen(false);
  }, [updateState]);

  const resetOnboarding = useCallback(() => {
    setState(INITIAL_STATE);
    saveState(INITIAL_STATE);
    setWizardOpen(false);
  }, []);

  // ── API calls (uses existing endpoints) ──────────────────────────────────

  /** Step 1: Analyze website — saves to company profile */
  const analyzeWebsite = useCallback(async (url: string): Promise<boolean> => {
    if (!selectedCompanyId) {
      setError('No company selected');
      return false;
    }

    setIsLoading(true);
    setError(null);

    try {
      // Save website URL to company profile
      const res = await fetch('/api/company-profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company_id: selectedCompanyId,
          website_url: url.startsWith('http') ? url : `https://${url}`,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to save website');
      }

      const data = await res.json();

      // Auto-fill company name from profile if available
      if (data.profile?.name) {
        updateData({ companyName: data.profile.name });
      }
      if (data.profile?.industry) {
        updateData({ industry: data.profile.industry });
      }

      updateData({ websiteUrl: url });
      return true;
    } catch (err: any) {
      setError(err.message || 'Something went wrong');
      return false;
    } finally {
      setIsLoading(false);
    }
  }, [selectedCompanyId, updateData]);

  /** Step 2: Save business context */
  const saveBusinessContext = useCallback(async (
    companyName: string,
    industry: string,
    goal: string,
  ): Promise<boolean> => {
    if (!selectedCompanyId) {
      setError('No company selected');
      return false;
    }

    setIsLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/company-profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company_id: selectedCompanyId,
          name: companyName,
          industry,
          goals: goal,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to save profile');
      }

      updateData({ companyName, industry, goal: goal as OnboardingData['goal'] });
      return true;
    } catch (err: any) {
      setError(err.message || 'Something went wrong');
      return false;
    } finally {
      setIsLoading(false);
    }
  }, [selectedCompanyId, updateData]);

  /** Step 3: Generate first report */
  const generateReport = useCallback(async (): Promise<string | null> => {
    if (!selectedCompanyId) {
      setError('No company selected');
      return null;
    }

    setIsLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/reports/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId: selectedCompanyId,
          type: 'free',
          reportCategory: 'snapshot',
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to start report');
      }

      const data = await res.json();
      return data.reportId || null;
    } catch (err: any) {
      setError(err.message || 'Something went wrong');
      return null;
    } finally {
      setIsLoading(false);
    }
  }, [selectedCompanyId]);

  // ── Derived state ────────────────────────────────────────────────────────

  const showOnboarding = !state.completed && !state.dismissed;
  const hasCompanyProfile = !!(selectedCompanyName && selectedCompanyId);

  return {
    // State
    state,
    wizardOpen,
    isLoading,
    error,
    showOnboarding,
    hasCompanyProfile,

    // Actions
    startOnboarding,
    goToStep,
    nextStep,
    prevStep,
    completeOnboarding,
    dismissOnboarding,
    resetOnboarding,
    setWizardOpen,
    setError,

    // Data
    updateData,

    // API
    analyzeWebsite,
    saveBusinessContext,
    generateReport,
  };
}
