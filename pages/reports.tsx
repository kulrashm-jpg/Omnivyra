import React from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { useCompanyContext } from '@/components/CompanyContext';
import { apiFetch } from '@/lib/apiFetch';
import ReportJourneyGuide from '@/components/ReportJourneyGuide';

interface ReportHubCard {
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
  hidden?: boolean;
}

const REPORT_CARDS: ReportHubCard[] = [
  {
    id: 'snapshot',
    icon: 'S',
    category: 'Starter',
    effortBand: 'Free',
    outcome: 'A baseline report that shows gaps, priorities, and quick wins',
    title: 'Digital Authority Snapshot',
    description: 'Start with a focused baseline on visibility, authority, and the fastest improvements your team should prioritize first.',
    bullets: [
      'Best for a first baseline and quick diagnosis',
      'Highlights visibility, authority, and content gaps',
      'Useful for planning the next set of actions',
    ],
    cta: 'Generate Report',
    route: '/reports/digital-authority-snapshot',
    accentFrom: 'from-green-50',
    accentTo: 'to-emerald-50',
    borderColor: 'border-green-200',
    ctaColor: 'bg-green-600 hover:bg-green-700',
  },
  {
    id: 'performance',
    icon: 'P',
    category: 'Behavior',
    effortBand: '40-80 Credits',
    outcome: 'A deeper view of performance, behavior, and conversion friction',
    title: 'Performance Intelligence',
    description: 'Go deeper into how visitors behave, where friction shows up, and which channels are actually contributing value.',
    bullets: [
      'Best for performance and behavior analysis',
      'Helps surface funnel and engagement friction',
      'Useful for sharper optimization decisions',
    ],
    cta: 'Open Performance Report',
    route: '/reports/performance-intelligence',
    accentFrom: 'from-purple-50',
    accentTo: 'to-indigo-50',
    borderColor: 'border-purple-200',
    ctaColor: 'bg-purple-600 hover:bg-purple-700',
  },
  {
    id: 'market',
    icon: 'M',
    category: 'Strategic',
    effortBand: '80-150 Credits',
    outcome: 'A strategic report for positioning, growth direction, and investment',
    title: 'Market & Growth Intelligence',
    description: 'Use a more strategic report to understand positioning, market direction, competitive pressure, and growth priorities.',
    bullets: [
      'Best for strategic market-level planning',
      'Highlights positioning and growth opportunities',
      'Useful for bigger allocation decisions',
    ],
    cta: 'Open Market Report',
    route: '/reports/market-growth-intelligence',
    accentFrom: 'from-red-50',
    accentTo: 'to-orange-50',
    borderColor: 'border-red-200',
    ctaColor: 'bg-red-600 hover:bg-red-700',
  },
  {
    id: 'hidden-future-report',
    icon: 'H',
    category: 'Hidden',
    effortBand: 'Hidden',
    outcome: 'Internal only',
    title: 'Predictive Intelligence Lab',
    description: 'Internal placeholder.',
    bullets: [],
    cta: 'Hidden',
    route: '/reports',
    accentFrom: 'from-gray-50',
    accentTo: 'to-white',
    borderColor: 'border-gray-200',
    ctaColor: 'bg-gray-600 hover:bg-gray-700',
    hidden: true,
  },
];

const SNAPSHOT_DETAILS = [
  {
    title: 'Content Blind Spots',
    desc: 'Topics your audience searches for but your site currently does not cover well.',
  },
  {
    title: 'Competitive Visibility Gap',
    desc: 'Where competitors outrank you and what themes they dominate today.',
  },
  {
    title: 'Keyword Opportunity Clusters',
    desc: 'Groups of realistic opportunities you can target in the next 60-90 days.',
  },
  {
    title: 'Authority Signal Weaknesses',
    desc: 'Areas where trust, topical depth, or consistency can be improved quickly.',
  },
  {
    title: 'Quick Wins Roadmap',
    desc: 'Top changes to prioritize first for maximum impact with minimal effort.',
  },
  {
    title: 'Executive Summary',
    desc: 'A concise summary your team can use immediately for planning and alignment.',
  },
];

