'use client';

import {
  CartesianGrid,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from 'recharts';

type Confidence = 'high' | 'medium' | 'low';

type Props = {
  data: {
    opportunities: Array<{
      keyword: string;
      opportunity_score: number;
      coverage_score: number;
      opportunity_value_score?: number | null;
      priority_bucket?: 'quick_win' | 'strategic' | 'low_priority' | null;
      confidence: Confidence;
    }>;
    confidence: Confidence;
    opportunityReasoning: string;
    insightSentence: string;
  };
};

function confidenceClasses(confidence: Confidence): string {
  if (confidence === 'high') return 'bg-emerald-100 text-emerald-700';
  if (confidence === 'medium') return 'bg-amber-100 text-amber-700';
  return 'bg-slate-100 text-slate-700';
}

export default function OpportunityCoverageMatrix({ data }: Props) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Opportunity Coverage Matrix</p>
          <p className="mt-2 text-sm text-slate-600">{data.opportunityReasoning}</p>
        </div>
        <span className={`rounded-full px-2.5 py-1 text-xs font-semibold uppercase ${confidenceClasses(data.confidence)}`}>
          {data.confidence} confidence
        </span>
      </div>

      {data.opportunities.length > 0 ? (
        <div className="mt-5 h-72">
          <ResponsiveContainer width="100%" height="100%">
            <ScatterChart margin={{ top: 8, right: 12, left: 4, bottom: 12 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis type="number" dataKey="coverage_score" name="Coverage" domain={[0, 100]} tick={{ fill: '#475569', fontSize: 12 }} />
              <YAxis type="number" dataKey="opportunity_score" name="Opportunity" domain={[0, 100]} tick={{ fill: '#475569', fontSize: 12 }} />
              <ZAxis type="number" dataKey="opportunity_score" range={[80, 320]} />
              <Tooltip
                cursor={{ strokeDasharray: '4 4' }}
                contentStyle={{ borderRadius: 12, borderColor: '#cbd5e1' }}
                formatter={(value: number, _name, item: any) => {
                  if (item?.dataKey === 'coverage_score') return [`${Math.round(value)}`, 'Coverage'];
                  return [`${Math.round(value)}`, 'Opportunity'];
                }}
                labelFormatter={(_, payload: any) => payload?.[0]?.payload?.keyword || ''}
              />
              <Scatter data={data.opportunities} fill="#2563eb" />
            </ScatterChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <div className="mt-5 rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
          Available signals indicate limited data coverage, but early patterns suggest gaps in coverage and structure.
        </div>
      )}

      {data.opportunities.length > 0 ? (
        <div className="mt-4 space-y-2">
          {data.opportunities.slice(0, 4).map((item) => (
            <div key={item.keyword} className="flex items-center justify-between gap-4 rounded-lg bg-slate-50 px-3 py-2 text-sm">
              <div>
                <span className="font-medium text-slate-800">{item.keyword}</span>
                <div className="mt-1 flex flex-wrap gap-2">
                  <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[11px] font-semibold uppercase text-slate-700">
                    {item.priority_bucket ? item.priority_bucket.replace(/_/g, ' ') : 'unclassified'}
                  </span>
                  <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[11px] font-semibold uppercase text-slate-700">
                    Data Strength: {item.confidence === 'high' ? 'Strong' : item.confidence === 'medium' ? 'Inferred' : 'Weak'}
                  </span>
                </div>
              </div>
              <span className="text-slate-600">
                Opportunity {item.opportunity_score} / Coverage {item.coverage_score}
                {typeof item.opportunity_value_score === 'number' ? ` / Value ${item.opportunity_value_score}` : ''}
              </span>
            </div>
          ))}
        </div>
      ) : null}

      <div className="mt-4 rounded-lg bg-blue-50 px-3 py-3 text-sm text-blue-900">
        <p className="font-semibold">Why this matters</p>
        <p className="mt-1">{data.insightSentence}</p>
      </div>
    </div>
  );
}

