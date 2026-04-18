import React from 'react';
import { CheckCircle, FileText, Save } from 'lucide-react';

type PlanActionBarProps = {
  hasPlanActions: boolean;
  hasViewedPlan: boolean;
  isBusy: boolean;
  governanceLocked?: boolean;
  structuredPlan: unknown | null;
  lastPlanMessage?: { id: number; message: string } | null;
  structuredPlanMessageId?: number | null;
  hasGeneratedPlanInSession: boolean;
  onViewPlan: (message?: string, messageId?: number) => void;
  onCommitPlan: (message?: string) => void;
  onSaveForLater: (message: string, structuredPlan?: unknown) => void;
};

export function PlanActionBar({
  hasPlanActions,
  hasViewedPlan,
  isBusy,
  governanceLocked,
  structuredPlan,
  lastPlanMessage,
  structuredPlanMessageId,
  onViewPlan,
  onCommitPlan,
  onSaveForLater,
}: PlanActionBarProps) {
  if (!hasPlanActions) return null;

  return (
    <>
      <span className="hidden sm:inline text-gray-300 mx-1">|</span>
      <button
        onClick={() => onViewPlan(lastPlanMessage?.message, lastPlanMessage?.id ?? structuredPlanMessageId ?? undefined)}
        disabled={isBusy}
        className="flex items-center gap-1.5 px-2.5 py-1.5 bg-purple-100 text-purple-700 rounded-lg hover:bg-purple-200 text-sm font-medium transition-colors disabled:opacity-50"
        title="View plan first"
      >
        <FileText className="h-3.5 w-3.5" />
        View Plan
      </button>
      <button
        onClick={() => onCommitPlan(structuredPlan ? undefined : lastPlanMessage?.message)}
        disabled={isBusy || governanceLocked || (!structuredPlan && !hasViewedPlan)}
        className="flex items-center gap-1.5 px-2.5 py-1.5 bg-blue-100 text-blue-700 rounded-lg hover:bg-blue-200 text-sm font-medium transition-colors disabled:opacity-50"
        title={hasViewedPlan ? 'Submit to create campaign structure' : 'View plan first'}
      >
        <CheckCircle className="h-3.5 w-3.5" />
        Submit Plan
      </button>
      <button
        onClick={() => onSaveForLater(lastPlanMessage?.message ?? '', structuredPlan ?? undefined)}
        disabled={isBusy || !structuredPlan}
        className="flex items-center gap-1.5 px-2.5 py-1.5 bg-green-100 text-green-700 rounded-lg hover:bg-green-200 text-sm font-medium transition-colors disabled:opacity-50"
        title="Save chat for campaign planning (draft/edit)"
      >
        <Save className="h-3.5 w-3.5" />
        Save for Later
      </button>
    </>
  );
}