const SAMPLE_INSIGHTS = [
  { value: '-60%', tone: 'text-red-600', desc: 'Critical topic coverage gap compared to top competitors.' },
  { value: '2.5x', tone: 'text-orange-600', desc: 'Competitor visibility advantage in your highest-intent segments.' },
  { value: '+340', tone: 'text-green-600', desc: 'Estimated ranking opportunities available with focused execution.' },
];

type ExistingReport = {
  id: string;
  report_id?: string;
  report_type?: string;
  status?: string;
  domain?: string;
  created_at?: string;
  completed_at?: string | null;
};

// Map a stored report_type to the viewer's renderer category (snapshot|performance|growth).
function viewerType(rt?: string): 'snapshot' | 'performance' | 'growth' {
  const t = (rt || '').toLowerCase();
  if (t.includes('performance') || t.includes('competitor')) return 'performance';
  if (t.includes('growth') || t.includes('strategic') || t.includes('market') || t.includes('gap')) return 'growth';
  return 'snapshot';
}
function reportLabel(rt?: string): string {
  const t = (rt || '').toLowerCase();
  if (t === 'snapshot') return 'Digital Authority Snapshot';
  if (t === 'content_readiness') return 'Content Readiness';
  if (t.includes('performance')) return 'Performance Intelligence';
  if (t.includes('growth') || t.includes('market')) return 'Market & Growth Intelligence';
  return (rt || 'Report').replace(/_/g, ' ');
}

