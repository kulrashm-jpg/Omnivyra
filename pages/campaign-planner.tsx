/**
 * Campaign Planner
 * Two-row layout: Row 1 = CampaignContextBar | StrategySetupPanel | ExecutionSetupPanel
 * Row 2 = PlanningCanvas (70%) | AI Copilot (30%)
 * Entry modes: direct, turbo, recommendation, campaign, opportunity.
 */

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { ArrowLeft, ChevronDown, ChevronUp, LayoutGrid, FileText } from 'lucide-react';
import { useCompanyContext } from '../components/CompanyContext';
import {
  PlannerEntryRouter,
  CampaignContextBar,
  PlanningCanvas,
  FinalizeSection,
  PlannerSessionProvider,
  usePlannerSession,
  CampaignHealthPanel,
  AIPlanningAssistantTab,
  StrategySetupPanel,
  ExecutionSetupPanel,
  ContentTab,
} from '../components/planner';
import { weeksToCalendarPlan } from '../components/planner/calendarPlanConverter';
import styles from '../styles/planner-layout.module.css';
import { useCampaignResume } from '../hooks/useCampaignResume';

interface CampaignPlannerLayoutProps {
  companyId?: string | null;
  campaignId?: string | null;
  recommendationContext: Record<string, unknown> | null;
  opportunityContext: Record<string, unknown> | null;
  initialIdea?: string | null;
  onRefresh?: () => void;
  onFinalize?: (campaignId: string) => void;
}

function CampaignPlannerLayout({
  companyId,
  campaignId,
  recommendationContext,
  opportunityContext,
  initialIdea,
  onRefresh,
  onFinalize,
}: CampaignPlannerLayoutProps) {
  const { state } = usePlannerSession();
  const [setupCollapsed, setSetupCollapsed] = useState(false);
  const [canvasTab, setCanvasTab] = useState<'calendar' | 'content'>('calendar');

  const hasSkeleton =
    Boolean(state.calendar_plan?.activities?.length) || Boolean(state.calendar_plan?.days?.length);

  return (
    <div className={`${styles.plannerPage} flex-1 flex flex-col min-h-0`}>
      <div className="flex-shrink-0 space-y-1">
        {!setupCollapsed && (
          <div className={styles.plannerSetupRow}>
            <div className="bg-white rounded-lg border border-gray-200 overflow-hidden min-h-0 flex flex-col">
              <CampaignContextBar
                recommendation_context={recommendationContext}
                opportunity_context={opportunityContext}
                initial_idea={initialIdea}
                companyId={companyId}
                campaignId={campaignId}
                onOpportunityApplied={onRefresh}
              />
            </div>
            <div className="bg-white rounded-lg border border-gray-200 overflow-hidden min-h-0 flex flex-col">
              <StrategySetupPanel
                companyId={companyId}
                campaignId={campaignId}
                recommendation_context={recommendationContext}
                opportunity_context={opportunityContext}
                onOpportunityApplied={onRefresh}
              />
            </div>
            <div className="bg-white rounded-lg border border-gray-200 overflow-hidden min-h-0 flex flex-col">
              <ExecutionSetupPanel companyId={companyId} onGenerate={onRefresh} />
            </div>
          </div>
        )}

      {hasSkeleton && (
        <button
          type="button"
          onClick={() => setSetupCollapsed((c) => !c)}
          className="flex items-center gap-1.5 text-xs font-medium text-gray-600 hover:text-gray-900 mb-1"
        >
          {setupCollapsed ? (
            <ChevronDown className="h-4 w-4" />
          ) : (
            <ChevronUp className="h-4 w-4" />
          )}
          {setupCollapsed ? 'Expand Campaign Setup' : 'Collapse Campaign Setup'}
        </button>
      )}

      <div className={styles.plannerExecutionRow}>
        <div className="min-w-0 flex flex-col">
          {hasSkeleton && (
            <div className="flex gap-1 border-b border-gray-200 px-2 py-2">
              <button
                type="button"
                onClick={() => setCanvasTab('calendar')}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium ${
                  canvasTab === 'calendar' ? 'bg-indigo-100 text-indigo-700' : 'text-gray-600 hover:bg-gray-100'
                }`}
              >
                <LayoutGrid className="h-4 w-4" />
                Calendar
              </button>
              <button
                type="button"
                onClick={() => setCanvasTab('content')}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium ${
                  canvasTab === 'content' ? 'bg-indigo-100 text-indigo-700' : 'text-gray-600 hover:bg-gray-100'
                }`}
              >
                <FileText className="h-4 w-4" />
                Content
              </button>
            </div>
          )}
          <div className="flex-1 min-h-0 flex flex-col p-4">
            {campaignId && companyId && (
              <CampaignHealthPanel campaignId={campaignId} companyId={companyId} />
            )}
            {canvasTab === 'content' && hasSkeleton ? (
              <ContentTab campaignId={campaignId} companyId={companyId} />
            ) : (
              <>
                <PlanningCanvas
                  campaignId={campaignId}
                  collapsed={false}
                  onToggleCollapse={() => {}}
                />
                <FinalizeSection
                  companyId={companyId}
                  campaignId={campaignId}
                  onFinalize={onFinalize ?? (() => {})}
                  onGeneratePreview={onRefresh}
                />
              </>
            )}
          </div>
        </div>
        <div className="border-l border-gray-200 bg-white flex flex-col min-w-0 min-[1200px]:min-w-[280px]">
          <div className="px-4 py-2 text-xs font-medium text-gray-600 flex items-center gap-2 border-b border-gray-200">
            AI Copilot
          </div>
          <div className="flex-1 min-h-[200px] overflow-hidden">
            <AIPlanningAssistantTab companyId={companyId} />
          </div>
        </div>
      </div>
    </div>
  </div>
  );
}

