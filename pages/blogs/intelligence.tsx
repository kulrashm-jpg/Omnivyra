import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useRef } from 'react';
import { AlertTriangle, ArrowRight, BarChart2, Bot, Lightbulb, Loader2, RefreshCw, Sparkles, TrendingUp } from 'lucide-react';
import { useCompanyContext } from '../../components/CompanyContext';
import AIBlogCardModal from '../../components/blog/AIBlogCardModal';
import { useBlogIntelligence } from '../../components/blog/intelligence/useBlogIntelligence';
import StepTracker, { type StepDef } from '../../components/progress/StepTracker';

const INTEL_LOAD_STAGES: StepDef[] = [
  { key: 'coverage',    label: 'Reading existing blog coverage', etaSeconds: 3 },
  { key: 'gaps',        label: 'Detecting topic gaps',           etaSeconds: 4 },
  { key: 'ranking',     label: 'Ranking opportunities',          etaSeconds: 3 },
  { key: 'positioning', label: 'Enriching with positioning',     etaSeconds: 4 },
];

const PRIORITY_BADGES: Record<string, string> = {
  high: 'bg-red-100 text-red-700',
  medium: 'bg-amber-100 text-amber-700',
  low: 'bg-slate-100 text-slate-600',
};

const WORD_TIER_META: Record<string, { label: string; posture: string; outcome: string }> = {
  '800': {
    label: '800+ words',
    posture: 'Fast-turn perspective',
    outcome: 'Sharp market commentary with a concise executive read.',
  },
  '1200': {
    label: '1,200+ words',
    posture: 'Balanced authority',
    outcome: 'A polished B2B blog with enough depth for search and trust-building.',
  },
  '1600': {
    label: '1,600+ words',
    posture: 'Deep analysis',
    outcome: 'A more strategic draft with room for frameworks, nuance, and defensible points of view.',
  },
  '2000': {
    label: '2,000+ words',
    posture: 'Cornerstone authority',
    outcome: 'A flagship long-form asset for category ownership and premium editorial quality.',
  },
};

const SUGGESTION_COUNTS: Record<string, number> = {
  '800': 3,
  '1200': 5,
  '1600': 6,
  '2000': 8,
};

