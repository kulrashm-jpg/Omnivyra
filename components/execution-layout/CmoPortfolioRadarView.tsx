/**
 * CMO Portfolio Radar View — cross-campaign intelligence.
 * COMPANY_ADMIN only. High-level health across campaigns; click campaign → Campaign Radar (execution stays campaign-scoped).
 * Campaign Risk Score: 0–100 rule-based, explainable; sort by risk.
 */

import React, { useMemo, useRef, useState } from 'react';
import { FileText, LayoutGrid, Clock, CheckCircle, AlertTriangle, AlertCircle, UserX, ArrowDownAZ, Gauge, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import type { CompanyPortfolioHealth, CampaignHealthCard, PortfolioAttentionItem, AttentionReason, RiskLevel, RiskTrend, PreventiveAction, PreventiveActionFilterHint, ImpactLevel, PreventiveActionCategory, UserDecisionPattern } from '../../lib/campaign-health-engine';
import { reorderOptionsByPreference } from '../../lib/campaign-health-engine';

const HEALTH_COLOR_CLASSES = {
  green: 'bg-green-100 text-green-800 border-green-200',
  orange: 'bg-amber-100 text-amber-800 border-amber-200',
  red: 'bg-red-100 text-red-800 border-red-200',
} as const;

const RISK_LEVEL_CLASSES: Record<RiskLevel, string> = {
  healthy: 'bg-green-100 text-green-800 border-green-200',
  watch: 'bg-amber-100 text-amber-800 border-amber-200',
  critical: 'bg-red-100 text-red-800 border-red-200',
};

export interface CmoPortfolioRadarViewProps {
  portfolio: CompanyPortfolioHealth | null;
  loading: boolean;
  /** When suggestedFilter is provided, layout should open campaign radar with that filter applied. */
  onSelectCampaign: (campaignId: string, activityId?: string, suggestedFilter?: PreventiveActionFilterHint) => void;
  /** Optional: adaptive learning — reorder options by user preference. */
  userId?: string | null;
  getDecisionPattern?: (userId: string) => UserDecisionPattern | null;
  onRecordSelection?: (userId: string, category: PreventiveActionCategory, campaignId?: string | null) => void;
}

function AttentionReasonIcon({ reason }: { reason: AttentionReason }) {
  const cls = 'w-3.5 h-3.5 shrink-0';
  switch (reason) {
    case 'overdue':
      return <Clock className={`${cls} text-red-500`} aria-label="Overdue" />;
    case 'blocked':
    case 'waiting_approval':
      return <AlertCircle className={`${cls} text-amber-500`} aria-label={String(reason)} />;
    case 'unassigned':
      return <UserX className={`${cls} text-amber-500`} aria-label="Unassigned" />;
    default:
      return <AlertCircle className={`${cls} text-gray-400`} />;
  }
}

function TrendIcon({ trend }: { trend: RiskTrend }) {
  const cls = 'w-3.5 h-3.5 shrink-0';
  switch (trend) {
    case 'increasing':
      return <TrendingUp className={`${cls} text-amber-600`} aria-label="Increasing" />;
    case 'improving':
      return <TrendingDown className={`${cls} text-green-600`} aria-label="Improving" />;
    default:
      return <Minus className={`${cls} text-gray-500`} aria-label="Stable" />;
  }
}

function CampaignHealthCardRow({
  card,
  onSelect,
  onOpenRelatedItems,
  onRecordSelection,
  userId,
}: {
  card: CampaignHealthCard;
  onSelect: () => void;
  onOpenRelatedItems: (campaignId: string, filter?: PreventiveActionFilterHint) => void;
  onRecordSelection?: (userId: string, category: PreventiveActionCategory, campaignId?: string | null) => void;
  userId?: string | null;
}) {
  const colorClass = HEALTH_COLOR_CLASSES[card.healthColor];
  const riskClass = RISK_LEVEL_CLASSES[card.riskLevel];
  const pred = card.prediction;
  const hasActions = card.preventiveActions && card.preventiveActions.length > 0;
  return (
    <div
      className="w-full text-left rounded-lg border border-gray-200 bg-white p-4 flex flex-col gap-3 hover:bg-gray-50 hover:border-gray-300 transition-colors"
    >
      <button
        type="button"
        onClick={onSelect}
        className="flex items-center gap-4 text-left w-full"
      >
        <span className={`flex-shrink-0 w-3 h-3 rounded-full ${
          card.healthColor === 'red' ? 'bg-red-500' :
          card.healthColor === 'orange' ? 'bg-amber-500' : 'bg-green-500'
        }`} aria-hidden />
        <div className="min-w-0 flex-1">
          <div className="font-medium text-gray-900 truncate">{card.campaignName}</div>
          <div className="flex flex-wrap gap-3 mt-1 text-xs text-gray-500">
            <span className="flex items-center gap-1">
              <Clock className="w-3 h-3" />
              Overdue: {card.overdueCount}
            </span>
            <span className="flex items-center gap-1">
              <CheckCircle className="w-3 h-3" />
              Pending: {card.pendingApprovalCount}
            </span>
            {card.hasBottleneck && (
              <span className="flex items-center gap-1 text-amber-600">
                <AlertTriangle className="w-3 h-3" />
                Bottleneck
              </span>
            )}
          </div>
        </div>
        <div className="flex flex-shrink-0 items-center gap-2">
          <span className="flex items-center gap-1" title="Risk score (0–100)">
            <Gauge className="w-4 h-4 text-gray-400" aria-hidden />
            <span className={`tabular-nums font-semibold text-sm px-2 py-0.5 rounded border ${riskClass}`}>
              {card.riskScore}
            </span>
          </span>
          <span className={`px-2 py-0.5 rounded text-xs font-medium border ${colorClass}`}>
            {card.healthColor}
          </span>
        </div>
      </button>
      {/* Risk Now (primary) + Predicted (secondary) */}
      <div className="flex flex-wrap items-center gap-3 text-xs border-t border-gray-100 pt-2">
        <span className="text-gray-600">
          <span className="text-gray-500 font-medium">Risk Now:</span> {card.riskScore}
        </span>
        <span className="text-gray-400">|</span>
        <span className="flex items-center gap-1 text-gray-600">
          <span className="text-gray-500 font-medium">Predicted:</span>
          <span className="tabular-nums">{pred.predictedScore}</span>
          <TrendIcon trend={pred.trend} />
        </span>
      </div>
      {pred.explanation && (
        <div className="text-xs text-gray-600 border-t border-gray-100 pt-1">
          {pred.explanation}
        </div>
      )}
      {/* Suggested Options: user chooses which path; AI never auto-executes. Order is stable for this view. */}
      {hasActions && (
        <div className="border-t border-gray-100 pt-2 space-y-2">
          <div className="text-xs font-medium text-gray-600">Suggested Options</div>
          {card.preventiveActions.map((action: PreventiveAction, i: number) => (
            <div key={`${action.category}-${i}`} className="flex flex-col gap-1.5 rounded border border-gray-100 bg-gray-50/50 p-2 text-xs">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-gray-800">{action.label}</div>
                  {action.reason && <div className="text-gray-500 mt-0.5">{action.reason}</div>}
                </div>
                <span className={`flex-shrink-0 px-1.5 py-0.5 rounded text-[10px] font-medium uppercase ${
                  action.impactLevel === 'high' ? 'bg-red-100 text-red-700' :
                  action.impactLevel === 'medium' ? 'bg-amber-100 text-amber-700' : 'bg-gray-200 text-gray-600'
                }`}>
                  {action.impactLevel}
                </span>
              </div>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  if (userId && onRecordSelection) onRecordSelection(userId, action.category, card.campaignId);
                  onOpenRelatedItems(card.campaignId, action.suggestedFilter);
                }}
                className="self-start px-2 py-1 rounded text-xs font-medium bg-indigo-100 text-indigo-800 hover:bg-indigo-200"
              >
                Open Related Items
              </button>
            </div>
          ))}
        </div>
      )}
      {card.riskContributors.length > 0 && (
        <div className="text-xs text-gray-500 border-t border-gray-100 pt-1">
          <span className="text-gray-400">Top: </span>
          {card.riskContributors.join('; ')}
        </div>
      )}
    </div>
  );
}

