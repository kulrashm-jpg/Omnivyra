'use client';

type RadarEntity = {
  name: string;
  content_score: number;
  keyword_coverage_score: number;
  authority_score: number;
  technical_score: number;
  ai_answer_presence_score: number;
};

type Props = {
  data: {
    competitors: RadarEntity[];
    user: Omit<RadarEntity, 'name'>;
    confidence: 'high' | 'medium' | 'low';
  };
};

const DIMENSIONS: Array<{ key: keyof Omit<RadarEntity, 'name'>; label: string }> = [
  { key: 'content_score', label: 'Content' },
  { key: 'keyword_coverage_score', label: 'Keywords' },
  { key: 'authority_score', label: 'Authority' },
  { key: 'technical_score', label: 'Technical' },
  { key: 'ai_answer_presence_score', label: 'AI Answers' },
];

function avg(values: number[]): number {
  if (values.length === 0) return 0;
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

export default function CompetitorPositioningRadar({ data }: Props) {
  const competitorAverage = {
    content_score: avg(data.competitors.map((item) => item.content_score)),
    keyword_coverage_score: avg(data.competitors.map((item) => item.keyword_coverage_score)),
    authority_score: avg(data.competitors.map((item) => item.authority_score)),
    technical_score: avg(data.competitors.map((item) => item.technical_score)),
    ai_answer_presence_score: avg(data.competitors.map((item) => item.ai_answer_presence_score)),
  };

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Competitor Positioning Radar</p>
          <p className="mt-1 text-sm text-slate-600">User vs competitor average across SEO and GEO/AEO dimensions.</p>
        </div>
        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700">
          {data.confidence} confidence
        </span>
      </div>

      <div className="mt-5 space-y-4">
        {DIMENSIONS.map((dimension) => {
          const userValue = data.user[dimension.key];
          const competitorValue = competitorAverage[dimension.key];
          return (
            <div key={dimension.key}>
              <div className="mb-2 flex items-center justify-between text-xs text-slate-600">
                <span className="font-semibold text-slate-800">{dimension.label}</span>
                <span>User {userValue} vs Competitors {competitorValue}</span>
              </div>
              <div className="grid gap-2">
                <div className="h-2.5 rounded-full bg-slate-100">
                  <div className="h-full rounded-full bg-blue-500" style={{ width: `${Math.max(0, Math.min(userValue, 100))}%` }} />
                </div>
                <div className="h-2.5 rounded-full bg-slate-100">
                  <div className="h-full rounded-full bg-amber-500" style={{ width: `${Math.max(0, Math.min(competitorValue, 100))}%` }} />
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {data.competitors.length > 0 ? (
        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          {data.competitors.slice(0, 4).map((competitor, index) => (
            <div key={`${competitor.name}-${index}`} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <p className="text-sm font-semibold text-slate-900">{competitor.name}</p>
              <p className="mt-1 text-xs text-slate-600">
                SEO {Math.round((competitor.content_score + competitor.keyword_coverage_score + competitor.authority_score + competitor.technical_score) / 4)} / GEO-AEO {competitor.ai_answer_presence_score}
              </p>
            </div>
          ))}
        </div>
      ) : (
        <div className="mt-5 rounded-lg border border-dashed border-slate-200 bg-slate-50 px-4 py-5 text-sm text-slate-500">
          Available signals indicate limited data coverage, but early patterns suggest gaps in coverage and structure.
        </div>
      )}
    </section>
  );
}

