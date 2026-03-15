import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useCompanyContext } from './CompanyContext';
import { useCompanyIntegrations } from '@/hooks/useCompanyIntegrations';
import { supabase } from '../utils/supabaseClient';
import { CreditMeter } from './ui/CreditMeter';
import PlatformIcon from './ui/PlatformIcon';

const Header: React.FC = () => {
  const router = useRouter();
  const { userName, selectedCompanyId, userRole, isAuthenticated } = useCompanyContext();
  const { platforms: connectedPlatforms } = useCompanyIntegrations(selectedCompanyId || '');
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [noCompanyLabel, setNoCompanyLabel] = useState('No company selected');

  useEffect(() => {
    const isPlatform =
      router.pathname === '/external-apis' &&
      (router.query?.mode === 'platform' || (router.asPath || '').includes('mode=platform'));
    setNoCompanyLabel(isPlatform ? 'Platform Catalog' : 'No company selected');
  }, [router.pathname, router.query?.mode, router.asPath]);

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

  const isAdmin = ['SUPER_ADMIN', 'COMPANY_ADMIN'].includes((userRole || '').toString());

  return (
    <div className="bg-gradient-to-br from-indigo-50 via-white to-purple-50 backdrop-blur-sm border-b border-gray-200/60 shadow-sm">
      <div className="max-w-7xl mx-auto px-6 py-4">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <Link
              href="/dashboard"
              className="flex items-center shrink-0 bg-transparent p-0 m-0 border-0 shadow-none outline-none ring-0"
              aria-label="Go to home"
            >
              <img
                src="/logo.png"
                alt="Logo"
                className="h-[3.74rem] w-auto object-contain bg-transparent border-0 shadow-none"
              />
            </Link>
            <button
              onClick={() => router.push('/dashboard')}
              className="bg-white text-gray-700 px-4 py-2 rounded-xl font-semibold hover:bg-gray-100 transition-colors"
            >
              Home
            </button>
            <button
              onClick={() => router.push('/campaign-proposals')}
              className="bg-white text-gray-700 px-4 py-2 rounded-xl font-semibold hover:bg-gray-100 transition-colors"
            >
              Campaign Proposals
            </button>
            <button
              onClick={() => router.push('/social-platforms')}
              className="bg-white text-gray-700 px-4 py-2 rounded-xl font-semibold hover:bg-gray-100 transition-colors"
            >
              Social Platforms
            </button>
            <button
              onClick={() => router.push('/community-ai/connectors')}
              className="bg-white text-gray-700 px-4 py-2 rounded-xl font-semibold hover:bg-gray-100 transition-colors"
            >
              Connect Accounts
            </button>
            <button
              onClick={() => router.push('/community-ai')}
              className="bg-white text-gray-700 px-4 py-2 rounded-xl font-semibold hover:bg-gray-100 transition-colors"
            >
              Community AI
            </button>
            <button
              onClick={() => router.push('/community-ai/discovered-users')}
              className="bg-white text-gray-700 px-4 py-2 rounded-xl font-semibold hover:bg-gray-100 transition-colors"
            >
              Discovered Users
            </button>
            {isAdmin && (
              <button
                onClick={() => router.push('/community-ai/auto-rules')}
                className="bg-white text-gray-700 px-4 py-2 rounded-xl font-semibold hover:bg-gray-100 transition-colors"
              >
                Auto-Rules
              </button>
            )}
            {(userRole || '').toString().toUpperCase() === 'COMPANY_ADMIN' && (
              <button
                onClick={() => router.push('/super-admin/consumption')}
                className="bg-white text-gray-700 px-4 py-2 rounded-xl font-semibold hover:bg-gray-100 transition-colors"
              >
                Usage
              </button>
            )}
          </div>
          {selectedCompanyId && connectedPlatforms.length > 0 && (
            <div className="flex items-center gap-2 shrink-0">
              <span className="text-xs text-gray-500 font-medium">Connected:</span>
              <div className="flex items-center gap-1.5">
                {connectedPlatforms.map(({ platform }) => (
                  <PlatformIcon
                    key={platform}
                    platform={platform}
                    size={20}
                    showLabel={false}
                    className="opacity-90 hover:opacity-100"
                    useBrandColor
                  />
                ))}
              </div>
            </div>
          )}
          <div className="flex flex-col items-end gap-2">
            <div className="flex items-center gap-4 text-sm text-gray-700">
              <div className="flex flex-col items-end">
                <span className="font-medium text-gray-900">{displayName}</span>
                {roleDisplayLabel && (
                  <span className="text-xs text-gray-500">{roleDisplayLabel}</span>
                )}
              </div>
              {!selectedCompanyId && (
                <div className="text-gray-500">{noCompanyLabel}</div>
              )}
              <button
                onClick={handleLogout}
                disabled={isSigningOut}
                className="bg-white text-gray-700 px-4 py-2 rounded-xl font-semibold hover:bg-gray-100 transition-colors disabled:opacity-50"
              >
                {isSigningOut ? 'Signing out...' : 'Logout'}
              </button>
            </div>
            {isAuthenticated && (
              <CreditMeter variant="compact" />
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Header;
