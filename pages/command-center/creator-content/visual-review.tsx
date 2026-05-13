import React from 'react';
import { useRouter } from 'next/router';
import { useCompanyContext } from '../../../components/CompanyContext';
import {
  clearCreatorVisualReviewQueue,
  readCreatorVisualReviewQueue,
  updateCreatorVisualReviewItem,
  type CreatorVisualReviewItem,
  type CreatorVisualReviewVerdict,
} from '../../../lib/content/creatorVisualReview';

const VERDICTS: Array<{ id: CreatorVisualReviewVerdict; label: string; className: string }> = [
  { id: 'approved', label: 'Approve', className: 'border-emerald-200 bg-emerald-50 text-emerald-800' },
  { id: 'revise', label: 'Revise', className: 'border-amber-200 bg-amber-50 text-amber-800' },
  { id: 'weak', label: 'Weak', className: 'border-red-200 bg-red-50 text-red-800' },
];

function getQuality(item: CreatorVisualReviewItem) {
  const quality = item.metadata?.overlay_quality && typeof item.metadata.overlay_quality === 'object'
    ? item.metadata.overlay_quality as { score?: unknown; flags?: unknown; preset?: unknown }
    : {};
  return {
    score: Number(quality.score ?? item.score ?? 0) || null,
    preset: String(quality.preset || 'unknown'),
    flags: Array.isArray(quality.flags) ? quality.flags.map(String) : [],
  };
}

function verdictClass(verdict: CreatorVisualReviewVerdict): string {
  if (verdict === 'approved') return 'bg-emerald-600 text-white';
  if (verdict === 'revise') return 'bg-amber-500 text-white';
  if (verdict === 'weak') return 'bg-red-600 text-white';
  return 'bg-slate-100 text-slate-700';
}

