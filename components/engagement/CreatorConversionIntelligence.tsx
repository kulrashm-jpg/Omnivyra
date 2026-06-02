/**
 * Creator Conversion Intelligence — operator surface.
 *
 * Self-fetching section embedded in the Engagement Analytics page. Consumes
 * /api/engagement/creator-conversion (which consumes the existing
 * getLeadsByStrategy / getLeadsByVariant / getLeadsByAsset helpers). Renders
 * Top Converting Strategies / Variants / Assets with conversions, conversion
 * share, and associated campaigns.
 *
 * Never fabricates: shows real ids only, "Insufficient attribution data" when
 * the attribution layer is unavailable, and a graceful empty state when there
 * are simply no creator-attributed conversions yet.
 */

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Sparkles, Layers, FlaskConical, Image as ImageIcon, Megaphone, Globe, Shapes } from 'lucide-react';
import SuggestedActions from '@/components/engagement/SuggestedActions';

type Confidence = 'insufficient' | 'low' | 'medium' | 'high';
type RankedItem = {
  id: string;
  conversions: number;
  conversion_share: number;
  campaigns: string[];
  // Conversion-rate quality (display-only; present on strategy + asset only).
  exposed_sessions?: number;
  conversion_rate?: number | null;
  confidence?: Confidence;
  metadata: { conversion_count: number; conversion_share: number };
};
type Category = { available: boolean; total_conversions: number; items: RankedItem[] };
type Payload = {
  window_days: number;
  attribution_source: string;
  attribution_available: boolean;
  strategies: Category;
  variants: Category;
  assets: Category;
  // Marketing-effectiveness dimensions (additive; optional for back-compat).
  campaigns?: Category;
  platforms?: Category;
  content_types?: Category;
};

const pct = (share: number) => `${(share * 100).toFixed(1)}%`;

function ConfidenceBadge({ tier }: { tier: 'low' | 'medium' | 'high' }) {
  const cls =
    tier === 'high'
      ? 'bg-emerald-100 text-emerald-700'
      : tier === 'medium'
      ? 'bg-blue-100 text-blue-700'
      : 'bg-amber-100 text-amber-700';
  return <span className={`rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase ${cls}`}>{tier}</span>;
}

