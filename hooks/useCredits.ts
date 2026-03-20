/**
 * useCredits — fetches live credit balance for the current org.
 *
 * Returns totalCredits (lifetime_purchased), remainingCredits (balance_credits),
 * and a category breakdown derived from recent transactions for use with CreditMeter.
 */

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/utils/supabaseClient';
import type { CategoryUsage } from '@/components/ui/CreditMeter';

export interface CreditsState {
  totalCredits: number;
  remainingCredits: number;
  categories: CategoryUsage[];
  loading: boolean;
  error: string | null;
}

// Map reference_type → display group
const ACTION_GROUP: Record<string, { label: string; color: string }> = {
  // Low
  ai_reply:            { label: 'AI Replies',         color: 'bg-emerald-400' },
  auto_post:           { label: 'AI Replies',         color: 'bg-emerald-400' },
  content_rewrite:     { label: 'Content Generation', color: 'bg-blue-400' },
  content_basic:       { label: 'Content Generation', color: 'bg-blue-400' },
  // Medium
  trend_analysis:      { label: 'Insights & Trends',  color: 'bg-blue-500' },
  market_insight_manual: { label: 'Insights & Trends', color: 'bg-blue-500' },
  campaign_creation:   { label: 'Campaigns',          color: 'bg-violet-500' },
  campaign_optimization: { label: 'Campaigns',        color: 'bg-violet-500' },
  website_audit:       { label: 'Audits',             color: 'bg-amber-400' },
  // High / background
  lead_detection:      { label: 'Lead Detection',     color: 'bg-amber-500' },
  daily_insight_scan:  { label: 'Insights & Trends',  color: 'bg-blue-500' },
  // Heavy
  voice_per_minute:    { label: 'Voice',              color: 'bg-violet-400' },
  deep_analysis:       { label: 'Deep Analysis',      color: 'bg-violet-600' },
  full_strategy:       { label: 'Campaigns',          color: 'bg-violet-500' },
};

function buildCategories(
  recentTx: Array<{ credits_delta: number; reference_type: string | null }>,
  totalConsumed: number,
): CategoryUsage[] {
  if (!recentTx.length || totalConsumed <= 0) return [];

  // Aggregate credits consumed per group
  const groupTotals = new Map<string, { credits: number; color: string }>();
  for (const tx of recentTx) {
    if (tx.credits_delta >= 0) continue; // skip grants
    const ref = tx.reference_type ?? 'other';
    const group = ACTION_GROUP[ref] ?? { label: 'Other', color: 'bg-gray-400' };
    const existing = groupTotals.get(group.label);
    if (existing) {
      existing.credits += Math.abs(tx.credits_delta);
    } else {
      groupTotals.set(group.label, { credits: Math.abs(tx.credits_delta), color: group.color });
    }
  }

  const total = Array.from(groupTotals.values()).reduce((s, v) => s + v.credits, 0) || 1;
  return Array.from(groupTotals.entries())
    .map(([label, { credits, color }]) => ({
      label,
      credits,
      color,
      percent: Math.round((credits / total) * 100),
    }))
    .sort((a, b) => b.credits - a.credits)
    .slice(0, 5);
}

export function useCredits(companyId: string | null | undefined): CreditsState & { refetch: () => void } {
  const [state, setState] = useState<CreditsState>({
    totalCredits: 0,
    remainingCredits: 0,
    categories: [],
    loading: false,
    error: null,
  });

  const fetch = useCallback(async () => {
    if (!companyId) return;
    setState(s => ({ ...s, loading: true, error: null }));
    try {
      const res = await window.fetch(`/api/admin/credits?companyId=${encodeURIComponent(companyId)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      const credits = json?.credits;
      if (!credits) {
        // No credit account yet — show zeros
        setState({ totalCredits: 0, remainingCredits: 0, categories: [], loading: false, error: null });
        return;
      }
      setState({
        totalCredits: credits.lifetime_purchased ?? 0,
        remainingCredits: credits.balance_credits ?? 0,
        categories: buildCategories(credits.recent_transactions ?? [], credits.lifetime_consumed ?? 0),
        loading: false,
        error: null,
      });
    } catch (err: any) {
      setState(s => ({ ...s, loading: false, error: err?.message ?? 'Failed to load credits' }));
    }
  }, [companyId]);

  useEffect(() => {
    if (!companyId) return;
    fetch();

    // Poll every 5 minutes as fallback
    const pollId = setInterval(fetch, 5 * 60 * 1000);

    // Realtime: refetch instantly whenever a credit transaction is inserted for this org
    const channel = supabase
      .channel(`credit_balance_${companyId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'credit_transactions',
          filter: `organization_id=eq.${companyId}`,
        },
        () => { void fetch(); },
      )
      .subscribe();

    return () => {
      clearInterval(pollId);
      void supabase.removeChannel(channel);
    };
  }, [companyId, fetch]);

  return { ...state, refetch: fetch };
}
