import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import { getAuthToken } from '../utils/getAuthToken';
import { getSupabaseBrowser } from '../lib/supabaseBrowser';
import { isAccountDeleted } from '../utils/authErrors';

type UserContext = {
  userId: string;
  role: 'admin' | 'user';
  companyIds: string[];
  defaultCompanyId: string;
};

type CompanyOption = {
  company_id: string;
  name: string;
};

type PermissionAction =
  | 'CREATE_CAMPAIGN'
  | 'GENERATE_RECOMMENDATIONS'
  | 'APPROVE_CONTENT'
  | 'SCHEDULE_CONTENT'
  | 'CREATE_CONTENT'
  | 'ENGAGE'
  | 'MANAGE_EXTERNAL_APIS'
  | 'VIEW_OMNIVYRA';

const normalizeCompanyRole = (role?: string | null) => {
  if (!role) return null;
  const upper = role.toUpperCase();
  if (upper === 'ADMIN') return 'COMPANY_ADMIN';
  // SUPER_ADMIN in user_company_roles means the row was miscreated during onboarding.
  // Real platform super admins authenticate via the super-admin cookie path
  // (loadContentArchitectContext), not via normal Supabase auth. Downgrade silently.
  if (upper === 'SUPER_ADMIN') return 'COMPANY_ADMIN';
  if (upper === 'CONTENT_MANAGER') return 'CONTENT_CREATOR';
  if (upper === 'CONTENT_PLANNER') return 'CONTENT_CREATOR';
  if (upper === 'CONTENT_ENGAGER') return 'VIEW_ONLY';
  if (upper === 'VIEWER') return 'VIEW_ONLY';
  return upper;
};

const permissionMatrix: Record<PermissionAction, string[]> = {
  CREATE_CAMPAIGN: ['SUPER_ADMIN', 'COMPANY_ADMIN', 'CONTENT_CREATOR', 'CONTENT_REVIEWER', 'CONTENT_PUBLISHER'],
  GENERATE_RECOMMENDATIONS: ['SUPER_ADMIN', 'COMPANY_ADMIN'],
  APPROVE_CONTENT: ['SUPER_ADMIN', 'COMPANY_ADMIN', 'CONTENT_REVIEWER'],
  SCHEDULE_CONTENT: ['SUPER_ADMIN', 'COMPANY_ADMIN', 'CONTENT_PUBLISHER'],
  CREATE_CONTENT: ['SUPER_ADMIN', 'COMPANY_ADMIN', 'CONTENT_CREATOR'],
  ENGAGE: ['SUPER_ADMIN', 'COMPANY_ADMIN', 'VIEW_ONLY'],
  MANAGE_EXTERNAL_APIS: ['SUPER_ADMIN', 'COMPANY_ADMIN'],
  VIEW_OMNIVYRA: ['SUPER_ADMIN'],
};

const hasPermissionForRole = (role: string, action: PermissionAction) => {
  if (!role) return false;
  return permissionMatrix[action].includes(role);
};

type CompanyContextValue = {
  user: UserContext | null;
  userName: string;
  userRole: string | null;
  companies: CompanyOption[];
  selectedCompanyId: string;
  selectedCompanyName: string;
  isLoading: boolean;
  isAuthenticated: boolean;
  /** true once the Supabase session has been validated against the backend.
   *  Consumers should show a loading/blank state until this is true to prevent
   *  a flash of protected or unauthenticated content. */
  authChecked: boolean;
  isAdmin: boolean;
  setSelectedCompanyId: (companyId: string) => void;
  refreshCompanies: () => Promise<void>;
  hasPermission: (action: PermissionAction) => boolean;
};

const CompanyContext = createContext<CompanyContextValue | null>(null);

const resolveStoredCompanyId = (): string => {
  if (typeof window === 'undefined') return '';
  return (
    window.localStorage.getItem('selected_company_id') ||
    window.localStorage.getItem('company_id') ||
    ''
  );
};

