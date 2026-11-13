import React from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import { useCompanyContext } from '../../components/CompanyContext';
import PageLoader from '../../components/PageLoader';
import AccessRestricted from '../../components/access/AccessRestricted';
import { roleCanAccessArea } from '../../config/commandCenterCards';
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
    effortBand: 'Produce Assets',
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
    effortBand: 'Combine Assets',
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
    title: 'Strategic Mix',
    description: 'Build a more deliberate campaign with control over goals, formats, cadence, channels, and execution planning.',
    bullets: [
      'Best for full campaign planning and control',
      'Supports more deliberate channel orchestration',
      'Useful for structured strategic campaigns',
    ],
    cta: 'Open Strategic Mix',
    route: '/campaign-planner?mode=direct',
    accentFrom: 'from-green-50',
    accentTo: 'to-emerald-50',
    borderColor: 'border-green-200',
    ctaColor: 'bg-green-600 hover:bg-green-700',
  },
];

export default function CampaignsSubPage() {
  const router = useRouter();
  const { user, authChecked, isLoading, userRole, selectedCompanyId, isAdmin } = useCompanyContext();
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
    if (authChecked && !isLoading && !user?.userId) router.replace('/login');
  }, [authChecked, isLoading, user?.userId, router]);

  if (!authChecked || isLoading) {
    return <PageLoader message="Loading your campaigns…" />;
  }

  if (!user?.userId) return <PageLoader message="Redirecting…" statuses={[]} />;

  // Campaigns are not part of a view-only role's workspace. Show a
  // professional permission state instead of the campaign chooser.
  if (!roleCanAccessArea(userRole, 'campaigns')) {
    return <AccessRestricted area="campaigns" />;
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 px-3 py-5 sm:px-4 lg:px-6">
      <div className="mx-auto max-w-[1500px]">
        <button
          onClick={() => router.push('/command-center')}
          className="mb-4 flex items-center gap-2 text-sm text-gray-500 transition-colors hover:text-gray-800"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
          </svg>
          Back to Command Center
        </button>

        {/* D3 (owner rule 3): the hero keeps only the heading. The "Campaign Modes 4 / UX Goal:
            Consistent" stat boxes and the three filler boxes were internal copy. */}
        <div className="mb-5 rounded-[28px] border border-white/80 bg-white/92 p-5 shadow-[0_24px_60px_rgba(15,23,42,0.08)] backdrop-blur-sm md:p-6">
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-500">
            Campaign System
          </p>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900 md:text-3xl">
            Launch campaigns across every style
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-gray-600">
            Choose the campaign path that fits the execution model you need.
          </p>
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

        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-400">Select A Campaign Type</p>
            <p className="mt-1 text-sm text-gray-600">Every card below leads into a more deliberate campaign planning path with stronger information hierarchy.</p>
          </div>
          {/* D3 (owner rule 2): existing campaigns are one click away from the modes hub. */}
          <Link
            href="/campaigns"
            className="shrink-0 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-800 shadow-sm transition-colors hover:bg-gray-50"
          >
            Your campaigns →
          </Link>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {CAMPAIGN_CARDS.map((card) => (
            // D3 (owner rule 3): ONE control per card (the CTA); cards size to their content.
            <div
              key={card.id}
              data-testid={`campaign-mode-card-${card.id}`}
              className={`group flex flex-col rounded-[24px] border bg-gradient-to-br ${card.accentFrom} via-white ${card.accentTo} ${card.borderColor} p-5 shadow-[0_10px_30px_rgba(15,23,42,0.06)] xl:p-4 2xl:p-5`}
            >
              <div className="mb-3 flex items-start justify-between gap-3">
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
                <p className="mt-2 text-sm leading-relaxed text-gray-600">{card.description}</p>
              </div>

              <ul className="mt-3 flex flex-col justify-start space-y-1.5 text-sm">
                {card.bullets.map((bullet, index) => (
                  <li key={index} className="flex items-start gap-2 text-gray-700">
                    <span className="mt-1 h-1.5 w-1.5 rounded-full bg-gray-900/70" />
                    <span>{bullet}</span>
                  </li>
                ))}
              </ul>

              <button
                type="button"
                onClick={() => handleCardClick(card.route)}
                className={`mt-4 w-full rounded-xl px-3 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors ${card.ctaColor}`}
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
        {/* The SELECTED company, never the user's first one (55's active-company sweep).
            D3 / BETA-008: operator tooling (raw campaign-id input, strategy override), so
            admins only (isAdmin = SUPER_ADMIN or COMPANY_ADMIN); customers never see it. */}
        {isAdmin ? <CampaignVariantHubSection companyId={selectedCompanyId} /> : null}
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
        const response = await fetch(
          `/api/campaigns?companyId=${encodeURIComponent(companyId)}&limit=50`,
          { credentials: 'include' },
        );
        const payload = await response.json().catch(() => ({}));
        if (cancelled) return;
        if (!response.ok || !payload?.success) {
          // Never surface the raw API/validation message to customers.
          setCampaignListError("We couldn't load your campaigns just now. Refresh to try again.");
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
