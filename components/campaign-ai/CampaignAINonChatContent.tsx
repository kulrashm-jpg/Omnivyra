import React from 'react';
import EmptyState from '@/components/shared/EmptyState';
import ExamplePreview from '@/components/shared/ExamplePreview';
import StepTracker, { type StepDef } from '@/components/progress/StepTracker';
import { renderPlanSummary } from './chatHelpers';

const AUDIT_LOAD_STAGES: StepDef[] = [
  { key: 'plan',     label: 'Reading campaign plan',  etaSeconds: 2 },
  { key: 'metrics',  label: 'Pulling current metrics', etaSeconds: 2 },
  { key: 'evaluate', label: 'Evaluating audit checks', etaSeconds: 2 },
  { key: 'score',    label: 'Scoring confidence',     etaSeconds: 2 },
];

type TabKind = 'history' | 'audit' | 'execution' | 'content' | 'performance' | 'memory' | 'business' | 'platform';

type CampaignAINonChatContentProps = {
  activeTab: TabKind;
  aiHistory: any[];
  isHistoryLoading: boolean;
  isAuditLoading: boolean;
  auditReport: any;
  auditStartedAt?: number | null;
  isHealthLoading: boolean;
  healthReport: any;
  optimizeWeekNumber: number;
  setOptimizeWeekNumber: React.Dispatch<React.SetStateAction<number>>;
  optimizeReason: string;
  setOptimizeReason: React.Dispatch<React.SetStateAction<string>>;
  handleOptimizeWeek: () => void;
  isOptimizingWeek: boolean;
  optimizeResult: any;
  executionWeekNumber: number;
  setExecutionWeekNumber: React.Dispatch<React.SetStateAction<number>>;
  loadExecutionPlan: (campaignId: string, regenerate?: boolean) => void;
  isExecutionLoading: boolean;
  handleApproveScheduling: () => void;
  executionPlan: any;
  schedulerPayload: any;
  campaignId?: string;
  contentWeekNumber: number;
  setContentWeekNumber: React.Dispatch<React.SetStateAction<number>>;
  regenerateInstruction: string;
  setRegenerateInstruction: React.Dispatch<React.SetStateAction<string>>;
  isContentLoading: boolean;
  contentAssets: any[];
  handleTrackingLinkClick: (url: string, platform?: string) => void;
  handleRegenerateContent: (assetId: string) => void;
  handleApproveContent: (assetId: string) => void;
  handleRejectContent: (assetId: string) => void;
  handleGenerateContent: (day: string) => void;
  performanceWeekNumber: number;
  setPerformanceWeekNumber: React.Dispatch<React.SetStateAction<number>>;
  handleApplyInsightsToWeek: () => void;
  isPerformanceLoading: boolean;
  analyticsReport: any;
  learningInsights: any;
  campaignMemory: any;
  memoryOverlap: any;
  isBusinessLoading: boolean;
  forecastReport: any;
  roiReport: any;
  businessReport: any;
  platformIntelAssetId: string;
  setPlatformIntelAssetId: React.Dispatch<React.SetStateAction<string>>;
  platformIntelPlatform: string;
  setPlatformIntelPlatform: React.Dispatch<React.SetStateAction<string>>;
  platformIntelContentType: string;
  setPlatformIntelContentType: React.Dispatch<React.SetStateAction<string>>;
  handlePlatformIntel: () => void;
  isPlatformIntelLoading: boolean;
  platformIntelData: any;
};

