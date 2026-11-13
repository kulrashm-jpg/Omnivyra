/**
 * F3 (owner ruling 2026-11-13): campaign CREATION screens are for roles that may write
 * campaigns. Viewers, view-only users and Engagers get the standard AccessRestricted page
 * instead (the server answers their writes with 403 ROLE_FORBIDDEN anyway). Wrapping the
 * page means the creation hooks never run for them, so nothing is fetched or generated.
 */
import React from 'react';
import { useCompanyContext } from '../CompanyContext';
import PageLoader from '../PageLoader';
import AccessRestricted from './AccessRestricted';
import { canWriteCampaign } from '../../lib/access/campaignWriteAccess';

export default function CampaignWriteGate({ area = 'campaign creation', children }: { area?: string; children: React.ReactNode }) {
  const { authChecked, isLoading, companiesResolved, userRole } = useCompanyContext();
  if (!authChecked || isLoading || !companiesResolved) return <PageLoader message="Loading…" />;
  if (!canWriteCampaign(userRole)) return <AccessRestricted area={area} />;
  return <>{children}</>;
}
