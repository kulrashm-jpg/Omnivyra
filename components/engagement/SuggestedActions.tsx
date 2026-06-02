/**
 * Suggested Actions — advisory bridge from observed performance to operator action.
 *
 * Derives plain-language suggestions ENTIRELY from data already on screen: the
 * conversion-effectiveness payload (passed in) + the existing universal-funnel
 * bottleneck (read-only fetch of an endpoint that already computes it). Every
 * suggestion shows its Observation + Confidence + Reason, so nothing is a black
 * box.
 *
 * ADVISORY ONLY. It computes no new metrics, writes nothing, and feeds NO
 * recommendation engine, ranking, governance, learning, or attribution path —
 * it is a presentation-layer reading of signals the operator can already see.
 */

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Lightbulb } from 'lucide-react';

type Confidence = 'insufficient' | 'low' | 'medium' | 'high';
type Item = { id: string; conversions: number; conversion_rate?: number | null; exposed_sessions?: number; confidence?: Confidence };
type Category = { available: boolean; total_conversions: number; items: Item[] };
type ActionsPayload = {
  strategies: Category;
  variants: Category;
  assets: Category;
  campaigns?: Category;
  platforms?: Category;
  content_types?: Category;
};

type Action = {
  group: string;
  confidence: Confidence | null;
  observation: string;
  reason: string;
  suggestion: string;
  href?: string;
  priority: number;
};

const pctOf = (r?: number | null) => `${((r ?? 0) * 100).toFixed(1)}%`;

function badgeClass(tier: 'low' | 'medium' | 'high') {
  return tier === 'high' ? 'bg-emerald-100 text-emerald-700' : tier === 'medium' ? 'bg-blue-100 text-blue-700' : 'bg-amber-100 text-amber-700';
}

/** Build advisory actions for one effectiveness dimension. */
function deriveCategory(group: string, singular: string, cat: Category | undefined): Action[] {
  if (!cat || !cat.available) return [];
  const evaluable = cat.items
    .filter((it) => it.confidence && it.confidence !== 'insufficient' && it.conversion_rate != null)
    .sort((a, b) => (b.conversion_rate ?? 0) - (a.conversion_rate ?? 0));
  const out: Action[] = [];

  if (evaluable.length > 0) {
    const top = evaluable[0];
    out.push({
      group,
      confidence: top.confidence!,
      observation: `${top.id} converts at ${pctOf(top.conversion_rate)} (${top.exposed_sessions ?? 0} exposed sessions).`,
      reason: `Highest evaluable ${singular} conversion rate, at ${top.confidence} confidence.`,
      suggestion: `Consider expanding ${top.id} — increase its ${singular === 'platform' ? 'allocation' : 'frequency'}.`,
      priority: top.confidence === 'high' ? 5 : top.confidence === 'medium' ? 4 : 3,
    });
    if (evaluable.length > 1) {
      const low = evaluable[evaluable.length - 1];
      if (low.id !== top.id) {
        out.push({
          group,
          confidence: low.confidence!,
          observation: `${low.id} converts at ${pctOf(low.conversion_rate)} vs ${top.id} at ${pctOf(top.conversion_rate)}.`,
          reason: `Lowest evaluable ${singular}, well below the ${singular} leader.`,
          suggestion: `Review ${low.id} — compare its targeting and messaging against ${top.id}.`,
          priority: 2,
        });
      }
    }
  } else if (cat.items.length > 0) {
    out.push({
      group,
      confidence: 'insufficient',
      observation: `${cat.items.length} ${singular}${cat.items.length === 1 ? '' : 's'} with attributed leads, none above the confidence floor.`,
      reason: `Too few exposed sessions to evaluate ${singular} conversion reliably yet.`,
      suggestion: `Collect more data — keep publishing; this becomes evaluable as exposure grows.`,
      priority: 1,
    });
  }
  return out;
}

