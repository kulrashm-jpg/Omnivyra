import React, { useMemo, useState } from 'react';
import {
  BarChart3,
  ChevronDown,
  ChevronRight,
  MessageSquare,
  PenTool,
  Rocket,
} from 'lucide-react';
import type { useCommandCenter } from '../hooks/useCommandCenter';
import CommandCenterPreflightModal from './command-center/CommandCenterPreflightModal';
import { getCardHoverMessage, toPreflightItems, withCompanyId } from './command-center/preflightHelpers';
import CategoryFactorsPanel from './command-center/CategoryFactorsPanel';
import { masteryLevel } from '../lib/mastery/masteryLevels';

type S = ReturnType<typeof useCommandCenter>;

type EnhancedCardLike = {
  id: string;
  title: string;
  description: string;
  hint?: string;
  ctaLabel: string;
  route: string;
  // K2: mirrors CardState in config/commandCenterCards — `unknown` means the
  // feature data was not readable this load, NOT that setup is outstanding.
  state: 'not_started' | 'in_progress' | 'ready' | 'unknown';
  hoverMessage?: string | null;
};

const CARD_ACTION_LABELS: Record<string, string> = {
  reports: 'Generate',
  blogs: 'Create',
  campaigns: 'Build',
  engagement: 'Engage',
};


const CARD_ICONS: Record<string, React.ElementType> = {
  reports: BarChart3,
  blogs: PenTool,
  campaigns: Rocket,
  engagement: MessageSquare,
};

