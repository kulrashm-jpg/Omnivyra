import React from 'react';
import { useRouter } from 'next/router';
import { useCompanyContext } from '../../components/CompanyContext';
import { readCampaignSourcePayload } from '../../lib/content/launchCampaignFromContent';
// Variant Experience Embedding (PHASE 5 + 8) — campaign creation
// surfaces the variant mode picker + experiment dashboard so
// operators see what variant generation will fire when the campaign
// runs, and can review past experiment results.
import { ExperimentResultsPanel } from '../../components/variant-experience/ExperimentResultsPanel';
import { VariantWinnerCard } from '../../components/variant-experience/VariantWinnerCard';
import { useStrategyAnalytics, useVariantExperiments } from '../../components/variant-experience/useVariantApi';
import { CampaignVariantConfigPanel } from '../../components/variant-experience/CampaignVariantConfigPanel';

interface CampaignCard {
  id: string;
  icon: string;
  category: string;
  effortBand: string;
  outcome: string;
  title: string;
  description: string;
  bullets: string[];
  cta: string;
  route: string;
  accentFrom: string;
  accentTo: string;
  borderColor: string;
  ctaColor: string;
}

const CAMPAIGN_CARDS: CampaignCard[] = [
  {
    id: 'bolt-text',
    icon: 'T',
    category: 'Text-led',
    effortBand: 'Fast Launch',
    outcome: 'AI-run text campaigns for faster publishing and promotion',
    title: 'BOLT (Text)',
    description: 'Launch AI-driven campaigns using posts, articles, newsletters, and other text-first formats without creator production.',
    bullets: [
      'Built for text-first campaign execution',
      'Moves quickly from strategy to publishing',
      'Works well for consistent B2B distribution',
    ],
    cta: 'Launch BOLT (Text)',
    route: '/command-center/bolt-text',
    accentFrom: 'from-amber-50',
    accentTo: 'to-yellow-50',
    borderColor: 'border-amber-200',
    ctaColor: 'bg-amber-500 hover:bg-amber-600',
  },
  {
    id: 'bolt-creator',
    icon: 'C',
    category: 'Creator-led',
    effortBand: 'Produced Assets',
    outcome: 'Campaigns built for creator media and production workflows',
    title: 'BOLT (Creator)',
    description: 'Use AI for planning while your team or creators produce videos, reels, carousels, images, and other media assets.',
    bullets: [
      'Best for creator and media-led campaigns',
      'Includes briefs for production alignment',
      'Supports richer format and channel variety',
    ],
    cta: 'Launch BOLT (Creator)',
    route: '/command-center/bolt-creator-strategy',
    accentFrom: 'from-blue-50',
    accentTo: 'to-cyan-50',
    borderColor: 'border-blue-200',
    ctaColor: 'bg-blue-500 hover:bg-blue-600',
  },
  {
    id: 'intelligent-mix',
    icon: 'M',
    category: 'Mixed Mode',
    effortBand: 'AI Guided',
    outcome: 'A guided mix of text and creator formats in one campaign',
    title: 'Intelligent Mix',
    description: 'Let AI recommend the right mix of text and creator formats based on goals, audience context, and campaign direction.',
    bullets: [
      'Balances text and creator formats together',
      'Helps choose the right campaign mix faster',
      'Useful when format decisions are still open',
    ],
    cta: 'Start Intelligent Mix',
    route: '/command-center/intelligent-mix-strategy',
    accentFrom: 'from-teal-50',
    accentTo: 'to-cyan-50',
    borderColor: 'border-teal-200',
    ctaColor: 'bg-teal-600 hover:bg-teal-700',
  },
  {
    id: 'strategic-campaign',
    icon: 'S',
    category: 'Planner',
    effortBand: 'Full Control',
    outcome: 'Full campaign planning with strategic control and structure',
    title: 'Strategy Mix',
    description: 'Build a more deliberate campaign with control over goals, formats, cadence, channels, and execution planning.',
    bullets: [
      'Best for full campaign planning and control',
      'Supports more deliberate channel orchestration',
      'Useful for structured strategic campaigns',
    ],
    cta: 'Open Strategy Mix',
    route: '/campaign-planner?mode=direct',
    accentFrom: 'from-green-50',
    accentTo: 'to-emerald-50',
    borderColor: 'border-green-200',
    ctaColor: 'bg-green-600 hover:bg-green-700',
  },
];

