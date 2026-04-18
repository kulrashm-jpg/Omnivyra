import React from 'react';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';

type Action = {
  label: string;
  href?: string;
  onClick?: () => void;
};

type EmptyStateProps = {
  title: string;
  description: string;
  primaryAction: Action;
  secondaryAction?: Action;
  illustration?: React.ReactNode;
  examplePreview?: React.ReactNode;
  tone?: 'first-time' | 'no-results' | 'partial';
};

function ActionButton({
  action,
  kind,
}: {
  action: Action;
  kind: 'primary' | 'secondary';
}) {
  const className =
    kind === 'primary'
      ? 'inline-flex items-center gap-2 rounded-xl bg-[#0B5ED7] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#094db8]'
      : 'inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50';

  if (action.href) {
    return (
      <Link href={action.href} className={className}>
        {action.label}
        {kind === 'primary' ? <ArrowRight className="h-4 w-4" /> : null}
      </Link>
    );
  }

  return (
    <button type="button" onClick={action.onClick} className={className}>
      {action.label}
      {kind === 'primary' ? <ArrowRight className="h-4 w-4" /> : null}
    </button>
  );
}

export default function EmptyState({
  title,
  description,
  primaryAction,
  secondaryAction,
  illustration,
  examplePreview,
  tone = 'first-time',
}: EmptyStateProps) {
  const toneCopy =
    tone === 'partial'
      ? 'You are almost there'
      : tone === 'no-results'
        ? 'No results found'
        : 'Start here';

  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
      <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr] lg:items-center">
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            {illustration ? (
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-sky-50 text-sky-600">
                {illustration}
              </div>
            ) : null}
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">{toneCopy}</p>
              <h3 className="mt-1 text-2xl font-semibold text-slate-900">{title}</h3>
            </div>
          </div>
          <p className="mt-3 max-w-2xl text-sm text-slate-600">{description}</p>
          <div className="mt-5 flex flex-wrap gap-3">
            <ActionButton action={primaryAction} kind="primary" />
            {secondaryAction ? <ActionButton action={secondaryAction} kind="secondary" /> : null}
          </div>
        </div>

        {examplePreview ? <div className="min-w-0">{examplePreview}</div> : null}
      </div>
    </div>
  );
}
