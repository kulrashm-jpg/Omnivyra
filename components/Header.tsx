import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { Menu, X } from 'lucide-react';
import { useCompanyContext } from './CompanyContext';
import { useCompanyIntegrations } from '@/hooks/useCompanyIntegrations';
import { supabase } from '../utils/supabaseClient';
import { CreditMeter } from './ui/CreditMeter';
import PlatformIcon from './ui/PlatformIcon';
import { useCredits } from '@/hooks/useCredits';

const Header: React.FC = () => {
  const router = useRouter();
  const { userName, selectedCompanyId, userRole, isAuthenticated } = useCompanyContext();
  const { platforms: connectedPlatforms } = useCompanyIntegrations(selectedCompanyId || '');
  const { totalCredits, remainingCredits, categories } = useCredits(isAuthenticated ? selectedCompanyId : null);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [noCompanyLabel, setNoCompanyLabel] = useState('No company selected');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    const isPlatform =
      router.pathname === '/external-apis' &&
      (router.query?.mode === 'platform' || (router.asPath || '').includes('mode=platform'));
    setNoCompanyLabel(isPlatform ? 'Platform Catalog' : 'No company selected');
  }, [router.pathname, router.query?.mode, router.asPath]);

  // Close mobile menu on route change
  useEffect(() => {
    setMobileMenuOpen(false);
  }, [router.pathname]);

  const displayName = userName && userName.trim().length > 0 ? userName : 'User';

  const roleDisplayLabel = (() => {
    if (!userRole || !userRole.trim()) return null;
    const r = userRole.toUpperCase().replace(/\s+/g, '_');
    const labels: Record<string, string> = {
      SUPER_ADMIN: 'Super Admin',
      COMPANY_ADMIN: 'Company Admin',
      CONTENT_CREATOR: 'Content Creator',
      CONTENT_REVIEWER: 'Content Reviewer',
      CONTENT_PUBLISHER: 'Content Publisher',
      VIEW_ONLY: 'View Only',
    };
    return labels[r] ?? r.replace(/_/g, ' ');
  })();

  const handleLogout = async () => {
    setIsSigningOut(true);
    await supabase.auth.signOut();
    window.location.href = '/login';
  };

  const navBtnClass = 'bg-white text-gray-700 px-4 py-2 rounded-xl font-semibold hover:bg-gray-100 transition-colors text-sm';
  const mobileNavBtnClass = 'w-full text-left bg-white text-gray-700 px-4 py-3 rounded-xl font-semibold hover:bg-gray-100 transition-colors text-sm border border-gray-100';

  const isCompanyAdmin = (userRole || '').toString().toUpperCase() === 'COMPANY_ADMIN';

  return (
    <div className="bg-gradient-to-br from-indigo-50 via-white to-purple-50 border-b border-gray-200/60 shadow-sm">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3">
        {/* Top bar */}
        <div className="flex items-center justify-between gap-2">
          {/* Logo */}
          <Link
            href="/dashboard"
            className="flex items-center shrink-0 bg-transparent p-0 m-0 border-0 shadow-none outline-none ring-0"
            aria-label="Go to home"
          >
            <img
              src="/logo.png"
              alt="Logo"
              className="h-12 sm:h-[3.74rem] w-auto object-contain bg-transparent border-0 shadow-none"
            />
          </Link>

          {/* Desktop nav */}
          <div className="hidden md:flex items-center gap-1.5 flex-wrap">
            <button onClick={() => router.push('/dashboard')} className={navBtnClass}>Home</button>
            <button onClick={() => router.push('/campaign-proposals')} className={navBtnClass}>Campaign Proposals</button>
            <button onClick={() => router.push('/community-ai')} className={navBtnClass}>Engagement Center</button>
            <button onClick={() => router.push('/blogs')} className={navBtnClass}>Blog</button>
            {isCompanyAdmin && (
              <button onClick={() => router.push('/super-admin/consumption')} className={navBtnClass}>Usage</button>
            )}
          </div>

          {/* Desktop: connected platforms + user info */}
          <div className="hidden md:flex items-center gap-3">
            {selectedCompanyId && connectedPlatforms.length > 0 && (
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-gray-500 font-medium">Connected:</span>
                {connectedPlatforms.map(({ platform }) => (
                  <PlatformIcon key={platform} platform={platform} size={20} showLabel={false} className="opacity-90 hover:opacity-100" useBrandColor />
                ))}
              </div>
            )}
            <div className="flex flex-col items-end gap-1">
              <div className="flex items-center gap-3 text-sm text-gray-700">
                <div className="flex flex-col items-end">
                  <span className="font-medium text-gray-900">{displayName}</span>
                  {roleDisplayLabel && <span className="text-xs text-gray-500">{roleDisplayLabel}</span>}
                </div>
                {!selectedCompanyId && <div className="text-gray-500 text-xs">{noCompanyLabel}</div>}
                <button onClick={handleLogout} disabled={isSigningOut} className={`${navBtnClass} disabled:opacity-50`}>
                  {isSigningOut ? 'Signing out...' : 'Logout'}
                </button>
              </div>
              {isAuthenticated && (
                <CreditMeter
                  variant="compact"
                  totalCredits={totalCredits}
                  remainingCredits={remainingCredits}
                />
              )}
            </div>
          </div>

          {/* Mobile: user name + hamburger */}
          <div className="flex md:hidden items-center gap-2">
            <span className="text-sm font-medium text-gray-900 truncate max-w-[120px]">{displayName}</span>
            <button
              onClick={() => setMobileMenuOpen((o) => !o)}
              className="p-2 rounded-lg bg-white border border-gray-200 text-gray-700"
              aria-label="Toggle menu"
            >
              {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
          </div>
        </div>

        {/* Mobile menu */}
        {mobileMenuOpen && (
          <div className="md:hidden mt-3 pb-2 space-y-1.5 border-t border-gray-200 pt-3">
            <button onClick={() => router.push('/dashboard')} className={mobileNavBtnClass}>Home</button>
            <button onClick={() => router.push('/campaign-proposals')} className={mobileNavBtnClass}>Campaign Proposals</button>
            <button onClick={() => router.push('/community-ai')} className={mobileNavBtnClass}>Engagement Center</button>
            <button onClick={() => router.push('/blogs')} className={mobileNavBtnClass}>Blog</button>
            {isCompanyAdmin && (
              <button onClick={() => router.push('/super-admin/consumption')} className={mobileNavBtnClass}>Usage</button>
            )}
            <div className="flex items-center justify-between px-4 py-3 bg-white rounded-xl border border-gray-100">
              <div>
                <div className="text-sm font-medium text-gray-900">{displayName}</div>
                {roleDisplayLabel && <div className="text-xs text-gray-500">{roleDisplayLabel}</div>}
                {!selectedCompanyId && <div className="text-xs text-gray-400 mt-0.5">{noCompanyLabel}</div>}
              </div>
              <button onClick={handleLogout} disabled={isSigningOut} className="text-sm font-semibold text-red-600 hover:text-red-700 disabled:opacity-50">
                {isSigningOut ? 'Signing out...' : 'Logout'}
              </button>
            </div>
            {isAuthenticated && (
              <div className="px-1">
                <CreditMeter
                  variant="compact"
                  totalCredits={totalCredits}
                  remainingCredits={remainingCredits}
                />
              </div>
            )}
            {selectedCompanyId && connectedPlatforms.length > 0 && (
              <div className="flex items-center gap-2 px-4 py-2">
                <span className="text-xs text-gray-500 font-medium">Connected:</span>
                <div className="flex items-center gap-1.5 flex-wrap">
                  {connectedPlatforms.map(({ platform }) => (
                    <PlatformIcon key={platform} platform={platform} size={18} showLabel={false} className="opacity-90" useBrandColor />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default Header;
