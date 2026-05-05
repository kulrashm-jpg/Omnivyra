import { useMemo } from 'react';
import { useCompanyContext } from '../../components/CompanyContext';

export function useOrganization() {
  const context = useCompanyContext();
  const organization_id = context.selectedCompanyId || '';

  const canManageOrganization = useMemo(
    () =>
      context.userRole === 'SUPER_ADMIN' ||
      context.userRole === 'ADMIN' ||
      context.userRole === 'COMPANY_ADMIN',
    [context.userRole],
  );

  return {
    ...context,
    organization_id,
    organizationName: context.selectedCompanyName,
    canManageOrganization,
  };
}
