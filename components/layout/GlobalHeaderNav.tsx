/** Part 1/2 of GlobalHeader.tsx — verbatim split (barrel preserved; importers unchanged). */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import {
  AlertTriangle,
  BarChart3,
  BookOpen,
  Camera,
  ChevronDown,
  ChevronRight,
  Coins,
  CreditCard,
  FileText,
  HelpCircle,
  Home,
  LifeBuoy,
  Link2,
  LogOut,
  Megaphone,
  Menu,
  MessageSquare,
  Moon,
  PenTool,
  Radar,
  Settings,
  Shield,
  Sparkles,
  Sun,
  Users,
  X,
  Zap,
} from 'lucide-react';
import { useCompanyContext } from '../CompanyContext';
import { getSupabaseBrowser } from '../../lib/supabaseBrowser';
import { logoutCurrentSession } from '../../lib/security/sessionClient';
import { clearBrowserAuthState } from '../../utils/authStorage';
import { useCredits, type CreditsStatus } from '@/hooks/useCredits';
import { useTour } from '../tour/TourContext';
import { TourOverlay } from '../tour/TourOverlay';
import { NotificationBell } from '../NotificationBell';
import {
  SETTINGS_ROUTE_COMPANY_ADMIN_ACCESS,
  SETTINGS_ROUTE_SECURITY,
} from '../../lib/settings/canonicalRegistry';
import {
  CONTENT_NAV_SECTIONS,
  getContentNavRoutes,
  resolveCreationEntry,
  type ContentNavSection,
} from './contentNavigationConfig';
import { creatorOutcomeFirstEnabled } from '../../lib/creator-outcomes/outcomeRegistry';
import { roleCanAccessArea } from '../../config/commandCenterCards';


type HeaderChildItem = {
  label: string;
  href: string;
  description: string;
  contentSectionId?: ContentNavSection['id'];
};

type HeaderNavItem = {
  // CREATOR-071: stable navigation id — identity no longer relies on display label.
  id?: string;
  label: string;
  href: string;
  icon: React.ElementType;
  description: string;
  matchers: string[];
  children: HeaderChildItem[];
};

