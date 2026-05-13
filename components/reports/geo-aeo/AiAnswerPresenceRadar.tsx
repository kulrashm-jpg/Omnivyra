'use client';

import { PolarAngleAxis, PolarGrid, Radar, RadarChart, ResponsiveContainer, Tooltip } from 'recharts';

type Props = {
  data: {
    answer_coverage_score: number | null;
    entity_clarity_score: number | null;
    topical_authority_score: number | null;
    citation_readiness_score: number | null;
    content_structure_score: number | null;
    freshness_score: number | null;
    confidence: 'high' | 'medium' | 'low';
    data_source_strength: 'strong' | 'inferred' | 'weak' | 'missing';
    source_tags: string[] | null;
  };
};

export default function AiAnswerPresenceRadar({ data }: Props) {
  const rows = [
    { label: 'Answer', value: data.answer_coverage_score ?? 0 },
    { label: 'Entity', value: data.entity_clarity_score ?? 0 },
    { label: 'Authority', value: data.topical_authority_score ?? 0 },
    { label: 'Citation', value: data.citation_readiness_score ?? 0 },
    { label: 'Structure', value: data.content_structure_score ?? 0 },
    { label: 'Freshness', value: data.freshness_score ?? 0 },
  ];
  const available = rows.some((row) => row.value > 0);
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">AI Answer Presence Radar</p>
          <p className="mt-2 text-sm text-slate-600">How reusable the site looks for AI answers and citations.</p>
        </div>
        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold uppercase text-slate-700">
          {data.data_source_strength}
        </span>
      </div>
      {available ? (
        <div className="mt-5 h-72">
          <ResponsiveContainer width="100%" height="100%">
            <RadarChart data={rows} outerRadius="70%">
              <PolarGrid stroke="#cbd5e1" />
              <PolarAngleAxis dataKey="label" tick={{ fill: '#475569', fontSize: 12 }} />
              <Radar dataKey="value" stroke="#0f766e" fill="#5eead4" fillOpacity={0.35} />
              <Tooltip formatter={(value: number) => [`${Math.round(value)}/100`, 'Score']} />
            </RadarChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <div className="mt-5 rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">Available signals indicate limited data coverage, but early patterns suggest gaps in coverage and structure.</div>
      )}
      <p className="mt-4 text-xs text-slate-500">Sources: {(data.source_tags ?? ['unclassified']).join(', ')}</p>
    </div>
  );
}

