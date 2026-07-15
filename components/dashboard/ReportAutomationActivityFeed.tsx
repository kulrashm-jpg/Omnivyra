import { useEffect, useState } from 'react';
import Link from 'next/link';
import { apiFetch } from '@/lib/apiFetch';
import { Bell, RefreshCw, ArrowRight, CircleCheck, Clock3, AlertTriangle } from 'lucide-react';

type HighlightTone = 'good' | 'warn' | 'neutral';

type HighlightItem = {
  id: string;
  title: string;
  detail: string;
  tone: HighlightTone;
  sourceLabel?: string;
  sourceHref?: string;
};

type FeedResponse = {
  automationPrioritySignal?: HighlightItem | null;
  snapshotPrioritySignal?: HighlightItem | null;
  showSection?: boolean;
};

function toneMeta(tone: HighlightTone): { icon: React.ReactNode; accent: string; label: string } {
  if (tone === 'good') {
    return {
      icon: <CircleCheck className="h-4 w-4 text-emerald-600" />,
      accent: 'bg-emerald-50 text-emerald-700 border-emerald-200',
      label: 'Healthy',
    };
  }
  if (tone === 'warn') {
    return {
      icon: <AlertTriangle className="h-4 w-4 text-amber-600" />,
      accent: 'bg-amber-50 text-amber-700 border-amber-200',
      label: 'Attention',
    };
  }
  return {
    icon: <Clock3 className="h-4 w-4 text-sky-600" />,
    accent: 'bg-sky-50 text-sky-700 border-sky-200',
    label: 'Review',
  };
}

function SummaryRow({
  label,
  highlight,
  fallback,
}: {
  label: string;
  highlight: HighlightItem | null;
  fallback: string;
}) {
  const meta = toneMeta(highlight?.tone ?? 'neutral');

  return (
    <div className="grid gap-3 border-t border-slate-100 py-4 first:border-t-0 first:pt-0 last:pb-0 md:grid-cols-[150px_minmax(0,1fr)_auto] md:items-start">
      <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">{label}</div>
      <div className="min-w-0">
        <p className="text-sm font-semibold leading-6 text-slate-900">
          {highlight?.title || 'Not available yet'}
        </p>
        <p className="mt-1 text-sm leading-6 text-slate-600">
          {highlight?.detail || fallback}
        </p>
      </div>
      <div className="flex items-center gap-2 md:flex-col md:items-end">
        <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] ${meta.accent}`}>
          {meta.icon}
          {meta.label}
        </span>
        {highlight?.sourceHref && highlight?.sourceLabel ? (
          <Link
            href={highlight.sourceHref}
            className="inline-flex items-center gap-1 text-xs font-semibold text-indigo-600 transition-colors hover:text-indigo-700"
          >
            {highlight.sourceLabel}
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        ) : null}
      </div>
    </div>
  );
}

export default function ReportAutomationActivityFeed({ companyId }: { companyId: string | null }) {
  const [loading, setLoading] = useState(false);
  const [showSection, setShowSection] = useState(false);
  const [automationPrioritySignal, setAutomationPrioritySignal] = useState<HighlightItem | null>(null);
  const [snapshotPrioritySignal, setSnapshotPrioritySignal] = useState<HighlightItem | null>(null);

  useEffect(() => {
    if (!companyId) return;
    let cancelled = false;

    async function load() {
      setLoading(true);
      try {
        const response = await apiFetch(`/api/reports/automation-activity?company_id=${encodeURIComponent(companyId)}`);
        if (!response.ok) return;
        const json = (await response.json()) as FeedResponse;
        if (cancelled) return;
        setShowSection(Boolean(json.showSection));
        setAutomationPrioritySignal(json.automationPrioritySignal ?? null);
        setSnapshotPrioritySignal(json.snapshotPrioritySignal ?? null);
      } catch {
        // non-fatal
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    // W5-6 (audit B-77): skip refreshes while the tab is hidden.
    const timer = setInterval(() => {
      if (typeof document === 'undefined' || document.visibilityState === 'visible') void load();
    }, 60_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [companyId]);

  if (!loading && !showSection) {
    return null;
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
        <div className="flex items-center gap-2">
          <Bell className="h-4 w-4 text-indigo-600" />
          <h3 className="text-sm font-semibold text-gray-900">Latest Snapshot</h3>
        </div>
        <Link
          href="/reports"
          className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 transition-colors hover:text-slate-900"
        >
          Open reports
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>

      <div className="p-5">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-slate-500">
            <RefreshCw className="h-4 w-4 animate-spin" />
            Loading latest snapshot summary...
          </div>
        ) : (
          <div>
            <SummaryRow
              label="Automation"
              highlight={automationPrioritySignal}
              fallback="The most important automation update should explain whether meaningful changes have justified a refresh yet."
            />
            <SummaryRow
              label="Snapshot"
              highlight={snapshotPrioritySignal}
              fallback="The latest snapshot should surface one clear, high-value takeaway from the report."
            />
          </div>
        )}
      </div>
    </div>
  );
}
