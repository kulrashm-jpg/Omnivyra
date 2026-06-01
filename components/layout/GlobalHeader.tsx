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
  type ContentNavSection,
} from './contentNavigationConfig';

type HeaderChildItem = {
  label: string;
  href: string;
  description: string;
  contentSectionId?: ContentNavSection['id'];
};

type HeaderNavItem = {
  label: string;
  href: string;
  icon: React.ElementType;
  description: string;
  matchers: string[];
  children: HeaderChildItem[];
};

const HEADER_NAV_ITEMS: HeaderNavItem[] = [
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
        description: '9 text-first content types',
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
        label: 'Strategy Mix',
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
      { label: 'Intelligence', href: '/intelligence', description: 'Broader intelligence signals and insights.' },
    ],
  },
];

function getRoleLabel(role: string | null | undefined): string | null {
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

function isPathMatch(pathname: string, target: string): boolean {
  const path = normalizePath(pathname);
  const normalizedTarget = normalizePath(target);
  return path === normalizedTarget || path.startsWith(`${normalizedTarget}/`);
}

function useClickOutside(ref: React.RefObject<HTMLElement | null>, onClose: () => void) {
  useEffect(() => {
    const handler = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) onClose();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose, ref]);
}

function CreditPill({
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

function NavDropdown({
  item,
  isActive,
}: {
  item: HeaderNavItem;
  isActive: boolean;
}) {
  const [open, setOpen] = useState(false);
  const isContentMenu = item.label === 'Content';
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

  const navigateToContentItem = (route: string) => {
    setOpen(false);
    router.push(route);
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
        {item.label}
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

function HelpFloatingButton({ onStartTour }: { onStartTour: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useClickOutside(ref, () => setOpen(false));

  return (
    <div ref={ref} className="fixed right-4 top-[4.8rem] z-30">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        title="Help"
        className="flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 shadow-lg transition-colors hover:bg-slate-50 hover:text-slate-900"
      >
        <HelpCircle className="h-5 w-5" />
      </button>

      {open ? (
        <div className="absolute right-0 top-full mt-2 w-52 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl">
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              onStartTour();
            }}
            className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm text-slate-700 transition-colors hover:bg-slate-50"
          >
            <LifeBuoy className="h-4 w-4 text-slate-400" />
            Guided Tour
          </button>
          <a
            href="https://docs.omnivyra.com"
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => setOpen(false)}
            className="flex items-center gap-3 px-4 py-3 text-sm text-slate-700 transition-colors hover:bg-slate-50"
          >
            <BookOpen className="h-4 w-4 text-slate-400" />
            Documentation
          </a>
        </div>
      ) : null}
    </div>
  );
}

function UserMenu({
  displayName,
  roleLabel,
  isCompanyAdmin,
  billingVisible,
}: {
  displayName: string;
  roleLabel: string | null;
  isCompanyAdmin: boolean;
  billingVisible: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [isDark, setIsDark] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  useClickOutside(ref, () => setOpen(false));

  useEffect(() => {
    setOpen(false);
  }, [router.asPath]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const storedTheme = window.localStorage.getItem('theme');
    const storedAvatar = window.localStorage.getItem('omnivyra:user-avatar');
    const isDarkTheme = storedTheme === 'dark';
    setIsDark(isDarkTheme);
    document.documentElement.classList.toggle('dark', isDarkTheme);
    setAvatarUrl(storedAvatar || null);
  }, []);

  const identityLine = roleLabel ? `${displayName} - ${roleLabel}` : displayName;

  const setTheme = (theme: 'light' | 'dark') => {
    const dark = theme === 'dark';
    setIsDark(dark);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('theme', theme);
    }
    document.documentElement.classList.toggle('dark', dark);
  };

  const handleAvatarChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : null;
      setAvatarUrl(result);
      if (typeof window !== 'undefined' && result) {
        window.localStorage.setItem('omnivyra:user-avatar', result);
      }
    };
    reader.readAsDataURL(file);
    event.target.value = '';
  };

  const handleRemoveAvatar = () => {
    setAvatarUrl(null);
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem('omnivyra:user-avatar');
    }
  };

  const handleLogout = async () => {
    setIsSigningOut(true);
    try {
      await logoutCurrentSession();
    } catch {
      // ignore server-side logout cleanup failures
    }
    try {
      await getSupabaseBrowser().auth.signOut();
    } catch {
      // ignore sign-out cleanup failures
    }
    clearBrowserAuthState({ preservePkce: false });
    window.location.href = '/login';
  };

  const itemClassName =
    'flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-sm text-slate-700 transition-colors hover:bg-slate-50';

  return (
    <div ref={ref} className="relative">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleAvatarChange}
      />

      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-2 py-1.5 transition-colors hover:bg-slate-50"
      >
        {avatarUrl ? (
          <img
            src={avatarUrl}
            alt={displayName}
            className="h-8 w-8 rounded-full object-cover"
          />
        ) : (
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-sky-600 text-xs font-bold text-white">
            {displayName.charAt(0).toUpperCase()}
          </div>
        )}
        <ChevronDown className={`h-3.5 w-3.5 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open ? (
        <div className="absolute right-0 top-full z-50 mt-2 w-56 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg">
          <div className="border-b border-slate-100 px-3 py-2.5">
            <div className="flex items-center gap-3">
              {avatarUrl ? (
                <img
                  src={avatarUrl}
                  alt={displayName}
                  className="h-10 w-10 rounded-full object-cover"
                />
              ) : (
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-sky-600 text-sm font-bold text-white">
                  {displayName.charAt(0).toUpperCase()}
                </div>
              )}
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-slate-900">{identityLine}</div>
                <div className="mt-1 flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="inline-flex items-center gap-1 rounded-full border border-slate-200 px-2 py-0.5 text-[10px] font-semibold text-slate-600 transition-colors hover:bg-slate-50"
                  >
                    <Camera className="h-3.5 w-3.5" />
                    {avatarUrl ? 'Change image' : 'Add image'}
                  </button>
                  {avatarUrl ? (
                    <button
                      type="button"
                      onClick={handleRemoveAvatar}
                      className="rounded-full border border-slate-200 px-2 py-0.5 text-[10px] font-semibold text-slate-500 transition-colors hover:bg-slate-50"
                    >
                      Remove
                    </button>
                  ) : null}
                </div>
              </div>
            </div>
          </div>

          <div className="border-b border-slate-100 p-1.5">
            <div className="px-2 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">
              Appearance
            </div>
            <div className="grid grid-cols-2 gap-2 px-1">
              <button
                type="button"
                onClick={() => setTheme('light')}
                className={`flex items-center justify-center gap-2 rounded-xl px-3 py-2 text-xs font-medium transition-colors ${
                  !isDark ? 'bg-sky-50 text-sky-700' : 'bg-slate-50 text-slate-600 hover:bg-slate-100'
                }`}
              >
                <Sun className="h-4 w-4" />
                Light
              </button>
              <button
                type="button"
                onClick={() => setTheme('dark')}
                className={`flex items-center justify-center gap-2 rounded-xl px-3 py-2 text-xs font-medium transition-colors ${
                  isDark ? 'bg-sky-50 text-sky-700' : 'bg-slate-50 text-slate-600 hover:bg-slate-100'
                }`}
              >
                <Moon className="h-4 w-4" />
                Dark
              </button>
            </div>
          </div>

          <div className="space-y-0.5 p-1.5">
            <Link href="/pricing" className={itemClassName}>
              <CreditCard className="h-4 w-4 text-slate-400" />
              Pricing & Plans
            </Link>
            <Link href="/team-management" className={itemClassName}>
              <Users className="h-4 w-4 text-slate-400" />
              Team
            </Link>
            <Link href="/integrations?focus=website" className={itemClassName}>
              <Link2 className="h-4 w-4 text-slate-400" />
              Integrations
            </Link>
            {billingVisible ? (
              <Link href="/company/billing" className={itemClassName}>
                <CreditCard className="h-4 w-4 text-slate-400" />
                Billing
              </Link>
            ) : null}
            {isCompanyAdmin ? (
              <Link href={SETTINGS_ROUTE_COMPANY_ADMIN_ACCESS} className={itemClassName}>
                <Settings className="h-4 w-4 text-slate-400" />
                Settings
              </Link>
            ) : null}
            {/* Per-user security settings (passkeys/TOTP/sessions). Visible to every authenticated user. */}
            <Link href={SETTINGS_ROUTE_SECURITY} className={itemClassName}>
              <Shield className="h-4 w-4 text-slate-400" />
              Security
            </Link>
          </div>

          <div className="border-t border-slate-100 p-1.5">
            <button
              type="button"
              onClick={handleLogout}
              className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-sm text-red-600 transition-colors hover:bg-red-50"
            >
              <LogOut className="h-4 w-4 opacity-70" />
              {isSigningOut ? 'Signing out...' : 'Log out'}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

type GlobalHeaderProps = {
  onOpenCommandPalette?: () => void;
};

const GlobalHeader: React.FC<GlobalHeaderProps> = () => {
  const router = useRouter();
  const { userName, selectedCompanyId, userRole, isAuthenticated } = useCompanyContext();
  const { startTour } = useTour();
  const { status: creditsStatus, totalCredits, remainingCredits } = useCredits(isAuthenticated ? selectedCompanyId : null);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    setMobileOpen(false);
  }, [router.asPath]);

  const displayName = userName?.trim() || 'User';
  const roleLabel = getRoleLabel(userRole);
  // Settings visibility: COMPANY_ADMIN OR SUPER_ADMIN OR ADMIN.
  // Was previously a literal equality check that hid Settings from SUPER_ADMINs.
  const isCompanyAdmin = (() => {
    const r = (userRole || '').toUpperCase();
    return r === 'COMPANY_ADMIN' || r === 'SUPER_ADMIN' || r === 'ADMIN';
  })();
  // Billing nav visibility: company admins + finance roles. Standard users
  // never see it. The /company/billing page + its APIs independently enforce
  // org-isolation via assertOrgAccess, so this is presentation-only gating.
  const billingVisible = (() => {
    const r = (userRole || '').toUpperCase();
    return (
      r === 'COMPANY_ADMIN' ||
      r === 'SUPER_ADMIN' ||
      r === 'ADMIN' ||
      r === 'FINANCE_ADMIN' ||
      r === 'FINANCE_AUDITOR'
    );
  })();
  const activeNav = useMemo(
    () =>
      HEADER_NAV_ITEMS.find((item) =>
        item.matchers.some((matcher) => isPathMatch(router.pathname, matcher))
      ) ?? null,
    [router.pathname]
  );

  return (
    <>
      <header className="sticky top-0 z-[70] border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-screen-xl items-center gap-3 px-3 sm:px-4 lg:px-6">
          <Link href="/command-center" className="shrink-0" title="Command Center">
            <img src="/logo.png" alt="Omnivyra" className="h-9 w-auto object-contain" />
          </Link>

          <div className="hidden h-5 w-px shrink-0 bg-slate-200 md:block" />

          <nav className="hidden flex-1 items-center gap-1 md:flex">
            <Link
              href="/dashboard"
              className={`flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-semibold transition-colors ${
                isPathMatch(router.pathname, '/dashboard')
                  ? 'bg-sky-50 text-sky-700'
                  : 'text-slate-700 hover:bg-slate-100 hover:text-slate-900'
              }`}
            >
              <Home className="h-4 w-4" />
              Home
            </Link>

            {HEADER_NAV_ITEMS.map((item) => (
              <NavDropdown
                key={item.label}
                item={item}
                isActive={activeNav?.label === item.label}
              />
            ))}
          </nav>

          <div className="ml-auto flex shrink-0 items-center gap-2">
            {isAuthenticated ? <NotificationBell /> : null}
            {isAuthenticated ? (
              <CreditPill status={creditsStatus} total={totalCredits} remaining={remainingCredits} />
            ) : null}
            {isAuthenticated ? (
              <UserMenu
                displayName={displayName}
                roleLabel={roleLabel}
                isCompanyAdmin={isCompanyAdmin}
                billingVisible={billingVisible}
              />
            ) : null}

            <button
              type="button"
              onClick={() => setMobileOpen((value) => !value)}
              className="rounded-xl p-2 text-slate-600 transition-colors hover:bg-slate-50 md:hidden"
              aria-label="Toggle navigation"
            >
              {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
          </div>
        </div>

        {mobileOpen ? (
          <div className="border-t border-slate-200 bg-white px-4 pb-4 pt-3 md:hidden">
            <div className="space-y-2">
              <Link
                href="/dashboard"
                onClick={() => setMobileOpen(false)}
                className={`flex items-center gap-3 rounded-2xl px-3 py-3 text-sm font-semibold ${
                  isPathMatch(router.pathname, '/dashboard')
                    ? 'bg-sky-50 text-sky-700'
                    : 'bg-slate-50 text-slate-700'
                }`}
              >
                <Home className="h-4 w-4" />
                Home
              </Link>

              {HEADER_NAV_ITEMS.map((item) => (
                <div key={item.label} className="rounded-2xl border border-slate-100 bg-slate-50/70 p-2">
                  <div className="flex items-center gap-2 px-2 py-1">
                    <item.icon className="h-4 w-4 text-slate-500" />
                    <div className="text-sm font-semibold text-slate-900">{item.label}</div>
                    <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-semibold text-slate-500">
                      {item.children.length}
                    </span>
                  </div>
                  {item.label === 'Content' ? (
                    <div className="space-y-1 px-1 pb-1 pt-2">
                      {CONTENT_NAV_SECTIONS.map((section) => {
                        const SectionIcon = section.id === 'writer' ? PenTool : Sparkles;
                        const sectionActive = isPathMatch(router.asPath, section.href);
                        return (
                          <div key={section.id} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                            <Link
                              href={section.href}
                              onClick={() => setMobileOpen(false)}
                              className={`flex w-full items-center justify-between gap-3 px-3 py-3 text-left text-sm transition-colors ${
                                sectionActive ? 'bg-sky-50 text-sky-800' : 'text-slate-700 hover:bg-slate-50'
                              }`}
                            >
                              <span className="flex min-w-0 items-start gap-3">
                                <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border ${
                                  sectionActive ? 'border-sky-100 bg-white text-sky-700' : 'border-slate-200 bg-slate-50 text-slate-500'
                                }`}>
                                  <SectionIcon className="h-4 w-4" />
                                </span>
                                <span className="min-w-0">
                                  <span className="block font-semibold">{section.label}</span>
                                  <span className="mt-0.5 block text-xs text-slate-500">{section.description}</span>
                                  <span className="mt-1.5 inline-flex rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-semibold text-slate-500">
                                    {section.badge}
                                  </span>
                                </span>
                              </span>
                              <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" />
                            </Link>
                            <div className="grid grid-rows-[1fr]">
                              <div className="overflow-hidden">
                                <div className="border-t border-slate-100 px-3 py-2 text-xs leading-5 text-slate-500">
                                  {section.summary}
                                </div>
                                <div className="grid grid-cols-1 gap-1.5 border-t border-slate-100 p-2">
                                  {section.items.map((contentItem) => (
                                    <Link
                                      key={contentItem.id}
                                      href={contentItem.route}
                                      aria-label={contentItem.label}
                                      onClick={() => setMobileOpen(false)}
                                      className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 text-sm ${
                                        isPathMatch(router.asPath, contentItem.route)
                                          ? 'border-sky-200 bg-sky-50 text-sky-700'
                                          : 'border-transparent text-slate-600 hover:border-slate-200 hover:bg-slate-50'
                                      }`}
                                    >
                                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-xs font-bold text-slate-500">
                                        {contentItem.label.slice(0, 1)}
                                      </span>
                                      <span>
                                        <span className="block font-semibold">{contentItem.label}</span>
                                        <span className="mt-0.5 block text-xs text-slate-500">{contentItem.description}</span>
                                      </span>
                                    </Link>
                                  ))}
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="space-y-1 px-1 pb-1 pt-2">
                      {item.children.map((child) => (
                      <Link
                        key={child.href}
                        href={child.href}
                        onClick={() => setMobileOpen(false)}
                        className={`block rounded-xl px-3 py-2 text-sm ${
                          isPathMatch(router.pathname, child.href)
                            ? 'bg-white text-sky-700'
                            : 'text-slate-600 hover:bg-white'
                        }`}
                      >
                        <div className="font-medium">{child.label}</div>
                        <div className="mt-0.5 text-xs text-slate-500">{child.description}</div>
                      </Link>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </header>

      {isAuthenticated ? (
        <HelpFloatingButton
          onStartTour={() => {
            router.push('/command-center').then(() => startTour());
          }}
        />
      ) : null}

      <TourOverlay />
    </>
  );
};

export default GlobalHeader;
