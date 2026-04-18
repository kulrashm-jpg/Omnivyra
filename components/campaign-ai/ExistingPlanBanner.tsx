import React from 'react';

type ExistingPlanBannerProps = {
  activeTab: string;
  retrievePlanData: {
    savedPlan?: { content: string; savedAt: string };
    committedPlan?: { weeks: any[] };
    draftPlan?: { weeks: any[]; savedAt: string };
  } | null;
  isRetrievePlanLoading: boolean;
  isParsingSavedPlan: boolean;
  resolvedCompanyId: string;
  campaignId?: string;
  onLoadSavedPlanAndEdit: () => void;
  onLoadCommittedPlanAndEdit: () => void;
};

export function ExistingPlanBanner({
  activeTab,
  retrievePlanData,
  isRetrievePlanLoading,
  isParsingSavedPlan,
  resolvedCompanyId,
  campaignId,
  onLoadSavedPlanAndEdit,
  onLoadCommittedPlanAndEdit,
}: ExistingPlanBannerProps) {
  if (activeTab !== 'chat' || !(retrievePlanData?.savedPlan || retrievePlanData?.committedPlan || retrievePlanData?.draftPlan)) {
    return null;
  }

  return (
    <div className={`rounded-lg p-3 flex flex-wrap items-center gap-2 ${retrievePlanData?.committedPlan ? 'bg-emerald-50 border-2 border-emerald-300' : 'bg-indigo-50 border border-indigo-200'}`}>
      {isRetrievePlanLoading ? (
        <span className="text-sm text-indigo-700">Checking for existing plans...</span>
      ) : (
        <>
          <span className="text-sm font-medium text-indigo-900">
            {retrievePlanData?.committedPlan ? 'Your submitted plan:' : 'Existing plans:'}
          </span>
          {retrievePlanData?.savedPlan && (
            <button
              onClick={onLoadSavedPlanAndEdit}
              disabled={isParsingSavedPlan}
              className="px-3 py-1.5 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50"
            >
              {isParsingSavedPlan ? 'Loading...' : 'Load saved plan (Edit)'}
            </button>
          )}
          {retrievePlanData?.committedPlan && (
            <>
              <button
                onClick={() => {
                  const params = resolvedCompanyId ? `?companyId=${encodeURIComponent(resolvedCompanyId)}` : '';
                  window.location.href = `/campaign-details/${campaignId!}${params}`;
                }}
                className="px-3 py-1.5 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700"
              >
                View submitted plan
              </button>
              <button
                onClick={onLoadCommittedPlanAndEdit}
                className="px-3 py-1.5 bg-purple-600 text-white text-sm font-medium rounded-lg hover:bg-purple-700"
              >
                Load submitted plan (Edit)
              </button>
            </>
          )}
        </>
      )}
    </div>
  );
}
