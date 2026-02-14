import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { supabase } from '../utils/supabaseClient';

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
    if (userRole && userRole !== 'SUPER_ADMIN' && !isAllowedCompany) {
      return;
    }
    setSelectedCompanyIdInternal(companyId);
    setUserRole(rolesByCompany[companyId] || null);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('selected_company_id', companyId);
      window.localStorage.setItem('company_id', companyId);
      window.localStorage.removeItem('selected_campaign_id');
    }
    const match = companies.find((company) => company.company_id === companyId);
    console.log('SELECTED_COMPANY', { companyId, companyName: match?.name || '' });
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
      const { data: sessionData } = await supabase.auth.getSession();
      const supabaseUser = sessionData.session?.user;
      if (!supabaseUser) {
        setUser(null);
        setUserName('');
        setCompanies([]);
        setSelectedCompanyIdInternal('');
        setUserRole(null);
        setRolesByCompany({});
        return;
      }
      const resolvedName =
        (supabaseUser.user_metadata?.name as string | undefined) ||
        supabaseUser.email ||
        'User';
      setUserName(resolvedName);

      const { data: invitedRows, error: invitedError } = await supabase
        .from('user_company_roles')
        .select('company_id')
        .eq('user_id', supabaseUser.id)
        .eq('status', 'invited');
      if (invitedError) {
        console.warn('Failed to load invite status', invitedError.message);
      }
      if (invitedRows && invitedRows.length > 0) {
        await supabase
          .from('user_company_roles')
          .update({
            status: 'active',
            accepted_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('user_id', supabaseUser.id)
          .eq('status', 'invited');
        await supabase.from('audit_logs').insert(
          invitedRows.map((row) => ({
            actor_user_id: supabaseUser.id,
            action: 'USER_ACCEPTED_INVITE',
            company_id: row.company_id,
            created_at: new Date().toISOString(),
          }))
        );
      }

      const { data: roleRows, error: roleError } = await supabase
        .from('user_company_roles')
        .select('company_id, role, status')
        .eq('user_id', supabaseUser.id);
      if (roleError) {
        console.warn('Failed to load roles for user', roleError.message);
      }
      if (!roleRows || roleRows.length === 0) {
        console.warn('No role assigned yet');
        setUserRole(null);
        setCompanies([]);
        setIsLoading(false);
        return;
      }

      const roles = (roleRows || []).filter((row) => row.status === 'active');
      if (roles.length === 0) {
        setUserRole(null);
        setCompanies([]);
        setIsLoading(false);
        return;
      }
      const rolesMap = roles.reduce<Record<string, string>>((acc, entry) => {
        const normalizedRole = normalizeCompanyRole(entry?.role);
        if (entry?.company_id && normalizedRole) {
          acc[entry.company_id] = normalizedRole;
        }
        return acc;
      }, {});

      const companyIds = Array.from(new Set(roles.map((row) => row.company_id))).filter(Boolean);
      let nextCompanies: CompanyOption[] = [];
      if (companyIds.length > 0) {
        const { data: profiles, error: profileError } = await supabase
          .from('company_profiles')
          .select('company_id, name')
          .in('company_id', companyIds);
        if (profileError) {
          console.warn('Failed to load company profiles', profileError.message);
        }
        nextCompanies = (profiles || []).map((profile) => ({
          company_id: profile.company_id,
          name: profile.name || 'Unnamed company',
        }));

        if (nextCompanies.length === 0) {
          nextCompanies = companyIds.map((companyId) => ({
            company_id: companyId,
            name: 'Unnamed company',
          }));
        }
      }

      const nextUser: UserContext = {
        userId: supabaseUser.id,
        role: Object.values(rolesMap).some((role) => role === 'SUPER_ADMIN' || role === 'COMPANY_ADMIN')
          ? 'admin'
          : 'user',
        companyIds: companyIds as string[],
        defaultCompanyId: (companyIds[0] || '') as string,
      };

      setUser(nextUser);
      setCompanies(nextCompanies);
      setRolesByCompany(rolesMap);

      const stored = resolveStoredCompanyId();
      const fallbackId = nextUser.defaultCompanyId || nextCompanies[0]?.company_id || '';
      const resolvedId = stored && nextCompanies.some((c) => c.company_id === stored) ? stored : fallbackId;
      if (resolvedId && resolvedId !== selectedCompanyId) {
        setSelectedCompanyIdInternal(resolvedId);
        if (typeof window !== 'undefined') {
          window.localStorage.setItem('selected_company_id', resolvedId);
          window.localStorage.setItem('company_id', resolvedId);
        }
        const match = nextCompanies.find((company) => company.company_id === resolvedId);
        console.log('SELECTED_COMPANY', {
          companyId: resolvedId,
          companyName: match?.name || '',
        });
      }
      const nextRole = rolesMap[resolvedId] || null;
      console.log('COMPANY_CONTEXT_ROLE', {
        userId: supabaseUser.id,
        companyId: resolvedId,
        role: nextRole,
      });
      setUserRole(nextRole);
    } catch (error) {
      console.warn('Failed to load company context');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    const syncSession = async () => {
      const { data } = await supabase.auth.getSession();
      setIsAuthenticated(!!data.session);
      setAuthChecked(true);
    };
    syncSession();
    const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => {
      setIsAuthenticated(!!session);
      setAuthChecked(true);
    });
    return () => {
      authListener?.subscription?.unsubscribe();
    };
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
    refreshCompanies();
  }, [isAuthenticated, authChecked]);

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
      isAdmin: userRole === 'SUPER_ADMIN' || userRole === 'COMPANY_ADMIN',
      setSelectedCompanyId,
      refreshCompanies,
      hasPermission: (action: PermissionAction) => hasPermissionForRole(userRole, action),
    }),
    [user, userName, userRole, companies, selectedCompanyId, selectedCompanyName, isLoading, isAuthenticated]
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
