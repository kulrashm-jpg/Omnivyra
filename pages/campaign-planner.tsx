/**
 * Campaign Planner
 * Three tabs: Skeleton | Strategy | Build & Launch
 * Entry modes: direct, turbo, recommendation, campaign, opportunity.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { ArrowLeft, LayoutGrid, FileText, CalendarDays, Sparkles, RocketIcon, Lock, MessageSquare, Layers, Link2, Gauge } from 'lucide-react';
import DesignSystemPanel from '../components/planner/DesignSystemPanel';
import { familyForCreatorType, type TemplateAssetFamily } from '../lib/creator-templates';
import type { RequestedFamilyFrequency } from '../lib/creator-templates/designSystemCoverage';
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
  ContentTab,
  ContentWorkspace,
} from '../components/planner';
import { StrategicThemeCards } from '../components/planner/StrategicThemeCards';
import { StrategyAIChat } from '../components/planner/StrategyAIChat';
import { AccountInsightPanel } from '../components/planner/AccountInsightPanel';
import { SkeletonBuilderPanel } from '../components/planner/SkeletonBuilderPanel';
import { WeekDailyPlanPanel } from '../components/planner/WeekDailyPlanPanel';
import { CreateCampaignAndBuild } from '../components/planner/CreateCampaignAndBuild';
import { AssignmentWorkspace } from '../components/planner/AssignmentWorkspace';
import { CampaignBoardTab } from '../components/planner/CampaignBoardTab';
import { PlannerOrchestrationStrip } from '../components/orchestration/PlannerOrchestrationStrip';
import { weeksToCalendarPlan } from '../components/planner/calendarPlanConverter';
import styles from '../styles/planner-layout.module.css';
import { useCampaignResume } from '../hooks/useCampaignResume';
import { AccountContext } from '../lib/shared/accountContext';
import { fetchWithAuth } from '../components/community-ai/fetchWithAuth';

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
  const { state, setAccountContext, draft_save } = usePlannerSession();
  const router = useRouter();
  // Strategic Mix P1: finalize against the server Draft Campaign when this
  // session owns one (direct mode). planner-finalize's existingCampaignId
  // branch then UPGRADES the draft row in place instead of creating a second
  // campaign. Read-panels intentionally keep the context campaignId only.
  const finalizeCampaignId = campaignId ?? state.draft_campaign_id ?? null;
  const [activeTab, setActiveTab] = useState<'skeleton' | 'strategy' | 'content' | 'alignment' | 'board' | 'build' | 'design'>(() => {
    if (typeof window !== 'undefined') {
      const tab = new URLSearchParams(window.location.search).get('tab');
      if (tab === 'strategy') return 'strategy';
      if (tab === 'content') return 'content';
      if (tab === 'alignment') return 'alignment';
      if (tab === 'board') return 'board';
      if (tab === 'build') return 'build';
      if (tab === 'design') return 'design';
    }
    return 'skeleton';
  });
  const [leftPanelTab, setLeftPanelTab] = useState<'plan' | 'chat' | 'week'>(() => {
    if (typeof window !== 'undefined') {
      const panel = new URLSearchParams(window.location.search).get('leftPanel');
      if (panel === 'chat') return 'chat';
    }
    return 'plan';
  });
  const [selectedThemeWeek, setSelectedThemeWeek] = useState<number | null>(null);
  const [canvasTab, setCanvasTab] = useState<'calendar' | 'daily' | 'content'>('calendar');
  const hasAdvancedRef = useRef(false);
  // R2-P5 (Part A) — Board-as-home. Any explicit user navigation latches
  // this ref so automatic landings never fight the user's choice; the
  // new-campaign flow (Structure → Content → Alignment → Board) stays
  // untouched because its confirm actions latch before state effects run.
  const userNavigatedRef = useRef(
    typeof window !== 'undefined' && Boolean(new URLSearchParams(window.location.search).get('tab')),
  );
  const navigateTab = (tab: typeof activeTab) => {
    userNavigatedRef.current = true;
    setActiveTab(tab);
  };
  // R2-P5 (Part C) — two-door entry state: fresh sessions present Structure
  // and Content as unordered peers until a door is chosen.
  const [structureDoorOpened, setStructureDoorOpened] = useState(false);

  // Load account context on mount; bust cache when returning from OAuth (connected=*)
  useEffect(() => {
    if (!companyId) return;
    const justConnected = typeof router.query.connected === 'string';
    if (!state.account_context || justConnected) {
      fetchWithAuth(`/api/account-context/analyze?companyId=${companyId}${justConnected ? '&refresh=1' : ''}`)
        .then(res => {
          if (!res.ok) return null;
          return res.json() as Promise<AccountContext>;
        })
        .then((data) => {
          if (data) setAccountContext(data);
        })
        .catch(() => {
          // Non-fatal — account context is optional enrichment
        });
    }
  }, [companyId, state.account_context, setAccountContext, router.query.connected]);

  const hasSkeletonDraft =
    Boolean(state.calendar_plan?.activities?.length) || Boolean(state.calendar_plan?.days?.length);

  // Strategy is confirmable once themes exist (a strategic card is a bonus,
  // not a hard gate) — matches the soft-gating model and the footer note.
  const hasStrategyDraft =
    (state.strategic_themes?.length ?? 0) > 0 || Boolean(state.strategic_card);

  const hasSkeleton = state.skeleton_confirmed === true;
  const hasStrategy = state.strategy_confirmed === true;
  const themesReady = (state.strategic_themes?.length ?? 0) > 0;
  // Soft gating: Build & Launch opens as soon as there's a skeleton draft and
  // themes are ready — confirming Skeleton/Strategy is status-only, never a gate.
  const canBuild = hasSkeletonDraft && themesReady;

  // Requested asset families (frequency > 0) for Design System coverage validation,
  // derived from the campaign's chosen content formats. Defensive read across the
  // possible strategy-context shapes; maps each format → canonical asset family.
  const requestedFamilies = useMemo<RequestedFamilyFrequency[]>(() => {
    const raw = ((state as Record<string, any>)?.strategy_context?.content_formats
      ?? (state as Record<string, any>)?.content_formats
      ?? (state as Record<string, any>)?.strategy?.content_formats
      ?? []) as unknown;
    const formats = Array.isArray(raw) ? raw : [];
    const byFam = new Map<TemplateAssetFamily, number>();
    for (const f of formats) {
      const fam = familyForCreatorType(String(f));
      if (fam) byFam.set(fam, (byFam.get(fam) ?? 0) + 1);
    }
    return Array.from(byFam.entries()).map(([family, frequency]) => ({ family, frequency }));
  }, [state]);

  // When the skeleton becomes final, advance. Driven by the skeleton_confirmed
  // false→true transition so it fires on every (re)confirm AND on resume.
  // R2-P5 (Part A): the two cases now land differently — a RESUMED confirmed
  // session (no user navigation yet) is an existing campaign and lands on the
  // BOARD (SPEC-001 §6.4 "Board is home"); a mid-session confirm (the user
  // just clicked, which latched userNavigatedRef) keeps the new-campaign flow.
  useEffect(() => {
    const wasConfirmed = hasAdvancedRef.current;
    hasAdvancedRef.current = hasSkeleton;
    if (hasSkeleton && !wasConfirmed) {
      if (!userNavigatedRef.current) setActiveTab('board');
      else setActiveTab(hasStrategy ? 'build' : 'strategy');
    }
  }, [hasSkeleton, hasStrategy]);

  // R2-P5 (Part A) — existing-campaign entries (campaign mode) open directly
  // on the Board; ?tab= overrides via the latch initializer.
  useEffect(() => {
    if (!campaignId || userNavigatedRef.current) return;
    userNavigatedRef.current = true;
    setActiveTab('board');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaignId]);

  return (
    <div className={`${styles.plannerPage} flex-1 flex flex-col min-h-0`}>
      {/* Top-level tab bar */}
      <div className="flex-shrink-0 flex gap-1 border-b border-gray-200 px-3 pt-2">
        <button
          type="button"
          onClick={() => navigateTab('skeleton')}
          className={`flex items-center gap-1.5 px-4 py-2 rounded-t-lg text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'skeleton'
              ? 'border-indigo-600 text-indigo-700 bg-indigo-50'
              : 'border-transparent text-gray-600 hover:text-gray-900 hover:bg-gray-50'
          }`}
        >
          <CalendarDays className="h-4 w-4" />
          Skeleton
        </button>
        <button
          type="button"
          onClick={() => navigateTab('strategy')}
          className={`flex items-center gap-1.5 px-4 py-2 rounded-t-lg text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'strategy'
              ? 'border-indigo-600 text-indigo-700 bg-indigo-50'
              : 'border-transparent text-gray-600 hover:text-gray-900 hover:bg-gray-50'
          }`}
        >
          <Sparkles className="h-4 w-4" />
          Strategy
        </button>
        {/* Strategic Mix R3-P1 — Content Workspace: build the campaign's
            copy per activity (manual / AI-assisted / generated) at campaign,
            week or activity scope. Opens with the skeleton, like Alignment. */}
        <button
          type="button"
          onClick={() => hasSkeletonDraft && navigateTab('content')}
          disabled={!hasSkeletonDraft}
          title={!hasSkeletonDraft ? 'Build the campaign skeleton first' : undefined}
          className={`flex items-center gap-1.5 px-4 py-2 rounded-t-lg text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'content'
              ? 'border-indigo-600 text-indigo-700 bg-indigo-50'
              : hasSkeletonDraft
              ? 'border-transparent text-gray-600 hover:text-gray-900 hover:bg-gray-50'
              : 'border-transparent text-gray-400 cursor-not-allowed'
          }`}
        >
          <FileText className="h-4 w-4" />
          Content
          {!hasSkeletonDraft && <Lock className="h-3 w-3 ml-1 text-gray-400" />}
        </button>
        {/* Strategic Mix P3 — Alignment: the Assignment workspace, where
            Structure (slots) and Content (Asset Library) are linked. Available
            as soon as the skeleton defines publishing opportunities. */}
        <button
          type="button"
          onClick={() => hasSkeletonDraft && navigateTab('alignment')}
          disabled={!hasSkeletonDraft}
          title={!hasSkeletonDraft ? 'Build the campaign skeleton first' : undefined}
          className={`flex items-center gap-1.5 px-4 py-2 rounded-t-lg text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'alignment'
              ? 'border-indigo-600 text-indigo-700 bg-indigo-50'
              : hasSkeletonDraft
              ? 'border-transparent text-gray-600 hover:text-gray-900 hover:bg-gray-50'
              : 'border-transparent text-gray-400 cursor-not-allowed'
          }`}
        >
          <Link2 className="h-4 w-4" />
          Alignment
          {!hasSkeletonDraft && <Lock className="h-3 w-3 ml-1 text-gray-400" />}
        </button>
        {/* Strategic Mix P6 — Campaign Board: the operational projection over
            structure/content/assignments/execution. Primary workspace after
            Alignment; opens with the skeleton like Alignment does. */}
        <button
          type="button"
          onClick={() => hasSkeletonDraft && navigateTab('board')}
          disabled={!hasSkeletonDraft}
          title={!hasSkeletonDraft ? 'Build the campaign skeleton first' : undefined}
          className={`flex items-center gap-1.5 px-4 py-2 rounded-t-lg text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'board'
              ? 'border-indigo-600 text-indigo-700 bg-indigo-50'
              : hasSkeletonDraft
              ? 'border-transparent text-gray-600 hover:text-gray-900 hover:bg-gray-50'
              : 'border-transparent text-gray-400 cursor-not-allowed'
          }`}
        >
          <Gauge className="h-4 w-4" />
          Board
          {!hasSkeletonDraft && <Lock className="h-3 w-3 ml-1 text-gray-400" />}
        </button>
        <button
          type="button"
          onClick={() => canBuild && navigateTab('build')}
          disabled={!canBuild}
          title={!canBuild ? 'Complete both Skeleton and Strategy first' : undefined}
          className={`flex items-center gap-1.5 px-4 py-2 rounded-t-lg text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'build'
              ? 'border-indigo-600 text-indigo-700 bg-indigo-50'
              : canBuild
              ? 'border-transparent text-gray-600 hover:text-gray-900 hover:bg-gray-50'
              : 'border-transparent text-gray-400 cursor-not-allowed'
          }`}
        >
          <RocketIcon className="h-4 w-4" />
          Build &amp; Launch
          {!canBuild && <Lock className="h-3 w-3 ml-1 text-gray-400" />}
        </button>
        <button
          type="button"
          onClick={() => navigateTab('design')}
          className={`flex items-center gap-1.5 px-4 py-2 rounded-t-lg text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'design'
              ? 'border-indigo-600 text-indigo-700 bg-indigo-50'
              : 'border-transparent text-gray-600 hover:text-gray-900 hover:bg-gray-50'
          }`}
        >
          <Layers className="h-4 w-4" />
          Design System
        </button>
        {/* R2-P5 (Part B) — Draft Status: the existing persistence lifecycle,
            surfaced. Only rendered when the server draft owns this session. */}
        {draft_save.enabled && (
          <span
            title={draft_save.lastSavedAt ? `Last saved ${new Date(draft_save.lastSavedAt).toLocaleTimeString()}` : undefined}
            className={`ml-auto self-center mr-2 text-[11px] font-medium px-2.5 py-1 rounded-full ${
              draft_save.status === 'saved' ? 'bg-emerald-50 text-emerald-700'
              : draft_save.status === 'sync_failed' ? 'bg-red-50 text-red-700'
              : draft_save.status === 'offline' ? 'bg-gray-100 text-gray-600'
              : 'bg-amber-50 text-amber-700'
            }`}
          >
            {draft_save.status === 'saving' ? 'Saving…'
              : draft_save.status === 'syncing' ? 'Syncing…'
              : draft_save.status === 'sync_failed' ? 'Sync failed — retrying'
              : draft_save.status === 'offline' ? 'Offline'
              : 'Draft · saved'}
          </span>
        )}
      </div>

      {/* R2-P5 (Part C) — two-door entry (SPEC-001 §6.1): a fresh session
          presents Structure and Content as unordered peers. Both doors share
          the SAME Draft Campaign (the provider bootstrapped it on entry);
          both converge on the Board once structure exists (Part A). */}
      {activeTab === 'skeleton' && !structureDoorOpened && !hasSkeletonDraft && !state.idea_spine && (state.assignments ?? []).length === 0 && !campaignId ? (
        <div className="flex-1 flex items-center justify-center p-6">
          <div className="max-w-2xl w-full">
            <h2 className="text-center text-lg font-semibold text-gray-900">Where do you want to start?</h2>
            <p className="mt-1 text-center text-sm text-gray-500">
              Structure and content are independent — begin with either. Your draft campaign is already saved.
            </p>
            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => setStructureDoorOpened(true)}
                className="rounded-2xl border border-gray-200 bg-white p-6 text-left transition hover:border-indigo-300 hover:shadow-md"
              >
                <CalendarDays className="h-6 w-6 text-indigo-600" />
                <div className="mt-3 text-sm font-semibold text-gray-900">Start from Structure</div>
                <p className="mt-1 text-xs text-gray-500">
                  Define platforms, cadence, and publishing slots — the campaign skeleton.
                </p>
              </button>
              <button
                type="button"
                onClick={() => router.push('/command-center/creator-content/library?from=strategic-mix')}
                className="rounded-2xl border border-gray-200 bg-white p-6 text-left transition hover:border-indigo-300 hover:shadow-md"
              >
                <LayoutGrid className="h-6 w-6 text-indigo-600" />
                <div className="mt-3 text-sm font-semibold text-gray-900">Start from Content</div>
                <p className="mt-1 text-xs text-gray-500">
                  Create and organize assets in the Library — assign them to structure whenever you're ready.
                </p>
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Tab 1: Skeleton — social insight + builder (left) + calendar preview (right) */}
      {activeTab === 'skeleton' && (structureDoorOpened || hasSkeletonDraft || Boolean(state.idea_spine) || (state.assignments ?? []).length > 0 || Boolean(campaignId)) && (
        <div className="flex-1 flex flex-col min-h-0 overflow-auto p-3 space-y-3">
          <AccountInsightPanel variant="social" />
          <div className="flex-1 flex gap-3 min-h-0" style={{ minHeight: '400px' }}>
            {/* Left: skeleton builder */}
            <div className="w-[35%] flex-shrink-0 bg-white rounded-lg border border-gray-200 overflow-hidden flex flex-col">
              <SkeletonBuilderPanel
                companyId={companyId}
                onGenerate={onRefresh}
                onConfirmed={() => navigateTab(hasStrategy ? 'build' : 'strategy')}
                canConfirm={hasSkeletonDraft}
                strategyAlreadyConfirmed={hasStrategy}
              />
            </div>
            {/* Right: calendar preview */}
            <div className="flex-1 bg-white rounded-lg border border-gray-200 overflow-hidden flex flex-col p-4">
              <PlanningCanvas
                campaignId={campaignId}
                collapsed={false}
                onToggleCollapse={() => {}}
              />
            </div>
          </div>
        </div>
      )}

      {/* Tab 2: Strategy — left panel (Plan/AI Chat) + right panel (Theme Cards) */}
      {activeTab === 'strategy' && (
        <div className="flex-1 flex flex-col min-h-0 overflow-hidden p-3 gap-3">
          {/* Top: social insight + setup */}
          <div className="flex-shrink-0 space-y-3">
            <AccountInsightPanel variant="content" />
            <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
              <StrategySetupPanel companyId={companyId} />
            </div>
          </div>

          {/* Bottom: left column + right column */}
          <div className="flex gap-3 flex-1 min-h-0" style={{ minHeight: '400px' }}>

            {/* ── Left column: Plan / AI Chat tabs ── */}
            <div className="flex-1 min-w-0 bg-white rounded-lg border border-gray-200 flex flex-col min-h-0 overflow-hidden">
              {/* Tab bar — right above the campaign context content */}
              <div className="flex-shrink-0 flex items-center border-b border-gray-200 px-2 pt-1">
                <button
                  type="button"
                  onClick={() => setLeftPanelTab('plan')}
                  className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-colors ${
                    leftPanelTab === 'plan'
                      ? 'border-indigo-600 text-indigo-700'
                      : 'border-transparent text-gray-500 hover:text-gray-800'
                  }`}
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  Plan
                </button>
                <button
                  type="button"
                  onClick={() => setLeftPanelTab('chat')}
                  className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-colors ${
                    leftPanelTab === 'chat'
                      ? 'border-indigo-600 text-indigo-700'
                      : 'border-transparent text-gray-500 hover:text-gray-800'
                  }`}
                >
                  <MessageSquare className="h-3.5 w-3.5" />
                  AI Chat
                  {selectedThemeWeek !== null && (
                    <span className="ml-1 text-[10px] bg-indigo-100 text-indigo-600 px-1.5 py-0.5 rounded-full">
                      Wk {selectedThemeWeek}
                    </span>
                  )}
                </button>
                {selectedThemeWeek !== null && (
                  <button
                    type="button"
                    onClick={() => setLeftPanelTab('week')}
                    className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-colors ${
                      leftPanelTab === 'week'
                        ? 'border-indigo-600 text-indigo-700'
                        : 'border-transparent text-gray-500 hover:text-gray-800'
                    }`}
                  >
                    <CalendarDays className="h-3.5 w-3.5" />
                    Week {selectedThemeWeek} Plan
                  </button>
                )}
              </div>

              {/* Plan tab content */}
              {leftPanelTab === 'plan' && (
                <div className="flex-1 overflow-y-auto">
                  <CampaignContextBar
                    recommendation_context={recommendationContext}
                    opportunity_context={opportunityContext}
                    initial_idea={initialIdea}
                    companyId={companyId}
                    campaignId={campaignId}
                    onOpportunityApplied={onRefresh}
                  />
                </div>
              )}

              {/* AI Chat tab content */}
              {leftPanelTab === 'chat' && (
                <div className="flex-1 min-h-0 overflow-hidden">
                  <StrategyAIChat
                    companyId={companyId}
                    selectedWeek={selectedThemeWeek}
                    onClearSelection={() => setSelectedThemeWeek(null)}
                  />
                </div>
              )}

              {/* Week daily-plan content */}
              {leftPanelTab === 'week' && selectedThemeWeek !== null && (
                <div className="flex-1 min-h-0 overflow-hidden">
                  <WeekDailyPlanPanel companyId={companyId} campaignId={campaignId} week={selectedThemeWeek} />
                </div>
              )}
              {leftPanelTab === 'week' && selectedThemeWeek === null && (
                <div className="flex-1 flex items-center justify-center text-xs text-gray-400 px-4 text-center">
                  Select a week card on the right to plan its days.
                </div>
              )}
            </div>

            {/* ── Right column: Strategic Theme Cards (30%) ── */}
            <div className="w-[30%] flex-shrink-0 min-h-0 flex flex-col">
              <StrategicThemeCards
                companyId={companyId}
                selectedWeek={selectedThemeWeek}
                onSelectWeek={(week) => {
                  setSelectedThemeWeek(week);
                  setLeftPanelTab(week !== null ? 'week' : 'plan');
                }}
                onConfirmed={() => navigateTab(hasSkeleton ? 'build' : 'skeleton')}
                canConfirm={hasStrategyDraft}
                skeletonAlreadyConfirmed={hasSkeleton}
              />
            </div>
          </div>
        </div>
      )}

      {/* Tab: Content — Strategic Mix R3-P1 Content Workspace (campaign /
          week / activity scoped orchestration over the EXISTING generation
          seam; planning lifecycle draft → review → approved) */}
      {activeTab === 'content' && (
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
          <ContentWorkspace companyId={companyId} campaignId={finalizeCampaignId} />
        </div>
      )}

      {/* Tab: Alignment — Strategic Mix P3 Assignment workspace (the only
          place structure↔content relationships are edited) */}
      {activeTab === 'alignment' && (
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
          <AssignmentWorkspace companyId={companyId} campaignId={finalizeCampaignId} />
        </div>
      )}

      {/* Tab: Board — Strategic Mix P6 Master Campaign Board (a projection
          over the canonical entities; owns no data, edits nothing) */}
      {activeTab === 'board' && (
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
          <CampaignBoardTab
            companyId={companyId}
            campaignId={finalizeCampaignId}
            onNavigate={(target) => navigateTab(target)}
          />
        </div>
      )}

      {/* Tab: Design System — the campaign's single pinned collection (CREATOR-029) */}
      {activeTab === 'design' && (
        <div className="flex-1 min-h-0 overflow-auto">
          <div className="max-w-3xl mx-auto">
            <DesignSystemPanel campaignId={campaignId ?? ''} companyId={companyId} requestedFamilies={requestedFamilies} />
          </div>
        </div>
      )}

      {/* Tab 3: Build & Launch — calendar, AI copilot, finalize */}
      {activeTab === 'build' && (
        <div className={`${styles.plannerExecutionRow} flex-1 min-h-0`}>
          <div className="min-w-0 flex flex-col">
            {hasSkeletonDraft && (
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
                  onClick={() => setCanvasTab('daily')}
                  className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium ${
                    canvasTab === 'daily' ? 'bg-indigo-100 text-indigo-700' : 'text-gray-600 hover:bg-gray-100'
                  }`}
                >
                  <CalendarDays className="h-4 w-4" />
                  Daily Plan
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
              {/* Phase-2 Step-15: read-only orchestration visibility (fail-soft, additive). */}
              <PlannerOrchestrationStrip campaignId={campaignId} />
              {canvasTab === 'daily' ? (
                (() => {
                  const weeks = (state.strategic_themes ?? []).map((t) => t.week).sort((a, b) => a - b);
                  const activeWeek = selectedThemeWeek != null && weeks.includes(selectedThemeWeek)
                    ? selectedThemeWeek
                    : weeks[0] ?? null;
                  if (activeWeek == null) {
                    return (
                      <div className="flex-1 flex items-center justify-center text-xs text-gray-400 text-center px-4">
                        Generate strategic themes first to plan content by week.
                      </div>
                    );
                  }
                  return (
                    <div className="flex-1 min-h-0 flex flex-col">
                      <div className="flex-shrink-0 pb-3">
                        <CreateCampaignAndBuild companyId={companyId} campaignId={finalizeCampaignId} />
                      </div>
                      <div className="flex-shrink-0 flex items-center gap-2 pb-3">
                        <span className="text-xs font-medium text-gray-500">Planning week</span>
                        <select
                          value={activeWeek}
                          onChange={(e) => setSelectedThemeWeek(Number(e.target.value))}
                          className="text-sm border border-gray-300 rounded-lg px-2 py-1 bg-white"
                        >
                          {weeks.map((w) => (
                            <option key={w} value={w}>Week {w}</option>
                          ))}
                        </select>
                      </div>
                      <div className="flex-1 min-h-0 border border-gray-200 rounded-lg overflow-hidden">
                        <WeekDailyPlanPanel companyId={companyId} campaignId={campaignId} week={activeWeek} />
                      </div>
                    </div>
                  );
                })()
              ) : canvasTab === 'content' && hasSkeletonDraft ? (
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
                    campaignId={finalizeCampaignId}
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
      )}
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
  const { state, setCampaignStructure, setCalendarPlan } = usePlannerSession();
  useEffect(() => {
    if (!campaignId || !companyId) {
      return;
    }
    if (refreshTrigger === 0 && (state.calendar_plan || state.campaign_structure)) {
      return;
    }
    let cancelled = false;
    fetchWithAuth(`/api/campaigns/retrieve-plan?campaignId=${encodeURIComponent(campaignId)}`)
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
  }, [campaignId, companyId, refreshTrigger, setCampaignStructure, setCalendarPlan, state.calendar_plan, state.campaign_structure]);
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

  // ── Strategic Mix P1 (SPEC-001 I-1): server Draft Campaign persistence ──
  // Enabled ONLY for the canonical Strategic Mix entry (mode=direct with no
  // source ids) — recommendation/opportunity/turbo/existing-campaign entries
  // are untouched. The draft id rides its OWN query param (`draftId`, not
  // `campaignId`) so PlannerEntryRouter keeps resolving 'direct' mode.
  const q = router.query ?? {};
  const serverDraftEnabled =
    router.isReady &&
    q.mode === 'direct' &&
    typeof q.campaignId !== 'string' &&
    typeof q.recommendationId !== 'string' &&
    typeof q.opportunityId !== 'string';
  const urlDraftId = typeof q.draftId === 'string' && q.draftId.trim() ? q.draftId.trim() : null;
  const onDraftIdChange = (id: string) => {
    if (typeof q.draftId === 'string' && q.draftId === id) return;
    router.replace(
      { pathname: router.pathname, query: { ...q, draftId: id } },
      undefined,
      { shallow: true },
    ).catch(() => { /* navigation races are non-fatal */ });
  };

  return (
    <PlannerSessionProvider
      companyId={companyId}
      serverDraft={{ enabled: serverDraftEnabled, urlDraftId, onDraftIdChange }}
    >
      <CampaignPlannerContent />
    </PlannerSessionProvider>
  );
}

export default function CampaignPlannerPage() {
  return (
    <>
      {/* Strategic Mix P0 (SPEC-001 §0): this page is THE canonical Strategic
          Mix shell — the tab/browser identity carries the product name. */}
      <Head>
        <title>Strategic Mix — Campaign Planner | Omnivyra</title>
      </Head>
      <CampaignPlannerWithSession />
    </>
  );
}

