import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { useCompanyContext } from './CompanyContext';
import { supabase } from '../utils/supabaseClient';
import { fetchWithAuth } from './community-ai/fetchWithAuth';

const Header: React.FC = () => {
  const router = useRouter();
  const { userName, selectedCompanyId, userRole } = useCompanyContext();
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [canManageConnectors, setCanManageConnectors] = useState(false);
  const [canViewExternalApis, setCanViewExternalApis] = useState(false);
  const [canManageExternalApisVirality, setCanManageExternalApisVirality] = useState(false);

  const displayName = userName && userName.trim().length > 0 ? userName : 'User';

  const handleLogout = async () => {
    setIsSigningOut(true);
    await supabase.auth.signOut();
    window.location.href = '/login';
  };

  const isAdmin = ['SUPER_ADMIN', 'COMPANY_ADMIN'].includes((userRole || '').toString());

  useEffect(() => {
    const shouldFetch = router.pathname.startsWith('/community-ai');
    if (!shouldFetch || !selectedCompanyId) {
      setCanManageConnectors(false);
      return;
    }
    const loadPermissions = async () => {
      try {
        const response = await fetchWithAuth(
          `/api/community-ai/actions?tenant_id=${encodeURIComponent(
            selectedCompanyId
          )}&organization_id=${encodeURIComponent(selectedCompanyId)}`
        );
        if (!response.ok) {
          setCanManageConnectors(false);
          return;
        }
        const data = await response.json();
        setCanManageConnectors(!!data?.permissions?.canManageConnectors);
      } catch {
        setCanManageConnectors(false);
      }
    };
    loadPermissions();
  }, [router.pathname, selectedCompanyId]);

  useEffect(() => {
    if (!selectedCompanyId) {
      setCanViewExternalApis(false);
      setCanManageExternalApisVirality(false);
      return;
    }
    const loadExternalApiPermissions = async () => {
      try {
        const response = await fetchWithAuth(
          `/api/external-apis?companyId=${encodeURIComponent(selectedCompanyId)}`
        );
        if (!response.ok) {
          setCanViewExternalApis(false);
          setCanManageExternalApisVirality(false);
          return;
        }
        const data = await response.json();
        setCanViewExternalApis(true);
        setCanManageExternalApisVirality(!!data?.permissions?.canManageExternalApis);
      } catch {
        setCanViewExternalApis(false);
        setCanManageExternalApisVirality(false);
      }
    };
    loadExternalApiPermissions();
  }, [selectedCompanyId]);

  return (
    <div className="bg-white/90 backdrop-blur-sm border-b border-gray-200/60 shadow-sm">
      <div className="max-w-7xl mx-auto px-6 py-4">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <button
              onClick={() => router.push('/dashboard')}
              className="bg-white text-gray-700 px-4 py-2 rounded-xl font-semibold hover:bg-gray-100 transition-colors"
            >
              Home
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
            {canManageConnectors && (
              <button
                onClick={() => router.push('/community-ai/connectors')}
                className="bg-white text-gray-700 px-4 py-2 rounded-xl font-semibold hover:bg-gray-100 transition-colors"
              >
                Connectors
              </button>
            )}
            {canViewExternalApis && (
              <button
                onClick={() =>
                  router.push(canManageExternalApisVirality ? '/external-apis' : '/external-apis-access')
                }
                className="bg-white text-gray-700 px-4 py-2 rounded-xl font-semibold hover:bg-gray-100 transition-colors"
              >
                External APIs
              </button>
            )}
          </div>
          <div className="text-lg font-semibold text-gray-900">
            Content Manager App
          </div>
          <div className="flex items-center gap-3 text-sm text-gray-700">
            <div>Logged in as: {displayName}</div>
            {!selectedCompanyId && (
              <div className="text-gray-500">No company selected</div>
            )}
            <button
              onClick={handleLogout}
              disabled={isSigningOut}
              className="bg-white text-gray-700 px-4 py-2 rounded-xl font-semibold hover:bg-gray-100 transition-colors disabled:opacity-50"
            >
              {isSigningOut ? 'Signing out...' : 'Logout'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Header;
