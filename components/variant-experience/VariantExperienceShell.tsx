/**
 * VariantExperienceShell (P2-1).
 *
 * Thin app-layout-level wrapper that resolves the active company
 * from CompanyContext and mounts the existing
 * `VariantExperienceProvider`. All authenticated routes that include
 * `<AppLayout>` get shared analytics + operator-controls fetches
 * automatically.
 *
 * When no company is selected (auth still resolving, multi-org
 * picker open), the provider mounts with an empty `companyId`. The
 * underlying `useStrategyAnalyticsDirect` / `useOperatorControlsDirect`
 * hooks short-circuit on empty companyId — no fetch fires until a
 * company is selected.
 *
 * No new caching, no new state machine — this is purely the
 * existing context provider mounted at the right scope.
 */

import React from 'react';
import { useCompanyContext } from '../CompanyContext';
import { VariantExperienceProvider } from './VariantContexts';

export const VariantExperienceShell: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { selectedCompanyId } = useCompanyContext();
  return (
    <VariantExperienceProvider companyId={selectedCompanyId ?? ''}>
      {children}
    </VariantExperienceProvider>
  );
};
