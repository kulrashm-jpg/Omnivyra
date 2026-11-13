import type { LucideIcon } from 'lucide-react';
import {
  CreditCard,
  FileText,
  Home,
  LayoutDashboard,
  Lightbulb,
  Megaphone,
  MessageSquare,
  PenTool,
  Receipt,
  Rocket,
  Sparkles,
  Users,
  Wallet,
} from 'lucide-react';
import { CAMPAIGN_FLOWS } from '../../lib/navigation/campaignFlows';

export type SecondaryNavItem = {
  label: string;
  description: string;
  href: string;
  icon?: LucideIcon;
  /** Short plain-English line shown under the label in the section tabs (product names need one). */
  hint?: string;
};

export type PrimaryNavItem = {
  label: string;
  href: string;
  icon: LucideIcon;
  description: string;
  matchers: string[];
  children?: SecondaryNavItem[];
};

export type CreateAction = {
  id: string;
  label: string;
  description: string;
  href: string;
  icon: LucideIcon;
  keywords: string[];
};

export const PRIMARY_NAV_ITEMS: PrimaryNavItem[] = [
  {
    label: 'Dashboard',
    href: '/dashboard',
    icon: Home,
    description: 'See performance, priorities, and what needs attention now.',
    matchers: ['/dashboard', '/home', '/command-center'],
  },
  {
    label: 'Content',
    href: '/command-center/content',
    icon: FileText,
    description: 'Choose between writer and creator content workflows.',
    matchers: ['/command-center/content', '/command-center/writer-content', '/command-center/creator-content', '/blogs', '/stories', '/articles', '/whitepapers', '/case-studies', '/guides', '/newsletters', '/posts', '/threads', '/content-studio', '/content-creation'],
    children: [
      {
        label: 'Writer Content',
        description: 'Open the writer lane with 5 text-first content types.',
        href: '/command-center/writer-content',
        icon: PenTool,
      },
      {
        label: 'Creator Content',
        description: 'Open the creator lane with 5 AI-supported creator content types.',
        href: '/command-center/creator-content',
        icon: Sparkles,
      },
    ],
  },
  {
    label: 'Campaigns',
    href: '/campaigns',
    icon: Megaphone,
    description: 'Plan, launch, and optimize your campaign work.',
    matchers: [
      '/campaigns',
      '/campaign-planner',
      '/campaign-details',
      '/campaign-planning',
      '/command-center/bolt-text',
      '/command-center/bolt-text-strategy',
      '/command-center/bolt-creator-strategy',
      '/command-center/intelligent-mix-strategy',
      '/command-center/campaigns',
      '/command-center/variant-experience',
    ],
    children: [
      // Owner decision 2026-11-13: product name + a short plain-English hint, the same
      // wording in the header menu and here. Hints approved verbatim by the owner.
      {
        label: CAMPAIGN_FLOWS.all.label,
        description: CAMPAIGN_FLOWS.all.hint,
        hint: CAMPAIGN_FLOWS.all.hint,
        href: CAMPAIGN_FLOWS.all.href,
        icon: Megaphone,
      },
      {
        label: CAMPAIGN_FLOWS.boltText.label,
        description: CAMPAIGN_FLOWS.boltText.hint,
        hint: CAMPAIGN_FLOWS.boltText.hint,
        href: CAMPAIGN_FLOWS.boltText.href,
        icon: Sparkles,
      },
      {
        label: CAMPAIGN_FLOWS.boltCreator.label,
        description: CAMPAIGN_FLOWS.boltCreator.hint,
        hint: CAMPAIGN_FLOWS.boltCreator.hint,
        href: CAMPAIGN_FLOWS.boltCreator.href,
        icon: Users,
      },
      {
        label: CAMPAIGN_FLOWS.intelligentMix.label,
        description: CAMPAIGN_FLOWS.intelligentMix.hint,
        hint: CAMPAIGN_FLOWS.intelligentMix.hint,
        href: CAMPAIGN_FLOWS.intelligentMix.href,
        icon: Rocket,
      },
      {
        label: CAMPAIGN_FLOWS.strategicMix.label,
        description: CAMPAIGN_FLOWS.strategicMix.hint,
        hint: CAMPAIGN_FLOWS.strategicMix.hint,
        href: CAMPAIGN_FLOWS.strategicMix.href,
        icon: Lightbulb,
      },
      // BETA-008 (RULE 8): "Variant Experience" hidden for Beta — operator/dev-only tooling.
    ],
  },
  {
    label: 'Engagement',
    href: '/command-center/engagement',
    icon: MessageSquare,
    description: 'Monitor audience signals, leads, and conversations.',
    matchers: ['/command-center/engagement', '/command-center/active-leads', '/engagement'],
    children: [
      {
        label: 'Engagement Center',
        description: 'Respond to audience activity and track momentum.',
        href: '/command-center/engagement',
        icon: MessageSquare,
      },
      // BETA-008 (RULE 8): "Intelligence" (→ /intelligence) hidden for Beta — admin-gated shell.
      {
        label: 'Market Pulse',
        description: 'Open the executive MarketPulse intelligence room.',
        href: '/market-pulse',
        icon: Lightbulb,
      },
      {
        label: 'Active Leads',
        description: 'Review and manage the leads that need action.',
        href: '/command-center/active-leads',
        icon: Users,
      },
    ],
  },
  {
    label: 'Credits & Billing',
    href: '/command-center/credit-advisor',
    icon: Wallet,
    description: 'Track credit burn, manage your plan, billing, and top-ups.',
    matchers: ['/command-center/credit-advisor', '/command-center/billing', '/command-center/topup'],
    children: [
      {
        label: 'Credit Advisor',
        description: 'Track credit burn rate, forecast runway, and find savings.',
        href: '/command-center/credit-advisor',
        icon: Wallet,
      },
      {
        label: 'Billing & Subscription',
        description: 'View your plan, credits, purchases, and invoices.',
        href: '/command-center/billing',
        icon: Receipt,
      },
      {
        label: 'Buy Credits',
        description: 'Purchase top-up credits that never expire.',
        href: '/command-center/topup',
        icon: CreditCard,
      },
    ],
  },
];

