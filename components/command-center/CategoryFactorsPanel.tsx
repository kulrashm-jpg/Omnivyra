import React from 'react';
import Link from 'next/link';
import { CheckCircle2, AlertCircle, ArrowRight, Info, MinusCircle } from 'lucide-react';
import type { CapabilityEvaluation, EvaluatedCategory, EvaluatedFactor } from '../../lib/shared/capabilityRegistry';
import { resolveActionNavigation, type ResolvedAction } from '../../config/commandCenterActions';

/**
 * CategoryFactorsPanel — the single, shared renderer for any capability-aware
 * evaluation (Setup + Readiness, and future Mastery). Presentational only: no
 * scoring / no logic. Scored categories render their factors (available →
 * done/incomplete; unavailable → capability note). Non-scored / unavailable
 * categories render a capability note with a canonical reason and are never
 * hidden. Title + metric word are parameterized so each module keeps its label.
 */

function CapabilityNote({ category }: { category: EvaluatedCategory }) {
  const { capability } = category;
  const unsupported = !capability.supported;
  const Icon = unsupported ? MinusCircle : Info;
  const stateLabel = unsupported ? 'Not available' : !capability.available ? 'Unavailable' : 'Info';
  return (
    <div className="flex items-start gap-2.5">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-slate-300" />
      <div className="min-w-0">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{stateLabel}</p>
        {capability.reason ? <p className="mt-0.5 text-xs text-slate-500">{capability.reason}</p> : null}
      </div>
    </div>
  );
}

const ROW_LINK_CLASS = 'group -mx-1 flex w-full items-start gap-2.5 rounded-lg px-1 py-0.5 text-left transition-colors hover:bg-slate-50';

function FactorRow({
  factor,
  companyId,
  onAction,
}: {
  factor: EvaluatedFactor;
  companyId?: string;
  onAction?: (action: ResolvedAction) => void;
}) {
  if (!factor.available) {
    return (
      <div className="flex items-start gap-2.5">
        <MinusCircle className="mt-0.5 h-4 w-4 shrink-0 text-slate-300" />
        <div className="min-w-0">
          <p className="text-sm font-medium text-slate-500">{factor.title}</p>
          {factor.reason ? <p className="mt-0.5 text-xs text-slate-400">{factor.reason}</p> : null}
        </div>
      </div>
    );
  }
  if (factor.status === 'done') {
    return (
      <div className="flex items-center gap-2.5">
        <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
        <span className="text-sm font-medium text-slate-400 line-through decoration-slate-300">{factor.title}</span>
      </div>
    );
  }

  // Destination + params come ONLY from the canonical action registry (no URLs
  // or query params in this component). A disabled resolution renders a
  // non-navigating row with the canonical reason — never a dead link.
  const resolved: ResolvedAction | null = factor.nextAction
    ? resolveActionNavigation(factor.nextAction.actionId, { companyId }, factor.nextAction.label)
    : null;
  const clickable = resolved && resolved.kind !== 'disabled';

  const icon = (
    <AlertCircle className={`mt-0.5 h-4 w-4 shrink-0 ${factor.status === 'in_progress' ? 'text-amber-500' : 'text-slate-300'}`} />
  );
  const body = (
    <div className="min-w-0">
      <p className={`text-sm font-medium text-slate-800 ${clickable ? 'group-hover:text-sky-800' : ''}`}>{factor.title}</p>
      {factor.missing.length > 0 ? <p className="mt-0.5 text-xs text-slate-500">{factor.missing[0]}</p> : null}
      {resolved && resolved.kind === 'disabled' ? (
        <p className="mt-1 text-xs text-slate-400">{resolved.reason}</p>
      ) : resolved ? (
        <span className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-sky-700 group-hover:text-sky-800">
          {resolved.label}
          <ArrowRight className="h-3 w-3" />
        </span>
      ) : null}
    </div>
  );

  // The WHOLE incomplete task is clickable, rendered by the resolved action kind
  // (page → Link, external → anchor, modal/workflow → dispatch to onAction).
  // No nested <a>: the CTA is a <span> inside the single row control.
  if (resolved && resolved.kind === 'page') {
    return (
      <Link href={resolved.href} className={ROW_LINK_CLASS}>
        {icon}
        {body}
      </Link>
    );
  }
  if (resolved && resolved.kind === 'external') {
    return (
      <a href={resolved.href} target="_blank" rel="noopener noreferrer" className={ROW_LINK_CLASS}>
        {icon}
        {body}
      </a>
    );
  }
  if (resolved && (resolved.kind === 'modal' || resolved.kind === 'workflow')) {
    return (
      <button type="button" onClick={() => onAction?.(resolved)} className={ROW_LINK_CLASS}>
        {icon}
        {body}
      </button>
    );
  }
  // No action, or disabled → non-clickable row.
  return (
    <div className="flex items-start gap-2.5">
      {icon}
      {body}
    </div>
  );
}