export default function CreatorVisualReviewPage() {
  const router = useRouter();
  const { user, authChecked, isLoading } = useCompanyContext();
  const [items, setItems] = React.useState<CreatorVisualReviewItem[]>([]);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [filter, setFilter] = React.useState<'all' | CreatorVisualReviewVerdict>('all');

  React.useEffect(() => {
    if (authChecked && !user?.userId) router.replace('/login');
  }, [authChecked, router, user?.userId]);

  React.useEffect(() => {
    const queue = readCreatorVisualReviewQueue();
    setItems(queue);
    setSelectedId((current) => current || queue[0]?.id || null);
  }, []);

  const visibleItems = React.useMemo(
    () => filter === 'all' ? items : items.filter((item) => item.verdict === filter),
    [filter, items],
  );
  const selected = visibleItems.find((item) => item.id === selectedId) || visibleItems[0] || null;
  const comparison = visibleItems.filter((item) => item.id !== selected?.id).slice(0, 3);

  const setVerdict = (item: CreatorVisualReviewItem, verdict: CreatorVisualReviewVerdict) => {
    setItems(updateCreatorVisualReviewItem(item.id, { verdict }));
  };

  const setNotes = (item: CreatorVisualReviewItem, notes: string) => {
    setItems(updateCreatorVisualReviewItem(item.id, { notes }));
  };

  if (!authChecked || isLoading || !user?.userId) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <div className="h-10 w-10 animate-spin rounded-full border-b-2 border-slate-800" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-8">
      <div className="mx-auto max-w-7xl">
        <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
          <div>
            <button
              type="button"
              onClick={() => router.push('/command-center/creator-content')}
              className="mb-4 text-sm font-semibold text-slate-500 hover:text-slate-900"
            >
              Back to Creator
            </button>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Internal Visual Review</p>
            <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950">Writer to Creator Image Calibration</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
              Review generated social creatives with preserved overlay diagnostics, platform preset metadata, and quick taste-level decisions.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {(['all', 'unreviewed', 'approved', 'revise', 'weak'] as const).map((id) => (
              <button
                key={id}
                type="button"
                onClick={() => setFilter(id)}
                className={`rounded-full px-3 py-2 text-xs font-semibold ${filter === id ? 'bg-slate-900 text-white' : 'bg-white text-slate-700 border border-slate-200'}`}
              >
                {id}
              </button>
            ))}
            <button
              type="button"
              onClick={() => {
                clearCreatorVisualReviewQueue();
                setItems([]);
                setSelectedId(null);
              }}
              className="rounded-full border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-500 hover:text-slate-900"
            >
              Clear queue
            </button>
          </div>
        </div>

        {visibleItems.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-slate-200 bg-white px-6 py-14 text-center">
            <p className="text-lg font-semibold text-slate-900">No review candidates yet</p>
            <p className="mt-2 text-sm text-slate-600">Generate Image, Banner, or Infographic outputs from Writer or Creator. They will appear here automatically.</p>
          </div>
        ) : (
          <div className="grid gap-5 lg:grid-cols-[300px_minmax(0,1fr)]">
            <aside className="space-y-3">
              {visibleItems.map((item) => {
                const quality = getQuality(item);
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setSelectedId(item.id)}
                    className={`w-full rounded-2xl border bg-white p-3 text-left transition ${selected?.id === item.id ? 'border-slate-900 shadow-md' : 'border-slate-200 hover:border-slate-300'}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-semibold uppercase text-slate-600">{item.platform}</span>
                      <span className={`rounded-full px-2 py-1 text-[10px] font-semibold ${verdictClass(item.verdict)}`}>{item.verdict}</span>
                    </div>
                    <p className="mt-2 line-clamp-2 text-sm font-semibold text-slate-900">{item.title}</p>
                    <p className="mt-1 text-xs text-slate-500">{item.assetType} | Quality {quality.score ?? 'n/a'} | {quality.preset}</p>
                  </button>
                );
              })}
            </aside>

            {selected ? (
              <main className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
                <section className="space-y-5">
                  <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">Primary Preview</p>
                        <h2 className="mt-1 text-lg font-semibold text-slate-950">{selected.title}</h2>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {VERDICTS.map((verdict) => (
                          <button
                            key={verdict.id}
                            type="button"
                            onClick={() => setVerdict(selected, verdict.id)}
                            className={`rounded-full border px-3 py-2 text-xs font-semibold ${verdict.className}`}
                          >
                            {verdict.label}
                          </button>
                        ))}
                      </div>
                    </div>
                    <img src={selected.mediaUrl} alt={selected.title} className="max-h-[720px] w-full rounded-2xl bg-slate-100 object-contain" />
                  </div>

                  {comparison.length > 0 ? (
                    <div className="rounded-3xl border border-slate-200 bg-white p-4">
                      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">Side-by-side Comparison</p>
                      <div className="mt-3 grid gap-3 md:grid-cols-3">
                        {comparison.map((item) => (
                          <button key={item.id} type="button" onClick={() => setSelectedId(item.id)} className="rounded-2xl border border-slate-200 bg-slate-50 p-2 text-left hover:border-slate-300">
                            <img src={item.mediaUrl} alt={item.title} className="h-48 w-full rounded-xl bg-white object-contain" />
                            <p className="mt-2 text-xs font-semibold text-slate-700">{item.platform} | {item.assetType}</p>
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </section>

                <aside className="space-y-4">
                  <div className="rounded-3xl border border-slate-200 bg-white p-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">Quality Metadata</p>
                    {(() => {
                      const quality = getQuality(selected);
                      return (
                        <div className="mt-3 space-y-3 text-sm text-slate-700">
                          <div className="grid grid-cols-2 gap-2">
                            <div className="rounded-2xl bg-slate-50 p-3">
                              <p className="text-[10px] font-semibold uppercase text-slate-400">Score</p>
                              <p className="mt-1 text-lg font-semibold text-slate-950">{quality.score ?? 'n/a'}</p>
                            </div>
                            <div className="rounded-2xl bg-slate-50 p-3">
                              <p className="text-[10px] font-semibold uppercase text-slate-400">Preset</p>
                              <p className="mt-1 text-sm font-semibold text-slate-950">{quality.preset}</p>
                            </div>
                          </div>
                          <div>
                            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">Flags</p>
                            <div className="mt-2 flex flex-wrap gap-2">
                              {quality.flags.length ? quality.flags.map((flag) => (
                                <span key={flag} className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-800">{flag}</span>
                              )) : <span className="text-xs text-slate-500">No flags</span>}
                            </div>
                          </div>
                        </div>
                      );
                    })()}
                  </div>

                  <div className="rounded-3xl border border-slate-200 bg-white p-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">Review Notes</p>
                    <textarea
                      value={selected.notes || ''}
                      onChange={(event) => setNotes(selected, event.target.value)}
                      rows={8}
                      placeholder="Taste-level feedback: focal clarity, overlay elegance, CTA fit, brand subtlety, platform realism..."
                      className="mt-3 w-full rounded-2xl border border-slate-200 px-3 py-3 text-sm text-slate-900 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-100"
                    />
                  </div>

                  <div className="rounded-3xl border border-slate-200 bg-white p-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">Overlay Text</p>
                    <pre className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap rounded-2xl bg-slate-50 p-3 text-xs leading-5 text-slate-700">
                      {JSON.stringify(selected.overlayText || selected.metadata?.overlay_text || {}, null, 2)}
                    </pre>
                  </div>
                </aside>
              </main>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
