/**
 * ReportJourneyGuide  (BETA-EVIDENCE-EXEC-003)
 *
 * The single, shared surface that tells a customer where they are in the scan → evidence → report journey
 * and the one thing to do next. Every entry point (Reports hub, Command Center, Website / Company detail)
 * can mount this; they all read the same GET /api/reports/journey, so guidance is consistent by construction.
 *
 * Presentational + read-only. It NEVER triggers a scan or a report build — it links the customer to the
 * existing pages where those actions already live.
 */
import React from 'react';
import { useRouter } from 'next/router';
import { apiFetch } from '@/lib/apiFetch';

type JourneyState =
  | 'website_required'
  | 'scan_required'
  | 'report_generating'
  | 'report_preliminary'
  | 'evidence_incomplete'
  | 'evidence_stale'
  | 'ready_to_generate'
  | 'report_available';

interface ReportJourney {
  state: JourneyState;
  blocking: boolean;
  headline: string;
  explanation: string;
  current_status: string;
  next_action: { label: string; kind: string; href: string | null };
  expected_outcome: string;
  signals: {
    website_scanned: boolean;
    scanned_pages: number;
    last_scanned_at: string | null;
    scan_stale: boolean;
    input_ready: boolean;
    latest_report_status: string;
  };
}

/** Tone per state — blocking/guidance states are amber, ready/available are green, in-progress is indigo. */
function toneFor(state: JourneyState): { ring: string; chip: string; btn: string; dot: string } {
  switch (state) {
    case 'report_available':
    case 'ready_to_generate':
      return { ring: 'border-green-200 bg-green-50/60', chip: 'bg-green-100 text-green-700', btn: 'bg-green-600 hover:bg-green-700', dot: 'bg-green-500' };
    case 'report_generating':
      return { ring: 'border-indigo-200 bg-indigo-50/60', chip: 'bg-indigo-100 text-indigo-700', btn: 'bg-indigo-600 hover:bg-indigo-700', dot: 'bg-indigo-500' };
    case 'evidence_stale':
      return { ring: 'border-amber-200 bg-amber-50/60', chip: 'bg-amber-100 text-amber-700', btn: 'bg-amber-600 hover:bg-amber-700', dot: 'bg-amber-500' };
    default:
      // website_required / scan_required / report_preliminary / evidence_incomplete — action needed.
      return { ring: 'border-amber-200 bg-amber-50/60', chip: 'bg-amber-100 text-amber-800', btn: 'bg-amber-600 hover:bg-amber-700', dot: 'bg-amber-500' };
  }
}

function stateLabel(state: JourneyState): string {
  const map: Record<JourneyState, string> = {
    website_required: 'Website required',
    scan_required: 'Scan required',
    report_generating: 'Generating',
    report_preliminary: 'Preliminary',
    evidence_incomplete: 'Almost ready',
    evidence_stale: 'Evidence stale',
    ready_to_generate: 'Ready to generate',
    report_available: 'Report ready',
  };
  return map[state];
}

export default function ReportJourneyGuide({ companyId, className }: { companyId?: string | null; className?: string }) {
  const router = useRouter();
  const [journey, setJourney] = React.useState<ReportJourney | null>(null);
  const [loading, setLoading] = React.useState(true);

  const load = React.useCallback(async () => {
    if (!companyId) { setJourney(null); setLoading(false); return; }
    setLoading(true);
    try {
      const res = await apiFetch(`/api/reports/journey?companyId=${encodeURIComponent(companyId)}`);
      const data = (await res.json().catch(() => null)) as ReportJourney | null;
      setJourney(data && (data as { state?: string }).state ? data : null);
    } catch {
      setJourney(null);
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  React.useEffect(() => { void load(); }, [load]);

  if (loading) {
    return (
      <div className={`rounded-[24px] border border-gray-100 bg-white/80 p-5 text-sm text-gray-500 ${className ?? ''}`}>
        Checking where you are in your report journey…
      </div>
    );
  }
  if (!journey) return null;

  const tone = toneFor(journey.state);
  const go = () => { if (journey.next_action.href) void router.push(journey.next_action.href); };

  return (
    <div className={`rounded-[24px] border ${tone.ring} p-5 sm:p-6 ${className ?? ''}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] ${tone.chip}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${tone.dot} ${journey.state === 'report_generating' ? 'animate-pulse' : ''}`} />
          {stateLabel(journey.state)}
        </span>
        <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-gray-400">Report readiness journey</span>
      </div>

      <h3 className="mt-3 text-lg font-semibold text-gray-900">{journey.headline}</h3>
      <p className="mt-1.5 text-sm leading-relaxed text-gray-600">{journey.explanation}</p>

      <dl className="mt-4 grid gap-3 sm:grid-cols-2">
        <div>
          <dt className="text-[11px] font-semibold uppercase tracking-[0.12em] text-gray-400">Current status</dt>
          <dd className="mt-0.5 text-sm text-gray-700">{journey.current_status}</dd>
        </div>
        <div>
          <dt className="text-[11px] font-semibold uppercase tracking-[0.12em] text-gray-400">What happens next</dt>
          <dd className="mt-0.5 text-sm text-gray-700">{journey.expected_outcome}</dd>
        </div>
      </dl>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        {journey.next_action.href ? (
          <button onClick={go} className={`rounded-xl px-4 py-2 text-sm font-semibold text-white transition-colors ${tone.btn}`}>
            {journey.next_action.label}
          </button>
        ) : null}
        <span className="text-xs text-gray-400">
          {journey.signals.website_scanned
            ? `Last scan ${journey.signals.last_scanned_at ? new Date(journey.signals.last_scanned_at).toLocaleDateString() : '—'} · ${journey.signals.scanned_pages} pages`
            : 'Website not scanned yet'}
        </span>
      </div>
    </div>
  );
}
