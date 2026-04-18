import { useState, useEffect, useMemo, useCallback } from 'react';
import { useCompanyContext } from '../components/CompanyContext';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type SetupLevel = 1 | 2 | 3 | 4;

export interface SetupItem {
  key: string;
  label: string;           // benefit-driven, not technical
  description: string;     // what happens when they do this
  href: string;            // where to go to complete it
  level: SetupLevel;       // 1=essential, 2=auto, 3=recommended, 4=advanced
  completed: boolean;
  required: boolean;       // true = blocks nothing, false = purely optional
}

export interface SetupState {
  items: SetupItem[];
  level1Complete: boolean;  // name + URL
  level2Complete: boolean;  // industry auto-filled
  level3Complete: boolean;  // audience, goals, tone
  level4Complete: boolean;  // api keys, social, extensions
  overallPercent: number;
  nextItem: SetupItem | null;  // first incomplete item
  canGenerate: boolean;    // can user generate content right now?
  canCampaign: boolean;    // can user create campaigns?
  canEngage: boolean;      // can user use engagement?
}

// ─────────────────────────────────────────────────────────────────────────────
// Local storage for dismissed nudges
// ─────────────────────────────────────────────────────────────────────────────

const DISMISSED_KEY = 'omnivyra_setup_dismissed';

function getDismissed(): Set<string> {
  if (typeof window === 'undefined') return new Set();
  try {
    const raw = localStorage.getItem(DISMISSED_KEY);
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch { return new Set(); }
}

function setDismissed(keys: Set<string>): void {
  if (typeof window === 'undefined') return;
  try { localStorage.setItem(DISMISSED_KEY, JSON.stringify([...keys])); } catch {}
}

// ─────────────────────────────────────────────────────────────────────────────
// Hook
// ─────────────────────────────────────────────────────────────────────────────

export function useSetupProgress() {
  const { selectedCompanyId, isAuthenticated } = useCompanyContext();
  const [features, setFeatures] = useState<Record<string, { status: string; score: number }>>({});
  const [profileSignals, setProfileSignals] = useState<{ hasWebsite: boolean; hasProfileBasics: boolean }>({
    hasWebsite: false,
    hasProfileBasics: false,
  });
  const [loading, setLoading] = useState(true);
  const [dismissed, setDismissedState] = useState<Set<string>>(new Set());

  // Load feature completion data
  useEffect(() => {
    if (!selectedCompanyId || !isAuthenticated) return;

    const load = async () => {
      try {
        const [featureRes, profileRes] = await Promise.all([
          fetch(`/api/feature-completion?sync=true`),
          fetch(`/api/company-profile?companyId=${encodeURIComponent(selectedCompanyId)}&includeCompleteness=0`),
        ]);

        if (featureRes.ok) {
          const data = await featureRes.json();
          if (data.success && data.data?.features) {
            const map: Record<string, { status: string; score: number }> = {};
            for (const f of data.data.features) {
              map[f.key] = { status: f.status, score: f.score };
            }
            setFeatures(map);
          }
        }

        if (profileRes.ok) {
          const data = await profileRes.json();
          const profile = data?.profile || null;
          setProfileSignals({
            hasWebsite: Boolean(profile?.website_url?.trim()),
            hasProfileBasics: Boolean(profile?.name?.trim() || profile?.industry?.trim()),
          });
        } else {
          setProfileSignals({ hasWebsite: false, hasProfileBasics: false });
        }
      } catch {
        // Non-critical — degrade gracefully
      } finally {
        setLoading(false);
      }
    };

    load();

    const refresh = (event: Event) => {
      const detail = (event as CustomEvent<{ companyId?: string }>).detail;
      if (!detail?.companyId || detail.companyId === selectedCompanyId) {
        void load();
      }
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('company-profile-updated', refresh as EventListener);
    }

    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('company-profile-updated', refresh as EventListener);
      }
    };
  }, [selectedCompanyId, isAuthenticated]);

  // Load dismissed nudges
  useEffect(() => {
    setDismissedState(getDismissed());
  }, []);

  const dismissNudge = useCallback((key: string) => {
    setDismissedState((prev) => {
      const next = new Set(prev);
      next.add(key);
      setDismissed(next);
      return next;
    });
  }, []);

  const isNudgeDismissed = useCallback((key: string) => dismissed.has(key), [dismissed]);

  // Build setup state
  const state: SetupState = useMemo(() => {
    const feat = (key: string) => features[key] || { status: 'not_started', score: 0 };
    const done = (key: string) => {
      if (key === 'website_connected') return profileSignals.hasWebsite;
      if (key === 'company_profile_completed') return profileSignals.hasProfileBasics || feat(key).status === 'completed' || feat(key).score >= 1;
      return feat(key).status === 'completed' || feat(key).score >= 1;
    };

    const items: SetupItem[] = [
      // Level 1: Essential (just name + URL)
      {
        key: 'company_profile_completed',
        label: 'Tell us about your business',
        description: 'Add your company name and industry so AI generates relevant content.',
        href: '/company-profile',
        level: 1,
        completed: done('company_profile_completed'),
        required: false,
      },
      {
        key: 'website_connected',
        label: 'Add your website',
        description: 'We\'ll analyze your site to understand your content and audience.',
        href: '/company-profile',
        level: 1,
        completed: done('website_connected'),
        required: false,
      },

      // Level 3: Recommended (after user has seen value)
      {
        key: 'social_accounts_connected',
        label: 'Connect your social accounts',
        description: 'Publish content directly to LinkedIn, Twitter, and more.',
        href: '/social-platforms',
        level: 3,
        completed: done('social_accounts_connected'),
        required: false,
      },

      // Level 4: Advanced (only when needed)
      {
        key: 'api_configured',
        label: 'Connect AI tools',
        description: 'Add API keys to enable advanced content generation.',
        href: '/external-apis',
        level: 4,
        completed: done('api_configured'),
        required: false,
      },
      {
        key: 'chrome_extension_installed',
        label: 'Get the Chrome extension',
        description: 'Reply to comments and engage directly from your browser.',
        href: '/integrations',
        level: 4,
        completed: done('chrome_extension_installed'),
        required: false,
      },
    ];

    const completedCount = items.filter((i) => i.completed).length;
    const overallPercent = items.length > 0 ? Math.round((completedCount / items.length) * 100) : 0;
    const nextItem = items.find((i) => !i.completed) || null;

    const level1Complete = items.filter((i) => i.level === 1).every((i) => i.completed);
    const level2Complete = level1Complete; // auto-extracted, considered done if level 1 is
    const level3Complete = items.filter((i) => i.level <= 3).every((i) => i.completed);
    const level4Complete = items.every((i) => i.completed);

    // These should NEVER be false — we allow everything with degraded quality
    const canGenerate = true;   // blog generation only needs company_id + topic
    const canCampaign = true;   // campaigns work, just can't publish without social
    const canEngage = true;     // engagement shows, just empty without social

    return {
      items,
      level1Complete,
      level2Complete,
      level3Complete,
      level4Complete,
      overallPercent,
      nextItem,
      canGenerate,
      canCampaign,
      canEngage,
    };
  }, [features, profileSignals]);

  return {
    ...state,
    loading,
    dismissNudge,
    isNudgeDismissed,
  };
}