function RankedList({
  icon,
  title,
  category,
  noun,
  note,
}: {
  icon: React.ReactNode;
  title: string;
  category: Category | undefined;
  noun: string;
  /** Optional concise informational note shown under the title (e.g. variant). */
  note?: string;
}) {
  // Phase 5: a rate-bearing category with NO item meeting the Low floor cannot
  // be evaluated — show the advisory note, never a rate leader.
  const hasRateSignal = !!category?.items.some((it) => it.confidence);
  const anyEvaluable = !!category?.items.some((it) => it.confidence && it.confidence !== 'insufficient');

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4">
      <h3 className="mb-3 flex items-center gap-2 text-sm font-medium text-slate-800">
        {icon}
        {title}
      </h3>
      {note && <p className="mb-2 text-[10px] leading-snug text-slate-400">{note}</p>}
      {!category || !category.available ? (
        <p className="text-sm text-slate-500">Insufficient attribution data</p>
      ) : category.items.length === 0 ? (
        <p className="text-sm text-slate-500">No creator-attributed conversions yet</p>
      ) : (
        <>
          {hasRateSignal && !anyEvaluable && (
            <p className="mb-2 rounded-lg bg-slate-50 px-2.5 py-1.5 text-[11px] text-slate-500">
              More data required before conversion performance can be evaluated.
            </p>
          )}
          <div className="space-y-2">
            {category.items.slice(0, 8).map((item, i) => (
              <div
                key={item.id || i}
                className="flex items-start gap-3 rounded-xl border border-emerald-100 bg-emerald-50/50 px-3 py-2.5"
              >
                <span className="mt-0.5 w-4 text-right text-xs font-bold text-emerald-400">{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-semibold text-slate-800" title={item.id}>
                    {item.id}
                  </p>
                  <p className="text-[11px] text-slate-500">
                    {item.conversions} {item.conversions === 1 ? noun.replace(/s$/, '') : noun} · {pct(item.conversion_share)} share
                  </p>
                  {/* Conversion-rate quality indicator (strategy/asset only).
                      Below the Low floor we show "Insufficient data", never a
                      fabricated rate leader. */}
                  {item.confidence &&
                    (item.confidence === 'insufficient' ? (
                      <p className="mt-0.5 text-[10px] text-slate-400">
                        Insufficient data
                        {typeof item.exposed_sessions === 'number' ? ` · ${item.conversions}/${item.exposed_sessions} sessions` : ''}
                      </p>
                    ) : (
                      <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[10px] text-slate-500">
                        <span className="font-semibold text-slate-700">
                          {item.conversion_rate != null ? `${(item.conversion_rate * 100).toFixed(1)}%` : '—'}
                        </span>
                        <span className="text-slate-400">of {item.exposed_sessions ?? 0} exposed sessions</span>
                        <ConfidenceBadge tier={item.confidence} />
                      </p>
                    ))}
                  {item.campaigns.length > 0 && (
                    <p className="mt-0.5 truncate text-[10px] text-slate-400" title={item.campaigns.join(', ')}>
                      Campaigns: {item.campaigns.length === 1 ? item.campaigns[0] : `${item.campaigns.length} associated`}
                    </p>
                  )}
                </div>
                <span className="text-sm font-bold text-emerald-600">{item.conversions}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

/**
 * Active empty state — never hides the feature. Shows what it does, attribution
 * readiness (from the live attribution_available flag), tracking guidance, and a
 * concrete next action. `ready` = attribution schema live (true) vs not yet (false).
 */
function ConversionEmptyState({ ready, days }: { ready: boolean; days: number }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4">
      <p className="text-sm font-medium text-slate-800">
        This section shows which creator strategy, variant, asset, and campaign generated leads.
      </p>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <div className="flex items-center gap-2 text-xs">
          <span className={`h-2 w-2 rounded-full ${ready ? 'bg-emerald-500' : 'bg-amber-500'}`} />
          <span className="text-slate-600">Attribution: {ready ? 'Active' : 'Pending setup'}</span>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <span className={`h-2 w-2 rounded-full ${ready ? 'bg-emerald-500' : 'bg-amber-500'}`} />
          <span className="text-slate-600">Tracking: {ready ? 'Ready to attribute' : 'Install tracking snippet'}</span>
        </div>
      </div>
      <p className="mt-3 text-xs text-slate-500">
        {ready
          ? `No creator-attributed leads in the last ${days} days yet. Publish a single or best-variant creator campaign, then open the tracked link.`
          : 'Apply creator attribution and install the tracking snippet on your site to start capturing creator-driven leads.'}
      </p>
      <div className="mt-3">
        <Link
          href={ready ? '/command-center/creator-content' : '/lead-capture'}
          className="inline-flex items-center rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:border-slate-300 hover:text-slate-900"
        >
          {ready ? 'Generate creator content' : 'Set up tracking'}
        </Link>
      </div>
    </div>
  );
}

export default function CreatorConversionIntelligence({
  organizationId,
  days,
}: {
  organizationId: string;
  days: number;
}) {
  const [payload, setPayload] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    if (!organizationId?.trim()) {
      setPayload(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ organization_id: organizationId, days: String(days) });
      const res = await fetch(`/api/engagement/creator-conversion?${params.toString()}`, { credentials: 'include' });
      if (!res.ok) throw new Error(res.statusText);
      const json = await res.json();
      if (json.error) throw new Error(json.error);
      setPayload(json as Payload);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load creator conversion intelligence');
      setPayload(null);
    } finally {
      setLoading(false);
    }
  }, [organizationId, days]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return (
    <section className="mt-6 rounded-[24px] border border-gray-100 bg-white p-5 shadow-[0_10px_30px_rgba(15,23,42,0.05)]">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-base font-semibold text-slate-900">
            <Sparkles className="h-4 w-4 text-emerald-500" />
            Creator Conversion Intelligence
          </h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Which creator strategy, variant, and asset actually generated leads — attributed from{' '}
            <span className="font-medium text-slate-600">lead_attributions</span>.
          </p>
        </div>
        <span className="shrink-0 rounded-full border border-gray-200 px-2.5 py-1 text-[11px] text-slate-500">
          {days}d window
        </span>
      </div>

      {loading && !payload ? (
        <div className="grid gap-4 animate-pulse md:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-40 rounded-lg bg-slate-100" />
          ))}
        </div>
      ) : error || !payload || !payload.attribution_available ? (
        // Attribution not live yet → active empty state (readiness + next action).
        <ConversionEmptyState ready={false} days={days} />
      ) : payload.strategies.items.length +
          payload.variants.items.length +
          payload.assets.items.length +
          (payload.campaigns?.items.length ?? 0) +
          (payload.platforms?.items.length ?? 0) +
          (payload.content_types?.items.length ?? 0) ===
        0 ? (
        // Attribution live, no attributed leads in any dimension yet → ready empty state.
        <ConversionEmptyState ready days={days} />
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-3">
            <RankedList
              icon={<Layers className="h-4 w-4 text-emerald-500" />}
              title="Top Converting Strategies"
              category={payload.strategies}
              noun="leads"
            />
            <RankedList
              icon={<FlaskConical className="h-4 w-4 text-emerald-500" />}
              title="Top Converting Variants"
              category={payload.variants}
              noun="leads"
              note="Variant conversion rates are most reliable for clickable creator-asset links. Some publishing surfaces may under-report conversions."
            />
            <RankedList
              icon={<ImageIcon className="h-4 w-4 text-emerald-500" />}
              title="Top Converting Assets"
              category={payload.assets}
              noun="leads"
            />
          </div>

          {/* Marketing effectiveness — campaign / platform / content-type at
              parity with the creator dimensions, over existing utm_* columns. */}
          <p className="mt-5 mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">
            Marketing effectiveness
          </p>
          <div className="grid gap-4 md:grid-cols-3">
            <RankedList
              icon={<Megaphone className="h-4 w-4 text-emerald-500" />}
              title="Top Converting Campaigns"
              category={payload.campaigns}
              noun="leads"
            />
            <RankedList
              icon={<Globe className="h-4 w-4 text-emerald-500" />}
              title="Top Converting Platforms"
              category={payload.platforms}
              noun="leads"
            />
            <RankedList
              icon={<Shapes className="h-4 w-4 text-emerald-500" />}
              title="Top Converting Content Types"
              category={payload.content_types}
              noun="leads"
            />
          </div>

          {/* Suggested Actions — advisory bridge from the effectiveness data
              above to operator action. Derived client-side; influences nothing. */}
          <SuggestedActions payload={payload} organizationId={organizationId} />

          {/* Explainability footer — every number above traces to these fields. */}
          <p className="mt-4 text-[11px] leading-relaxed text-slate-400">
            Attribution source: <span className="font-medium text-slate-500">{payload.attribution_source}</span>. Each row is
            a real strategy / variant / asset id carried from the creator lane through the tracking link into the lead
            snapshot. Conversion share = a category item&apos;s conversions ÷ that category&apos;s total. Campaigns are the
            distinct campaigns those conversions came from. Nothing here is inferred or fabricated; rows with no creator
            attribution are omitted, not guessed.
          </p>
        </>
      )}
    </section>
  );
}
