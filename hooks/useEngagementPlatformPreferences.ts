/**
 * OPT-005 Phase 2B: SWR facade. The PATCH keeps its post-write local update,
 * now written through the shared cache entry via
 * mutate(updater, { revalidate: false }) so every mounted consumer sees it.
 * `loading` maps to isValidating — the previous implementation flipped
 * loading on every fetch INCLUDING refresh(), unlike the inbox/messages
 * hooks. Public signature unchanged.
 */
import { useCallback, useMemo } from 'react';
import useSWR from 'swr';
import { apiFetch } from '@/lib/apiFetch';
import { normalizePlatform } from '@/utils/platformIcons';
import { useState } from 'react';

type PlatformPreference = {
  platform: string;
  enabled: boolean;
};

export function useEngagementPlatformPreferences(organizationId: string) {
  const [updatingPlatform, setUpdatingPlatform] = useState<string | null>(null);

  const key = organizationId?.trim()
    ? `/api/engagement/platform-preferences?${new URLSearchParams({
        organization_id: organizationId,
        organizationId,
      }).toString()}`
    : null;

  const { data, error: swrError, isValidating, mutate } = useSWR<{ preferences?: PlatformPreference[] }>(key);

  const refresh = useCallback(async () => {
    await mutate();
  }, [mutate]);

  const preferences: PlatformPreference[] = useMemo(() => {
    if (swrError) return []; // parity: fetch failure blanks preferences
    const raw = Array.isArray(data?.preferences) ? data.preferences : [];
    return raw
      .map((preference: PlatformPreference) => ({
        platform: normalizePlatform(preference.platform),
        enabled: preference.enabled !== false,
      }))
      .filter((preference: PlatformPreference) => Boolean(preference.platform));
  }, [data, swrError]);

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

        // Same post-PATCH local update as before, written into the shared
        // cache entry (revalidate:false — the server was just told).
        await mutate(
          (current) => {
            const raw = Array.isArray(current?.preferences) ? current.preferences : [];
            const remaining = raw.filter(
              (preference) => normalizePlatform(preference.platform) !== normalizedPlatform
            );
            return {
              preferences: [...remaining, { platform: normalizedPlatform, enabled }].sort((a, b) =>
                a.platform.localeCompare(b.platform)
              ),
            };
          },
          { revalidate: false }
        );
      } finally {
        setUpdatingPlatform(null);
      }
    },
    [organizationId, mutate]
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
    loading: isValidating,
    error: swrError
      ? swrError instanceof Error
        ? swrError.message
        : 'Failed to fetch platform preferences'
      : null,
    refresh,
    updatingPlatform,
    setPlatformEnabled,
  };
}