export const CompanyProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const router = useRouter();
  const [user, setUser] = useState<UserContext | null>(null);
  const [userName, setUserName] = useState<string>('');
  const [userRole, setUserRole] = useState<string | null>(null);
  const [rolesByCompany, setRolesByCompany] = useState<Record<string, string>>({});
  const [companies, setCompanies] = useState<CompanyOption[]>([]);
  const [selectedCompanyId, setSelectedCompanyIdInternal] = useState<string>('');
  const [isLoading, setIsLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);

  const selectedCompanyName = useMemo(() => {
    const match = companies.find((company) => company.company_id === selectedCompanyId);
    return match?.name || '';
  }, [companies, selectedCompanyId]);

  const setSelectedCompanyId = (companyId: string) => {
    if (!companyId) return;
    const isAllowedCompany = !!rolesByCompany[companyId];
    const isContentArchitect = user?.userId === 'content_architect' || userRole === 'CONTENT_ARCHITECT';
    if (userRole && userRole !== 'SUPER_ADMIN' && !isContentArchitect && !isAllowedCompany) {
      return;
    }
    setSelectedCompanyIdInternal(companyId);
    setUserRole(rolesByCompany[companyId] || null);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('selected_company_id', companyId);
      window.localStorage.setItem('company_id', companyId);
      window.localStorage.removeItem('selected_campaign_id');
    }
    if (process.env.NODE_ENV === 'development') {
      const match = companies.find((company) => company.company_id === companyId);
      console.log('SELECTED_COMPANY', { companyId, companyName: match?.name || '' });
    }
  };

  const refreshCompanies = async () => {
    setIsLoading(true);
    try {
      if (!isAuthenticated) {
        setUser(null);
        setCompanies([]);
        setSelectedCompanyIdInternal('');
        setUserRole(null);
        setRolesByCompany({});
        return;
      }

      const fbToken = await getAuthToken();
      if (!fbToken) {
        // No session — may be content-architect cookie path
        const asArchitect = await loadContentArchitectContext();
        if (!asArchitect) {
          setUser(null);
          setUserName('');
          setCompanies([]);
          setSelectedCompanyIdInternal('');
          setUserRole(null);
          setRolesByCompany({});
        }
        return;
      }

      const listRes = await fetch('/api/company-profile?mode=list', {
        credentials: 'include',
        headers: { Authorization: `Bearer ${fbToken}` },
      });

      if (!listRes.ok) {
        // Parse the error body once for AUTH_001 detection.
        let errData: unknown = null;
        try { errData = await listRes.json(); } catch { /* non-JSON — ignore */ }

        // Don't force sign-out while the auth callback / onboarding flow is
        // still in progress — the user row may not have been synced yet.
        const isOnAuthFlow = typeof window !== 'undefined' &&
          (window.location.pathname.startsWith('/auth/') ||
           window.location.pathname.startsWith('/onboarding/'));

        if (isAccountDeleted(listRes, errData)) {
          // ACCOUNT_DELETED: the DB user was soft-deleted. Force full sign-out
          // so the user cannot linger in a half-authenticated state.
          try { await getSupabaseBrowser().auth.signOut(); } catch { /* ignore */ }
          setIsAuthenticated(false);
          setAuthChecked(true);
        } else if (listRes.status === 401 && !isOnAuthFlow) {
          // Ghost session: token is valid but DB user no longer exists.
          try { await getSupabaseBrowser().auth.signOut(); } catch { /* ignore */ }
          setIsAuthenticated(false);
        }
        setUser(null);
        setUserName('');
        setCompanies([]);
        setSelectedCompanyIdInternal('');
        setUserRole(null);
        setRolesByCompany({});
        return;
      }

      const listData = await listRes.json();
      const list: CompanyOption[] = listData?.companies || [];
      type RoleEntry = { company_id: string; role: string };
      const listRoles: RoleEntry[] = listData?.rolesByCompany || [];

      if (list.length === 0) {
        setUser(null);
        setUserName('');
        setCompanies([]);
        setSelectedCompanyIdInternal('');
        setUserRole(null);
        setRolesByCompany({});
        return;
      }

      const rolesMap = listRoles.reduce<Record<string, string>>((acc, entry) => {
        const normalizedRole = normalizeCompanyRole(entry?.role);
        if (entry?.company_id && normalizedRole) acc[entry.company_id] = normalizedRole;
        return acc;
      }, {});
      const companyIds = list.map((c) => c.company_id);
      const firstRole = Object.values(rolesMap)[0] || 'COMPANY_ADMIN';

      // Resolve display name from API response or Supabase user
      let resolvedName = listData?.userName || '';
      if (!resolvedName) {
        try {
          const { data: { user } } = await getSupabaseBrowser().auth.getUser();
          resolvedName = user?.user_metadata?.full_name || user?.email?.split('@')[0] || 'User';
        } catch { resolvedName = 'User'; }
      }
      setUserName(resolvedName);

      const nextUser: UserContext = {
        userId: listData?.userId || fbToken, // prefer DB id if returned by API
        role: firstRole === 'SUPER_ADMIN' || firstRole === 'COMPANY_ADMIN' ? 'admin' : 'user',
        companyIds,
        defaultCompanyId: companyIds[0] || '',
      };

      setUser(nextUser);
      setCompanies(list);
      setRolesByCompany(rolesMap);

      const stored = resolveStoredCompanyId();
      const resolvedId = stored && list.some((c) => c.company_id === stored) ? stored : companyIds[0] || '';
      setUserRole(rolesMap[resolvedId] || firstRole);
      if (resolvedId) {
        setSelectedCompanyIdInternal(resolvedId);
        if (typeof window !== 'undefined') {
          window.localStorage.setItem('selected_company_id', resolvedId);
          window.localStorage.setItem('company_id', resolvedId);
        }
      }
    } catch {
      console.warn('Failed to load company context');
    } finally {
      setIsLoading(false);
    }
  };

  const loadContentArchitectContext = async () => {
    try {
      const res = await fetch('/api/company-profile?mode=list', { credentials: 'include' });
      if (!res.ok) return false;
      const data = await res.json();
      const list = data?.companies || [];
      if (list.length === 0) return false;
      type RoleEntry = { company_id: string; role: string };
      const roles = ((data?.rolesByCompany || []) as RoleEntry[]).reduce<Record<string, string>>(
        (acc, entry) => {
          if (entry?.company_id) acc[entry.company_id] = entry.role || 'CONTENT_ARCHITECT';
          return acc;
        },
        {}
      );
      list.forEach((c: CompanyOption) => {
        if (!roles[c.company_id]) roles[c.company_id] = 'CONTENT_ARCHITECT';
      });
      const companyIds = list.map((c: CompanyOption) => c.company_id);
      const firstRole = Object.values(roles)[0] || 'CONTENT_ARCHITECT';
      const isSuperAdmin = firstRole === 'SUPER_ADMIN';
      setUser({
        userId: isSuperAdmin ? 'legacy_super_admin' : 'content_architect',
        role: 'admin',
        companyIds,
        defaultCompanyId: companyIds[0] || '',
      });
      setUserName(isSuperAdmin ? 'Super Admin' : 'Content Architect');
      setCompanies(list);
      setRolesByCompany(roles);
      setUserRole(isSuperAdmin ? 'SUPER_ADMIN' : 'CONTENT_ARCHITECT');
      const stored = resolveStoredCompanyId();
      const fallbackId = companyIds[0] || '';
      const resolvedId = stored && companyIds.includes(stored) ? stored : fallbackId;
      if (resolvedId) {
        setSelectedCompanyIdInternal(resolvedId);
        if (typeof window !== 'undefined') {
          window.localStorage.setItem('selected_company_id', resolvedId);
          window.localStorage.setItem('company_id', resolvedId);
        }
      }
      return true;
    } catch {
      return false;
    }
  };

  useEffect(() => {
    const supabase = getSupabaseBrowser();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (session) {
        // On INITIAL_SESSION (page load with existing cookie-session) we
        // validate against the backend so ghost / soft-deleted sessions are
        // caught early.  For SIGNED_IN (magic-link, password login) we skip
        // the probe because the callback page hasn't had a chance to call
        // sync-supabase-user yet — probing would race and 401.
        // TOKEN_REFRESHED is also safe to skip.
        if (event === 'INITIAL_SESSION') {
          try {
            const probe = await fetch('/api/auth/post-login-route', {
              headers: { Authorization: `Bearer ${session.access_token}` },
            });
            if (probe.status === 401) {
              await supabase.auth.signOut();
              setIsAuthenticated(false);
              setAuthChecked(true);
              return;
            }
          } catch {
            // Network error: optimistically allow; refreshCompanies catches 401 later.
          }
        }
        setIsAuthenticated(true);
        setAuthChecked(true);
        return;
      }
      // No session — check for content-architect cookie session
      const asArchitect = await loadContentArchitectContext();
      setIsAuthenticated(asArchitect);
      setAuthChecked(true);
    });

    return () => { subscription.unsubscribe(); };
  }, []);

  useEffect(() => {
    if (!authChecked) return;
    if (!isAuthenticated) {
      setIsLoading(false);
      setUser(null);
      setUserName('');
      setCompanies([]);
      setSelectedCompanyIdInternal('');
      setUserRole(null);
      setRolesByCompany({});
      return;
    }
    // Don't fetch company data while on auth/onboarding pages.
    // The callback page needs to finish sync-supabase-user before the
    // company-profile API can find the user.  Fetching prematurely
    // returns 401 → clears company data → stale context on /dashboard.
    // Instead, delay until the user navigates to a real protected page
    // (like /dashboard) — at which point the DB row and company exist.
    const p = router.pathname;
    const isAuthFlowPage =
      p.startsWith('/auth/') ||
      p.startsWith('/onboarding/') ||
      p === '/login' ||
      p === '/signup' ||
      p === '/create-account';
    if (isAuthFlowPage) {
      setIsLoading(false);
      return;
    }
    refreshCompanies();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated, authChecked, router.pathname]);

  const value = useMemo(
    () => ({
      user,
      userName,
      userRole,
      companies,
      selectedCompanyId,
      selectedCompanyName,
      isLoading,
      isAuthenticated,
      authChecked,
      isAdmin: userRole === 'SUPER_ADMIN' || userRole === 'COMPANY_ADMIN',
      setSelectedCompanyId,
      refreshCompanies,
      hasPermission: (action: PermissionAction) => hasPermissionForRole(userRole, action),
    }),
    [user, userName, userRole, companies, selectedCompanyId, selectedCompanyName, isLoading, isAuthenticated, authChecked]
  );

  return <CompanyContext.Provider value={value}>{children}</CompanyContext.Provider>;
};

export const useCompanyContext = (): CompanyContextValue => {
  const context = useContext(CompanyContext);
  if (!context) {
    throw new Error('useCompanyContext must be used within CompanyProvider');
  }
  return context;
};