export const HEADER_NAV_ITEMS: HeaderNavItem[] = [
  {
    label: 'Reports',
    href: '/reports',
    icon: BarChart3,
    description: 'Authority, performance, and market intelligence reports.',
    matchers: ['/reports'],
    children: [
      {
        label: 'Digital Authority Snapshot',
        href: '/reports/digital-authority-snapshot',
        description: 'Quick diagnostic view of brand authority and visibility.',
      },
      {
        label: 'Performance Intelligence',
        href: '/reports/performance-intelligence',
        description: 'Performance signals across campaigns and content.',
      },
      {
        label: 'Market Growth Intelligence',
        href: '/reports/market-growth-intelligence',
        description: 'Growth opportunities, whitespace, and competitive movement.',
      },
    ],
  },
  {
    id: 'content',
    label: 'Content',
    href: '/command-center/content',
    icon: FileText,
    description: 'Writer and creator content workflows from one navigation cluster.',
    matchers: [
      '/command-center/content',
      '/command-center/writer-content',
      '/command-center/creator-content',
      '/blogs',
      '/stories',
      '/articles',
      '/whitepapers',
      '/case-studies',
      '/posts',
      '/guides',
      '/newsletters',
      '/posts',
      '/threads',
      ...getContentNavRoutes(),
    ],
    children: [
      {
        label: 'Writer Content',
        href: '/command-center/writer-content',
        description: '5 text-first content types',
        contentSectionId: 'writer',
      },
      {
        label: 'Creator Content',
        href: '/command-center/creator-content',
        description: '3 AI-supported creator content types',
        contentSectionId: 'creator',
      },
    ],
  },
  {
    label: 'Campaigns',
    href: '/command-center/campaigns',
    icon: Megaphone,
    description: 'Four campaign workflows grouped under one menu.',
    matchers: [
      '/campaigns',
      '/campaign-planner',
      '/campaign-planning',
      '/campaign-details',
      '/command-center/campaigns',
      '/command-center/bolt-text',
      '/command-center/bolt-creator-strategy',
      '/command-center/intelligent-mix-strategy',
      '/command-center/bolt-combined-strategy',
    ],
    children: [
      { label: 'BOLT Text', href: '/command-center/bolt-text', description: 'Fast text-first campaign path.' },
      { label: 'BOLT Creator', href: '/command-center/bolt-creator-strategy', description: 'Creator-led strategy flow.' },
      {
        label: 'Intelligent Mix',
        href: '/command-center/intelligent-mix-strategy',
        description: 'Unified mix for text and creator-dependent campaign planning.',
      },
      {
        label: 'Strategic Mix',
        href: '/campaign-planner?mode=direct',
        description: 'Direct strategic campaign planning workflow.',
      },
    ],
  },
  {
    label: 'Engagement',
    href: '/command-center/engagement',
    icon: MessageSquare,
    description: 'Conversation, market pulse, leads, and intelligence.',
    matchers: [
      '/command-center/engagement',
      '/engagement',
      '/intelligence',
    ],
    children: [
      { label: 'Engagement Center', href: '/command-center/engagement', description: 'Conversation inbox and action queue.' },
      { label: 'Market Pulse', href: '/dashboard/intelligence?intelTab=market-pulse', description: 'Pulse, trend, and audience movement view.' },
      { label: 'Active Leads', href: '/command-center/active-leads', description: 'Lead review and action workspace.' },
      // BETA-008 (RULE 8): "Intelligence" (→ /intelligence) hidden for Beta — admin-gated shell.
    ],
  },
  {
    id: 'lead-intelligence',
    label: 'Lead Intelligence',
    href: '/lead-intelligence',
    icon: Radar,
    description: 'One workspace for every lead source — capture setup, overview, list, and profiles.',
    matchers: ['/lead-intelligence', '/website-setup', '/website-health', '/integrations', '/leads', '/lead-capture'],
    children: [
      { label: 'Overview', href: '/lead-intelligence', description: 'Totals, intent, source and status distribution.' },
      { label: 'All Leads', href: '/lead-intelligence?tab=leads', description: 'Unified, searchable list across every source.' },
      { label: 'Website Setup', href: '/website-setup', description: 'Connect a website, verify your domain, install tracking, and activate lead capture.' },
      { label: 'Website Health', href: '/website-health', description: 'Operational command center: integration, tracking, lead capture, intelligence & one-click validation.' },
      { label: 'Website Integrations', href: '/integrations?focus=website', description: 'Manage CMS connections and lead webhooks.' },
      { label: 'Forms', href: '/leads?tab=forms', description: 'Build and embed lead-capture forms.' },
      { label: 'Lead Capture', href: '/lead-capture', description: 'Capture topology, attribution continuity, and activation readiness.' },
    ],
  },
];

export function getRoleLabel(role: string | null | undefined): string | null {
  if (!role?.trim()) return null;
  const normalized = role.toUpperCase().replace(/\s+/g, '_');
  const labels: Record<string, string> = {
    SUPER_ADMIN: 'Super Admin',
    COMPANY_ADMIN: 'Admin',
    CONTENT_CREATOR: 'Creator',
    CONTENT_REVIEWER: 'Reviewer',
    CONTENT_PUBLISHER: 'Publisher',
    VIEW_ONLY: 'Viewer',
  };
  return labels[normalized] ?? normalized.replace(/_/g, ' ');
}

function normalizePath(pathname: string): string {
  return pathname.split('?')[0] || '/';
}

export function isPathMatch(pathname: string, target: string): boolean {
  const path = normalizePath(pathname);
  const normalizedTarget = normalizePath(target);
  return path === normalizedTarget || path.startsWith(`${normalizedTarget}/`);
}

export function useClickOutside(ref: React.RefObject<HTMLElement | null>, onClose: () => void) {
  useEffect(() => {
    const handler = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) onClose();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose, ref]);
}