export const CREATE_ACTIONS: CreateAction[] = [
  {
    id: 'write-blog',
    label: 'Write Blog',
    description: 'Create SEO-optimized long-form content.',
    href: '/blogs/create',
    icon: PenTool,
    keywords: ['blog', 'article', 'seo', 'long form', 'write'],
  },
  {
    id: 'generate-ai-content',
    label: 'Generate AI Content',
    description: 'Instantly generate ideas and first drafts.',
    href: '/posts/create',
    icon: Sparkles,
    keywords: ['ai', 'draft', 'content', 'post', 'idea'],
  },
  {
    id: 'launch-campaign',
    label: 'Launch Campaign',
    description: 'Start a multi-channel campaign from one place.',
    href: '/campaign-planner?mode=direct',
    icon: Rocket,
    keywords: ['campaign', 'launch', 'plan', 'multi-channel'],
  },
];

export type NextAction = {
  label: string;
  description: string;
  href: string;
  icon: LucideIcon;
};

function normalizePath(pathname: string): string {
  return pathname.split('?')[0] || '/';
}

export function isPathActive(pathname: string, href: string): boolean {
  const path = normalizePath(pathname);
  const target = normalizePath(href);
  return path === target || path.startsWith(`${target}/`);
}

export function getPrimaryNavForPath(pathname: string): PrimaryNavItem | null {
  const path = normalizePath(pathname);
  // Longest-prefix precedence. A primary item whose matcher is the
  // closest specific prefix wins over a primary item whose matcher
  // is a broader parent. Prevents `/command-center` (claimed by
  // Dashboard) from outranking `/command-center/variant-experience`
  // (declared as a Campaigns matcher).
  let bestMatch: PrimaryNavItem | null = null;
  let bestMatcherLength = -1;
  for (const item of PRIMARY_NAV_ITEMS) {
    for (const matcher of item.matchers) {
      const matches = path === matcher || path.startsWith(`${matcher}/`);
      if (!matches) continue;
      if (matcher.length > bestMatcherLength) {
        bestMatcherLength = matcher.length;
        bestMatch = item;
      }
    }
  }
  return bestMatch;
}

export function getSecondaryNavForPath(pathname: string): SecondaryNavItem[] {
  return getPrimaryNavForPath(pathname)?.children ?? [];
}

export function getNextActionForPath(pathname: string): NextAction | null {
  const path = normalizePath(pathname);

  if (path === '/dashboard' || path === '/home' || path === '/command-center') {
    return {
      label: 'Create your first content',
      description: 'Start with one piece of content and build momentum from there.',
      href: '/posts/create',
      icon: Sparkles,
    };
  }

  if (path.startsWith('/blogs') || path.startsWith('/content')) {
    return {
      label: 'Generate AI Content',
      description: 'Open the studio and create your next draft in minutes.',
      href: '/posts/create',
      icon: Sparkles,
    };
  }

  if (path.startsWith('/campaign')) {
    return {
      label: 'Launch your first campaign',
      description: 'Open the planner and turn strategy into execution.',
      href: '/campaign-planner?mode=direct',
      icon: Rocket,
    };
  }

  if (path.startsWith('/engagement') || path.startsWith('/command-center/engagement') || path.startsWith('/command-center/active-leads')) {
    return {
      label: 'Review active leads',
      description: 'Go straight to the people and conversations that need action.',
      href: '/command-center/engagement',
      icon: Users,
    };
  }

  return {
    label: 'Generate AI Content',
    description: 'Use the fastest path to start creating something useful.',
    href: '/posts/create',
    icon: Sparkles,
  };
}

export type CommandItem = {
  id: string;
  label: string;
  description: string;
  href: string;
  icon: LucideIcon;
  group: 'Navigate' | 'Create';
  keywords: string[];
};

export const COMMAND_ITEMS: CommandItem[] = [
  ...PRIMARY_NAV_ITEMS.flatMap((item) => [
    {
      id: `nav-${item.href}`,
      label: item.label,
      description: item.description,
      href: item.href,
      icon: item.icon,
      group: 'Navigate' as const,
      keywords: [item.label.toLowerCase(), ...item.matchers.map((matcher) => matcher.replace(/\//g, ' '))],
    },
    ...(item.children ?? []).map((child) => ({
      id: `nav-${child.href}`,
      label: child.label,
      description: child.description,
      href: child.href,
      icon: child.icon ?? item.icon,
      group: 'Navigate' as const,
      keywords: [child.label.toLowerCase(), child.description.toLowerCase(), child.href],
    })),
  ]),
  ...CREATE_ACTIONS.map((item) => ({
    id: `create-${item.id}`,
    label: item.label,
    description: item.description,
    href: item.href,
    icon: item.icon,
    group: 'Create' as const,
    keywords: item.keywords,
  })),
];