export default function ReportsHubPage() {
  const router = useRouter();
  const { selectedCompanyName, selectedCompanyId, userRole } = useCompanyContext();
  const visibleCards = REPORT_CARDS.filter((card) => !card.hidden);
  // View-only roles may open + export reports, but never delete them.
  // Deleting is destructive and outside a viewer's workspace.
  const canDeleteReports = (() => {
    const r = (userRole || '').toUpperCase();
    return r !== 'VIEW_ONLY' && r !== 'VIEWER' && r !== 'CONTENT_ENGAGER';
  })();

  // Existing reports — surfaced so customers see their work instead of only a creation chooser.
  const [reports, setReports] = React.useState<ExistingReport[] | null>(null);
  const [reportsLoading, setReportsLoading] = React.useState(true);
  const [deletingId, setDeletingId] = React.useState<string | null>(null);

  const loadReports = React.useCallback(async () => {
    if (!selectedCompanyId) { setReports([]); setReportsLoading(false); return; }
    setReportsLoading(true);
    try {
      const res = await apiFetch(`/api/reports?company_id=${encodeURIComponent(selectedCompanyId)}`);
      const data = await res.json().catch(() => ({}));
      setReports(Array.isArray(data?.reports) ? (data.reports as ExistingReport[]) : []);
    } catch {
      setReports([]);
    } finally {
      setReportsLoading(false);
    }
  }, [selectedCompanyId]);

  React.useEffect(() => { void loadReports(); }, [loadReports]);

  const openReport = (r: ExistingReport) => { void router.push(`/reports/view/${r.id}?type=${viewerType(r.report_type)}`); };
  const exportReport = (r: ExistingReport) => {
    if (typeof window !== 'undefined') window.open(`/api/reports/${r.id}?type=${viewerType(r.report_type)}&format=pdf`, '_blank', 'noopener');
  };
  const deleteReport = async (r: ExistingReport) => {
    setDeletingId(r.id);
    try { await apiFetch(`/api/reports/${r.id}`, { method: 'DELETE' }); await loadReports(); }
    catch { /* non-destructive on failure — list is reloaded */ }
    finally { setDeletingId(null); }
  };
  const hasReports = !!reports && reports.length > 0;

  return (
    <>
      <Head>
        <title>Reports Hub | Omnivyra</title>
        <meta
          name="description"
          content="Choose your report type: Digital Authority Snapshot, Performance Intelligence, or Market & Growth Intelligence."
        />
      </Head>

      <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 px-3 py-8 sm:px-4 lg:px-6">
        <div className="mx-auto max-w-6xl">
          <button
            onClick={() => router.push('/command-center')}
            className="mb-8 flex items-center gap-2 text-sm text-gray-500 transition-colors hover:text-gray-800"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
            </svg>
            Back to Command Center
          </button>

          {/* Report readiness journey — one canonical "what do I do next?" so a customer reaches a
              complete report without needing to know the scan → evidence → report architecture. */}
          <ReportJourneyGuide companyId={selectedCompanyId} className="mb-8" />

          {/* Your reports — existing work surfaced FIRST so creation never hides it. */}
          {reportsLoading ? (
            <div className="mb-8 rounded-[24px] border border-gray-100 bg-white/80 p-6 text-sm text-gray-500">
              Loading your reports…
            </div>
          ) : hasReports ? (
            <div className="mb-8 rounded-[24px] border border-gray-100 bg-white p-6 shadow-[0_10px_30px_rgba(15,23,42,0.06)]">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-400">Your Reports</p>
                  <h2 className="mt-1 text-xl font-semibold text-gray-900">
                    {reports!.length} report{reports!.length === 1 ? '' : 's'}
                  </h2>
                </div>
                <p className="text-sm text-gray-500">{canDeleteReports ? 'Open, export, or delete — or create a new report below.' : 'Open or export your reports below.'}</p>
              </div>
              <div className="divide-y divide-gray-100">
                {reports!.map((r) => {
                  const when = r.completed_at || r.created_at;
                  return (
                    <div key={r.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                      <button onClick={() => openReport(r)} className="min-w-0 flex-1 text-left">
                        <p className="truncate text-sm font-semibold text-gray-900">{reportLabel(r.report_type)}</p>
                        <p className="mt-0.5 text-xs text-gray-500">
                          {(r.domain || '—')} · {when ? new Date(when).toLocaleDateString() : ''} ·{' '}
                          <span className={r.status === 'completed' ? 'text-green-600' : r.status === 'failed' ? 'text-red-600' : 'text-amber-600'}>
                            {r.status || 'unknown'}
                          </span>
                        </p>
                      </button>
                      <div className="flex items-center gap-2">
                        <button onClick={() => openReport(r)} className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-indigo-700">Open</button>
                        <button onClick={() => exportReport(r)} className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50">Export</button>
                        {canDeleteReports ? (
                          <button onClick={() => deleteReport(r)} disabled={deletingId === r.id} className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 transition-colors hover:bg-red-50 disabled:opacity-50">
                            {deletingId === r.id ? 'Deleting…' : 'Delete'}
                          </button>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}

          <div className="mb-8 rounded-[28px] border border-white/80 bg-white/92 p-6 shadow-[0_24px_60px_rgba(15,23,42,0.08)] backdrop-blur-sm md:p-8">
            <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_240px] lg:items-end">
              <div className="max-w-3xl">
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-500">
                  Report System
                </p>
                <h1 className="text-3xl font-bold tracking-tight text-gray-900 md:text-4xl">
                  Choose the report depth you need
                </h1>
                <p className="mt-3 text-sm leading-relaxed text-gray-600 md:text-base">
                  Start with a focused baseline or move into deeper intelligence. Each path is designed to feel
                  consistent, executive-ready, and useful for teams making real planning decisions.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3 lg:w-[240px]">
                <div className="rounded-2xl border border-gray-100 bg-gray-50 px-3.5 py-3">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-gray-400">Report Types</p>
                  <p className="mt-1 text-base font-semibold text-gray-900">{visibleCards.length}</p>
                </div>
                <div className="rounded-2xl border border-gray-100 bg-gray-50 px-3.5 py-3">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-gray-400">Workspace</p>
                  <p className="mt-1 text-base font-semibold text-gray-900">{selectedCompanyName || 'Omnivyra'}</p>
                </div>
              </div>
            </div>

            <div className="mt-6 grid gap-4 md:grid-cols-3">
              <div className="rounded-2xl border border-gray-100 bg-gray-50/80 px-4 py-3">
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-gray-400">Designed For</p>
                <p className="mt-1 text-sm text-gray-700">Teams moving from first baseline diagnostics into performance and strategic intelligence.</p>
              </div>
              <div className="rounded-2xl border border-gray-100 bg-gray-50/80 px-4 py-3">
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-gray-400">Decision Quality</p>
                <p className="mt-1 text-sm text-gray-700">Each path helps teams choose the right depth of insight before committing time or credits.</p>
              </div>
              <div className="rounded-2xl border border-gray-100 bg-gray-50/80 px-4 py-3">
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-gray-400">Output Standard</p>
                <p className="mt-1 text-sm text-gray-700">Professional reports built for clearer analysis, stronger planning, and executive-level review.</p>
              </div>
            </div>
          </div>

          <div className="mb-5 flex items-center justify-between">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-400">Select A Report Type</p>
              <p className="mt-1 text-sm text-gray-600">Every card below leads into a more deliberate reporting path with stronger information hierarchy.</p>
            </div>
            <p className="hidden text-sm text-gray-500 md:block">{visibleCards.length} report paths</p>
          </div>

          <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
            {visibleCards.map((card) => (
              <div
                key={card.id}
                onClick={() => router.push(card.route)}
                className={`group flex min-h-[500px] cursor-pointer flex-col rounded-[24px] border bg-gradient-to-br ${card.accentFrom} via-white ${card.accentTo} ${card.borderColor} p-6 shadow-[0_10px_30px_rgba(15,23,42,0.06)] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_18px_42px_rgba(15,23,42,0.10)]`}
              >
                <div className="mb-5 flex items-start justify-between gap-3">
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

                <div className="flex h-[126px] flex-col">
                  <h2 className="h-[56px] text-xl font-semibold tracking-tight text-gray-900">{card.title}</h2>
                  <p className="mt-3 h-[56px] text-sm leading-relaxed text-gray-600">{card.description}</p>
                </div>

                <div className="mt-5 flex h-[74px] flex-col rounded-2xl border border-white/80 bg-white/75 px-4 py-3">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-gray-400">Primary Outcome</p>
                  <p className="mt-1 text-sm font-medium leading-5 text-gray-800">{card.outcome}</p>
                </div>

                <ul className="mt-5 flex h-[102px] flex-col justify-start space-y-2 text-sm">
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
                    router.push(card.route);
                  }}
                  className={`mt-6 w-full rounded-xl py-3 text-sm font-semibold text-white shadow-sm transition-colors ${card.ctaColor}`}
                >
                  {card.cta}
                </button>
              </div>
            ))}
          </div>

          <div className="mt-12 rounded-[28px] border border-green-200 bg-gradient-to-br from-green-50 to-white p-6 shadow-[0_16px_40px_rgba(15,23,42,0.05)] md:p-8">
            <div className="mb-6">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-green-700">Free Report Breakdown</p>
              <h2 className="mt-1 text-2xl font-semibold text-gray-900">What the Digital Authority Snapshot Covers</h2>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-gray-600">
                The free report is a real baseline, not just a teaser. It gives a clear view of your content performance,
                authority gaps, and the fastest wins your team can act on first.
              </p>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              {SNAPSHOT_DETAILS.map((item) => (
                <div key={item.title} className="rounded-2xl border border-green-200 bg-white px-4 py-4">
                  <h3 className="text-sm font-semibold text-gray-900">{item.title}</h3>
                  <p className="mt-1 text-sm text-gray-600">{item.desc}</p>
                </div>
              ))}
            </div>

            <div className="mt-6 rounded-2xl border border-green-300 bg-white px-4 py-4">
              <p className="text-sm text-gray-700">
                <span className="font-semibold text-green-700">Free report policy:</span> Your first Digital Authority Snapshot does not require payment.
                Premium reports use credits after submission and confirmation.
              </p>
            </div>
          </div>

          <div className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-3">
            {SAMPLE_INSIGHTS.map((item) => (
              <div key={item.value} className="rounded-2xl border border-gray-200 bg-white px-4 py-4">
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-gray-400">Sample Insight</p>
                <p className={`mt-2 text-2xl font-semibold ${item.tone}`}>{item.value}</p>
                <p className="mt-1 text-sm text-gray-600">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
