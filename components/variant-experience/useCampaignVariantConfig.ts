/**
 * useCampaignVariantConfig
 *
 * Load + save round-trip for the campaign-level variant strategy
 * persisted under `campaign_snapshot.execution_config.variant_strategy`.
 *
 * Uses the existing `/api/campaigns` GET endpoint for loading and
 * `/api/campaigns` POST for upserting. NO new endpoint. NO new
 * storage. NO schema migration.
 */

import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../../lib/apiFetch';
import {
  applyVariantConfigToExecutionConfig,
  readVariantConfigFromAnyCampaignShape,
} from '../../lib/variants/campaignVariantConfig';
import type { CampaignVariantPersistedConfig } from './CampaignVariantModeField';

export type UseCampaignVariantConfigState = {
  loading: boolean;
  saving: boolean;
  error: string | null;
  /** Persisted config (null when the campaign has none). */
  config: CampaignVariantPersistedConfig | null;
  /** Raw campaign data echoed back by GET — used to thread the
   *  existing execution_config through on save without trampling
   *  other fields. */
  campaignSnapshot: Record<string, unknown> | null;
};

export function useCampaignVariantConfig(input: {
  companyId: string;
  campaignId: string;
  refreshKey?: number;
}): UseCampaignVariantConfigState & {
  refetch: () => void;
  save: (config: CampaignVariantPersistedConfig | null) => Promise<CampaignVariantPersistedConfig | null>;
} {
  const [state, setState] = useState<UseCampaignVariantConfigState>({
    loading: false,
    saving: false,
    error: null,
    config: null,
    campaignSnapshot: null,
  });
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      if (!input.companyId || !input.campaignId) return;
      setState((s) => ({ ...s, loading: true, error: null }));
      try {
        const params = new URLSearchParams({
          companyId: input.companyId,
          type: 'campaign',
          campaignId: input.campaignId,
        });
        const response = await apiFetch(`/api/campaigns?${params.toString()}`);
        const payload = await response.json().catch(() => null);
        if (cancelled) return;
        if (!response.ok || !payload) {
          setState((s) => ({
            ...s,
            loading: false,
            // Never surface raw API/validation text to customers.
            error: "We couldn't load this campaign's configuration. Refresh to try again.",
            config: null,
            campaignSnapshot: null,
          }));
          return;
        }
        const config = readVariantConfigFromAnyCampaignShape(payload);
        setState({
          loading: false,
          saving: false,
          error: null,
          config,
          campaignSnapshot: payload as Record<string, unknown>,
        });
      } catch {
        if (cancelled) return;
        setState({
          loading: false,
          saving: false,
          error: "We couldn't load this campaign's configuration. Refresh to try again.",
          config: null,
          campaignSnapshot: null,
        });
      }
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [input.companyId, input.campaignId, input.refreshKey, tick]);

  const save = useCallback(
    async (next: CampaignVariantPersistedConfig | null): Promise<CampaignVariantPersistedConfig | null> => {
      if (!input.companyId || !input.campaignId) return null;
      setState((s) => ({ ...s, saving: true, error: null }));
      try {
        // Re-thread existing execution_config so we don't trample
        // other keys (e.g. tentative_start, key_messages).
        const snapshot = state.campaignSnapshot ?? {};
        const existingEc =
          (snapshot.campaign_snapshot && typeof snapshot.campaign_snapshot === 'object'
            ? (snapshot.campaign_snapshot as Record<string, unknown>).execution_config
            : null)
          ?? snapshot.execution_config
          ?? null;
        const mergedEc = applyVariantConfigToExecutionConfig(
          (existingEc && typeof existingEc === 'object' && !Array.isArray(existingEc)
            ? existingEc as Record<string, unknown>
            : null),
          next,
        );
        const campaignRow = (snapshot.campaign && typeof snapshot.campaign === 'object'
          ? (snapshot.campaign as Record<string, unknown>)
          : (typeof snapshot.id === 'string' ? snapshot : null)) as Record<string, unknown> | null;
        const name = (campaignRow && typeof campaignRow.name === 'string' ? campaignRow.name : 'Variant configuration update');
        const description = (campaignRow && typeof campaignRow.description === 'string' ? campaignRow.description : '');
        const startDate = campaignRow && typeof campaignRow.start_date === 'string' ? campaignRow.start_date : undefined;
        const endDate = campaignRow && typeof campaignRow.end_date === 'string' ? campaignRow.end_date : undefined;
        const upsertBody: Record<string, unknown> = {
          id: input.campaignId,
          name,
          description,
          startDate,
          endDate,
          execution_config: mergedEc,
        };
        const response = await apiFetch('/api/campaigns', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(upsertBody),
        });
        const payload = await response.json().catch(() => null);
        if (!response.ok || !payload) {
          setState((s) => ({
            ...s,
            saving: false,
            error: "We couldn't save your changes. Please try again.",
          }));
          return null;
        }
        // Refresh from server so the snapshot stays canonical.
        setTick((t) => t + 1);
        setState((s) => ({ ...s, saving: false, config: next ?? null, error: null }));
        return next ?? null;
      } catch {
        setState((s) => ({
          ...s,
          saving: false,
          error: "We couldn't save your changes. Please try again.",
        }));
        return null;
      }
    },
    [input.companyId, input.campaignId, state.campaignSnapshot],
  );

  return {
    ...state,
    refetch: useCallback(() => setTick((t) => t + 1), []),
    save,
  };
}
