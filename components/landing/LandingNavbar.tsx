'use client';

import React, { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useCompanyContext } from '../CompanyContext';
import { supabase } from '../../utils/supabaseClient';
import { ChevronDown, LayoutDashboard, LogOut, User } from 'lucide-react';

const LANDING_ROUTES = ['/', '/pricing', '/about', '/blog'];

export default function LandingNavbar() {
  const router = useRouter();
  const { isAuthenticated, userName } = useCompanyContext();
  const [profileOpen, setProfileOpen] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

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
    <nav className="landing-navbar sticky top-0 z-50 w-full border-b border-white/20 bg-white/90 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6">
        <Link href="/" className="flex shrink-0 items-center bg-transparent p-0 shadow-none outline-none ring-0" aria-label="Omnivyra home">
          <img
            src="/logo.png"
            alt="Omnivyra"
            width={140}
            height={56}
            className="h-14 w-auto object-contain bg-transparent border-0 shadow-none sm:h-16"
          />
        </Link>

        <div className="hidden items-center gap-6 sm:flex">
          <Link href="/pricing" className="text-base font-medium text-gray-600 hover:text-gray-900">
            Pricing
          </Link>
          <Link href="/about" className="text-base font-medium text-gray-600 hover:text-gray-900">
            About
          </Link>
          <Link href="/blog" className="text-base font-medium text-gray-600 hover:text-gray-900">
            Blog
          </Link>
        </div>

        <div className="flex items-center gap-3">
          {!isAuthenticated ? (
            <>
              <Link
                href="/login"
                className="rounded-2xl border border-[#0B5ED7] bg-transparent px-4 py-2 text-sm font-semibold text-[#0B5ED7] transition hover:bg-[#0B5ED7]/5"
              >
                Login
              </Link>
              <Link
                href="/login"
                className="rounded-2xl bg-gradient-to-r from-[#0B5ED7] to-[#1EA7FF] px-4 py-2 text-sm font-semibold text-white shadow-md transition hover:opacity-95"
              >
                Get Started
              </Link>
            </>
          ) : (
            <>
              <Link
                href="/dashboard"
                className="flex items-center gap-2 rounded-2xl border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                <LayoutDashboard className="h-4 w-4" />
                Dashboard
              </Link>
              <div className="flex h-8 items-center rounded-2xl border border-gray-200 bg-[#F5F9FF] px-3 text-sm font-semibold text-gray-800">
                25,000 Credits
              </div>
              <div className="relative" ref={dropdownRef}>
                <button
                  type="button"
                  onClick={() => setProfileOpen((o) => !o)}
                  className="flex items-center gap-2 rounded-2xl border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                  aria-expanded={profileOpen}
                  aria-haspopup="true"
                >
                  <User className="h-4 w-4" />
                  <span>{displayName}</span>
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
                      onClick={() => {
                        setProfileOpen(false);
                        handleLogout();
                      }}
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
    </nav>
  );
}

export function useIsLandingRoute(): boolean {
  const router = useRouter();
  return LANDING_ROUTES.includes(router.pathname);
}
