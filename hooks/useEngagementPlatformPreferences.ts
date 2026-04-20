import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiFetch } from '@/lib/apiFetch';
import { normalizePlatform } from '@/utils/platformIcons';

type PlatformPreference = {
  platform: string;
  enabled: boolean;
};

export function useEngagementPlatformPreferences(organizationId: string) {
  const [preferences, setPreferences] = useState<PlatformPreference[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [updatingPlatform, setUpdatingPlatform] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!organizationId?.trim()) {
      setPreferences([]);
      setLoading(false);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);

    const params = new URLSearchParams({
      organization_id: organizationId,
      organizationId,
    });

    try {
      const response = await apiFetch(`/api/engagement/platform-preferences?${params.toString()}`);
      const body = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(body.error || body.message || 'Failed to fetch platform preferences');
      }

      const nextPreferences = Array.isArray(body.preferences) ? body.preferences : [];
      setPreferences(
        nextPreferences
          .map((preference: PlatformPreference) => ({
            platform: normalizePlatform(preference.platform),
            enabled: preference.enabled !== false,
          }))
          .filter((preference: PlatformPreference) => Boolean(preference.platform))
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch platform preferences');
      setPreferences([]);
    } finally {
      setLoading(false);
    }
  }, [organizationId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const setPlatformEnabled = useCallback(
    async (platform: string, enabled: boolean) => {
      const normalizedPlatform = normalizePlatform(platform);
      setUpdatingPlatform(normalizedPlatform);

      try {
        const response = await apiFetch('/api/engagement/platform-preferences', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            organization_id: organizationId,
            platform: normalizedPlatform,
            enabled,
          }),
        });
        const body = await response.json().catch(() => ({}));

        if (!response.ok) {
          throw new Error(body.error || body.message || 'Failed to update platform preference');
        }

        setPreferences((current) => {
          const remaining = current.filter((preference) => preference.platform !== normalizedPlatform);
          return [...remaining, { platform: normalizedPlatform, enabled }].sort((a, b) =>
            a.platform.localeCompare(b.platform)
          );
        });
      } finally {
        setUpdatingPlatform(null);
      }
    },
    [organizationId]
  );

  const preferenceMap = useMemo(() => {
    return preferences.reduce<Record<string, boolean>>((accumulator, preference) => {
      accumulator[preference.platform] = preference.enabled;
      return accumulator;
    }, {});
  }, [preferences]);

  return {
    preferences,
    preferenceMap,
    loading,
    error,
    refresh,
    updatingPlatform,
    setPlatformEnabled,
  };
}
