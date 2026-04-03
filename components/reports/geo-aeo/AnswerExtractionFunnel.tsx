'use client';

import { Funnel, FunnelChart, LabelList, ResponsiveContainer, Tooltip } from 'recharts';

type Props = {
  data: {
    total_queries: number | null;
    answerable_content_pct: number | null;
    structured_content_pct: number | null;
    citation_ready_pct: number | null;
    confidence: 'high' | 'medium' | 'low';
    drop_off_reason_distribution: {
      answer_gap_pct: number | null;
      structure_gap_pct: number | null;
      citation_gap_pct: number | null;
    };
  };
};

export default function AnswerExtractionFunnel({ data }: Props) {
  const chartData = typeof data.total_queries === 'number'
    ? [
        { name: 'Queries', value: data.total_queries, fill: '#99f6e4' },
        { name: 'Answerable %', value: data.answerable_content_pct ?? 0, fill: '#2dd4bf' },
        { name: 'Structured %', value: data.structured_content_pct ?? 0, fill: '#0f766e' },
      ]
    : [];
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Answer Extraction Funnel</p>
          <p className="mt-2 text-sm text-slate-600">Shows how much crawled content is answerable, structured, and citation-ready.</p>
        </div>
        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold uppercase text-slate-700">{data.confidence} confidence</span>
      </div>
      {chartData.length > 0 ? (
        <div className="mt-5 h-64">
          <ResponsiveContainer width="100%" height="100%">
            <FunnelChart>
              <Tooltip formatter={(value: number) => [Math.round(value), 'Value']} />
              <Funnel dataKey="value" data={chartData}>
                <LabelList position="right" fill="#334155" stroke="none" dataKey="name" />
              </Funnel>
            </FunnelChart>
          </ResponsiveContainer>
        </div>
      ) : <div className="mt-5 rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">Available signals indicate limited data coverage, but early patterns suggest gaps in coverage and structure.</div>}
      <div className="mt-4 grid gap-2 sm:grid-cols-3 text-sm text-slate-700">
        <p>Answer gap: {typeof data.drop_off_reason_distribution.answer_gap_pct === 'number' ? `${data.drop_off_reason_distribution.answer_gap_pct}%` : 'Available signals indicate limited data coverage, but early patterns suggest gaps in coverage and structure.'}</p>
        <p>Structure gap: {typeof data.drop_off_reason_distribution.structure_gap_pct === 'number' ? `${data.drop_off_reason_distribution.structure_gap_pct}%` : 'Available signals indicate limited data coverage, but early patterns suggest gaps in coverage and structure.'}</p>
        <p>Citation gap: {typeof data.drop_off_reason_distribution.citation_gap_pct === 'number' ? `${data.drop_off_reason_distribution.citation_gap_pct}%` : 'Available signals indicate limited data coverage, but early patterns suggest gaps in coverage and structure.'}</p>
      </div>
    </div>
  );
}