function ProgressRing({
  label,
  value,
  tone,
  summary,
  active,
  onClick,
}: {
  label: string;
  value: number;
  tone: 'blue' | 'violet' | 'emerald';
  summary: {
    completedCount: number;
    inProgressCount: number;
    totalCount: number;
  };
  active: boolean;
  onClick: () => void;
}) {
  const radius = 34;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(100, value));
  const strokeOffset = circumference - (clamped / 100) * circumference;

  const toneClass =
    tone === 'violet'
      ? 'text-violet-600'
      : tone === 'emerald'
        ? 'text-emerald-600'
        : 'text-sky-600';
  const completedLabel = `${summary.completedCount}/${summary.totalCount}`;

  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-3xl border bg-white px-3 py-3 shadow-sm transition-colors ${
        active ? 'border-slate-400 ring-1 ring-slate-300' : 'border-slate-200 hover:border-slate-300'
      }`}
    >
      <div className="text-center">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">{label}</p>
        <p className="mt-1 text-[11px] font-semibold text-slate-500">({completedLabel})</p>
      </div>

      <div className="mt-2.5 flex justify-center">
        <div className="relative h-14 w-14 shrink-0">
          <svg className="h-14 w-14 -rotate-90" viewBox="0 0 88 88">
            <circle cx="44" cy="44" r={radius} fill="none" stroke="#E2E8F0" strokeWidth="8" />
            <circle
              cx="44"
              cy="44"
              r={radius}
              fill="none"
              stroke="currentColor"
              strokeWidth="8"
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={strokeOffset}
              className={toneClass}
            />
          </svg>
          <div className="absolute inset-0 flex items-center justify-center">
            <span className={`text-xs font-semibold ${toneClass}`}>{clamped}%</span>
          </div>
        </div>
      </div>

      <div className="mt-2 flex items-center justify-center gap-1 text-[11px] font-medium text-slate-500">
        <span>View factors</span>
        <ChevronDown className={`h-3.5 w-3.5 transition-transform ${active ? 'rotate-180' : ''}`} />
      </div>
    </button>
  );
}


function ActionCard({
  card,
  onOpen,
}: {
  card: EnhancedCardLike;
  onOpen: (route: string, state: EnhancedCardLike['state']) => void;
}) {
  const Icon = CARD_ICONS[card.id] ?? BarChart3;
  const actionLabel = CARD_ACTION_LABELS[card.id] ?? card.ctaLabel;
  // `unknown` suppresses the setup nudge too — we have no basis for telling
  // someone what to set up when we could not read what they already have.
  const setupHoverMessage =
    card.state === 'ready' || card.state === 'unknown' ? null : card.hoverMessage || null;
  const outcomeCopy =
    card.id === 'reports'
      ? 'See where your site stands now, understand the real gap, and get next actions you can apply immediately.'
      : card.id === 'blogs'
        ? 'Create content aligned to your business, capture current trends, and finish in minutes what used to take hours.'
        : card.id === 'campaigns'
          ? 'Turn strategy into an actual launch plan across channels with clearer execution, timing, and follow-through.'
          : 'Track conversations, surface what matters first, and respond faster without chasing activity across multiple tabs.';
  // K2: `unknown` gets its own neutral treatment — it is not a warning and not a
  // reproach. The workspace may be fully configured; we just could not read the
  // feature data on this load.
  const toneClass =
    card.state === 'ready'
      ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
      : card.state === 'in_progress'
        ? 'bg-amber-50 text-amber-700 border-amber-200'
        : card.state === 'unknown'
          ? 'bg-slate-50 text-slate-500 border-slate-200'
          : 'bg-slate-100 text-slate-700 border-slate-200';

  return (
    // Whole-card click mirrors the CTA — reuses the SAME onOpen handler
    // (analytics → preflight → handleCardClick); no duplicate navigation path.
    <article
      role="button"
      tabIndex={0}
      onClick={() => onOpen(card.route, card.state)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen(card.route, card.state);
        }
      }}
      className="flex h-full min-h-[560px] cursor-pointer flex-col rounded-3xl border border-slate-200 bg-white p-5 shadow-sm transition-shadow hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-100 text-slate-700">
          <Icon className="h-5 w-5" />
        </div>
        <span className={`inline-flex min-w-[112px] justify-center rounded-full border px-2.5 py-1 text-[11px] font-semibold ${toneClass}`}>
          {card.state === 'ready'
            ? 'Ready'
            : card.state === 'in_progress'
              ? 'In progress'
              : card.state === 'unknown'
                ? 'Checking…'
                : 'Setup needed'}
        </span>
      </div>

      <div className="mt-4 grid min-h-[184px] grid-rows-[48px_96px_40px]">
        <h2 className="overflow-hidden text-lg font-semibold leading-7 text-slate-950">{card.title}</h2>
        <p className="overflow-hidden text-sm leading-6 text-slate-600">{card.description}</p>
        <p className="overflow-hidden text-sm leading-5 text-slate-500">{card.hint || ''}</p>
      </div>

      <div className="mt-6 grid min-h-[128px] grid-rows-[16px_1fr] rounded-2xl border border-slate-200 bg-slate-50 p-4">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">What you can do here</p>
        <p className="mt-2 overflow-hidden text-sm leading-6 text-slate-700">{outcomeCopy}</p>
      </div>

      <div className="group relative mt-5">
        {setupHoverMessage ? (
          <div className="pointer-events-none absolute -top-11 left-1/2 z-10 hidden w-max max-w-[240px] -translate-x-1/2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-center text-xs font-medium text-slate-600 shadow-lg group-hover:block">
            {setupHoverMessage}
          </div>
        ) : null}
        <button
          type="button"
          onClick={(e) => {
            // Stop bubbling so the card-level onClick doesn't fire onOpen twice.
            e.stopPropagation();
            onOpen(card.route, card.state);
          }}
          className="inline-flex min-h-[52px] w-full items-center justify-center gap-2 rounded-2xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-slate-800"
        >
          {actionLabel}
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </article>
  );
}

export default function CommandCenterView({ d }: { d: S }) {
  const {
    companyName,
    displayName,
    enhancedCards,
    handleCardAnalytics,
    handleCardClick,
    readinessScore,
    setupPct,
    setupEvaluation,
    setupSummary,
    readinessEvaluation,
    readinessSummary,
    masteryPct,
    masteryEvaluation,
    masterySummary,
    selectedCompanyId,
    features,
  } = d;

  const cards = Array.isArray(enhancedCards)
    ? (enhancedCards as unknown as EnhancedCardLike[])
    : [];
  const topProgressItems = useMemo(
    () => [
      { id: 'setup', label: 'Setup', value: setupPct, tone: 'blue' as const, summary: setupSummary },
      { id: 'readiness', label: 'Readiness', value: readinessScore, tone: 'violet' as const, summary: readinessSummary },
      { id: 'mastery', label: 'Mastery', value: masteryPct, tone: 'emerald' as const, summary: masterySummary },
    ],
    [masteryPct, masterySummary, readinessScore, readinessSummary, setupPct, setupSummary],
  );
  const [activeProgressId, setActiveProgressId] = useState<'setup' | 'readiness' | 'mastery' | null>(null);
  const [preflightCardId, setPreflightCardId] = useState<string | null>(null);
  const activeProgress = activeProgressId
    ? topProgressItems.find((item) => item.id === activeProgressId) ?? null
    : null;
  const activePreflightCard = preflightCardId ? cards.find((card) => card.id === preflightCardId) ?? null : null;
  const activePreflight = activePreflightCard
    ? toPreflightItems(
        preflightCardId!,
        features as Array<{ key: string; score: number; status: 'completed' | 'not_started' | 'in_progress' }>,
        selectedCompanyId,
        d.profileStatus ?? null,
      )
    : null;

  // BETA-009: a brand-new company (low Setup score) gets first-run guidance instead of
  // the returning-user copy — clear "do this first" + a CTA that the existing onboarding
  // tour's Step 1 spotlights (data-tour-id below). Reuses existing setupPct + routes only.
  const isFirstRun = (Number(setupPct) || 0) < 50;

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-8 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-6xl space-y-8">
        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
          <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px] xl:items-start xl:gap-8">
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">
                {isFirstRun ? 'Getting started' : 'Welcome'}
              </p>
              <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950 sm:text-4xl">
                {isFirstRun ? `Welcome to OmniVyra, ${displayName}` : `Welcome back, ${displayName}`}
              </h1>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600 sm:text-base">
                {isFirstRun
                  ? `Let's get ${companyName} set up. Start with your company profile — it personalizes every report, content asset, and campaign you create. Then connect your channels and create your first asset.`
                  : `${companyName} is ready for the next step. Review your current progress, then move into reports, content, campaigns, or engagement from the four work areas below.`}
              </p>
              {isFirstRun && (
                <a
                  href={withCompanyId('/company-profile', selectedCompanyId)}
                  data-tour-id="company-profile-card"
                  className="mt-4 inline-flex items-center gap-2 rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-slate-800"
                >
                  Start here — complete your company profile
                </a>
              )}
            </div>
            <div className="grid grid-cols-3 gap-3 self-start">
              {topProgressItems.map((item) => (
                <ProgressRing
                  key={item.id}
                  label={item.label}
                  value={item.value}
                  tone={item.tone}
                  summary={item.summary}
                  active={activeProgressId === item.id}
                  onClick={() => setActiveProgressId((current) => (current === item.id ? null : item.id) as typeof current)}
                />
              ))}
            </div>
          </div>
        </section>

        {activeProgress ? (
          activeProgressId === 'setup' ? (
            <CategoryFactorsPanel evaluation={setupEvaluation} companyId={selectedCompanyId} title="Setup factors" metricWord="complete" />
          ) : activeProgressId === 'readiness' ? (
            <CategoryFactorsPanel evaluation={readinessEvaluation} companyId={selectedCompanyId} title="Readiness factors" metricWord="ready" />
          ) : (
            <CategoryFactorsPanel
              evaluation={masteryEvaluation}
              companyId={selectedCompanyId}
              title="Mastery factors"
              metricWord="mastery"
              categoryBadge={(c) => masteryLevel(c.percent).label}
              overallBadge={masteryLevel(masteryEvaluation.overallPercent).label}
            />
          )
        ) : null}

        <section>
          <div className="mb-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Work Areas</p>
            <h2 className="mt-1 text-xl font-semibold text-slate-950">Choose where you want to work</h2>
          </div>
          <div className="grid gap-5 lg:grid-cols-4">
            {cards.map((card) => (
              <ActionCard
                key={card.id}
                card={card}
                onOpen={(route, state) => {
                  handleCardAnalytics(card.id);
                  const guidance = toPreflightItems(
                    card.id,
                    features as Array<{ key: string; score: number; status: 'completed' | 'not_started' | 'in_progress' }>,
                    selectedCompanyId,
                    d.profileStatus ?? null,
                  );
                  const shouldOpenPreflight = [...guidance.required, ...guidance.recommended].some(
                    (item) => item.status !== 'done',
                  );

                  if (shouldOpenPreflight) {
                    setPreflightCardId(card.id);
                    return;
                  }

                  handleCardClick(withCompanyId(route, selectedCompanyId), state);
                }}
              />
            ))}
          </div>
        </section>
      </div>
      <CommandCenterPreflightModal
        open={Boolean(activePreflightCard && activePreflight)}
        title={activePreflightCard?.title || ''}
        actionLabel={activePreflightCard ? CARD_ACTION_LABELS[activePreflightCard.id] ?? activePreflightCard.ctaLabel : 'Continue'}
        required={activePreflight?.required || []}
        recommended={activePreflight?.recommended || []}
        onClose={() => setPreflightCardId(null)}
        onContinue={() => {
          if (!activePreflightCard) return;
          handleCardClick(withCompanyId(activePreflightCard.route, selectedCompanyId), activePreflightCard.state);
          setPreflightCardId(null);
        }}
      />
    </div>
  );
}
