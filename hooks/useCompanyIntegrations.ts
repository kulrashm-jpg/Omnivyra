/**
 * Hook for fetching company-connected social platforms.
 * Used by Engagement Command Center to show only configured platform tabs.
 */

import { useState, useEffect, useCallback } from 'react';

const PLATFORM_LABELS: Record<string, string> = {
  linkedin: 'LinkedIn',
  twitter: 'X',
  x: 'X',
  instagram: 'Instagram',
  facebook: 'Facebook',
  youtube: 'YouTube',
  reddit: 'Reddit',
};

export type CompanyIntegration = {
  platform: string;
  label: string;
};

export function useCompanyIntegrations(organizationId: string): {
  platforms: CompanyIntegration[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
} {
  const [platforms, setPlatforms] = useState<CompanyIntegration[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchIntegrations = useCallback(async () => {
    if (!organizationId?.trim()) {
      setPlatforms([]);
      setLoading(false);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);

    const params = new URLSearchParams({
      organization_id: organizationId,
      organizationId: organizationId,
    });

    try {
      const res = await fetch(`/api/engagement/integrations?${params.toString()}`, {
        credentials: 'include',
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(body.error || body.message || 'Failed to fetch integrations');
      }
      const list = Array.isArray(body.platforms) ? body.platforms : [];
      setPlatforms(
        list.map((p: string) => ({
          platform: (p || '').toLowerCase().trim(),
          label: PLATFORM_LABELS[(p || '').toLowerCase().trim()] || p || 'Unknown',
        }))
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch integrations');
      setPlatforms([]);
    } finally {
      setLoading(false);
    }
  }, [organizationId]);

  useEffect(() => {
    fetchIntegrations();
  }, [fetchIntegrations]);

  return { platforms, loading, error, refresh: fetchIntegrations };
}