function AttentionFeedRow({
  item,
  onSelect,
}: {
  item: PortfolioAttentionItem;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className="w-full text-left flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-white border border-transparent hover:border-gray-200"
    >
      <AttentionReasonIcon reason={item.reason} />
      <span className="truncate flex-1">{item.activityTitle}</span>
      <span className="text-xs text-gray-500 shrink-0">{item.campaignName}</span>
    </button>
  );
}

export default function CmoPortfolioRadarView({
  portfolio,
  loading,
  onSelectCampaign,
  userId,
  getDecisionPattern,
  onRecordSelection,
}: CmoPortfolioRadarViewProps) {
  const [sortBy, setSortBy] = useState<'risk' | 'name'>('risk');
  const pattern = useMemo(
    () => (userId && getDecisionPattern ? getDecisionPattern(userId) : null),
    [userId, getDecisionPattern]
  );
  const lastLoadKeyRef = useRef<string>('');
  const frozenPatternRef = useRef<UserDecisionPattern | null>(null);

  const campaignCards = portfolio?.campaignCards ?? [];
  const loadKey = `${campaignCards.length}-${campaignCards[0]?.campaignId ?? ''}`;
  if (loadKey !== lastLoadKeyRef.current) {
    lastLoadKeyRef.current = loadKey;
    frozenPatternRef.current = pattern;
  }

  const sortedCards = useMemo(() => {
    const list = [...campaignCards];
    if (sortBy === 'risk') list.sort((a, b) => b.riskScore - a.riskScore);
    else list.sort((a, b) => a.campaignName.localeCompare(b.campaignName, undefined, { sensitivity: 'base' }));
    return list;
  }, [campaignCards, sortBy]);

  const displayCards = useMemo(() => {
    const p = frozenPatternRef.current;
    if (!p) return sortedCards;
    return sortedCards.map((card) => ({
      ...card,
      preventiveActions: reorderOptionsByPreference(card.preventiveActions, p),
    }));
  }, [sortedCards]);

  if (loading) {
    return (
      <div className="flex flex-col h-full min-h-0 p-4 gap-6 overflow-y-auto">
        <div className="rounded-lg border border-gray-200 bg-gray-50 h-24 animate-pulse" />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="rounded-lg border border-gray-200 bg-gray-50 h-20 animate-pulse" />
          ))}
        </div>
        <div className="flex-1 min-h-0 rounded-lg border border-gray-200 bg-gray-50 animate-pulse" />
      </div>
    );
  }

  if (!portfolio) {
    return (
      <div className="flex flex-col h-full min-h-0 p-4 items-center justify-center text-gray-500">
        <LayoutGrid className="w-10 h-10 text-gray-300 mb-2" />
        <p>No portfolio data available.</p>
      </div>
    );
  }

  const { companyNarrative, attentionFeed } = portfolio;

  return (
    <div className="flex flex-col h-full min-h-0 p-4 gap-6 overflow-y-auto">
      {/* 1. Company AI Narrative */}
      <section aria-label="Company AI narrative" className="flex-shrink-0">
        <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-1.5 mb-2">
          <FileText className="w-4 h-4 text-indigo-500" />
          Company AI Narrative
        </h3>
        <div className="rounded-lg border border-gray-200 bg-indigo-50/50 p-4 text-sm text-gray-800">
          {companyNarrative}
        </div>
      </section>

      {/* 2. Campaign Health Grid (sort by risk or name) */}
      <section aria-label="Campaign health grid" className="flex-shrink-0">
        <div className="flex items-center justify-between gap-2 mb-2">
          <h3 className="text-sm font-semibold text-gray-700">Campaign Health</h3>
          <div className="flex rounded-md border border-gray-200 bg-gray-50/80 overflow-hidden">
            <button
              type="button"
              onClick={() => setSortBy('risk')}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium ${sortBy === 'risk' ? 'bg-white shadow border border-gray-200 text-gray-900' : 'text-gray-600 hover:text-gray-900'}`}
              title="Highest risk first"
            >
              <Gauge className="w-3.5 h-3.5" />
              Risk
            </button>
            <button
              type="button"
              onClick={() => setSortBy('name')}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium ${sortBy === 'name' ? 'bg-white shadow border border-gray-200 text-gray-900' : 'text-gray-600 hover:text-gray-900'}`}
              title="A–Z"
            >
              <ArrowDownAZ className="w-3.5 h-3.5" />
              Name
            </button>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {displayCards.length === 0 ? (
            <p className="text-sm text-gray-500 col-span-full">No campaigns in scope.</p>
          ) : (
            displayCards.map((card) => (
              <CampaignHealthCardRow
                key={card.campaignId}
                card={card}
                onSelect={() => onSelectCampaign(card.campaignId)}
                onOpenRelatedItems={(campaignId, filter) => onSelectCampaign(campaignId, undefined, filter)}
                onRecordSelection={onRecordSelection}
                userId={userId}
              />
            ))
          )}
        </div>
      </section>

      {/* 3. Cross-Campaign Attention Feed */}
      <section className="flex-1 min-h-0 flex flex-col" aria-label="Cross-campaign attention feed">
        <h3 className="text-sm font-semibold text-gray-700 mb-2">Highest priority across campaigns</h3>
        <ul className="flex-1 min-h-0 overflow-y-auto space-y-1 border border-gray-200 rounded-lg bg-gray-50/50 p-2">
          {attentionFeed.length === 0 ? (
            <li className="text-sm text-gray-500 py-4 text-center">No items needing action</li>
          ) : (
            attentionFeed.map((item) => (
              <li key={`${item.campaignId}-${item.activityId}`}>
                <AttentionFeedRow
                  item={item}
                  onSelect={() => onSelectCampaign(item.campaignId, item.activityId)}
                />
              </li>
            ))
          )}
        </ul>
      </section>
    </div>
  );
}
