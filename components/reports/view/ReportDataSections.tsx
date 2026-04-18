import { AlertCircle, TrendingUp, ArrowRight } from 'lucide-react';
import { formatPriorityType, type ReportData } from '@/pages/reports/view/reportView.types';

function getImpactColor(impact: string) {
  switch (impact) {
    case 'high':   return 'bg-red-50 border-red-200 text-red-900';
    case 'medium': return 'bg-yellow-50 border-yellow-200 text-yellow-900';
    case 'low':    return 'bg-green-50 border-green-200 text-green-900';
    default:       return 'bg-gray-50 border-gray-200 text-gray-900';
  }
}

function getImpactBadge(impact: string) {
  const colors = {
    high:   'bg-red-100 text-red-800',
    medium: 'bg-yellow-100 text-yellow-800',
    low:    'bg-green-100 text-green-800',
  };
  return colors[impact as keyof typeof colors] || colors.low;
}

interface ReportDataSectionsProps {
  reportData: ReportData;
}

export default function ReportDataSections({ reportData }: ReportDataSectionsProps) {
  return (
    <>
      {/* KEY INSIGHTS */}
      <section id="insights" className="print-section mb-12 scroll-mt-20">
        <h2 className="mb-6 text-2xl font-bold text-slate-900">
          Key Insights
        </h2>
        <div className="grid gap-4">
          {reportData.insights.map((insight, idx) => (
            <div
              key={idx}
              className="print-card rounded-lg border border-slate-200 bg-white p-5 shadow-sm transition-all hover:shadow-md"
            >
              <div className="flex items-start gap-4">
                <div className="mt-0.5 flex-shrink-0">
                  {insight.icon === 'alert' ? (
                    <AlertCircle size={20} className="text-amber-500" />
                  ) : (
                    <TrendingUp size={20} className="text-green-500" />
                  )}
                </div>
                <div className="flex-1">
                  <p className="font-medium text-slate-900">{insight.text}</p>
                  <p className="mt-2 text-sm text-slate-600">
                    Why it matters: {insight.whyItMatters}
                  </p>
                  <p className="mt-3 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
                    Business impact: {insight.businessImpact}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* PERFORMANCE/AUTHORITY SNAPSHOT */}
      <section id="metrics" className="print-section mb-12 scroll-mt-20">
        <h2 className="mb-6 text-2xl font-bold text-slate-900">
          {reportData.reportType === 'growth'
            ? 'Market Position Metrics'
            : 'Performance Metrics'}
        </h2>
        <div className="grid gap-6 sm:grid-cols-2">
          {reportData.metrics.map((metric, idx) => (
            <div
              key={idx}
              className="print-card rounded-lg border border-slate-200 bg-white p-6 shadow-sm"
            >
              <div className="mb-3 flex items-center justify-between">
                <p className="font-semibold text-slate-900">
                  {metric.label}
                </p>
                <p className="text-xl font-bold text-slate-900">
                  {typeof metric.score === 'number' &&
                  metric.score.toString().includes('.')
                    ? metric.score.toFixed(1) + '%'
                    : metric.score}
                  %
                </p>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-slate-200">
                <div
                  className={`h-full bg-gradient-to-r ${metric.color}`}
                  style={{ width: `${Math.min(metric.score, 100)}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* OPPORTUNITIES */}
      <section id="opportunities" className="print-section mb-12 scroll-mt-20">
        <h2 className="mb-6 text-2xl font-bold text-slate-900">
          Improvement Opportunities
        </h2>
        <div className="grid gap-4">
          {reportData.opportunities.map((opp, idx) => (
            <div
              key={idx}
              className={`print-card rounded-lg border p-6 ${getImpactColor(opp.impact)}`}
            >
              <div className="mb-3 flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-start">
                <h3 className="font-semibold">{opp.title}</h3>
                <div className="flex flex-col gap-2 whitespace-nowrap sm:items-end">
                  <span
                    className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wide ${getImpactBadge(opp.impact)}`}
                  >
                    {opp.impact} Impact
                  </span>
                  <span className="inline-block rounded-full bg-white/50 px-3 py-1 text-xs font-semibold text-slate-700">
                    {opp.priority}
                  </span>
                </div>
              </div>
              <p className="text-sm opacity-90">{opp.description}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ACTIONABLE NEXT STEPS */}
      <section id="actions" className="print-section print-page-break mb-16 scroll-mt-20">
        <h2 className="mb-6 text-2xl font-bold text-slate-900">
          Your Next Steps
        </h2>
        <div className="space-y-4">
          {reportData.nextSteps.map((step, idx) => (
            <div
              key={idx}
              className="print-card rounded-lg border border-slate-200 bg-white p-6 shadow-sm transition-all hover:shadow-md"
            >
              <div className="mb-3 flex items-center gap-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-100 text-sm font-bold text-blue-600">
                  {idx + 1}
                </div>
                <h3 className="font-semibold text-slate-900">
                  {step.action}
                </h3>
              </div>
              <p className="ml-11 text-slate-700">{step.description}</p>
              <p className="ml-11 mt-3 text-sm font-medium text-slate-700">{step.priorityWhy}</p>
              <p className="ml-11 mt-3 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{step.expectedUpside}</p>
              <div className="ml-11 mt-4 flex items-center gap-4 text-xs font-medium uppercase tracking-wide text-slate-500">
                <span>{formatPriorityType(step.priorityType)}</span>
                <span>Effort: {step.effortLevel}</span>
                <span>Outcome: {step.expectedOutcome}</span>
              </div>
              {step.steps.length > 0 ? (
                <ol className="ml-16 mt-4 list-decimal space-y-2 text-sm text-slate-600">
                  {step.steps.map((item, stepIndex) => (
                    <li key={stepIndex}>{item}</li>
                  ))}
                </ol>
              ) : null}
            </div>
          ))}
        </div>
      </section>

      {/* FOOTER CTA */}
      <section className="print-hide rounded-lg border-t border-slate-200 bg-gradient-to-r from-blue-50 to-slate-50 p-8 text-center">
        <h3 className="mb-2 text-xl font-bold text-slate-900">
          Ready to execute?
        </h3>
        <p className="mb-6 text-slate-700">
          This report is your strategic foundation. Start with the highest-impact opportunities and track progress weekly.
        </p>
        <button className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-6 py-3 font-semibold text-white transition-all hover:bg-blue-700">
          Get Implementation Guide
          <ArrowRight size={18} />
        </button>
      </section>
    </>
  );
}