export function CampaignAINonChatContent(props: CampaignAINonChatContentProps) {
  const {
    activeTab,
    aiHistory,
    isHistoryLoading,
    isAuditLoading,
    auditReport,
    auditStartedAt,
    isHealthLoading,
    healthReport,
    optimizeWeekNumber,
    setOptimizeWeekNumber,
    optimizeReason,
    setOptimizeReason,
    handleOptimizeWeek,
    isOptimizingWeek,
    optimizeResult,
    executionWeekNumber,
    setExecutionWeekNumber,
    loadExecutionPlan,
    isExecutionLoading,
    handleApproveScheduling,
    executionPlan,
    schedulerPayload,
    campaignId,
    contentWeekNumber,
    setContentWeekNumber,
    regenerateInstruction,
    setRegenerateInstruction,
    isContentLoading,
    contentAssets,
    handleTrackingLinkClick,
    handleRegenerateContent,
    handleApproveContent,
    handleRejectContent,
    handleGenerateContent,
    performanceWeekNumber,
    setPerformanceWeekNumber,
    handleApplyInsightsToWeek,
    isPerformanceLoading,
    analyticsReport,
    learningInsights,
    campaignMemory,
    memoryOverlap,
    isBusinessLoading,
    forecastReport,
    roiReport,
    businessReport,
    platformIntelAssetId,
    setPlatformIntelAssetId,
    platformIntelPlatform,
    setPlatformIntelPlatform,
    platformIntelContentType,
    setPlatformIntelContentType,
    handlePlatformIntel,
    isPlatformIntelLoading,
    platformIntelData,
  } = props;

  if (activeTab === 'history') {
    return (
      <div className="space-y-4">
        {isHistoryLoading ? <div className="text-sm text-gray-500">Loading history...</div> : aiHistory.length === 0 ? (
          <EmptyState
            title="Create your first AI planning run"
            description="Once you generate a plan, your earlier snapshots will appear here so you can compare decisions, review changes, and reuse what worked."
            primaryAction={{ label: 'Generate first plan', onClick: () => window.scrollTo({ top: 0, behavior: 'smooth' }) }}
            examplePreview={(
              <ExamplePreview variant="insight" />
            )}
          />
        ) : aiHistory.map((entry) => (
          <div key={entry.snapshot_hash} className="border rounded-lg p-4 bg-white">
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold text-gray-900">Plan Snapshot</div>
              <div className="text-xs text-gray-500">{entry.created_at ? new Date(entry.created_at).toLocaleString() : '—'}</div>
            </div>
            <div className="mt-2 text-sm text-gray-700">Omnivyre: {entry.omnivyre_decision?.recommendation || 'N/A'}</div>
            <div className="mt-1 text-xs text-gray-500">{renderPlanSummary(entry.structured_plan)}</div>
            <div className="mt-3">
              <div className="text-xs font-semibold text-gray-700">Scheduled Items</div>
              {entry.scheduled_posts.length === 0 ? <div className="text-xs text-gray-500 mt-1">No scheduled posts.</div> : <div className="mt-2 space-y-2">{entry.scheduled_posts.map((post: any) => <div key={post.id} className="bg-gray-50 rounded p-2 text-xs"><div className="flex items-center justify-between"><span className="capitalize text-gray-700">{post.platform}</span><span className="text-gray-500">{post.scheduled_for ? new Date(post.scheduled_for).toLocaleString() : '—'}</span></div><div className="text-gray-600 mt-1 line-clamp-2">{post.content}</div></div>)}</div>}
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (activeTab === 'audit') {
    return (
      <div className="space-y-3">
        {isAuditLoading ? <StepTracker stages={AUDIT_LOAD_STAGES} startedAt={auditStartedAt ?? Date.now()} accent="indigo" title="Generating audit report" variant="card" /> : !auditReport ? <div className="text-sm text-gray-500">No audit report available.</div> : <div className="border rounded-lg p-4 bg-white space-y-2"><div className="flex items-center justify-between"><div className="text-sm font-semibold text-gray-900">Campaign Audit Report</div><span className={`text-xs px-2 py-1 rounded-full ${auditReport.status === 'healthy' ? 'bg-green-100 text-green-800' : auditReport.status === 'warning' ? 'bg-yellow-100 text-yellow-800' : 'bg-red-100 text-red-800'}`}>{auditReport.status}</span></div><div className="text-xs text-gray-500">Confidence score: {auditReport.confidence_score ?? 0}%</div><div className="border-t pt-3 mt-3 space-y-2"><div className="flex items-center justify-between"><div className="text-sm font-semibold text-gray-900">Campaign Health</div>{isHealthLoading ? <span className="text-xs text-gray-500">Loading...</span> : <span title={healthReport?.issues ? healthReport.issues.map((issue: any) => `${issue.level.toUpperCase()}: ${issue.message}`).join(' | ') : 'No issues'} className={`text-xs px-2 py-1 rounded-full ${healthReport?.status === 'healthy' ? 'bg-green-100 text-green-800' : healthReport?.status === 'warning' ? 'bg-yellow-100 text-yellow-800' : 'bg-red-100 text-red-800'}`}>{healthReport?.status ?? 'unknown'}</span>}</div><div className="text-xs text-gray-500">Confidence: {healthReport?.confidence ?? 0}%</div><div className="h-2 w-full bg-gray-100 rounded"><div className={`h-2 rounded ${(healthReport?.confidence ?? 0) >= 80 ? 'bg-green-500' : (healthReport?.confidence ?? 0) >= 50 ? 'bg-yellow-500' : 'bg-red-500'}`} style={{ width: `${Math.min(100, Math.max(0, healthReport?.confidence ?? 0))}%` }} /></div><details className="text-xs text-gray-700"><summary className="cursor-pointer font-semibold">Health report JSON</summary><pre className="mt-2 whitespace-pre-wrap bg-gray-50 p-2 rounded border text-[11px] text-gray-800">{JSON.stringify(healthReport, null, 2)}</pre></details></div><div className="border-t pt-3 mt-3 space-y-2"><div className="text-sm font-semibold text-gray-900">Optimize Week</div><div className="flex items-center gap-2"><input type="number" min={1} max={12} value={optimizeWeekNumber} onChange={(e) => setOptimizeWeekNumber(Number(e.target.value))} className="w-20 rounded border border-gray-200 px-2 py-1 text-xs" /><input type="text" value={optimizeReason} onChange={(e) => setOptimizeReason(e.target.value)} placeholder="Reason for optimization" className="flex-1 rounded border border-gray-200 px-2 py-1 text-xs" /><button onClick={handleOptimizeWeek} disabled={isOptimizingWeek} className="px-3 py-1 text-xs rounded bg-indigo-600 text-white disabled:opacity-50">{isOptimizingWeek ? 'Optimizing...' : 'Optimize'}</button></div>{optimizeResult && <div className="text-xs text-gray-600">{optimizeResult.change_summary || 'Optimization complete.'}</div>}</div><details className="text-xs text-gray-700"><summary className="cursor-pointer font-semibold">View raw JSON</summary><pre className="mt-2 whitespace-pre-wrap bg-gray-50 p-2 rounded border text-[11px] text-gray-800">{JSON.stringify(auditReport, null, 2)}</pre></details></div>}
      </div>
    );
  }

  if (activeTab === 'execution') {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2"><input type="number" min={1} max={12} value={executionWeekNumber} onChange={(e) => setExecutionWeekNumber(Number(e.target.value))} className="w-20 rounded border border-gray-200 px-2 py-1 text-xs" /><button onClick={() => loadExecutionPlan(campaignId || '', true)} disabled={isExecutionLoading} className="px-3 py-1 text-xs rounded bg-indigo-600 text-white disabled:opacity-50">{isExecutionLoading ? 'Loading...' : 'Regenerate week plan'}</button><button onClick={handleApproveScheduling} className="px-3 py-1 text-xs rounded bg-green-600 text-white">Approve for scheduling</button></div>
        {isExecutionLoading ? <div className="text-sm text-gray-500">Loading execution plan...</div> : !executionPlan ? <div className="text-sm text-gray-500">No execution plan available.</div> : <div className="space-y-2">{executionPlan.days?.map((day: any, index: number) => <div key={`${day.date}-${day.platform}-${index}`} className="border rounded p-2 text-xs"><div className="flex items-center justify-between"><div className="font-semibold text-gray-800">{day.date}</div><span className="px-2 py-0.5 rounded bg-gray-100 text-gray-700 capitalize">{day.platform}</span></div><div className="mt-1 text-gray-600">{day.contentType} • {day.suggestedTime}</div><div className="mt-1 text-gray-500">{day.theme}{day.trendUsed ? ` • Trend: ${day.trendUsed}` : ''}</div><div className="mt-1 text-gray-500">{day.placeholder ? 'Placeholder required' : 'Ready'} • {day.reasoning}</div></div>)}</div>}
        {schedulerPayload && <details className="text-xs text-gray-700"><summary className="cursor-pointer font-semibold">Scheduler payload</summary><pre className="mt-2 whitespace-pre-wrap bg-gray-50 p-2 rounded border text-[11px] text-gray-800">{JSON.stringify(schedulerPayload, null, 2)}</pre></details>}
      </div>
    );
  }

  if (activeTab === 'content') {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2"><input type="number" min={1} max={12} value={contentWeekNumber} onChange={(e) => setContentWeekNumber(Number(e.target.value))} className="w-20 rounded border border-gray-200 px-2 py-1 text-xs" /><input type="text" value={regenerateInstruction} onChange={(e) => setRegenerateInstruction(e.target.value)} placeholder="Regeneration instruction" className="flex-1 rounded border border-gray-200 px-2 py-1 text-xs" /></div>
        {isContentLoading ? <div className="text-sm text-gray-500">Loading content assets...</div> : contentAssets.length === 0 ? (
          <EmptyState
            title="Generate your first content asset"
            description="Create the first review-ready draft for this campaign week so you can approve content, inspect tracking links, and move faster."
            primaryAction={{ label: 'Generate first asset', onClick: () => handleGenerateContent(`Week ${contentWeekNumber}`) }}
            examplePreview={(
              <ExamplePreview variant="insight" />
            )}
          />
        ) : <div className="space-y-2">{contentAssets.map((asset) => <div key={asset.asset_id} className="border rounded p-2 text-xs"><div className="flex items-center justify-between"><div className="font-semibold text-gray-800">{asset.day} • {asset.platform}</div><span className="px-2 py-0.5 rounded bg-gray-100 text-gray-700">{asset.status}</span></div><div className="mt-1 text-gray-600">{asset.latest_content?.headline || asset.latest_content?.caption || 'No content'}</div>{asset.latest_content?.tracking_link && <div className="mt-2 text-gray-600"><button onClick={() => handleTrackingLinkClick(asset.latest_content.tracking_link, asset.platform)} className="text-indigo-600 hover:text-indigo-700 underline">Open tracking link</button></div>}<div className="mt-2 flex gap-2"><button onClick={() => handleRegenerateContent(asset.asset_id)} className="px-2 py-1 rounded bg-indigo-600 text-white">Regenerate</button><button onClick={() => handleApproveContent(asset.asset_id)} className="px-2 py-1 rounded bg-green-600 text-white">Approve</button><button onClick={() => handleRejectContent(asset.asset_id)} className="px-2 py-1 rounded bg-red-600 text-white">Reject</button></div></div>)}</div>}
        {executionPlan?.days?.length ? <div className="border-t pt-3"><div className="text-xs font-semibold text-gray-700 mb-2">Generate for day</div><div className="flex flex-wrap gap-2">{executionPlan.days.map((day: any) => <button key={day.date} onClick={() => handleGenerateContent(day.date)} className="px-2 py-1 rounded bg-gray-100 text-gray-700 text-xs">{day.date}</button>)}</div></div> : null}
      </div>
    );
  }

  if (activeTab === 'performance') {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2"><input type="number" min={1} max={12} value={performanceWeekNumber} onChange={(e) => setPerformanceWeekNumber(Number(e.target.value))} className="w-20 rounded border border-gray-200 px-2 py-1 text-xs" /><button onClick={handleApplyInsightsToWeek} className="px-3 py-1 text-xs rounded bg-indigo-600 text-white">Apply insights to week</button></div>
        {isPerformanceLoading ? <div className="text-sm text-gray-500">Loading analytics...</div> : <div className="space-y-3"><div className="border rounded p-3 text-xs"><div className="font-semibold text-gray-800">Analytics Report</div><pre className="mt-2 whitespace-pre-wrap bg-gray-50 p-2 rounded border text-[11px] text-gray-800">{JSON.stringify(analyticsReport, null, 2)}</pre></div><div className="border rounded p-3 text-xs"><div className="font-semibold text-gray-800">Learning Insights</div><pre className="mt-2 whitespace-pre-wrap bg-gray-50 p-2 rounded border text-[11px] text-gray-800">{JSON.stringify(learningInsights, null, 2)}</pre></div></div>}
      </div>
    );
  }

  if (activeTab === 'memory') {
    return (
      <div className="space-y-3">
        {!campaignMemory ? <div className="text-sm text-gray-500">No memory available.</div> : <div className="space-y-2"><div className="border rounded p-3 text-xs"><div className="font-semibold text-gray-800">Past Themes</div><div className="text-gray-600">{campaignMemory.pastThemes?.join(', ') || '—'}</div></div><div className="border rounded p-3 text-xs"><div className="font-semibold text-gray-800">Past Topics</div><div className="text-gray-600">{campaignMemory.pastTopics?.join(', ') || '—'}</div></div><div className="border rounded p-3 text-xs"><div className="font-semibold text-gray-800">Past Hooks</div><div className="text-gray-600">{campaignMemory.pastHooks?.join(', ') || '—'}</div></div><div className="border rounded p-3 text-xs"><div className="font-semibold text-gray-800">Past Trends</div><div className="text-gray-600">{campaignMemory.pastTrendsUsed?.join(', ') || '—'}</div></div><div className="border rounded p-3 text-xs"><div className="font-semibold text-gray-800">Overlap Check</div><div className="text-gray-600">{memoryOverlap?.status || 'unknown'} • score {memoryOverlap?.overlap?.similarityScore ?? 0}</div><div className="text-gray-600">{memoryOverlap?.suggestions?.join(' ') || ''}</div></div></div>}
      </div>
    );
  }

  if (activeTab === 'business') {
    return (
      <div className="space-y-3">
        {isBusinessLoading ? <div className="text-sm text-gray-500">Loading business intelligence...</div> : <div className="space-y-3"><div className="border rounded p-3 text-xs"><div className="font-semibold text-gray-800">Forecast</div><pre className="mt-2 whitespace-pre-wrap bg-gray-50 p-2 rounded border text-[11px] text-gray-800">{JSON.stringify(forecastReport, null, 2)}</pre></div><div className="border rounded p-3 text-xs"><div className="font-semibold text-gray-800">ROI</div><pre className="mt-2 whitespace-pre-wrap bg-gray-50 p-2 rounded border text-[11px] text-gray-800">{JSON.stringify(roiReport, null, 2)}</pre></div><div className="border rounded p-3 text-xs"><div className="font-semibold text-gray-800">Business Report</div><pre className="mt-2 whitespace-pre-wrap bg-gray-50 p-2 rounded border text-[11px] text-gray-800">{JSON.stringify(businessReport, null, 2)}</pre></div></div>}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2"><select value={platformIntelAssetId} onChange={(e) => setPlatformIntelAssetId(e.target.value)} className="flex-1 rounded border border-gray-200 px-2 py-1 text-xs"><option value="">Select asset</option>{contentAssets.map((asset) => <option key={asset.asset_id} value={asset.asset_id}>{asset.day} • {asset.platform}</option>)}</select><select value={platformIntelPlatform} onChange={(e) => setPlatformIntelPlatform(e.target.value)} className="rounded border border-gray-200 px-2 py-1 text-xs">{['linkedin', 'instagram', 'x', 'youtube', 'blog', 'tiktok', 'podcast'].map((p) => <option key={p} value={p}>{p}</option>)}</select><select value={platformIntelContentType} onChange={(e) => setPlatformIntelContentType(e.target.value)} className="rounded border border-gray-200 px-2 py-1 text-xs">{['text', 'image', 'video', 'audio', 'carousel', 'blog'].map((t) => <option key={t} value={t}>{t}</option>)}</select><button onClick={handlePlatformIntel} disabled={isPlatformIntelLoading} className="px-3 py-1 text-xs rounded bg-indigo-600 text-white disabled:opacity-50">{isPlatformIntelLoading ? 'Loading...' : 'Generate'}</button></div>
      {platformIntelData && <div className="space-y-2 text-xs"><div className="border rounded p-2 bg-white"><div className="font-semibold">Formatted Content</div><div className="text-gray-700">{platformIntelData.variant?.formatted_content || '—'}</div></div><div className="border rounded p-2 bg-white"><div className="font-semibold">Promotion Metadata</div><pre className="mt-1 whitespace-pre-wrap text-[11px] text-gray-700">{JSON.stringify(platformIntelData.metadata, null, 2)}</pre></div><div className="border rounded p-2 bg-white"><div className="font-semibold">Compliance</div><pre className="mt-1 whitespace-pre-wrap text-[11px] text-gray-700">{JSON.stringify(platformIntelData.compliance, null, 2)}</pre></div></div>}
    </div>
  );
}