export default function CampaignsSubPage() {
  const router = useRouter();
  const { user, authChecked, isLoading } = useCompanyContext();
  const sourceContentToken = typeof router.query.sourceContentToken === 'string' ? router.query.sourceContentToken : null;
  const sourcePayload = React.useMemo(() => readCampaignSourcePayload(sourceContentToken), [sourceContentToken]);

  const handleCardClick = React.useCallback((route: string) => {
    if (route.startsWith('/campaign-planner')) {
      void router.push({
        pathname: '/campaign-planner',
        query: sourceContentToken ? { sourceContentToken } : undefined,
      });
      return;
    }

    void router.push({
      pathname: route,
      query: sourceContentToken ? { sourceContentToken } : undefined,
    });
  }, [router, sourceContentToken]);

  React.useEffect(() => {
    if (authChecked && !user?.userId) router.replace('/login');
  }, [authChecked, user?.userId, router]);

  if (!authChecked || isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-gray-50 to-gray-100">
        <div className="h-12 w-12 animate-spin rounded-full border-b-2 border-violet-600" />
      </div>
    );
  }

  if (!user?.userId) return null;

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 px-3 py-8 sm:px-4 lg:px-6">
      <div className="mx-auto max-w-[1500px]">
        <button
          onClick={() => router.push('/command-center')}
          className="mb-8 flex items-center gap-2 text-sm text-gray-500 transition-colors hover:text-gray-800"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
          </svg>
          Back to Command Center
        </button>

        <div className="mb-8 rounded-[28px] border border-white/80 bg-white/92 p-6 shadow-[0_24px_60px_rgba(15,23,42,0.08)] backdrop-blur-sm md:p-8">
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_240px] lg:items-end">
            <div className="max-w-3xl">
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-500">
                Campaign System
              </p>
              <h1 className="text-3xl font-bold tracking-tight text-gray-900 md:text-4xl">
                Launch campaigns across every style
              </h1>
              <p className="mt-3 text-sm leading-relaxed text-gray-600 md:text-base">
                Choose the campaign path that fits the execution model you need. Each route is structured to feel
                consistent, controlled, and aligned to serious B2B campaign planning.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3 lg:w-[240px]">
              <div className="rounded-2xl border border-gray-100 bg-gray-50 px-3.5 py-3">
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-gray-400">Campaign Modes</p>
                <p className="mt-1 text-base font-semibold text-gray-900">4</p>
              </div>
              <div className="rounded-2xl border border-gray-100 bg-gray-50 px-3.5 py-3">
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-gray-400">UX Goal</p>
                <p className="mt-1 text-base font-semibold text-gray-900">Consistent</p>
              </div>
            </div>
          </div>

          <div className="mt-6 grid gap-4 md:grid-cols-3">
            <div className="rounded-2xl border border-gray-100 bg-gray-50/80 px-4 py-3">
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-gray-400">Designed For</p>
              <p className="mt-1 text-sm text-gray-700">Teams choosing between text-only, creator-led, mixed, or full-planning campaign execution.</p>
            </div>
            <div className="rounded-2xl border border-gray-100 bg-gray-50/80 px-4 py-3">
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-gray-400">Decision Quality</p>
              <p className="mt-1 text-sm text-gray-700">Each path helps teams choose the right execution model before planning begins.</p>
            </div>
            <div className="rounded-2xl border border-gray-100 bg-gray-50/80 px-4 py-3">
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-gray-400">Output Standard</p>
              <p className="mt-1 text-sm text-gray-700">Professional campaign workflows built for structured planning, delivery, and brand consistency.</p>
            </div>
          </div>
        </div>

        {sourcePayload ? (
          <div className="mb-6 rounded-2xl border border-indigo-200 bg-indigo-50 px-5 py-4 shadow-sm">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-indigo-700">Campaign Source</p>
            <p className="mt-1 text-sm font-semibold text-gray-900">{sourcePayload.title}</p>
            <p className="mt-1 text-sm text-gray-600">
              We&apos;ll carry this {sourcePayload.contentType} into the campaign mode you choose so the core idea stays prefilled.
            </p>
          </div>
        ) : null}

        <div className="mb-5 flex items-center justify-between">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-400">Select A Campaign Type</p>
            <p className="mt-1 text-sm text-gray-600">Every card below leads into a more deliberate campaign planning path with stronger information hierarchy.</p>
          </div>
          <p className="hidden text-sm text-gray-500 md:block">4 campaign paths</p>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {CAMPAIGN_CARDS.map((card) => (
            <div
              key={card.id}
              onClick={() => handleCardClick(card.route)}
              className={`group flex min-h-[500px] cursor-pointer flex-col rounded-[24px] border bg-gradient-to-br ${card.accentFrom} via-white ${card.accentTo} ${card.borderColor} p-5 shadow-[0_10px_30px_rgba(15,23,42,0.06)] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_18px_42px_rgba(15,23,42,0.10)] xl:min-h-[540px] xl:p-4 2xl:p-5`}
            >
              <div className="mb-5 flex items-start justify-between gap-3 xl:mb-4">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-white/80 bg-white/85 text-lg font-semibold text-gray-900 shadow-sm">
                  {card.icon}
                </div>
                <div className="text-right">
                  <span className="inline-flex rounded-full bg-white/85 px-2.5 py-1 text-[11px] font-semibold text-gray-700 shadow-sm">
                    {card.category}
                  </span>
                  <p className="mt-2 text-[11px] font-medium uppercase tracking-[0.14em] text-gray-400">{card.effortBand}</p>
                </div>
              </div>

              <div className="flex flex-col">
                <h2 className="text-xl font-semibold tracking-tight text-gray-900 xl:text-lg 2xl:text-xl">{card.title}</h2>
                <p className="mt-3 min-h-[84px] text-sm leading-relaxed text-gray-600 xl:min-h-[112px] 2xl:min-h-[84px]">{card.description}</p>
              </div>

              <div className="mt-5 flex min-h-[74px] flex-col rounded-2xl border border-white/80 bg-white/75 px-4 py-3 xl:mt-4 xl:min-h-[94px] xl:px-3 2xl:min-h-[74px] 2xl:px-4">
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-gray-400">Primary Outcome</p>
                <p className="mt-1 text-sm font-medium leading-5 text-gray-800">{card.outcome}</p>
              </div>

              <ul className="mt-5 flex min-h-[102px] flex-col justify-start space-y-2 text-sm xl:mt-4 xl:min-h-[132px]">
                {card.bullets.map((bullet, index) => (
                  <li key={index} className="flex items-start gap-2 text-gray-700">
                    <span className="mt-1 h-1.5 w-1.5 rounded-full bg-gray-900/70" />
                    <span>{bullet}</span>
                  </li>
                ))}
              </ul>

              <button
                onClick={(event) => {
                  event.stopPropagation();
                  handleCardClick(card.route);
                }}
                className={`mt-auto w-full rounded-xl px-3 py-3 text-sm font-semibold text-white shadow-sm transition-colors ${card.ctaColor}`}
              >
                {card.cta}
              </button>
            </div>
          ))}
        </div>

        {/* Variant Experience hub embedding — PHASE 8 + 12. Shows
            active experiments + top winner cards so operators can
            assess the current campaign's experiment results without
            switching to the dedicated Variant Experience page. */}
        <CampaignVariantHubSection companyId={user?.defaultCompanyId ?? ''} />
      </div>
    </div>
  );
}