function CategoryCard({
  category,
  companyId,
  categoryBadge,
  onAction,
}: {
  category: EvaluatedCategory;
  companyId?: string;
  categoryBadge?: (category: EvaluatedCategory) => string | null;
  onAction?: (action: ResolvedAction) => void;
}) {
  const categoryEvaluable = category.capability.supported && category.capability.enabled && category.capability.available;
  const renderFactors = category.scored || (categoryEvaluable && category.factors.length > 0);
  // When a badge fn is supplied (e.g. Mastery proficiency level), it replaces
  // the default completed/total count. The badge logic lives in the caller —
  // this component contains no module-specific logic.
  const badge = category.scored ? (categoryBadge ? categoryBadge(category) : `${category.completedCount}/${category.totalCount}`) : null;
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm font-semibold text-slate-900">{category.title}</p>
        {badge ? (
          <span className={`text-[11px] font-semibold ${category.status === 'done' ? 'text-emerald-600' : 'text-slate-400'}`}>
            {badge}
          </span>
        ) : null}
      </div>
      <div className="space-y-3">
        {renderFactors ? (
          category.factors.map((factor) => <FactorRow key={factor.id} factor={factor} companyId={companyId} onAction={onAction} />)
        ) : (
          <CapabilityNote category={category} />
        )}
      </div>
    </div>
  );
}

export default function CategoryFactorsPanel({
  evaluation,
  companyId,
  title = 'Readiness factors',
  metricWord = 'ready',
  categoryBadge,
  overallBadge,
  onAction,
}: {
  evaluation: CapabilityEvaluation;
  companyId?: string;
  /** Section label, e.g. "Setup factors" | "Readiness factors" | "Mastery factors". */
  title?: string;
  /** Metric verb, e.g. "complete" | "ready" | "mastery". */
  metricWord?: string;
  /** Optional per-category badge (e.g. Mastery proficiency level); defaults to completed/total. */
  categoryBadge?: (category: EvaluatedCategory) => string | null;
  /** Optional overall badge appended to the header (e.g. overall proficiency level). */
  overallBadge?: string | null;
  /**
   * Optional dispatcher for non-page action kinds (modal / workflow). Wiring it
   * activates those action types WITHOUT changing this panel. Page + external
   * actions navigate directly and never call this.
   */
  onAction?: (action: ResolvedAction) => void;
}) {
  if (evaluation.categories.length === 0) {
    return (
      <div className="rounded-3xl border border-slate-200 bg-slate-50 p-5 shadow-sm">
        <p className="text-sm text-slate-500">Details are loading…</p>
      </div>
    );
  }
  return (
    <div className="rounded-3xl border border-slate-200 bg-slate-50 p-5 shadow-sm">
      <div className="mb-4 flex items-center justify-between">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">{title}</p>
        <p className="text-[11px] font-semibold text-slate-500">
          {evaluation.overallPercent}% {metricWord}
          {overallBadge ? <span className="text-slate-400"> · {overallBadge}</span> : null}
        </p>
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {evaluation.categories.map((category) => (
          <CategoryCard key={category.id} category={category} companyId={companyId} categoryBadge={categoryBadge} onAction={onAction} />
        ))}
      </div>
    </div>
  );
}
