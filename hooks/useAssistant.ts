import { useState, useEffect, useMemo, useCallback } from 'react';
import { useRouter } from 'next/router';
import { useCompanyContext } from '../components/CompanyContext';
import { useSetupProgress } from './useSetupProgress';
import type { LucideIcon } from 'lucide-react';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface Suggestion {
  id: string;
  message: string;
  action: string;          // CTA label
  href: string;
  priority: number;        // higher = more important
  category: 'setup' | 'create' | 'optimize' | 'engage';
  dismissible: boolean;
}

export interface Insight {
  id: string;
  message: string;
  detail?: string;
  action?: string;
  href?: string;
  type: 'opportunity' | 'tip' | 'milestone';
}

export interface DailyAction {
  label: string;
  description: string;
  href: string;
  priority: number;
}

export type AssistantMode = 'first-time' | 'mid-journey' | 'returning';

// ─────────────────────────────────────────────────────────────────────────────
// Dismissal persistence
// ─────────────────────────────────────────────────────────────────────────────

const DISMISS_KEY = 'omnivyra_assistant_dismissed';
const SESSION_KEY = 'omnivyra_assistant_session';

function getDismissed(): Set<string> {
  if (typeof window === 'undefined') return new Set();
  try {
    return new Set(JSON.parse(localStorage.getItem(DISMISS_KEY) || '[]'));
  } catch { return new Set(); }
}

function saveDismissed(set: Set<string>) {
  if (typeof window === 'undefined') return;
  try { localStorage.setItem(DISMISS_KEY, JSON.stringify([...set])); } catch {}
}

function getSessionData(): { visits: number; lastPath: string; startedAt: string } {
  if (typeof window === 'undefined') return { visits: 0, lastPath: '/', startedAt: new Date().toISOString() };
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : { visits: 0, lastPath: '/', startedAt: new Date().toISOString() };
  } catch { return { visits: 0, lastPath: '/', startedAt: new Date().toISOString() }; }
}

function saveSessionData(data: { visits: number; lastPath: string; startedAt: string }) {
  if (typeof window === 'undefined') return;
  try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(data)); } catch {}
}

// ─────────────────────────────────────────────────────────────────────────────
// Hook
// ─────────────────────────────────────────────────────────────────────────────

