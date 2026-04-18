import Link from 'next/link';
import { ArrowRight, X } from 'lucide-react';
import type { NextActionPrompt } from '@/hooks/useNextActionPrompt';

type NextActionBarProps = {
  prompt: NextActionPrompt | null;
  onDismiss: () => void;
};

export default function NextActionBar({ prompt, onDismiss }: NextActionBarProps) {
  if (!prompt) return null;

  return (
    <div className="fixed right-4 top-[7.6rem] z-30 w-[min(320px,calc(100vw-2rem))]">
      <div className="rounded-2xl border border-slate-200 bg-white/95 p-3 shadow-xl backdrop-blur">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">
              Next Best Action
            </p>
            <div className="mt-1 flex items-center gap-2 text-slate-900">
              <prompt.icon className="h-4 w-4 shrink-0 text-sky-600" />
              <span className="text-sm font-semibold leading-5">{prompt.label}</span>
            </div>
            <p className="mt-1 text-sm leading-5 text-slate-500">{prompt.description}</p>
          </div>
          <button
            type="button"
            onClick={onDismiss}
            className="rounded-lg p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
            title="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="mt-3 flex justify-end">
          <Link
            href={prompt.href}
            className="inline-flex items-center gap-2 rounded-xl bg-sky-600 px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-sky-700"
          >
            Go
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </div>
    </div>
  );
}
