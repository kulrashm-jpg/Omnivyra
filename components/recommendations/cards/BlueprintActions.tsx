import React, { useState } from 'react';
import type { BoltOutcomeView, BoltCampaignMode, BoltContentFormat } from './RecommendationBlueprintCard';
import type { ConfidenceTier } from './RecommendationBlueprintCard';

export type BlueprintActionsProps = {
  tier: ConfidenceTier;
  busy: boolean;
  isRefining: boolean;
  buildError?: string;
  fastLoading?: boolean;
  canExecuteRecommendationActions: boolean;
  onBuildCampaignBlueprint?: () => Promise<void> | void;
  onBuildCampaignFast?: (options?: { outcomeView?: BoltOutcomeView; campaignMode?: BoltCampaignMode; contentFormats?: BoltContentFormat[]; durationWeeks?: number }) => Promise<void> | void;
  onRefineRecommendation?: (recommendation: Record<string, unknown>) => Promise<void> | void;
  onMarkLongTerm?: () => Promise<void> | void;
  onArchive?: () => Promise<void> | void;
  onToggleRefine: () => void;
  onRun: (fn?: () => Promise<void> | void) => void;
  primaryButtonEmphasis: string;
  getPrimaryActionLabel: (tier: ConfidenceTier) => string;
};

export function BlueprintActions(props: BlueprintActionsProps) {
  const {
    tier, busy, isRefining, buildError, fastLoading,
    canExecuteRecommendationActions,
    onBuildCampaignBlueprint, onRefineRecommendation,
    onMarkLongTerm, onArchive,
    onToggleRefine, onRun,
    primaryButtonEmphasis, getPrimaryActionLabel,
  } = props;

  return (
    <section className="mt-4 pt-4 border-t border-gray-200">
      <h4 className="text-sm font-semibold text-gray-800 mb-2">Actions</h4>
      {buildError && (
        <p className="text-sm text-red-600 mb-2" role="alert">
          {buildError}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => onRun(onBuildCampaignBlueprint)}
          disabled={busy || !onBuildCampaignBlueprint}
          className={`px-4 py-2 text-sm rounded-lg bg-indigo-600 text-white disabled:opacity-50 ${primaryButtonEmphasis}`}
        >
          {getPrimaryActionLabel(tier)}
        </button>
        <button
          type="button"
          onClick={onToggleRefine}
          disabled={busy || !onRefineRecommendation}
          className="px-4 py-2 text-sm font-medium rounded-lg border border-indigo-200 text-indigo-700 bg-indigo-50 disabled:opacity-50"
        >
          {isRefining ? 'Close Refine' : 'Refine Card'}
        </button>
        <button
          type="button"
          onClick={() => onRun(onMarkLongTerm)}
          disabled={busy || !onMarkLongTerm || !canExecuteRecommendationActions}
          className="px-4 py-2 text-sm font-medium rounded-lg border border-gray-300 text-gray-700 disabled:opacity-50"
        >
          Mark Long-Term
        </button>
        <button
          type="button"
          onClick={() => onRun(onArchive)}
          disabled={busy || !onArchive || !canExecuteRecommendationActions}
          className="px-4 py-2 text-sm font-medium rounded-lg border border-gray-300 text-gray-600 disabled:opacity-50"
        >
          Archive
        </button>
      </div>
    </section>
  );
}