export function CreditPill({
  status,
  total,
  remaining,
}: {
  status?: CreditsStatus;
  total: number;
  remaining: number;
}) {
  // Legacy callers/tests that don't pass `status` keep the prior numeric
  // behavior (backward compatible).
  const effective: CreditsStatus = status ?? 'ready';

  // LOADING — animated placeholder, never a numeric 0.
  if (effective === 'loading') {
    return (
      <div
        data-testid="credit-pill" data-credit-status="loading"
        aria-busy="true"
        aria-label="Loading credit balance"
        className="hidden items-center gap-1 rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 sm:flex"
      >
        <Zap className="h-3.5 w-3.5 text-slate-300" />
        <span className="h-3 w-8 animate-pulse rounded bg-slate-200" />
      </div>
    );
  }

  // AUTH / API / TRANSIENT ERROR — warning indicator + tooltip, never 0.
  if (effective === 'error') {
    return (
      <Link
        href="/pricing#addons"
        title="Credit balance unavailable — couldn't reach the billing service. Retrying automatically."
        data-testid="credit-pill" data-credit-status="error"
        aria-label="Credit balance unavailable"
        className="hidden items-center gap-1 rounded-xl border border-amber-200 bg-amber-50 px-2.5 py-1.5 transition-colors hover:bg-amber-100 sm:flex"
      >
        <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
        <span className="text-xs font-semibold text-amber-700">—</span>
      </Link>
    );
  }

  // NO WALLET / UNAVAILABLE — explicit unavailable state, never 0.
  if (effective === 'unavailable') {
    return (
      <Link
        href="/pricing#addons"
        title="No credit account yet for this workspace."
        data-testid="credit-pill" data-credit-status="unavailable"
        aria-label="No credit account yet"
        className="hidden items-center gap-1 rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 transition-colors hover:bg-slate-50 sm:flex"
      >
        <Zap className="h-3.5 w-3.5 text-slate-300" />
        <span className="text-xs font-semibold text-slate-400">—</span>
      </Link>
    );
  }

  // READY — verified valid balance; 0 here is a REAL zero.
  const usedPercent = total > 0 ? ((total - remaining) / total) * 100 : 0;
  const accent =
    usedPercent >= 95 ? 'text-red-500' : usedPercent >= 80 ? 'text-amber-500' : 'text-sky-600';

  return (
    <Link
      href="/pricing#addons"
      data-testid="credit-pill"
      data-credit-status="ready"
      title={`${remaining.toLocaleString()} of ${total.toLocaleString()} credits remaining`}
      className="hidden items-center gap-1 rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 transition-colors hover:bg-slate-50 sm:flex"
    >
      <Zap className={`h-3.5 w-3.5 ${accent}`} />
      <span className="text-xs font-semibold tabular-nums text-slate-700">
        {remaining.toLocaleString()}
      </span>
    </Link>
  );
}

