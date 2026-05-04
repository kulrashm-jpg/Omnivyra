import type { LucideIcon } from 'lucide-react';
import {
  FileText,
  Home,
  LayoutDashboard,
  Lightbulb,
  Megaphone,
  MessageSquare,
  PenTool,
  Rocket,
  Sparkles,
  Users,
} from 'lucide-react';

export type SecondaryNavItem = {
  label: string;
  description: string;
  href: string;
  icon?: LucideIcon;
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
    matchers: ['/command-center/content', '/command-center/writer-content', '/command-center/creator-content', '/content/blog', '/stories', '/articles', '/whitepapers', '/case-studies', '/guides', '/newsletters', '/posts', '/threads', '/content-studio'],
    children: [
      {
        label: 'Writer Content',
        description: 'Open the writer lane with 9 text-first content types.',
        href: '/command-center/writer-content',
        icon: PenTool,
      },
      {
        label: 'Creator Content',
        description: 'Open the creator lane with 6 AI-supported creator content types.',
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
      '/command-center/bolt-text-strategy',
      '/command-center/bolt-creator-strategy',
      '/command-center/intelligent-mix-strategy',
      '/command-center/campaigns',
    ],
    children: [
      {
        label: 'All Campaigns',
        description: 'Track every live and planned campaign.',
        href: '/campaigns',
        icon: Megaphone,
      },
      {
        label: 'Create Quick Posts',
        description: 'Launch a lightweight text-first campaign fast.',
        href: '/command-center/bolt-text-strategy',
        icon: Sparkles,
      },
      {
        label: 'Creator Strategy',
        description: 'Plan creator-led campaign execution.',
        href: '/command-center/bolt-creator-strategy',
        icon: Users,
      },
      {
        label: 'Multi-Channel Campaigns',
        description: 'Build a coordinated campaign across channels.',
        href: '/command-center/intelligent-mix-strategy',
        icon: Rocket,
      },
    ],
  },
  {
    label: 'Engagement',
    href: '/command-center/engagement',
    icon: MessageSquare,
    description: 'Monitor audience signals, leads, and conversations.',
    matchers: ['/command-center/engagement', '/engagement'],
    children: [
      {
        label: 'Engagement Center',
        description: 'Respond to audience activity and track momentum.',
        href: '/command-center/engagement',
        icon: MessageSquare,
      },
      {
        label: 'Intelligence',
        description: 'Review the broader operating intelligence page.',
        href: '/intelligence',
        icon: Lightbulb,
      },
      {
        label: 'Market Pulse',
        description: 'Watch trends and engagement movement.',
        href: '/dashboard/intelligence?intelTab=market-pulse',
        icon: Lightbulb,
      },
      {
        label: 'Active Leads',
        description: 'Review and manage the leads that need action.',
        href: '/dashboard/intelligence?intelTab=active-leads',
        icon: Users,
      },
    ],
  },
];

export const CREATE_ACTIONS: CreateAction[] = [
  {
    id: 'write-blog',
    label: 'Write Blog',
    description: 'Create SEO-optimized long-form content.',
    href: '/admin/content',
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
  return (
    PRIMARY_NAV_ITEMS.find((item) =>
      item.matchers.some((matcher) => path === matcher || path.startsWith(`${matcher}/`)),
    ) ?? null
  );
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

  if (path.startsWith('/content/blog') || path.startsWith('/content')) {
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

  if (path.startsWith('/engagement') || path.startsWith('/command-center/engagement')) {
    return {
      label: 'Review active leads',
      description: 'Go straight to the people and conversations that need action.',
      href: '/dashboard/intelligence?intelTab=active-leads',
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


