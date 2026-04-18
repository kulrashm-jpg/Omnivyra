import React from 'react';
import EmptyState from '../../shared/EmptyState';
import ExamplePreview from '../../shared/ExamplePreview';

type JobHistoryEntry = {
  jobId: string;
  status: string;
  regions: string[];
  confidence_index: number | null;
  created_at: string;
};

interface TrendCampaignsHistoryDrawerProps {
  open: boolean;
  onClose: () => void;
  loading: boolean;
  jobHistory: JobHistoryEntry[];
  onViewIntelligence: (jobId: string) => void;
}

export default function TrendCampaignsHistoryDrawer({
  open,
  onClose,
  loading,
  jobHistory,
  onViewIntelligence,
}: TrendCampaignsHistoryDrawerProps) {
  if (!open) return null;
  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-black/20"
        aria-hidden
        onClick={onClose}
      />
      <div className="fixed top-0 right-0 bottom-0 z-50 w-full max-w-md bg-white shadow-xl flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
          <h3 className="text-lg font-semibold text-gray-900">Strategic Memory — Last 5 runs</h3>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-lg text-gray-500 hover:bg-gray-100"
            aria-label="Close"
          >
            ×
          </button>
        </div>
        <div className="flex-1 overflow-auto p-4">
          {loading ? (
            <p className="text-sm text-gray-500">Loading…</p>
          ) : jobHistory.length === 0 ? (
            <EmptyState
              title="Build your first recommendation history"
              description="Run the strategic theme builder once and this drawer will start showing what was generated, when, and with what confidence."
              primaryAction={{ label: 'Generate your first insight', href: '/dashboard?tab=intelligence&intelTab=market-pulse' }}
              secondaryAction={{ label: 'Try with sample data', href: '/campaigns?sample=1' }}
              examplePreview={<ExamplePreview variant="insight" />}
            />
          ) : (
            <ul className="space-y-3">
              {jobHistory.map((job) => (
                <li
                  key={job.jobId}
                  className="rounded-lg border border-gray-200 p-3 bg-gray-50/50"
                >
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <span
                      className={`text-xs font-medium px-2 py-0.5 rounded ${
                        job.status === 'COMPLETED' || job.status === 'COMPLETED_WITH_WARNINGS'
                          ? 'bg-green-100 text-green-800'
                          : job.status === 'FAILED'
                            ? 'bg-red-100 text-red-800'
                            : 'bg-gray-200 text-gray-700'
                      }`}
                    >
                      {job.status}
                    </span>
                    {typeof job.confidence_index === 'number' && (
                      <span className="text-xs text-gray-600">
                        Confidence: {job.confidence_index}%
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-gray-500 mb-1">
                    {new Date(job.created_at).toLocaleString()}
                  </p>
                  {job.regions?.length > 0 && (
                    <p className="text-xs text-gray-600 mb-2">
                      Regions: {job.regions.join(', ')}
                    </p>
                  )}
                  <button
                    type="button"
                    onClick={() => onViewIntelligence(job.jobId)}
                    disabled={job.status === 'PENDING' || job.status === 'RUNNING'}
                    className="w-full mt-1 px-3 py-1.5 text-sm font-medium rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
                  >
                    View Intelligence
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </>
  );
}
