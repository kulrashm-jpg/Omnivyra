import { useMemo } from 'react';
import { useRouter } from 'next/router';
import { useCompanyContext } from '@/components/CompanyContext';
import { useIntegrations } from '@/features/integrations/hooks/useIntegrations';
import type { FocusArea } from '@/features/integrations/types';
import IntegrationsView from '@/features/integrations/view/IntegrationsView';

export default function IntegrationsContainer() {
  const { selectedCompanyId, userRole } = useCompanyContext();
  const router = useRouter();
  const { state, actions } = useIntegrations();

  const companyId = selectedCompanyId || '';
  const isAdmin = ['SUPER_ADMIN', 'COMPANY_ADMIN'].includes((userRole || '').toUpperCase());
  const focusParam = typeof router.query.focus === 'string' ? router.query.focus : '';
  const focus: FocusArea = focusParam === 'data' ? 'data' : 'website';

  const highlightedIds = useMemo(() => {
    if (focus === 'website') return new Set(['website-publishing', 'lead-capture-forms']);
    if (focus === 'data') return new Set(['crm-pipeline', 'google-analytics', 'files-imports']);
    return new Set<string>();
  }, [focus]);

  return (
    <IntegrationsView
      state={state}
      actions={actions}
      companyId={companyId}
      isAdmin={isAdmin}
      focus={focus}
      highlightedIds={highlightedIds}
    />
  );
}