function PlanLoader({
  campaignId,
  companyId,
  refreshTrigger,
}: {
  campaignId: string | null;
  companyId: string | null;
  refreshTrigger: number;
}) {
  const { setCampaignStructure, setCalendarPlan } = usePlannerSession();
  useEffect(() => {
    if (!campaignId || !companyId) {
      return;
    }
    let cancelled = false;
    fetch(`/api/campaigns/retrieve-plan?campaignId=${encodeURIComponent(campaignId)}`, {
      credentials: 'include',
    })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error('Failed to load plan'))))
      .then((data) => {
        if (cancelled) return;
        const weeks =
          data?.committedPlan?.weeks ?? data?.draftPlan?.weeks ?? data?.weeks ?? [];
        const result = weeksToCalendarPlan(weeks);
        setCampaignStructure(result.campaign_structure);
        setCalendarPlan(result.calendar_plan);
      })
      .catch(() => {
        if (!cancelled) {
          setCampaignStructure(null);
          setCalendarPlan(null);
        }
      });
    return () => { cancelled = true; };
  }, [campaignId, companyId, refreshTrigger, setCampaignStructure, setCalendarPlan]);
  return null;
}

function CampaignPlannerInner({
  context,
}: {
  context: {
    entry_mode: string;
    recommendation_id: string | null;
    campaign_id: string | null;
    source_theme: Record<string, unknown> | null;
    source_opportunity_id: string | null;
    initial_idea: string | null;
  };
}) {
  const router = useRouter();
  const { query } = router;
  const { selectedCompanyId } = useCompanyContext() ?? { selectedCompanyId: '' };
  const companyId =
    (typeof query.companyId === 'string' ? query.companyId : null) || selectedCompanyId || undefined;
  const campaignId = context.campaign_id ?? null;
  const { setPlannerEntryMode, setSourceIds } = usePlannerSession();
  const [planRefreshTrigger, setPlanRefreshTrigger] = useState(0);

  useCampaignResume({
    campaignId: campaignId ?? undefined,
    page: 'campaign-planner',
    extraParams: context.entry_mode ? { mode: context.entry_mode } : undefined,
  });

  useEffect(() => {
    setPlannerEntryMode(
      context.entry_mode as 'direct' | 'turbo' | 'recommendation' | 'campaign' | 'opportunity'
    );
    setSourceIds({
      recommendation_id: context.recommendation_id,
      campaign_id: campaignId,
      source_opportunity_id: context.source_opportunity_id,
    });
  }, [
    context.entry_mode,
    context.recommendation_id,
    campaignId,
    context.source_opportunity_id,
    setPlannerEntryMode,
    setSourceIds,
  ]);

  const recommendationContext = context.source_theme ?? null;
  const opportunityContext = context.source_opportunity_id
    ? { id: context.source_opportunity_id }
    : null;

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <div className="bg-white border-b border-gray-200 shadow-sm flex-shrink-0">
        <div className="max-w-full mx-auto px-4 py-3">
          <div className="flex items-center justify-between">
            <button
              onClick={() => router.push('/campaigns')}
              className="flex items-center gap-2 text-gray-600 hover:text-gray-900 transition-colors"
            >
              <ArrowLeft className="h-5 w-5" />
              Back
            </button>
            <h1 className="text-lg font-bold text-gray-900">Campaign Planner</h1>
            <div className="w-16" />
          </div>
        </div>
      </div>

      <PlanLoader
        campaignId={campaignId}
        companyId={companyId ?? null}
        refreshTrigger={planRefreshTrigger}
      />

      <div className="flex-1 flex flex-col min-h-0">
        <div className="max-w-full mx-auto w-full px-4 py-4 flex-1 flex flex-col min-h-0">
          <div className="bg-white rounded-xl shadow-sm border overflow-hidden flex-1 flex flex-col min-h-0">
            <CampaignPlannerLayout
              companyId={companyId}
              campaignId={campaignId}
              recommendationContext={recommendationContext}
              opportunityContext={opportunityContext}
              initialIdea={context.initial_idea}
              onRefresh={() => setPlanRefreshTrigger((t) => t + 1)}
              onFinalize={(cid) => router.push(`/campaign-calendar/${cid}`)}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function CampaignPlannerContent() {
  return (
    <PlannerEntryRouter>{(context) => <CampaignPlannerInner context={context} />}</PlannerEntryRouter>
  );
}

function CampaignPlannerWithSession() {
  const router = useRouter();
  const { selectedCompanyId } = useCompanyContext() ?? { selectedCompanyId: null };
  const companyId =
    (typeof router.query?.companyId === 'string' ? router.query.companyId : null) ||
    selectedCompanyId ||
    null;

  return (
    <PlannerSessionProvider companyId={companyId}>
      <CampaignPlannerContent />
    </PlannerSessionProvider>
  );
}

export default function CampaignPlannerPage() {
  return <CampaignPlannerWithSession />;
}
