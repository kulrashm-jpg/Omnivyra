import Link from 'next/link';
import { AlertCircle, CheckCircle2, X } from 'lucide-react';

export type PreflightItem = {
  key: string;
  label: string;
  helpText: string;
  href: string;
  status: 'done' | 'in_progress' | 'missing';
};

type Props = {
  open: boolean;
  title: string;
  actionLabel: string;
  required: PreflightItem[];
  recommended: PreflightItem[];
  onClose: () => void;
  onContinue: () => void;
};

function GuidanceList({
  title,
  items,
}: {
  title: string;
  items: PreflightItem[];
}) {
  const actionableItems = items.filter((item) => item.status !== 'done');
  if (actionableItems.length === 0) return null;

  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">{title}</p>
      <div className="mt-3 space-y-3">
        {actionableItems.map((item) => {
          const done = item.status === 'done';
          const Icon = done ? CheckCircle2 : AlertCircle;
          const tone = done ? 'text-emerald-600' : item.status === 'in_progress' ? 'text-amber-600' : 'text-slate-300';

          return (
            <div key={item.key} className="flex items-start gap-3">
              <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${tone}`} />
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <p className={`text-sm font-medium ${done ? 'text-slate-400 line-through decoration-slate-300' : 'text-slate-900'}`}>
                    {item.label}
                  </p>
                  {!done ? (
                    <Link href={item.href} className="text-xs font-semibold text-sky-700 hover:underline">
                      Open
                    </Link>
                  ) : null}
                </div>
                <p className="mt-1 text-sm leading-6 text-slate-600">{item.helpText}</p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function CommandCenterPreflightModal({
  open,
  title,
  actionLabel,
  required,
  recommended,
  onClose,
  onContinue,
}: Props) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 px-4 py-6">
      <div className="w-full max-w-2xl rounded-3xl border border-slate-200 bg-white p-6 shadow-2xl sm:p-7">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Before you continue</p>
            <h3 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">{title}</h3>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              You can keep going now, but these items will improve the result and reduce trial-and-error.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-slate-200 text-slate-500 hover:border-slate-300 hover:text-slate-700"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-6 grid gap-4">
          <GuidanceList title="Required before best results" items={required} />
          <GuidanceList title="Recommended for a better outcome" items={recommended} />
        </div>

        <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex min-h-[48px] items-center justify-center rounded-2xl border border-slate-200 px-4 py-3 text-sm font-semibold text-slate-700 hover:border-slate-300"
          >
            Close
          </button>
          <button
            type="button"
            onClick={onContinue}
            className="inline-flex min-h-[48px] items-center justify-center rounded-2xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white hover:bg-slate-800"
          >
            Continue to {actionLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
