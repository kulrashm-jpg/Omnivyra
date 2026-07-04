/**
 * CampaignVariantConfigPanel
 *
 * Wraps `<CampaignVariantModeField>` with live load + save round-trip
 * against the existing `/api/campaigns` endpoint. Drop into any
 * campaign-edit surface — wizard step, campaign settings page,
 * campaign list row — and operators can adjust + persist a campaign's
 * variant mode without leaving the page.
 *
 * No new endpoint. No new storage.
 */

import React, { useEffect, useState } from 'react';
import { CampaignVariantModeField, type CampaignVariantPersistedConfig } from './CampaignVariantModeField';
import { useCampaignVariantConfig } from './useCampaignVariantConfig';
import { CampaignVariantBillingEstimate } from './CampaignVariantBillingEstimate';
import type { VariantModeOption } from './VariantModeSelector';

type Props = {
  companyId: string;
  campaignId: string;
  /** Fallback strategy id when the campaign has no variant config yet
   *  (e.g. a freshly created campaign). The operator can still adjust
   *  the mode; persistence pins this id. */
  defaultStrategyId: string;
  className?: string;
};

export const CampaignVariantConfigPanel: React.FC<Props> = ({
  companyId,
  campaignId,
  defaultStrategyId,
  className,
}) => {
  const persisted = useCampaignVariantConfig({ companyId, campaignId });
  // Working copy of the form so unsaved edits don't clobber the
  // persisted reference until the operator clicks Save.
  const [draftMode, setDraftMode] = useState<VariantModeOption>('v1');
  const [draftStrategy, setDraftStrategy] = useState<string>(defaultStrategyId);
  const [dirty, setDirty] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  // Reset draft when persisted config arrives.
  useEffect(() => {
    if (persisted.loading) return;
    if (persisted.config) {
      // P2-4 backward-compat — legacy persisted 'default' translates
      // to 'v1' so the panel renders the canonical baseline option.
      const next = persisted.config.variant_mode === ('default' as any)
        ? 'v1' as VariantModeOption
        : persisted.config.variant_mode;
      setDraftMode(next);
      setDraftStrategy(persisted.config.strategy_id);
    } else {
      setDraftMode('v1');
      setDraftStrategy(defaultStrategyId);
    }
    setDirty(false);
  }, [persisted.loading, persisted.config, defaultStrategyId]);

  const containerClass = className
    ?? 'rounded-xl border border-gray-200 bg-white p-4 shadow-sm';

  const handleChange = (next: CampaignVariantPersistedConfig) => {
    setDraftMode(next.variant_mode);
    setDraftStrategy(next.strategy_id);
    setDirty(true);
    setStatusMessage(null);
  };

  const handleSave = async () => {
    setStatusMessage(null);
    const saved = await persisted.save({
      strategy_id: draftStrategy,
      variant_mode: draftMode,
    });
    setStatusMessage(saved ? 'Saved.' : 'Save failed — see error below.');
    setDirty(false);
  };

  const handleClear = async () => {
    setStatusMessage(null);
    await persisted.save(null);
    setStatusMessage('Variant config cleared.');
    setDirty(false);
  };

  if (persisted.loading && !persisted.config) {
    return (
      <div className={containerClass}>
        <p className="text-sm text-gray-500">Loading campaign variant config…</p>
      </div>
    );
  }

  return (
    <div className={containerClass}>
      <CampaignVariantModeField
        companyId={companyId}
        strategyId={draftStrategy}
        value={draftMode}
        onChange={handleChange}
        disabled={persisted.saving}
      />
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={handleSave}
          disabled={!dirty || persisted.saving}
          className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-indigo-500 disabled:opacity-50"
        >
          {persisted.saving ? 'Saving…' : 'Save variant config'}
        </button>
        {persisted.config ? (
          <button
            type="button"
            onClick={handleClear}
            disabled={persisted.saving}
            className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 transition hover:bg-gray-50 disabled:opacity-50"
          >
            Clear
          </button>
        ) : null}
        {statusMessage ? (
          <span className="text-xs text-gray-600">{statusMessage}</span>
        ) : null}
      </div>
      {persisted.error ? (
        <p className="mt-2 text-xs text-rose-700">{persisted.error}</p>
      ) : null}
      <p className="mt-2 text-[11px] text-gray-500">
        Saved with this campaign and applied automatically the next time it runs.
      </p>
      {/* Fan-Out Completion — Phase 4 + 5. Pre-execution billing
          estimate. Refreshes whenever the persisted config changes
          (the underlying hook re-fetches on persisted.config flips). */}
      {persisted.config ? (
        <div className="mt-4">
          <CampaignVariantBillingEstimate
            companyId={companyId}
            campaignId={campaignId}
          />
        </div>
      ) : null}
    </div>
  );
};