const STAGE_LABEL: Record<string, string> = {
  cta_click: 'CTA Click', attribution_handoff_verified: 'Attribution Handoff',
  form_submit: 'Form Submit', form_conversion: 'Form Conversion', lead: 'Lead', page_view: 'Page View',
};
const STAGE_ACTION: Record<string, string> = {
  cta_click: 'Review CTA placement and content — visitors aren’t clicking through.',
  attribution_handoff_verified: 'Review cross-domain tracking continuity — attribution is breaking on handoff.',
  form_submit: 'Review form abandonment fields — users start but don’t submit.',
  form_conversion: 'Review form configuration and confirmation flow.',
  lead: 'Review lead capture wiring.',
};

function deriveFunnelAction(funnel: any): Action | null {
  const stage: string | null = funnel?.bottleneckStage ?? null;
  if (!stage) return null;
  const stageObj = Array.isArray(funnel?.stages) ? funnel.stages.find((s: any) => s.stage === stage) : null;
  const dropPct = stageObj && typeof stageObj.dropFromPrev === 'number' ? `${Math.round(stageObj.dropFromPrev * 100)}%` : '';
  const label = STAGE_LABEL[stage] ?? stage;
  return {
    group: 'Funnel',
    confidence: null,
    observation: `Largest funnel drop at ${label}${dropPct ? ` (${dropPct} of the prior stage lost)` : ''}.`,
    reason: `More users are lost entering ${label} than at any other stage.`,
    suggestion: STAGE_ACTION[stage] ?? `Investigate the ${label} stage.`,
    href: '/lead-capture',
    priority: 6,
  };
}

export default function SuggestedActions({ payload, organizationId }: { payload: ActionsPayload; organizationId: string }) {
  const [funnel, setFunnel] = useState<any | null>(null);

  const fetchFunnel = useCallback(async () => {
    if (!organizationId?.trim()) return;
    try {
      const res = await fetch(`/api/website-intelligence/universal-funnel?company_id=${encodeURIComponent(organizationId)}`, { credentials: 'include' });
      if (!res.ok) return; // role-gated / unavailable → no funnel action (graceful)
      const json = await res.json();
      if (!json?.error) setFunnel(json);
    } catch {
      /* best-effort */
    }
  }, [organizationId]);

  useEffect(() => { fetchFunnel(); }, [fetchFunnel]);

  const actions: Action[] = [
    ...deriveCategory('Content', 'strategy', payload.strategies),
    ...deriveCategory('Content', 'variant', payload.variants),
    ...deriveCategory('Content', 'asset', payload.assets),
    ...deriveCategory('Content', 'content type', payload.content_types),
    ...deriveCategory('Campaign', 'campaign', payload.campaigns),
    ...deriveCategory('Platform', 'platform', payload.platforms),
  ];
  const funnelAction = deriveFunnelAction(funnel);
  if (funnelAction) actions.push(funnelAction);

  const ranked = actions.sort((a, b) => b.priority - a.priority).slice(0, 8);

  return (
    <section className="mt-5">
      <div className="mb-2 flex items-center justify-between">
        <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">
          <Lightbulb className="h-3.5 w-3.5 text-amber-500" />
          Suggested Actions
        </p>
        <span className="text-[10px] text-slate-400">Advisory only — does not affect recommendations or ranking</span>
      </div>

      {ranked.length === 0 ? (
        <p className="rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-500">
          No suggested actions yet — actions appear as conversion data accumulates.
        </p>
      ) : (
        <div className="space-y-2">
          {ranked.map((a, i) => (
            <div key={i} className="rounded-xl border border-slate-200 bg-white px-3 py-2.5">
              <div className="mb-1 flex items-center gap-2">
                <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-slate-600">{a.group}</span>
                {a.confidence && a.confidence !== 'insufficient' && (
                  <span className={`rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase ${badgeClass(a.confidence)}`}>{a.confidence}</span>
                )}
                {a.confidence === 'insufficient' && <span className="text-[10px] text-slate-400">insufficient</span>}
              </div>
              <p className="text-sm font-semibold text-slate-800">{a.suggestion}</p>
              {/* Explainability — why this action exists, from observed data. */}
              <p className="mt-0.5 text-[11px] text-slate-500">{a.observation}</p>
              <p className="text-[11px] text-slate-400">Why: {a.reason}</p>
              {a.href && (
                <Link href={a.href} className="mt-1 inline-block text-[11px] font-medium text-emerald-600 hover:text-emerald-700">
                  Investigate →
                </Link>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
