import React, { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import {
  BarChart3,
  BookOpen,
  Camera,
  ChevronDown,
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
  Settings,
  Shield,
  Sun,
  Users,
  X,
  Zap,
} from 'lucide-react';
import { useCompanyContext } from '../CompanyContext';
import { getSupabaseBrowser } from '../../lib/supabaseBrowser';
import { logoutCurrentSession } from '../../lib/security/sessionClient';
import { clearBrowserAuthState } from '../../utils/authStorage';
import { useCredits } from '@/hooks/useCredits';
import { useTour } from '../tour/TourContext';
import { TourOverlay } from '../tour/TourOverlay';
import { NotificationBell } from '../NotificationBell';
import {
  SETTINGS_ROUTE_COMPANY_ADMIN_ACCESS,
  SETTINGS_ROUTE_SECURITY,
} from '../../lib/settings/canonicalRegistry';

type HeaderChildItem = {
  label: string;
  href: string;
  description: string;
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
    ],
    children: [
      { label: 'Writer Content', href: '/command-center/writer-content', description: 'Open the writer lane with 9 text-first content types.' },
      { label: 'Creator Content', href: '/command-center/creator-content', description: 'Open the creator lane with 6 AI-supported creator content types.' },
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
      { label: 'Active Leads', href: '/dashboard/intelligence?intelTab=active-leads', description: 'Lead review and action workspace.' },
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

function CreditPill({ total, remaining }: { total: number; remaining: number }) {
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
  const ref = useRef<HTMLDivElement>(null);
  const router = useRouter();

  useClickOutside(ref, () => setOpen(false));

  useEffect(() => {
    setOpen(false);
  }, [router.asPath]);

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

      {open ? (
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
}: {
  displayName: string;
  roleLabel: string | null;
  isCompanyAdmin: boolean;
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
  const { totalCredits, remainingCredits } = useCredits(isAuthenticated ? selectedCompanyId : null);
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
              <CreditPill total={totalCredits} remaining={remainingCredits} />
            ) : null}
            {isAuthenticated ? (
              <UserMenu
                displayName={displayName}
                roleLabel={roleLabel}
                isCompanyAdmin={isCompanyAdmin}
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