export function NavDropdown({
  item,
  isActive,
}: {
  item: HeaderNavItem;
  isActive: boolean;
}) {
  const [open, setOpen] = useState(false);
  // CREATOR-071: identity by stable id, not display label.
  const isContentMenu = item.id === 'content';
  const [expandedSection, setExpandedSection] = useState<ContentNavSection['id']>('writer');
  const [focusedCategoryIndex, setFocusedCategoryIndex] = useState(0);
  const [focusedItemIndex, setFocusedItemIndex] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const expandedContentSection = CONTENT_NAV_SECTIONS.find((section) => section.id === expandedSection) ?? CONTENT_NAV_SECTIONS[0];

  useClickOutside(ref, () => setOpen(false));

  useEffect(() => {
    setOpen(false);
  }, [router.asPath]);

  useEffect(() => {
    if (!open || !isContentMenu) return;
    const activeSection = CONTENT_NAV_SECTIONS.find((section) =>
      section.items.some((child) => isPathMatch(router.asPath, child.route)) || isPathMatch(router.asPath, section.href)
    );
    if (activeSection) setExpandedSection(activeSection.id);
  }, [isContentMenu, open, router.asPath]);

  // CREATOR-062: every content-creation nav target routes through the single
  // Unified Marketing Workspace when enabled (flag off ⇒ legacy route unchanged).
  const unifiedCreation = creatorOutcomeFirstEnabled();
  const navigateToContentItem = (route: string) => {
    setOpen(false);
    router.push(resolveCreationEntry(route, unifiedCreation));
  };

  const handleContentKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!isContentMenu) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      setOpen(false);
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (event.shiftKey) {
        setFocusedItemIndex((value) => Math.min(expandedContentSection.items.length - 1, value + 1));
      } else {
        const next = Math.min(CONTENT_NAV_SECTIONS.length - 1, focusedCategoryIndex + 1);
        setFocusedCategoryIndex(next);
        setExpandedSection(CONTENT_NAV_SECTIONS[next].id);
        setFocusedItemIndex(0);
      }
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (event.shiftKey) {
        setFocusedItemIndex((value) => Math.max(0, value - 1));
      } else {
        const next = Math.max(0, focusedCategoryIndex - 1);
        setFocusedCategoryIndex(next);
        setExpandedSection(CONTENT_NAV_SECTIONS[next].id);
        setFocusedItemIndex(0);
      }
      return;
    }
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      setFocusedItemIndex(0);
      return;
    }
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      setFocusedItemIndex(0);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      navigateToContentItem(expandedContentSection.items[focusedItemIndex]?.route ?? expandedContentSection.href);
    }
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className={`flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-semibold transition-colors ${
          isActive
            ? 'bg-sky-50 text-sky-700'
            : 'text-slate-700 hover:bg-slate-100 hover:text-slate-900'
        }`}
      >
        <item.icon className="h-4 w-4" />
        {isContentMenu && unifiedCreation ? 'Create Marketing' : item.label}
        <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500">
          {item.children.length}
        </span>
        <ChevronDown className={`h-3.5 w-3.5 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && isContentMenu ? (
        <div
          className="absolute left-0 top-full z-50 mt-2 grid w-[760px] grid-cols-[276px_1fr] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl shadow-slate-900/12 ring-1 ring-slate-900/5"
          role="menu"
          aria-label="Content menu"
          onKeyDown={handleContentKeyDown}
        >
          <div className="border-r border-slate-200 bg-slate-50/80 p-3">
            <div className="mb-2 px-2">
              <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">Content lanes</div>
              <div className="mt-1 text-xs leading-5 text-slate-500">Choose the production mode, then open the exact asset type.</div>
            </div>
            {CONTENT_NAV_SECTIONS.map((section, index) => {
              const sectionActive = expandedSection === section.id;
              const routeActive = isPathMatch(router.asPath, section.href)
                || section.items.some((child) => isPathMatch(router.asPath, child.route));
              const SectionIcon = section.id === 'writer' ? PenTool : Sparkles;
              return (
                <button
                  key={section.id}
                  type="button"
                  role="menuitem"
                  aria-expanded={sectionActive}
                  onMouseEnter={() => {
                    setExpandedSection(section.id);
                    setFocusedCategoryIndex(index);
                    setFocusedItemIndex(0);
                  }}
                  onFocus={() => {
                    setExpandedSection(section.id);
                    setFocusedCategoryIndex(index);
                    setFocusedItemIndex(0);
                  }}
                  onClick={() => {
                    setExpandedSection(section.id);
                    setFocusedCategoryIndex(index);
                    setFocusedItemIndex(0);
                    navigateToContentItem(section.href);
                  }}
                  className={`group relative mt-2 w-full rounded-xl border px-3 py-3 text-left transition-all duration-200 ${
                    sectionActive || routeActive
                      ? 'border-sky-200 bg-white text-sky-900 shadow-sm'
                      : 'border-transparent bg-transparent text-slate-700 hover:border-slate-200 hover:bg-white'
                  }`}
                >
                  <div className={`absolute left-0 top-3 h-10 w-1 rounded-r-full transition-opacity ${
                    sectionActive || routeActive ? 'bg-sky-500 opacity-100' : 'bg-slate-300 opacity-0 group-hover:opacity-100'
                  }`} />
                  <div className="flex items-start gap-3">
                    <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border ${
                      sectionActive || routeActive
                        ? 'border-sky-100 bg-sky-50 text-sky-700'
                        : 'border-slate-200 bg-white text-slate-500'
                    }`}>
                      <SectionIcon className="h-4 w-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center justify-between gap-2">
                        <span className="text-sm font-semibold leading-5">{section.label}</span>
                        <ChevronRight className={`h-4 w-4 shrink-0 transition-transform ${
                          sectionActive ? 'translate-x-0.5 text-sky-500' : 'text-slate-300 group-hover:text-slate-500'
                        }`} />
                      </span>
                      <span className="mt-0.5 block text-[11px] leading-4 text-slate-500">{section.description}</span>
                      <span className="mt-2 inline-flex rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-semibold text-slate-500">
                        {section.badge}
                      </span>
                    </span>
                  </div>
                </button>
              );
            })}
            <div className="mt-3 rounded-xl border border-slate-200 bg-white px-3 py-2">
              <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">Route safety</div>
              <div className="mt-1 text-xs leading-5 text-slate-500">Each item opens its existing creation flow.</div>
            </div>
          </div>
          <div className="bg-white p-4 transition-all duration-200 ease-out">
            <div className="mb-3 rounded-xl border border-slate-100 bg-slate-50/70 px-4 py-3">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                    {expandedContentSection.badge}
                  </div>
                  <div className="mt-1 text-base font-semibold text-slate-950">{expandedContentSection.label}</div>
                  <div className="mt-1 max-w-sm text-xs leading-5 text-slate-500">{expandedContentSection.summary}</div>
                </div>
                <div className="shrink-0 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-600">
                  {expandedContentSection.items.length} types
                </div>
              </div>
            </div>
            <div className={`grid gap-2.5 ${expandedContentSection.id === 'creator' ? 'grid-cols-3' : 'grid-cols-2'}`}>
              {expandedContentSection.items.map((contentItem, index) => {
                const childActive = isPathMatch(router.asPath, contentItem.route);
                const keyboardFocused = focusedItemIndex === index;
                return (
                  <button
                    key={contentItem.id}
                    type="button"
                    role="menuitem"
                    onMouseEnter={() => setFocusedItemIndex(index)}
                    onFocus={() => setFocusedItemIndex(index)}
                    onClick={() => navigateToContentItem(contentItem.route)}
                    aria-label={contentItem.label}
                    className={`group flex min-h-[74px] items-start gap-3 rounded-xl border px-3 py-3 text-left transition-all duration-200 ${
                      childActive
                        ? 'border-sky-500 bg-sky-600 text-white shadow-md shadow-sky-900/15'
                        : keyboardFocused
                          ? 'border-slate-300 bg-slate-50 text-slate-900'
                          : 'border-slate-200 bg-white text-slate-700 hover:border-sky-200 hover:bg-sky-50/40 hover:text-slate-950'
                    }`}
                  >
                    <span className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-xs font-bold ${
                      childActive ? 'bg-white/15 text-white' : 'bg-slate-100 text-slate-500 group-hover:bg-white group-hover:text-sky-700'
                    }`}>
                      {contentItem.label.slice(0, 1)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center justify-between gap-2">
                        <span className="text-sm font-semibold leading-5">{contentItem.label}</span>
                        <ChevronRight className={`h-3.5 w-3.5 shrink-0 ${childActive ? 'text-white/80' : 'text-slate-300 group-hover:text-sky-500'}`} />
                      </span>
                      <span className={`mt-1 block text-xs leading-4 ${childActive ? 'text-sky-50' : 'text-slate-500'}`} aria-hidden="true">
                        {contentItem.description}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
            <div className="mt-3 flex items-center justify-between rounded-xl border border-slate-100 px-3 py-2 text-xs text-slate-500">
              <span>Arrow keys navigate. Enter opens the selected type.</span>
              <span className="font-semibold text-slate-600">Esc closes</span>
            </div>
          </div>
        </div>
      ) : open ? (
        <div className="absolute left-0 top-full z-50 mt-1.5 w-[272px] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg">
          <div className="space-y-0.5 p-1">
            {item.children.map((child) => {
              const childActive = isPathMatch(router.pathname, child.href);
              return (
                <Link
                  key={child.href}
                  href={child.href}
                  className={`block rounded-lg px-2.5 py-1.5 transition-colors ${
                    childActive ? 'bg-sky-50 text-sky-800' : 'text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  <div className="text-sm font-semibold leading-4.5">{child.label}</div>
                  <div className="mt-0.5 text-[11px] leading-4 text-slate-500">{child.description}</div>
                </Link>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}