/* ── Campaign Variant Hub Section ─────────────────────────────────
 * Surfaces variant winner + experiment data on the campaign hub.
 * Renders only when companyId is available. Auto-refreshes via the
 * hook's `refreshKey` on every navigation.
 */
function CampaignVariantHubSection({ companyId }: { companyId: string }) {
  const router = useRouter();
  const analytics = useStrategyAnalytics({ companyId });
  const experiments = useVariantExperiments({ companyId });
  // Campaign-scoped variant config editor (P1-2). Operators can pick
  // from a dropdown of their existing campaigns OR paste an id by
  // hand. The dropdown pulls from the existing list endpoint —
  // no new endpoint required.
  const [campaignIdInput, setCampaignIdInput] = React.useState('');
  const [activeCampaignId, setActiveCampaignId] = React.useState('');
  const [defaultStrategy, setDefaultStrategy] = React.useState<string>('image:educational-image');
  const [campaignList, setCampaignList] = React.useState<Array<{ id: string; name: string; hasVariantConfig: boolean }>>([]);
  const [campaignListLoading, setCampaignListLoading] = React.useState(false);
  const [campaignListError, setCampaignListError] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (!companyId) return;
    let cancelled = false;
    setCampaignListLoading(true);
    setCampaignListError(null);
    (async () => {
      try {
        const response = await fetch('/api/campaigns?limit=50', { credentials: 'include' });
        const payload = await response.json().catch(() => ({}));
        if (cancelled) return;
        if (!response.ok || !payload?.success) {
          setCampaignListError(payload?.error || `Request failed (${response.status})`);
          return;
        }
        // P3-3 — annotate each campaign with whether it already has
        // a variant_strategy persisted. The list endpoint echoes
        // execution_config when present (in `campaign_snapshot.execution_config`).
        const list = Array.isArray(payload.campaigns)
          ? (payload.campaigns as Array<Record<string, unknown>>)
              .map((c) => {
                const snap = c.campaign_snapshot as Record<string, unknown> | undefined;
                const ec = (snap?.execution_config ?? c.execution_config) as Record<string, unknown> | undefined;
                const hasVariantConfig = Boolean(
                  ec && typeof ec === 'object' && !Array.isArray(ec) && (ec as Record<string, unknown>)['variant_strategy'],
                );
                return {
                  id: typeof c.id === 'string' ? c.id : '',
                  name: typeof c.name === 'string' && c.name.trim() ? c.name : '(unnamed)',
                  hasVariantConfig,
                };
              })
              .filter((c) => c.id)
          : [];
        setCampaignList(list);
      } catch (err) {
        if (!cancelled) setCampaignListError(err instanceof Error ? err.message : 'Failed to load campaigns');
      } finally {
        if (!cancelled) setCampaignListLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [companyId]);
  if (!companyId) return null;
  const declaredWinners = (analytics.data?.execution.winner_recommendations ?? []).slice(0, 3);
  const strategyOptions = (analytics.data?.dimensions ?? []).map((dim) => dim.strategy_id);
  return (
    <section className="mt-10 space-y-6">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-400">Variant Experience</p>
          <h2 className="text-xl font-semibold text-gray-900">Winners + experiments in this org</h2>
        </div>
        <button
          type="button"
          onClick={() => router.push('/command-center/variant-experience')}
          className="text-xs font-semibold text-indigo-700 hover:text-indigo-800"
        >
          Open Variant Experience dashboard →
        </button>
      </header>

      {/* Variant config persistence for an existing campaign id —
          round-trips through campaign_snapshot.execution_config so no
          schema change is required. Operators can find the campaign
          id under any of the campaign edit / detail pages. */}
      <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
        <header className="mb-3">
          <h3 className="text-sm font-semibold text-gray-900">Campaign variant configuration</h3>
          <p className="mt-1 text-xs text-gray-500">
            Paste a campaign id and save a variant strategy that the campaign runner replays at generation time.
          </p>
        </header>
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex-1 min-w-[260px]">
            <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-gray-500">Pick a campaign</span>
            <select
              value={campaignIdInput.startsWith('manual:') ? '' : campaignIdInput}
              onChange={(e) => setCampaignIdInput(e.target.value)}
              disabled={campaignListLoading || campaignList.length === 0}
              className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:bg-gray-50 disabled:text-gray-400"
            >
              <option value="">
                {campaignListLoading
                  ? 'Loading campaigns…'
                  : campaignList.length === 0
                    ? 'No campaigns found — paste an id below'
                    : '— select a campaign —'}
              </option>
              {campaignList.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.hasVariantConfig ? '★ ' : ''}{c.name} · {c.id.slice(0, 8)}…
                </option>
              ))}
            </select>
            {campaignListError ? (
              <p className="mt-1 text-[11px] text-rose-700">{campaignListError}</p>
            ) : (
              <p className="mt-1 text-[11px] italic text-gray-500">★ = variant strategy already configured</p>
            )}
          </label>
          <label className="min-w-[220px]">
            <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-gray-500">…or paste a campaign id</span>
            <input
              type="text"
              value={campaignIdInput}
              onChange={(e) => setCampaignIdInput(e.target.value)}
              placeholder="e.g. 12345678-90ab-…"
              className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </label>
          <label className="min-w-[200px]">
            <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-gray-500">Default strategy</span>
            <select
              value={defaultStrategy}
              onChange={(e) => setDefaultStrategy(e.target.value)}
              className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            >
              {strategyOptions.map((sid) => <option key={sid} value={sid}>{sid}</option>)}
            </select>
          </label>
          <button
            type="button"
            onClick={() => setActiveCampaignId(campaignIdInput.trim())}
            disabled={!campaignIdInput.trim()}
            className="rounded-md bg-indigo-600 px-3 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-indigo-500 disabled:opacity-50"
          >
            Load
          </button>
        </div>
        {activeCampaignId ? (
          <div className="mt-4">
            <CampaignVariantConfigPanel
              companyId={companyId}
              campaignId={activeCampaignId}
              defaultStrategyId={defaultStrategy}
            />
          </div>
        ) : (
          <p className="mt-4 text-xs italic text-gray-500">
            Enter a campaign id above and click Load to edit its variant configuration.
          </p>
        )}
      </div>

      {declaredWinners.length > 0 ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {declaredWinners.map((winner) => (
            <VariantWinnerCard key={winner.strategy_id} winner={winner} />
          ))}
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed border-gray-300 bg-white/70 p-6 text-sm text-gray-500">
          No declared variant winners yet — once the in-flight campaigns ship enough engagement, the winner engine will surface its picks here.
        </div>
      )}

      <ExperimentResultsPanel
        active={experiments.experiments.filter((e) => e.state !== 'completed')}
        completed={experiments.experiments.filter((e) => e.state === 'completed')}
        onComplete={async (experimentId) => {
          await experiments.complete(experimentId);
          experiments.refetch();
          analytics.refetch();
        }}
      />
    </section>
  );
}