export default function BlogIntelligencePage() {
  const router = useRouter();
  const { selectedCompanyId, user, isLoading: authLoading } = useCompanyContext();
  const wordsParam =
    typeof router.query.words === 'string' && ['800', '1200', '1600', '2000'].includes(router.query.words)
      ? router.query.words
      : null;

  const wordTierMeta = WORD_TIER_META[wordsParam || '1200'];
  const suggestionCount = SUGGESTION_COUNTS[wordsParam || '1200'] || 3;
  const {
    posts,
    companyProfile,
    companyContextNote,
    loading,
    error,
    isAICardModalOpen,
    setIsAICardModalOpen,
    cardSuggestions,
    suggestionsLoading,
    fetchIntelligence,
    gaps,
    recommendations,
    allMetrics,
  } = useBlogIntelligence({
    selectedCompanyId,
    suggestionCount,
  });

  const loadStartedAtRef = useRef<number>(Date.now());

  const handleAICardCreated = (card: { topic: string }) => {
    setIsAICardModalOpen(false);
    void router.push({
      pathname: '/blogs/template',
      query: {
        ...(wordsParam ? { words: wordsParam } : {}),
        topic: encodeURIComponent(card.topic),
      },
    });
  };

  if (authLoading || loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
        <div className="w-full max-w-md">
          <StepTracker
            stages={INTEL_LOAD_STAGES}
            startedAt={loadStartedAtRef.current}
            accent="sky"
            title="Analyzing your blog opportunity"
            subLabel="Comparing your coverage to market signals"
            variant="card"
          />
        </div>
      </div>
    );
  }

  if (!user?.userId) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <p className="text-sm text-gray-500">Sign in to continue.</p>
      </div>
    );
  }

  return (
    <>
      <Head>
        <title>Blog Intelligence | Omnivyra</title>
      </Head>

      <div className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(59,130,246,0.07),_transparent_35%),linear-gradient(180deg,#f8fafc_0%,#eef2ff_50%,#f8fafc_100%)] p-6">
        <div className="mx-auto max-w-6xl">
          <div className="mb-8 flex items-start justify-between gap-4">
            <div className="max-w-3xl">
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                Step 2 of 5 • Blog Intelligence
              </p>
              <h1 className="text-3xl font-semibold tracking-tight text-slate-950">
                Choose the strongest editorial direction
              </h1>
              <p className="mt-3 text-sm leading-6 text-slate-600">
                We are aligning topic opportunity, existing coverage, and writing posture so the next draft feels strategic,
                differentiated, and boardroom-safe from the first screen onward.
              </p>
            </div>

            <Link href="/blogs/create" className="text-sm font-medium text-slate-600 transition hover:text-slate-900">
              ← Back
            </Link>
          </div>

          {error ? (
            <div className="mb-6 flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              {error}
            </div>
          ) : null}

          <div className="mb-8 rounded-[28px] border border-white/70 bg-white/85 p-6 shadow-[0_24px_80px_rgba(15,23,42,0.08)] backdrop-blur-sm">
            <div className="grid gap-5 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
              <div className="grid gap-5 md:grid-cols-3">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">Selected Depth</p>
                  <p className="mt-2 text-sm font-semibold text-slate-900">{wordTierMeta.label}</p>
                  <p className="mt-1 text-sm text-slate-600">{wordTierMeta.posture}</p>
                </div>
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">Expected Outcome</p>
                  <p className="mt-2 text-sm text-slate-600">{wordTierMeta.outcome}</p>
                </div>
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">Company Context</p>
                  <p className="mt-2 text-sm text-slate-600">{companyContextNote || 'Using your existing content graph and profile data to personalize recommendations.'}</p>
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-5">
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">Next Steps In This Flow</p>
                <div className="mt-3 space-y-3 text-sm text-slate-600">
                  <p>1. Pick a recommended topic or start with AI chat.</p>
                  <p>2. Choose the layout that best fits the editorial angle.</p>
                  <p>3. Refine the brief before generation and send it to the editor.</p>
                </div>
              </div>
            </div>
          </div>

          <div className="mb-8 grid gap-4 lg:grid-cols-2">
            <button
              onClick={() => setIsAICardModalOpen(true)}
              className="group rounded-[24px] border border-blue-200 bg-[linear-gradient(135deg,rgba(239,246,255,0.95),rgba(255,255,255,0.96),rgba(224,242,254,0.9))] p-5 text-left shadow-[0_10px_30px_rgba(15,23,42,0.06)] transition hover:-translate-y-0.5 hover:shadow-[0_18px_44px_rgba(15,23,42,0.10)]"
            >
              <div className="flex items-start gap-4">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-blue-600 text-white shadow-sm">
                  <Bot className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">Guided Input</p>
                  <h2 className="mt-2 text-lg font-semibold text-slate-950">Create with AI chat</h2>
                  <p className="mt-2 text-sm leading-6 text-slate-600">
                    Start with a rough idea, campaign angle, or executive point of view and let the system shape it into a stronger blog brief.
                  </p>
                  <span className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-blue-700 transition-all group-hover:gap-2.5">
                    Open guided ideation <ArrowRight className="h-4 w-4" />
                  </span>
                </div>
              </div>
            </button>

            <button
              onClick={() => void router.push({ pathname: '/blogs/generate', query: wordsParam ? { words: wordsParam } : {} })}
              className="group rounded-[24px] border border-slate-200 bg-white/92 p-5 text-left shadow-[0_10px_30px_rgba(15,23,42,0.06)] transition hover:-translate-y-0.5 hover:shadow-[0_18px_44px_rgba(15,23,42,0.10)]"
            >
              <div className="flex items-start gap-4">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-slate-100 text-slate-700 shadow-sm">
                  <Lightbulb className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">Direct Build</p>
                  <h2 className="mt-2 text-lg font-semibold text-slate-950">Write your own topic</h2>
                  <p className="mt-2 text-sm leading-6 text-slate-600">
                    Skip recommendations and move directly into the draft builder when the team already knows exactly what it wants to publish.
                  </p>
                  <span className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-slate-900 transition-all group-hover:gap-2.5">
                    Go straight to drafting <ArrowRight className="h-4 w-4" />
                  </span>
                </div>
              </div>
            </button>
          </div>

          <section className="mb-10">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-blue-700" />
                <h2 className="text-sm font-semibold uppercase tracking-[0.16em] text-slate-900">Recommended Topics</h2>
              </div>

              <button
                onClick={() => void fetchIntelligence()}
                className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-600 transition hover:text-slate-900"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Refresh intelligence
              </button>
            </div>

            {gaps.length === 0 ? (
              <div className="rounded-[24px] border border-slate-200 bg-white/90 p-6 text-sm text-slate-500 shadow-sm">
                Current blog coverage is already strong. No major topic gaps were detected.
              </div>
            ) : (
              <div className="space-y-5">
                {suggestionsLoading ? (
                  <div className="flex items-center gap-2 text-sm text-blue-700">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    We&rsquo;re customizing topics for you — tailoring angles, suggestions, and positioning cues for each recommendation.
                  </div>
                ) : null}

                {gaps.map((gap, i) => {
                  const suggestions = cardSuggestions[i];
                  return (
                    <div key={i} className="rounded-[28px] border border-slate-200 bg-white/92 p-6 shadow-[0_12px_40px_rgba(15,23,42,0.06)]">
                      <div className="mb-4 flex items-start justify-between gap-3">
                        <div className="max-w-3xl">
                          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">Opportunity Topic</p>
                          <h3 className="mt-2 text-xl font-semibold text-slate-950">{gap.topic}</h3>
                          <p className="mt-3 text-sm leading-6 text-slate-600">{gap.reason}</p>
                        </div>

                        <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase ${PRIORITY_BADGES[gap.priority]}`}>
                          {gap.priority} priority
                        </span>
                      </div>

                      {(gap as any).brief ? (
                        <div className="mb-5 grid gap-3 lg:grid-cols-3">
                          <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4">
                            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">Company Context</p>
                            <p className="mt-2 text-sm leading-6 text-slate-600">{(gap as any).brief.company_context}</p>
                          </div>
                          <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4">
                            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">Current Coverage</p>
                            <p className="mt-2 text-sm leading-6 text-slate-600">{(gap as any).brief.current_content}</p>
                          </div>
                          <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4">
                            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">Writing Posture</p>
                            <p className="mt-2 text-sm leading-6 text-slate-600">{(gap as any).brief.tone}</p>
                          </div>
                        </div>
                      ) : null}

                      {suggestions ? (
                        <div className="mb-5 grid gap-3 lg:grid-cols-2">
                          {suggestions.uniqueness_directive_options.length > 0 ? (
                            <div className="rounded-2xl border border-blue-100 bg-blue-50/70 p-4">
                              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-blue-500">Differentiation Direction</p>
                              <div className="mt-3 flex flex-wrap gap-2">
                                {suggestions.uniqueness_directive_options.map((option, idx) => (
                                  <span key={`ud-${idx}`} className="rounded-full border border-blue-200 bg-white px-2.5 py-1 text-xs text-blue-700">
                                    {option}
                                  </span>
                                ))}
                              </div>
                            </div>
                          ) : null}

                          {suggestions.must_include_points_options.length > 0 ? (
                            <div className="rounded-2xl border border-indigo-100 bg-indigo-50/70 p-4">
                              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-indigo-500">Must-Include Points</p>
                              <div className="mt-3 flex flex-wrap gap-2">
                                {suggestions.must_include_points_options.map((option, idx) => (
                                  <span key={`mi-${idx}`} className="rounded-full border border-indigo-200 bg-white px-2.5 py-1 text-xs text-indigo-700">
                                    {option}
                                  </span>
                                ))}
                              </div>
                            </div>
                          ) : null}

                          {suggestions.campaign_objective_options.length > 0 ? (
                            <div className="rounded-2xl border border-amber-100 bg-amber-50/70 p-4">
                              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-amber-600">Campaign Objective</p>
                              <div className="mt-3 flex flex-wrap gap-2">
                                {suggestions.campaign_objective_options.map((option, idx) => (
                                  <span key={`co-${idx}`} className="rounded-full border border-amber-200 bg-white px-2.5 py-1 text-xs text-amber-700">
                                    {option}
                                  </span>
                                ))}
                              </div>
                            </div>
                          ) : null}

                          {suggestions.trend_context_options.length > 0 ? (
                            <div className="rounded-2xl border border-emerald-100 bg-emerald-50/70 p-4">
                              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-emerald-600">Trend Context</p>
                              <div className="mt-3 flex flex-wrap gap-2">
                                {suggestions.trend_context_options.map((option, idx) => (
                                  <span key={`tc-${idx}`} className="rounded-full border border-emerald-200 bg-white px-2.5 py-1 text-xs text-emerald-700">
                                    {option}
                                  </span>
                                ))}
                              </div>
                            </div>
                          ) : null}
                        </div>
                      ) : null}

                      {gap.relatedTo && gap.relatedTo.length > 0 ? (
                        <div className="mb-5 rounded-2xl border border-dashed border-slate-200 bg-slate-50/60 px-4 py-4">
                          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">Builds On Existing Coverage</p>
                          <div className="mt-2 flex flex-wrap gap-2">
                            {gap.relatedTo.map((topic) => (
                              <span key={topic} className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-600">
                                {topic}
                              </span>
                            ))}
                          </div>
                        </div>
                      ) : null}

                      <div className="flex items-center justify-between gap-4 border-t border-slate-100 pt-4">
                        <div className="flex items-center gap-2 text-sm text-slate-500">
                          <Sparkles className="h-4 w-4 text-blue-600" />
                          Prepared for template selection and brief refinement
                        </div>

                        <button
                          onClick={() =>
                            void router.push({
                              pathname: '/blogs/template',
                              query: {
                                ...(wordsParam ? { words: wordsParam } : {}),
                                topic: encodeURIComponent(gap.topic),
                              },
                            })
                          }
                          className="inline-flex items-center gap-1.5 rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800"
                        >
                          Continue with this topic <ArrowRight className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)]">
            <section className="rounded-[28px] border border-slate-200 bg-white/92 p-6 shadow-[0_12px_40px_rgba(15,23,42,0.06)]">
              <div className="mb-4 flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-blue-700" />
                <h2 className="text-sm font-semibold uppercase tracking-[0.16em] text-slate-900">Action Items</h2>
              </div>

              {recommendations.length > 0 ? (
                <div className="space-y-3">
                  {recommendations.map((rec, i) => (
                    <div key={i} className="rounded-2xl border border-slate-200 bg-slate-50/70 px-4 py-4">
                      <div className="mb-2 flex items-center gap-2">
                        <span className="rounded-full bg-slate-900 px-2 py-0.5 text-[10px] font-semibold uppercase text-white">
                          {rec.type}
                        </span>
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${PRIORITY_BADGES[rec.priority] || PRIORITY_BADGES.medium}`}>
                          {rec.priority}
                        </span>
                      </div>
                      <p className="text-sm font-semibold text-slate-900">{rec.action}</p>
                      <p className="mt-1 text-sm leading-6 text-slate-600">{rec.reason}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4 text-sm text-slate-500">
                  No additional action items are needed right now.
                </div>
              )}
            </section>

            <section className="rounded-[28px] border border-slate-200 bg-white/92 p-6 shadow-[0_12px_40px_rgba(15,23,42,0.06)]">
              <div className="mb-4 flex items-center gap-2">
                <BarChart2 className="h-4 w-4 text-blue-700" />
                <h2 className="text-sm font-semibold uppercase tracking-[0.16em] text-slate-900">Performance Snapshot</h2>
              </div>

              {allMetrics.length > 0 ? (
                <div className="space-y-3">
                  {allMetrics
                    .filter((metric) => metric.status === 'published')
                    .sort((a, b) => ((b as any).views_count || 0) - ((a as any).views_count || 0))
                    .slice(0, 5)
                    .map((metric) => (
                      <div key={metric.id} className="rounded-2xl border border-slate-200 bg-slate-50/70 px-4 py-4">
                        <h3 className="line-clamp-2 text-sm font-semibold text-slate-900">{metric.title}</h3>
                        <div className="mt-3 grid grid-cols-2 gap-3">
                          <div>
                            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">Views</p>
                            <p className="mt-1 text-sm font-semibold text-slate-900">{((metric as any).views_count || 0).toLocaleString()}</p>
                          </div>
                          <div>
                            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">Status</p>
                            <p className="mt-1 text-sm font-semibold text-slate-900">Published</p>
                          </div>
                        </div>
                      </div>
                    ))}
                </div>
              ) : (
                <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4 text-sm text-slate-500">
                  No published blog performance data is available yet. Once content is live, this panel will show the best-performing assets.
                </div>
              )}
            </section>
          </div>
        </div>
      </div>

      {isAICardModalOpen ? (
        <AIBlogCardModal
          isOpen={isAICardModalOpen}
          onClose={() => setIsAICardModalOpen(false)}
          onCardCreated={handleAICardCreated}
          companyId={selectedCompanyId || ''}
          companyName={companyProfile?.name || ''}
          companyContext={companyProfile?.brand_voice || ''}
          existingTopics={posts.map((post) => post.title)}
        />
      ) : null}
    </>
  );
}
