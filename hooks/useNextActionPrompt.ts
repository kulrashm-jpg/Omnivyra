import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import { Rocket, Settings, Sparkles, Users, type LucideIcon } from 'lucide-react';
import { useSetupProgress } from './useSetupProgress';
import { useUserState } from './useUserState';

export type NextActionPrompt = {
  id: string;
  label: string;
  description: string;
  href: string;
  icon: LucideIcon;
};

const DISMISS_KEY = 'omnivyra_next_action_dismissed';
const SESSION_KEY = 'omnivyra_next_action_session';

function normalizePath(pathname: string): string {
  return pathname.split('?')[0] || '/';
}

function readDismissed(): Set<string> {
  if (typeof window === 'undefined') return new Set();
  try {
    return new Set(JSON.parse(window.localStorage.getItem(DISMISS_KEY) || '[]'));
  } catch {
    return new Set();
  }
}

function saveDismissed(dismissed: Set<string>) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(DISMISS_KEY, JSON.stringify([...dismissed]));
  } catch {
    // ignore persistence errors
  }
}

function getSessionVisits(pathname: string): number {
  if (typeof window === 'undefined') return 1;
  try {
    const raw = window.sessionStorage.getItem(SESSION_KEY);
    const session = raw ? JSON.parse(raw) : { visitsByPath: {} as Record<string, number> };
    const path = normalizePath(pathname);
    const nextVisits = (session.visitsByPath[path] ?? 0) + 1;
    session.visitsByPath[path] = nextVisits;
    window.sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
    return nextVisits;
  } catch {
    return 1;
  }
}

export function useNextActionPrompt() {
  const router = useRouter();
  const setup = useSetupProgress();
  const userState = useUserState();
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [pathVisits, setPathVisits] = useState(1);

  useEffect(() => {
    setDismissed(readDismissed());
  }, []);

  useEffect(() => {
    setPathVisits(getSessionVisits(router.asPath));
  }, [router.asPath]);

  const prompt = useMemo<NextActionPrompt | null>(() => {
    const path = normalizePath(router.pathname);
    const isDashboard = path === '/dashboard' || path === '/home' || path === '/command-center';
    const isCampaign = path.startsWith('/campaign') || path.startsWith('/command-center/bolt');
    const isContent =
      path.startsWith('/blogs') ||
      path.startsWith('/content') ||
      path.startsWith('/articles') ||
      path.startsWith('/stories') ||
      path.startsWith('/whitepapers') ||
      path.startsWith('/guides') ||
      path.startsWith('/newsletters') ||
      path.startsWith('/case-studies');
    const isEngagement = path.startsWith('/engagement') || path.startsWith('/command-center/engagement');

    const hasWebsite = !!setup.items.find((item) => item.key === 'website_connected')?.completed;
    const hasProfile = !!setup.items.find((item) => item.key === 'company_profile_completed')?.completed;
    const hasSocial = !!setup.items.find((item) => item.key === 'social_accounts_connected')?.completed;
    const isBoltTextFlow = path.startsWith('/command-center/bolt-text');
    const isBoltCreatorFlow = path.startsWith('/command-center/bolt-creator-strategy');
    const isIntelligentMixFlow = path.startsWith('/command-center/intelligent-mix-strategy');
    const isStrategyPlannerFlow = path.startsWith('/campaign-planner');

    const candidates: NextActionPrompt[] = [];

    if (!hasWebsite) {
      candidates.push({
        id: 'setup-website',
        label: 'Add your website',
        description: 'Let Omnivyra understand your business before pushing you into actions.',
        href: '/company-profile',
        icon: Settings,
      });
    } else if (!hasProfile) {
      candidates.push({
        id: 'setup-profile',
        label: 'Complete your company profile',
        description: 'Fill in the business context so the next recommendations are actually relevant.',
        href: '/company-profile',
        icon: Settings,
      });
    }

    if (isDashboard && hasWebsite && hasProfile && pathVisits <= 2) {
      if (userState.state === 'has_content') {
        candidates.push({
          id: 'dashboard-launch-campaign',
          label: 'Launch your first campaign',
          description: 'Choose the campaign mode that fits your execution style from the campaign hub.',
          href: '/command-center/campaigns',
          icon: Rocket,
        });
      } else if (userState.state === 'has_report') {
        candidates.push({
          id: 'dashboard-create-content',
          label: 'Create your first content piece',
          description: 'Choose the content format you want to create from the content hub.',
          href: '/command-center/content',
          icon: Sparkles,
        });
      } else if (userState.state === 'has_campaign') {
        candidates.push({
          id: 'dashboard-monitor-engagement',
          label: 'Open engagement command center',
          description: 'Your campaign is already moving. Watch conversations and act on responses.',
          href: '/command-center/engagement',
          icon: Users,
        });
      }
    }

    if (isCampaign && pathVisits <= 2 && !isBoltTextFlow && !isBoltCreatorFlow && !isIntelligentMixFlow && !isStrategyPlannerFlow) {
      candidates.push({
        id: 'campaign-strategy-mix',
        label: 'Open Strategic Mix',
        description: 'Use the direct planner to build a practical campaign instead of browsing here first.',
        href: '/campaign-planner?mode=direct',
        icon: Rocket,
      });
    }

    if (isContent && hasWebsite && hasProfile && pathVisits <= 2) {
      candidates.push({
        id: 'content-create-first',
        label: 'Create your first content piece',
        description: 'Open the content hub and choose the format that fits what you want to make.',
        href: '/command-center/content',
        icon: Sparkles,
      });
    }

    if (isEngagement && !hasSocial) {
      candidates.push({
        id: 'engagement-connect-social',
        label: 'Connect a social account',
        description: 'Engagement becomes meaningful only after at least one social channel is connected.',
        href: '/social-platforms',
        icon: Users,
      });
    }

    const nextPrompt = candidates.find((candidate) => !dismissed.has(candidate.id)) ?? null;
    return nextPrompt;
  }, [router.pathname, pathVisits, setup.items, dismissed, userState.state]);

  const dismissPrompt = useCallback(() => {
    if (!prompt) return;
    setDismissed((previous) => {
      const next = new Set(previous);
      next.add(prompt.id);
      saveDismissed(next);
      return next;
    });
  }, [prompt]);

  return {
    prompt,
    dismissPrompt,
  };
}
