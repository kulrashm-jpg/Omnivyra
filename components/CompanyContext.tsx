import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';

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

type CompanyContextValue = {
  user: UserContext | null;
  companies: CompanyOption[];
  selectedCompanyId: string;
  selectedCompanyName: string;
  isLoading: boolean;
  setSelectedCompanyId: (companyId: string) => void;
  refreshCompanies: () => Promise<void>;
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
  const [companies, setCompanies] = useState<CompanyOption[]>([]);
  const [selectedCompanyId, setSelectedCompanyIdInternal] = useState<string>('');
  const [isLoading, setIsLoading] = useState(true);

  const selectedCompanyName = useMemo(() => {
    const match = companies.find((company) => company.company_id === selectedCompanyId);
    return match?.name || '';
  }, [companies, selectedCompanyId]);

  const setSelectedCompanyId = (companyId: string) => {
    setSelectedCompanyIdInternal(companyId);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('selected_company_id', companyId);
      window.localStorage.setItem('company_id', companyId);
    }
    const match = companies.find((company) => company.company_id === companyId);
    console.log('SELECTED_COMPANY', { companyId, companyName: match?.name || '' });
  };

  const refreshCompanies = async () => {
    setIsLoading(true);
    try {
      const response = await fetch('/api/company-profile?mode=list');
      if (!response.ok) {
        throw new Error('Failed to load companies');
      }
      const data = await response.json();
      const nextUser = data?.user || null;
      const nextCompanies: CompanyOption[] = data?.companies || [];
      setUser(nextUser);
      setCompanies(nextCompanies);

      const stored = resolveStoredCompanyId();
      const fallbackId = nextUser?.defaultCompanyId || nextCompanies[0]?.company_id || '';
      let resolvedId = stored && nextCompanies.some((c) => c.company_id === stored) ? stored : fallbackId;
      if (nextUser?.role === 'user' && nextUser.defaultCompanyId) {
        resolvedId = nextUser.defaultCompanyId;
      }
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
    } catch (error) {
      console.warn('Failed to load company context');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    refreshCompanies();
  }, []);

  const value = useMemo(
    () => ({
      user,
      companies,
      selectedCompanyId,
      selectedCompanyName,
      isLoading,
      setSelectedCompanyId,
      refreshCompanies,
    }),
    [user, companies, selectedCompanyId, selectedCompanyName, isLoading]
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
