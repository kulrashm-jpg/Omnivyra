'use client';

import { CartesianGrid, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis } from 'recharts';

type Props = {
  data: {
    entities: Array<{
      entity: string;
      relevance_score: number;
      coverage_score: number;
    }>;
    confidence: 'high' | 'medium' | 'low';
  };
};

export default function EntityAuthorityMap({ data }: Props) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Entity Authority Map</p>
          <p className="mt-2 text-sm text-slate-600">Maps how clearly the site reinforces important entities across coverage and relevance.</p>
        </div>
        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold uppercase text-slate-700">{data.confidence} confidence</span>
      </div>
      {data.entities.length > 0 ? (
        <div className="mt-5 h-72">
          <ResponsiveContainer width="100%" height="100%">
            <ScatterChart margin={{ top: 8, right: 12, left: 4, bottom: 12 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis type="number" dataKey="coverage_score" name="Coverage" domain={[0, 100]} tick={{ fill: '#475569', fontSize: 12 }} />
              <YAxis type="number" dataKey="relevance_score" name="Relevance" domain={[0, 100]} tick={{ fill: '#475569', fontSize: 12 }} />
              <ZAxis type="number" dataKey="relevance_score" range={[80, 300]} />
              <Tooltip labelFormatter={(_, payload: any) => payload?.[0]?.payload?.entity || ''} />
              <Scatter data={data.entities} fill="#0f766e" />
            </ScatterChart>
          </ResponsiveContainer>
        </div>
      ) : <div className="mt-5 rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">Available signals indicate limited data coverage, but early patterns suggest gaps in coverage and structure.</div>}
    </div>
  );
}

