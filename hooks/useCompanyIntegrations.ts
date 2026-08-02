/**
 * Hook for fetching company-connected social platforms.
 * Used by Engagement Command Center to show only configured platform tabs.
 *
 * OPT-005 Phase 1: backed by SWR — shared cache entry per org (this data
 * changes only on connect/disconnect; TTL-bounded staleness accepted, same
 * as the OPT-002 assessment). Public signature unchanged; error → [] parity
 * with the previous hand-rolled hook.
 */

import { useCallback } from 'react';
import useSWR from 'swr';
import { ApiFetchError } from '@/lib/swr/swrClient';

const PLATFORM_LABELS: Record<string, string> = {
  linkedin: 'LinkedIn',
  twitter: 'X',
  x: 'X',
  instagram: 'Instagram',
  facebook: 'Facebook',
  youtube: 'YouTube',
  reddit: 'Reddit',
  pinterest: 'Pinterest',
  tiktok: 'TikTok',
  threads: 'Threads',
  whatsapp: 'WhatsApp',
  github: 'GitHub',
  hackernews: 'Hacker News',
  discord: 'Discord',
  devto: 'Dev.to',
  medium: 'Medium',
  stackoverflow: 'Stack Overflow',
  quora: 'Quora',
};

export type CompanyIntegration = {
  platform: string;
  label: string;
};

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiFetchError && error.message) return error.message;
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

export function useCompanyIntegrations(organizationId: string): {
  platforms: CompanyIntegration[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
} {
  const key = organizationId?.trim()
    ? `/api/engagement/integrations?${new URLSearchParams({
        organization_id: organizationId,
        organizationId: organizationId,
      }).toString()}`
    : null;

  const { data, error, isValidating, mutate } = useSWR<{ platforms?: string[] }>(key);

  const refresh = useCallback(async () => {
    await mutate();
  }, [mutate]);

  const list = !error && Array.isArray(data?.platforms) ? data.platforms : [];
  const platforms: CompanyIntegration[] = list.map((p: string) => ({
    platform: (p || '').toLowerCase().trim(),
    label: PLATFORM_LABELS[(p || '').toLowerCase().trim()] || p || 'Unknown',
  }));

  return {
    platforms,
    loading: isValidating,
    error: error ? errorMessage(error, 'Failed to fetch integrations') : null,
    refresh,
  };
}
