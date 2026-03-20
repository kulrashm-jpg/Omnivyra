'use client';

import { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useCompanyContext } from '../CompanyContext';
import { supabase } from '../../utils/supabaseClient';
import { useCredits } from '../../hooks/useCredits';
import { ChevronDown, LayoutDashboard, LogOut, User, Menu, X, Coins } from 'lucide-react';

const LANDING_ROUTES = ['/', '/pricing', '/about', '/blog'];

const NAV_LINKS = [
  { label: 'Solutions', href: '/solutions' },
  { label: 'Features', href: '/features' },
  { label: 'Pricing', href: '/pricing' },
  { label: 'Blog', href: '/blog' },
  { label: 'About', href: '/about' },
];

export default function LandingNavbar() {
  const { isAuthenticated, userName, selectedCompanyId } = useCompanyContext();
  const { remainingCredits, loading: creditsLoading } = useCredits(isAuthenticated ? selectedCompanyId : null);
  const [profileOpen, setProfileOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 16);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setProfileOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleLogout = async () => {
    setIsSigningOut(true);
    await supabase.auth.signOut();
    window.location.href = '/login';
  };

  const displayName = userName && userName.trim().length > 0 ? userName : 'User';

  return (
    <nav
      className={`sticky top-0 z-50 w-full transition-all duration-300 ${
        scrolled
          ? 'border-b border-gray-200/70 bg-white/95 shadow-[0_2px_16px_rgba(10,31,68,0.08)] backdrop-blur-md'
          : 'border-b border-transparent bg-white/70 backdrop-blur-sm'
      }`}
    >
      <div className="mx-auto flex h-16 max-w-[1280px] items-center justify-between px-6 lg:px-8">

        {/* Logo */}
        <Link href="/" className="flex shrink-0 items-center" aria-label="Omnivyra home">
          <img src="/logo.png" alt="Omnivyra" className="h-12 w-auto object-contain sm:h-14" />
        </Link>

        {/* Center nav — desktop only */}
        <div className="hidden items-center gap-7 sm:flex">
          {NAV_LINKS.map(({ label, href }) => (
            <Link
              key={href}
              href={href}
              className="text-[15px] font-medium text-[#0B1F33]/70 transition-colors hover:text-[#0A66C2]"
            >
              {label}
            </Link>
          ))}
        </div>

        {/* Right actions */}
        <div className="flex items-center gap-2">
          {!isAuthenticated ? (
            <>
              {/* Login — hidden on mobile, visible sm+ */}
              <Link
                href="/login"
                className="hidden rounded-full border border-[#0A66C2]/30 bg-transparent px-5 py-2 text-sm font-semibold text-[#0A66C2] transition hover:bg-[#0A66C2]/5 sm:inline-flex"
              >
                Login
              </Link>

              {/* Get Free Credits — full text on desktop, compact icon on mobile */}
              <Link
                href="/get-free-credits"
                className="flex items-center gap-1.5 rounded-full bg-gradient-to-r from-[#0A66C2] to-[#3FA9F5] px-3 py-2 text-sm font-semibold text-white shadow-[0_2px_12px_rgba(10,102,194,0.30)] transition hover:shadow-[0_4px_20px_rgba(10,102,194,0.45)] hover:opacity-95 sm:px-5"
                aria-label="Get Free Credits"
              >
                <Coins className="h-4 w-4 flex-shrink-0" />
                <span className="hidden sm:inline">Get Free Credits</span>
                <span className="text-xs font-bold sm:hidden">Free</span>
              </Link>

              {/* Hamburger — mobile only */}
              <button
                type="button"
                onClick={() => setMobileOpen((o) => !o)}
                className="flex h-9 w-9 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 sm:hidden"
                aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
                aria-expanded={mobileOpen}
              >
                {mobileOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
              </button>
            </>
          ) : (
            <>
              <Link
                href="/dashboard"
                className="hidden items-center gap-2 rounded-full border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 sm:flex"
              >
                <LayoutDashboard className="h-4 w-4" />
                Dashboard
              </Link>
              <div className="hidden h-8 items-center gap-1.5 rounded-full border border-gray-200 bg-[#F5F9FF] px-3 text-sm font-semibold text-gray-800 sm:flex">
                <Coins className="h-3.5 w-3.5 text-[#0A66C2]" />
                {creditsLoading ? '—' : remainingCredits.toLocaleString()} credits
              </div>
              <div className="relative" ref={dropdownRef}>
                <button
                  type="button"
                  onClick={() => setProfileOpen((o) => !o)}
                  className="flex items-center gap-2 rounded-full border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                  aria-expanded={profileOpen}
                  aria-haspopup="true"
                >
                  <User className="h-4 w-4" />
                  <span className="hidden sm:inline">{displayName}</span>
                  <ChevronDown className="h-4 w-4" />
                </button>
                {profileOpen && (
                  <div className="absolute right-0 mt-1 w-48 rounded-2xl border border-gray-200 bg-white py-1 shadow-lg">
                    <Link
                      href="/dashboard"
                      className="flex items-center gap-2 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                      onClick={() => setProfileOpen(false)}
                    >
                      <LayoutDashboard className="h-4 w-4" />
                      Dashboard
                    </Link>
                    <button
                      type="button"
                      onClick={() => { setProfileOpen(false); handleLogout(); }}
                      disabled={isSigningOut}
                      className="flex w-full items-center gap-2 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                    >
                      <LogOut className="h-4 w-4" />
                      {isSigningOut ? 'Signing out...' : 'Log out'}
                    </button>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── Mobile drawer ─────────────────────────────────────────────────── */}
      {mobileOpen && !isAuthenticated && (
        <div className="border-t border-gray-100 bg-white/98 px-6 pb-5 pt-3 shadow-[0_8px_24px_rgba(10,31,68,0.10)] sm:hidden">
          <div className="flex flex-col gap-1">
            {NAV_LINKS.map(({ label, href }) => (
              <Link
                key={href}
                href={href}
                onClick={() => setMobileOpen(false)}
                className="rounded-xl px-4 py-3 text-[15px] font-medium text-[#0B1F33]/80 transition-colors hover:bg-[#F5F9FF] hover:text-[#0A66C2]"
              >
                {label}
              </Link>
            ))}
            <div className="my-2 h-px bg-gray-100" />
            <Link
              href="/login"
              onClick={() => setMobileOpen(false)}
              className="rounded-xl px-4 py-3 text-[15px] font-medium text-[#0A66C2] transition-colors hover:bg-[#F5F9FF]"
            >
              Login
            </Link>
          </div>
        </div>
      )}
    </nav>
  );
}

export function useIsLandingRoute(): boolean {
  const router = useRouter();
  return LANDING_ROUTES.includes(router.pathname);
}
