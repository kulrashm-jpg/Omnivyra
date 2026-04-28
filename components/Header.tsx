import React, { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import {
  Menu, X, ChevronDown, BarChart3, FileText, Megaphone, MessageSquare,
  Settings, LogOut, Users, CreditCard, Zap, Link2, HelpCircle,
  Sun, Moon, LifeBuoy, BookOpen, Home,
} from 'lucide-react';
import { useCompanyContext } from './CompanyContext';
import { getSupabaseBrowser } from '../lib/supabaseBrowser';
import { useCredits } from '@/hooks/useCredits';
import { useTour } from './tour/TourContext';
import { TourOverlay } from './tour/TourOverlay';
import { NotificationBell } from './NotificationBell';

// ── Nav structure ──────────────────────────────────────────────────────────────

const NAV_ITEMS = [
  {
    label: 'Reports',
    icon: BarChart3,
    children: [
      { label: 'Digital Authority Snapshot',   href: '/reports/digital-authority-snapshot' },
      { label: 'Performance Intelligence',     href: '/reports/performance-intelligence' },
      { label: 'Market & Growth Intelligence', href: '/reports/market-growth-intelligence' },
    ],
  },
  {
    label: 'Content',
    icon: FileText,
    children: [
      { label: 'Post',        href: '/content-studio' },
      { label: 'Blog',        href: '/blogs' },
      { label: 'Story',       href: '/stories/create' },
      { label: 'Article',     href: '/articles' },
      { label: 'Whitepaper',  href: '/whitepapers/create' },
      { label: 'Case Study',  href: '/case-studies/create' },
      { label: 'Thread',      href: '/content-creation' },
      { label: 'Guide',       href: '/guides/create' },
      { label: 'Newsletter',  href: '/newsletters/create' },
    ],
  },
  {
    label: 'Campaigns',
    icon: Megaphone,
    children: [
      { label: 'BOLT (Text)',        href: '/command-center/bolt-text-strategy' },
      { label: 'BOLT (Creator)',     href: '/command-center/bolt-creator-strategy' },
      { label: 'Intelligence Mix',   href: '/command-center/intelligent-mix-strategy' },
      { label: 'Strategic Campaign', href: '/command-center/bolt-combined-strategy' },
    ],
  },
  {
    label: 'Engagement',
    icon: MessageSquare,
    children: [
      { label: 'Engagement Center', href: '/command-center/engagement' },
      { label: 'Market Pulse',      href: '/dashboard/intelligence?intelTab=market-pulse' },
      { label: 'Active Leads',      href: '/dashboard/intelligence?intelTab=active-leads' },
      { label: 'Intelligence',      href: '/intelligence' },
    ],
  },
];

// ── Role label ─────────────────────────────────────────────────────────────────

function getRoleLabel(role: string | null | undefined): string | null {
  if (!role?.trim()) return null;
  const r = role.toUpperCase().replace(/\s+/g, '_');
  const map: Record<string, string> = {
    SUPER_ADMIN:       'Super Admin',
    COMPANY_ADMIN:     'Admin',
    CONTENT_CREATOR:   'Creator',
    CONTENT_REVIEWER:  'Reviewer',
    CONTENT_PUBLISHER: 'Publisher',
    VIEW_ONLY:         'Viewer',
  };
  return map[r] ?? r.replace(/_/g, ' ');
}

// ── Credit pill ────────────────────────────────────────────────────────────────

function CreditPill({ total, remaining }: { total: number; remaining: number }) {
  const pct = total > 0 ? ((total - remaining) / total) * 100 : 0;
  const iconColor = pct >= 95 ? 'text-red-500' : pct >= 80 ? 'text-amber-500' : 'text-indigo-500';
  const textColor = pct >= 95 ? 'text-red-600' : pct >= 80 ? 'text-amber-600' : 'text-gray-600';

  return (
    <Link
      href="/pricing#addons"
      title={`${remaining.toLocaleString()} of ${total.toLocaleString()} credits remaining`}
      className="flex flex-col items-center leading-none hover:opacity-70 transition-opacity shrink-0"
    >
      <Zap className={`h-4 w-4 ${iconColor}`} />
      <span className={`text-[10px] tabular-nums mt-0.5 font-medium ${textColor}`}>
        {remaining.toLocaleString()}/{total.toLocaleString()}
      </span>
    </Link>
  );
}

// ── Dropdown menu ──────────────────────────────────────────────────────────────

function NavDropdown({
  label,
  icon: Icon,
  children,
  isActive,
}: {
  label: string;
  icon: React.ElementType;
  children: { label: string; href: string }[];
  isActive: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const router = useRouter();

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  useEffect(() => { setOpen(false); }, [router.pathname]);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className={`flex items-center gap-1 lg:gap-1.5 px-2 lg:px-3 py-2 rounded-xl text-sm font-semibold transition-colors whitespace-nowrap ${
          isActive
            ? 'bg-indigo-100 text-indigo-700'
            : 'bg-white text-gray-700 hover:bg-gray-100'
        }`}
      >
        <Icon className="h-4 w-4 hidden lg:block" />
        {label}
        <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-2 w-56 bg-white/95 backdrop-blur-sm rounded-2xl border border-gray-200/80 shadow-xl z-50 p-2 overflow-hidden">
          <div className="flex flex-col gap-1">
            {children.map((item) => {
              const isItemActive = router.pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setOpen(false)}
                  className={`flex items-center px-3.5 py-2.5 text-sm font-medium whitespace-nowrap rounded-xl transition-all duration-150 select-none
                    ${isItemActive
                      ? 'bg-indigo-600 text-white shadow-[0_2px_0_0_rgba(67,56,202,0.6),inset_0_1px_0_rgba(255,255,255,0.2)]'
                      : 'text-gray-700 bg-gray-50 shadow-[0_2px_0_0_rgba(0,0,0,0.08),inset_0_1px_0_rgba(255,255,255,0.9)] hover:bg-white hover:shadow-[0_3px_0_0_rgba(0,0,0,0.1),inset_0_1px_0_rgba(255,255,255,1)] hover:-translate-y-px active:translate-y-0 active:shadow-[0_1px_0_0_rgba(0,0,0,0.08)]'
                    }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ── User menu ──────────────────────────────────────────────────────────────────

function UserMenu({
  displayName,
  roleLabel,
  isCompanyAdmin,
  isDark,
  onToggleDark,
  onLogout,
  isSigningOut,
}: {
  displayName: string;
  roleLabel: string | null;
  isCompanyAdmin: boolean;
  isDark: boolean;
  onToggleDark: () => void;
  onLogout: () => void;
  isSigningOut: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const router = useRouter();

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  useEffect(() => { setOpen(false); }, [router.pathname]);

  const Section = ({ children }: { children: React.ReactNode }) => (
    <div className="border-t border-gray-100 py-1">{children}</div>
  );

  const Item = ({
    icon: Icon,
    label,
    href,
    onClick,
    danger,
    right,
  }: {
    icon: React.ElementType;
    label: string;
    href?: string;
    onClick?: () => void;
    danger?: boolean;
    right?: React.ReactNode;
  }) => {
    const cls = `flex items-center justify-between w-full px-4 py-2.5 text-sm transition-colors ${
      danger ? 'text-red-600 hover:bg-red-50' : 'text-gray-700 hover:bg-gray-50'
    }`;
    const inner = (
      <>
        <span className="flex items-center gap-3">
          <Icon className="h-4 w-4 shrink-0 opacity-70" />
          {label}
        </span>
        {right && <span className="ml-2">{right}</span>}
      </>
    );
    if (href) return <Link href={href} onClick={() => setOpen(false)} className={cls}>{inner}</Link>;
    return <button onClick={() => { onClick?.(); setOpen(false); }} className={cls}>{inner}</button>;
  };

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 px-2.5 py-1.5 rounded-xl bg-white border border-gray-200 hover:bg-gray-50 transition-colors min-w-0"
      >
        {/* Avatar circle */}
        <div className="h-7 w-7 rounded-full bg-indigo-600 text-white flex items-center justify-center text-xs font-bold shrink-0">
          {displayName.charAt(0).toUpperCase()}
        </div>
        <div className="text-left hidden lg:block min-w-0 max-w-[110px]">
          <div className="text-sm font-semibold text-gray-900 leading-none truncate">{displayName}</div>
          {roleLabel && <div className="text-[10px] text-gray-500 mt-0.5 truncate">{roleLabel}</div>}
        </div>
        <ChevronDown className={`h-3.5 w-3.5 text-gray-400 transition-transform shrink-0 ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute top-full right-0 mt-1.5 w-56 bg-white rounded-xl border border-gray-200 shadow-lg z-50 overflow-hidden">
          {/* Identity */}
          <div className="px-4 py-3">
            <div className="text-sm font-semibold text-gray-900">{displayName}</div>
            {roleLabel && <div className="text-xs text-gray-500 mt-0.5">{roleLabel}</div>}
          </div>

          <Section>
            <Item icon={CreditCard} label="Pricing & Plans"    href="/pricing" />
            <Item icon={Zap}        label="Buy Credits"        href="/pricing#addons" />
          </Section>

          <Section>
            <Item icon={Users}      label="Manage Users"       href="/team-management" />
            {isCompanyAdmin && (
              <Item icon={BarChart3} label="Usage"             href="/super-admin/consumption" />
            )}
            <Item icon={Link2}      label="Integrations"       href="/integrations?focus=website" />
            {isCompanyAdmin && (
              <Item icon={Settings} label="Settings"           href="/settings/company-admin-access" />
            )}
          </Section>

          <Section>
            <Item
              icon={isDark ? Sun : Moon}
              label={isDark ? 'Light mode' : 'Dark mode'}
              onClick={onToggleDark}
              right={
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${isDark ? 'bg-gray-700 text-gray-200' : 'bg-gray-100 text-gray-500'}`}>
                  {isDark ? 'ON' : 'OFF'}
                </span>
              }
            />
          </Section>

          <Section>
            <Item
              icon={LogOut}
              label={isSigningOut ? 'Signing out…' : 'Log out'}
              onClick={onLogout}
              danger
            />
          </Section>
        </div>
      )}
    </div>
  );
}

// ── Help button (floating) ─────────────────────────────────────────────────────

function HelpButton({ onStartTour }: { onStartTour: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div ref={ref} className="fixed top-[4.5rem] right-4 z-40">
      <button
        onClick={() => setOpen((o) => !o)}
        title="Help"
        className="flex items-center justify-center h-9 w-9 rounded-full bg-indigo-600 text-white shadow-lg hover:bg-indigo-700 transition-colors"
      >
        <HelpCircle className="h-5 w-5" />
      </button>

      {open && (
        <div className="absolute top-full right-0 mt-2 w-48 bg-white rounded-xl border border-gray-200 shadow-lg overflow-hidden">
          <button
            onClick={() => { setOpen(false); onStartTour(); }}
            className="flex items-center gap-3 w-full px-4 py-2.5 text-sm text-gray-700 hover:bg-indigo-50 hover:text-indigo-700 transition-colors"
          >
            <LifeBuoy className="h-4 w-4 opacity-70" />
            Guided tour
          </button>
          <a
            href="https://docs.omnivyra.com"
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => setOpen(false)}
            className="flex items-center gap-3 w-full px-4 py-2.5 text-sm text-gray-700 hover:bg-indigo-50 hover:text-indigo-700 transition-colors"
          >
            <BookOpen className="h-4 w-4 opacity-70" />
            Documentation
          </a>
        </div>
      )}
    </div>
  );
}

// ── Main Header ────────────────────────────────────────────────────────────────

const Header: React.FC = () => {
  const router = useRouter();
  const { userName, selectedCompanyId, userRole, isAuthenticated } = useCompanyContext();
  const { startTour } = useTour();
  const { totalCredits, remainingCredits } = useCredits(isAuthenticated ? selectedCompanyId : null);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [isDark, setIsDark] = useState(false);

  // Close mobile menu on route change
  useEffect(() => { setMobileMenuOpen(false); }, [router.pathname]);

  // Persist dark mode preference
  useEffect(() => {
    const stored = localStorage.getItem('theme');
    if (stored === 'dark') {
      setIsDark(true);
      document.documentElement.classList.add('dark');
    }
  }, []);

  const toggleDark = () => {
    const next = !isDark;
    setIsDark(next);
    document.documentElement.classList.toggle('dark', next);
    localStorage.setItem('theme', next ? 'dark' : 'light');
  };

  const handleLogout = async () => {
    setIsSigningOut(true);
    try {
      await getSupabaseBrowser().auth.signOut();
    } catch { /* already signed out */ }
    window.location.href = '/login';
  };

  const displayName = userName?.trim() || 'User';
  const roleLabel = getRoleLabel(userRole);
  const isCompanyAdmin = (userRole || '').toUpperCase() === 'COMPANY_ADMIN';

  // Determine which top-level nav is active based on current route
  const activeNav = NAV_ITEMS.findIndex((item) =>
    item.children.some((c) => router.pathname.startsWith(c.href))
  );

  return (
    <>
      <div className="bg-white border-b border-gray-200 shadow-sm sticky top-0 z-30">
        <div className="max-w-screen-xl mx-auto px-3 sm:px-4 lg:px-6 h-14 flex items-center gap-2">

          {/* Logo → Home (Command Center) */}
          <Link
            href="/command-center"
            className="flex items-center gap-2 shrink-0 group"
            title="Home"
          >
            <img
              src="/logo.png"
              alt="Omnivyra"
              className="h-10 w-auto object-contain"
            />
          </Link>

          {/* Divider */}
          <div className="hidden md:block h-6 w-px bg-gray-200 shrink-0" />

          {/* Desktop nav — Home + 4 dropdowns, centered */}
          <nav className="hidden md:flex items-center justify-center gap-0 min-w-0 flex-1">
            {/* Home button */}
            <Link
              href="/dashboard"
              className={`flex items-center gap-1 lg:gap-1.5 px-2 lg:px-3 py-2 rounded-xl text-sm font-semibold transition-colors whitespace-nowrap ${
                router.pathname === '/dashboard' || router.pathname.startsWith('/dashboard')
                  ? 'bg-indigo-100 text-indigo-700'
                  : 'text-gray-700 hover:bg-gray-100'
              }`}
            >
              <Home className="h-4 w-4" />
              Home
            </Link>

            {NAV_ITEMS.map((item, i) => (
              <NavDropdown
                key={item.label}
                label={item.label}
                icon={item.icon}
                children={item.children}
                isActive={activeNav === i}
              />
            ))}
          </nav>

          {/* Right side */}
          <div className="flex items-center gap-2 ml-auto shrink-0">
            {/* Credits */}
            {isAuthenticated && (
              <CreditPill total={totalCredits} remaining={remainingCredits} />
            )}

            {/* User menu */}
            {isAuthenticated && (
              <UserMenu
                displayName={displayName}
                roleLabel={roleLabel}
                isCompanyAdmin={isCompanyAdmin}
                isDark={isDark}
                onToggleDark={toggleDark}
                onLogout={handleLogout}
                isSigningOut={isSigningOut}
              />
            )}

            {/* Notifications — right of user menu */}
            {isAuthenticated && <NotificationBell />}

            {/* Mobile hamburger */}
            <button
              onClick={() => setMobileMenuOpen((o) => !o)}
              className="md:hidden p-2 rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-50"
              aria-label="Toggle menu"
            >
              {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
          </div>
        </div>

        {/* Mobile menu */}
        {mobileMenuOpen && (
          <div className="md:hidden border-t border-gray-100 bg-white px-4 pb-4 pt-2 space-y-1">
            {/* Home */}
            <Link
              href="/dashboard"
              className="flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm font-semibold text-gray-700 hover:bg-gray-100"
              onClick={() => setMobileMenuOpen(false)}
            >
              <Home className="h-4 w-4" />
              Home
            </Link>

            {/* Nav sections */}
            {NAV_ITEMS.map((section) => (
              <div key={section.label} className="pt-1">
                <div className="flex items-center gap-2 px-3 py-1.5 text-xs font-bold text-gray-400 uppercase tracking-wide">
                  <section.icon className="h-3.5 w-3.5" />
                  {section.label}
                </div>
                {section.children.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setMobileMenuOpen(false)}
                    className={`flex items-center pl-8 pr-3 py-2 rounded-xl text-sm transition-colors ${
                      router.pathname.startsWith(item.href)
                        ? 'bg-indigo-50 text-indigo-700 font-semibold'
                        : 'text-gray-700 hover:bg-gray-50'
                    }`}
                  >
                    {item.label}
                  </Link>
                ))}
              </div>
            ))}

            {/* Credits + account row */}
            {isAuthenticated && (
              <div className="border-t border-gray-100 pt-3 space-y-2">
                <div className="flex items-center justify-between px-3">
                  <CreditPill total={totalCredits} remaining={remainingCredits} />
                  <button
                    onClick={() => { setMobileMenuOpen(false); toggleDark(); }}
                    className="p-2 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50"
                  >
                    {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
                  </button>
                </div>
                <div className="flex items-center justify-between px-3 py-2 rounded-xl bg-gray-50">
                  <div>
                    <div className="text-sm font-semibold text-gray-900">{displayName}</div>
                    {roleLabel && <div className="text-xs text-gray-500">{roleLabel}</div>}
                  </div>
                  <button
                    onClick={() => { setMobileMenuOpen(false); handleLogout(); }}
                    disabled={isSigningOut}
                    className="text-sm font-semibold text-red-600 hover:text-red-700 disabled:opacity-50 flex items-center gap-1"
                  >
                    <LogOut className="h-4 w-4" />
                    {isSigningOut ? 'Signing out…' : 'Log out'}
                  </button>
                </div>
                {isCompanyAdmin && (
                  <div className="grid grid-cols-2 gap-1.5 px-1">
                    {[
                      { label: 'Settings', href: '/settings/company-admin-access', icon: Settings },
                      { label: 'Users',    href: '/team-management',                icon: Users },
                      { label: 'Usage',    href: '/super-admin/consumption',        icon: BarChart3 },
                      { label: 'Plans',    href: '/pricing',                        icon: CreditCard },
                    ].map((m) => (
                      <Link
                        key={m.href}
                        href={m.href}
                        onClick={() => setMobileMenuOpen(false)}
                        className="flex items-center gap-2 px-3 py-2 rounded-xl bg-white border border-gray-200 text-sm text-gray-700 hover:bg-gray-50"
                      >
                        <m.icon className="h-4 w-4 opacity-60" />
                        {m.label}
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Floating help button — below header, top-right */}
      {isAuthenticated && (
        <HelpButton onStartTour={() => { router.push('/command-center').then(() => startTour()); }} />
      )}

      <TourOverlay />
    </>
  );
};

export default Header;
