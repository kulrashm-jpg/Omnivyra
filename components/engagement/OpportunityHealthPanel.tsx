/**
 * OpportunityHealthPanel — executive metrics for content opportunity pipeline.
 * Displays detected, approved, sent to campaign, completed, approval rate, campaign conversion.
 * Quality indicators: green when approval > 50%, red when < 20%.
 */

import React, { useState, useEffect, useCallback } from 'react';

export interface OpportunityHealthPanelProps {
  organizationId: string | null;
  className?: string;
}

type HealthData = {
  detected: number;
  approved: number;
  ignored: number;
  sent_to_campaign: number;
  completed: number;
  average_confidence: number;
  approval_rate: number;
  campaign_conversion_rate: number;
};

export const OpportunityHealthPanel = React.memo(function OpportunityHealthPanel({
  organizationId,
  className = '',
}: OpportunityHealthPanelProps) {
  const [data, setData] = useState<HealthData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchHealth = useCallback(async () => {
    if (!organizationId) {
      setData(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/engagement/opportunity-health?organization_id=${encodeURIComponent(organizationId)}`,
        { credentials: 'include' }
      );
      if (!res.ok) throw new Error(res.statusText);
      const json = await res.json();
      setData(json);
    } catch (e) {
      setError((e as Error).message);
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [organizationId]);

  useEffect(() => {
    void fetchHealth();
  }, [fetchHealth]);

  if (!organizationId) {
    return <div className={`text-sm text-slate-500 ${className}`}>Select organization to view health.</div>;
  }
  if (loading) {
    return <div className={`text-sm text-slate-500 ${className}`}>Loading…</div>;
  }
  if (error) {
    return <div className={`text-sm text-amber-700 ${className}`}>{error}</div>;
  }
  if (!data) {
    return <div className={`text-sm text-slate-500 ${className}`}>No data.</div>;
  }

  const approvalIndicator =
    data.approval_rate >= 0.5 ? 'green' : data.approval_rate < 0.2 ? 'red' : 'yellow';
  const conversionIndicator =
    data.campaign_conversion_rate >= 0.5 ? 'green' : data.campaign_conversion_rate < 0.2 ? 'red' : 'yellow';

  const indicatorClass = (color: string) => {
    if (color === 'green') return 'bg-emerald-100 text-emerald-800 border-emerald-200';
    if (color === 'red') return 'bg-red-100 text-red-800 border-red-200';
    return 'bg-amber-100 text-amber-800 border-amber-200';
  };

  return (
    <div className={`rounded-lg border border-slate-200 bg-white p-3 space-y-3 ${className}`}>
      <h4 className="text-sm font-semibold text-slate-800">Opportunity Health</h4>
      <div className="grid grid-cols-2 gap-2 text-sm">
        <div className="rounded border border-slate-100 bg-slate-50 p-2">
          <div className="text-xs text-slate-500">Detected (7d)</div>
          <div className="font-medium text-slate-800">{data.detected}</div>
        </div>
        <div className="rounded border border-slate-100 bg-slate-50 p-2">
          <div className="text-xs text-slate-500">Approved (7d)</div>
          <div className="font-medium text-slate-800">{data.approved}</div>
        </div>
        <div className="rounded border border-slate-100 bg-slate-50 p-2">
          <div className="text-xs text-slate-500">Sent to Campaign</div>
          <div className="font-medium text-slate-800">{data.sent_to_campaign}</div>
        </div>
        <div className="rounded border border-slate-100 bg-slate-50 p-2">
          <div className="text-xs text-slate-500">Completed</div>
          <div className="font-medium text-slate-800">{data.completed}</div>
        </div>
      </div>
      <div className="space-y-2">
        <div className={`rounded border px-2 py-1 inline-block ${indicatorClass(approvalIndicator)}`}>
          <span className="text-xs font-medium">Approval Rate: </span>
          <span>{((data.approval_rate ?? 0) * 100).toFixed(1)}%</span>
        </div>
        <div className={`rounded border px-2 py-1 inline-block ${indicatorClass(conversionIndicator)}`}>
          <span className="text-xs font-medium">Campaign Conversion: </span>
          <span>{((data.campaign_conversion_rate ?? 0) * 100).toFixed(1)}%</span>
        </div>
      </div>
    </div>
  );
});