export function useAssistant() {
  const router = useRouter();
  const { userName, isAuthenticated } = useCompanyContext();
  const setup = useSetupProgress();

  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [collapsed, setCollapsed] = useState(false);
  const [sessionVisits, setSessionVisits] = useState(0);

  // Load dismissed state
  useEffect(() => { setDismissed(getDismissed()); }, []);

  // Track session visits
  useEffect(() => {
    const session = getSessionData();
    session.visits += 1;
    session.lastPath = router.pathname;
    saveSessionData(session);
    setSessionVisits(session.visits);
  }, [router.pathname]);

  // Dismiss a suggestion
  const dismiss = useCallback((id: string) => {
    setDismissed((prev) => {
      const next = new Set(prev);
      next.add(id);
      saveDismissed(next);
      return next;
    });
  }, []);

  // ── Determine mode ───────────────────────────────────────────────────────

  const mode: AssistantMode = useMemo(() => {
    if (!setup.level1Complete && setup.overallPercent < 30) return 'first-time';
    if (setup.overallPercent < 80) return 'mid-journey';
    return 'returning';
  }, [setup.level1Complete, setup.overallPercent]);

  // ── Generate suggestions (rule-based, max 2) ────────────────────────────

  const suggestions: Suggestion[] = useMemo(() => {
    const all: Suggestion[] = [];
    const path = router.pathname;
    const isDashboard = path === '/dashboard' || path === '/home' || path === '/command-center';
    const isBlogs = path.startsWith('/blogs');
    const isCampaignContext =
      path.startsWith('/campaign') ||
      path.startsWith('/command-center/bolt') ||
      path.startsWith('/campaign-planner') ||
      path.startsWith('/command-center/campaigns');
    const isEngagementContext =
      path.startsWith('/engagement') || path.startsWith('/command-center/engagement');
    const hasWebsiteConnected = !!setup.items.find((i) => i.key === 'website_connected')?.completed;
    const hasCompanyProfile = !!setup.items.find((i) => i.key === 'company_profile_completed')?.completed;

    // ── Setup-driven suggestions ────────────────────────────────────────

    if (!hasWebsiteConnected) {
      all.push({
        id: 'add-website',
        message: 'Add your website so we can analyze your content and find opportunities.',
        action: 'Add website',
        href: '/company-profile',
        priority: 90,
        category: 'setup',
        dismissible: true,
      });
    }

    if (!hasCompanyProfile && hasWebsiteConnected) {
      all.push({
        id: 'complete-profile',
        message: 'Add your industry and company size for more relevant AI suggestions.',
        action: 'Complete profile',
        href: '/company-profile',
        priority: 70,
        category: 'setup',
        dismissible: true,
      });
    }

    if (!setup.items.find((i) => i.key === 'social_accounts_connected')?.completed
        && setup.level1Complete) {
      all.push({
        id: 'connect-social',
        message: 'Connect a social account to publish content and track engagement.',
        action: 'Connect accounts',
        href: '/social-platforms',
        priority: 50,
        category: 'setup',
        dismissible: true,
      });
    }

    // ── Context-driven suggestions (based on current page) ─────────────

    if (isDashboard && setup.level1Complete) {
      all.push({
        id: 'create-first-content',
        message: 'You\'re set up. Try generating your first AI-powered blog — it takes about 60 seconds.',
        action: 'Create content',
        href: '/command-center/content',
        priority: 85,
        category: 'create',
        dismissible: true,
      });
    }

    if (isBlogs && setup.level1Complete) {
      all.push({
        id: 'try-ai-generation',
        message: 'Let AI suggest 3 blog topics based on what your audience is searching for.',
        action: 'Generate ideas',
        href: '/command-center/content',
        priority: 60,
        category: 'create',
        dismissible: true,
      });
    }

    if (isCampaignContext && !setup.items.find((i) => i.key === 'social_accounts_connected')?.completed) {
      all.push({
        id: 'campaign-needs-social',
        message: 'Connect a social account to publish your campaigns when they\'re ready.',
        action: 'Connect now',
        href: '/social-platforms',
        priority: 75,
        category: 'setup',
        dismissible: true,
      });
    }

    if (isEngagementContext && !setup.items.find((i) => i.key === 'social_accounts_connected')?.completed) {
      all.push({
        id: 'engagement-needs-social',
        message: 'Connect a social account to start monitoring conversations and finding leads.',
        action: 'Connect now',
        href: '/social-platforms',
        priority: 75,
        category: 'engage',
        dismissible: true,
      });
    }

    // ── Progress-based suggestions ─────────────────────────────────────

    if (mode === 'mid-journey') {
      if (setup.items.find((i) => i.key === 'company_profile_completed')?.completed
          && !setup.items.find((i) => i.key === 'social_accounts_connected')?.completed) {
        all.push({
          id: 'progress-to-campaigns',
          message: 'Your profile is set. Connect a social account to start distributing content.',
          action: 'Connect accounts',
          href: '/social-platforms',
          priority: 45,
          category: 'optimize',
          dismissible: true,
        });
      }
    }

    // Filter out dismissed, sort by priority, take top 2
    return all
      .filter((s) => !dismissed.has(s.id))
      .sort((a, b) => b.priority - a.priority)
      .slice(0, 2);
  }, [router.pathname, setup, mode, dismissed]);

  // ── Generate insights ────────────────────────────────────────────────────

  const insights: Insight[] = useMemo(() => {
    const all: Insight[] = [];

    if (setup.overallPercent === 100) {
      all.push({
        id: 'setup-complete',
        message: 'Setup complete',
        detail: 'You\'ve configured everything. Your AI content will be at maximum quality.',
        type: 'milestone',
      });
    } else if (setup.overallPercent >= 60) {
      all.push({
        id: 'setup-progress',
        message: `Profile ${setup.overallPercent}% complete`,
        detail: 'Adding more details helps AI generate better content for your audience.',
        action: 'Improve profile',
        href: '/company-profile',
        type: 'tip',
      });
    }

    if (setup.level1Complete && !setup.items.find((i) => i.key === 'social_accounts_connected')?.completed) {
      all.push({
        id: 'social-opportunity',
        message: 'Publish to multiple channels',
        detail: 'Connect LinkedIn or Twitter to distribute content with one click.',
        action: 'Connect accounts',
        href: '/social-platforms',
        type: 'opportunity',
      });
    }

    return all.filter((i) => !dismissed.has(i.id)).slice(0, 3);
  }, [setup, dismissed]);

  // ── Daily brief actions ──────────────────────────────────────────────────

  const dailyActions: DailyAction[] = useMemo(() => {
    const actions: DailyAction[] = [];

    if (!setup.level1Complete) {
      actions.push({
        label: 'Finish setting up your profile',
        description: 'Add your website and company details for better AI results.',
        href: '/company-profile',
        priority: 100,
      });
    }

    actions.push({
      label: 'Create a new piece of content',
      description: 'Write a blog or generate ideas with AI — takes about 60 seconds.',
      href: '/command-center/content',
      priority: 80,
    });

    if (setup.items.find((i) => i.key === 'social_accounts_connected')?.completed) {
      actions.push({
        label: 'Check your engagement',
        description: 'See new conversations, mentions, and potential leads.',
        href: '/command-center/engagement',
        priority: 60,
      });
    } else {
      actions.push({
        label: 'Connect a social account',
        description: 'Start publishing content and monitoring your community.',
        href: '/social-platforms',
        priority: 60,
      });
    }

    return actions.sort((a, b) => b.priority - a.priority).slice(0, 3);
  }, [setup]);

  // ── Greeting ─────────────────────────────────────────────────────────────

  const greeting = useMemo(() => {
    const name = userName?.split(' ')[0] || 'there';
    const hour = new Date().getHours();
    const timeGreeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

    switch (mode) {
      case 'first-time':
        return `${timeGreeting}, ${name}. I'll help you get your first result.`;
      case 'mid-journey':
        return `${timeGreeting}, ${name}. Here's what you can do next.`;
      case 'returning':
        return `${timeGreeting}, ${name}. Ready to create?`;
    }
  }, [userName, mode]);

  return {
    // State
    mode,
    collapsed,
    setCollapsed,
    greeting,
    sessionVisits,

    // Data
    suggestions,
    insights,
    dailyActions,

    // Actions
    dismiss,
  };
}
