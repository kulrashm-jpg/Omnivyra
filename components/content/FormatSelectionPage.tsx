'use client';

import React from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { ArrowRight, CheckCircle2 } from 'lucide-react';
import { useCompanyContext } from '../CompanyContext';
import { Loader2 } from 'lucide-react';

type AccentColor = 'purple' | 'orange' | 'pink' | 'blue' | 'amber' | 'violet';

const ACCENT_CLASSES: Record<
  AccentColor,
  {
    gradient: string;
    cardBorder: string;
    cardHoverBorder: string;
    badge: string;
    text: string;
    ribbon: string;
  }
> = {
  purple: {
    gradient: 'from-purple-50 to-indigo-50',
    cardBorder: 'border-purple-100',
    cardHoverBorder: 'hover:border-purple-300',
    badge: 'bg-purple-100 text-purple-800',
    text: 'text-purple-700',
    ribbon: 'from-purple-500 to-indigo-500',
  },
  orange: {
    gradient: 'from-orange-50 to-amber-50',
    cardBorder: 'border-orange-100',
    cardHoverBorder: 'hover:border-orange-300',
    badge: 'bg-orange-100 text-orange-800',
    text: 'text-orange-700',
    ribbon: 'from-orange-500 to-amber-500',
  },
  pink: {
    gradient: 'from-pink-50 to-rose-50',
    cardBorder: 'border-pink-100',
    cardHoverBorder: 'hover:border-pink-300',
    badge: 'bg-pink-100 text-pink-800',
    text: 'text-pink-700',
    ribbon: 'from-pink-500 to-rose-500',
  },
  blue: {
    gradient: 'from-blue-50 to-cyan-50',
    cardBorder: 'border-blue-100',
    cardHoverBorder: 'hover:border-blue-300',
    badge: 'bg-blue-100 text-blue-800',
    text: 'text-blue-700',
    ribbon: 'from-blue-500 to-cyan-500',
  },
  amber: {
    gradient: 'from-amber-50 to-yellow-50',
    cardBorder: 'border-amber-100',
    cardHoverBorder: 'hover:border-amber-300',
    badge: 'bg-amber-100 text-amber-800',
    text: 'text-amber-700',
    ribbon: 'from-amber-500 to-orange-500',
  },
  violet: {
    gradient: 'from-violet-50 to-purple-50',
    cardBorder: 'border-violet-100',
    cardHoverBorder: 'hover:border-violet-300',
    badge: 'bg-violet-100 text-violet-800',
    text: 'text-violet-700',
    ribbon: 'from-violet-500 to-purple-500',
  },
};

interface FormatSelectionPageProps {
  title: string;
  subtitle: string;
  icon: string;
  formats: { value: string; label: string; description: string; wordRange?: string }[];
  generatePath: string;
  accentColor: AccentColor;
  backPath?: string;
  pageTitle?: string;
  enableCanonicalHandoffs?: boolean;
}

type CampaignContentPlan = {
  id?: string;
  campaignId?: string;
  dayOfWeek?: string;
  date?: string;
  platform?: string;
  contentType?: string;
  topic?: string;
  content?: string;
  hashtags?: string[];
  status?: string;
  aiGenerated?: boolean;
};

type CampaignGoal = Record<string, unknown>;
type CampaignRecord = Record<string, unknown>;

const CANONICAL_CONTENT_DAYS = [
  { id: 'monday', name: 'Monday' },
  { id: 'tuesday', name: 'Tuesday' },
  { id: 'wednesday', name: 'Wednesday' },
  { id: 'thursday', name: 'Thursday' },
  { id: 'friday', name: 'Friday' },
];

const CANONICAL_CONTENT_PLATFORMS = ['linkedin', 'instagram', 'facebook', 'twitter'];

export default function FormatSelectionPage({
  title,
  subtitle,
  icon,
  formats,
  generatePath,
  accentColor,
  backPath = '/command-center/content',
  pageTitle,
  enableCanonicalHandoffs = false,
}: FormatSelectionPageProps) {
  const router = useRouter();
  const { user, isLoading } = useCompanyContext();
  const c = ACCENT_CLASSES[accentColor];
  const formatCountLabel = `${formats.length} format${formats.length === 1 ? '' : 's'}`;
  const campaignId = typeof router.query.campaignId === 'string' ? router.query.campaignId : null;
  const objective = typeof router.query.objective === 'string' ? router.query.objective : '';
  const [campaignData, setCampaignData] = React.useState<CampaignRecord | null>(null);
  const [campaignGoals, setCampaignGoals] = React.useState<CampaignGoal[]>([]);
  const [contentPlans, setContentPlans] = React.useState<CampaignContentPlan[]>([]);
  const [campaignLoading, setCampaignLoading] = React.useState(false);
  const [campaignSaving, setCampaignSaving] = React.useState(false);
  const [campaignError, setCampaignError] = React.useState<string | null>(null);
  const [selectedDay, setSelectedDay] = React.useState('monday');
  const [selectedPlatform, setSelectedPlatform] = React.useState('linkedin');
  const [selectedContentType, setSelectedContentType] = React.useState('post');

  function buildFormatHref(format: string) {
    const query = new URLSearchParams({ format });
    if (campaignId) query.set('campaignId', campaignId);
    if (objective) query.set('objective', objective);
    return `${generatePath}?${query.toString()}`;
  }

  function buildCanonicalHandoffHref(target: 'campaign' | 'scheduler') {
    const query = new URLSearchParams({
      source: 'posts-create',
      contentType: 'post',
    });
    if (campaignId) query.set('campaignId', campaignId);
    if (objective) query.set('objective', objective);
    if (target === 'campaign') {
      query.set('mode', 'direct');
      return `/campaign-planner?${query.toString()}`;
    }
    return `/multi-platform-scheduler?${query.toString()}`;
  }

  React.useEffect(() => {
    if (!campaignId) return;

    let cancelled = false;
    const loadCampaignContinuation = async () => {
      setCampaignLoading(true);
      setCampaignError(null);
      try {
        const [campaignResponse, goalsResponse, plansResponse] = await Promise.all([
          fetch(`/api/campaigns?type=campaign&campaignId=${encodeURIComponent(campaignId)}`),
          fetch(`/api/campaigns?type=goals&campaignId=${encodeURIComponent(campaignId)}`),
          fetch(`/api/campaigns?type=content-plan&campaignId=${encodeURIComponent(campaignId)}`),
        ]);

        if (cancelled) return;

        if (campaignResponse.ok) {
          const campaignResult = await campaignResponse.json().catch(() => null) as { campaign?: CampaignRecord } | null;
          setCampaignData(campaignResult?.campaign || null);
        }
        if (goalsResponse.ok) {
          const goalsResult = await goalsResponse.json().catch(() => null) as { goals?: CampaignGoal[] } | null;
          setCampaignGoals(Array.isArray(goalsResult?.goals) ? goalsResult.goals : []);
        }
        if (plansResponse.ok) {
          const plansResult = await plansResponse.json().catch(() => null) as { plans?: CampaignContentPlan[] } | null;
          setContentPlans(Array.isArray(plansResult?.plans) ? plansResult.plans : []);
        }
      } catch {
        if (!cancelled) setCampaignError('Unable to load campaign continuation right now.');
      } finally {
        if (!cancelled) setCampaignLoading(false);
      }
    };

    void loadCampaignContinuation();
    return () => {
      cancelled = true;
    };
  }, [campaignId]);

  async function generateCampaignContentPlan() {
    if (!campaignId) return;

    setCampaignSaving(true);
    setCampaignError(null);
    try {
      const response = await fetch('/api/ai/generate-content', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          campaignId,
          day: selectedDay,
          platform: selectedPlatform,
          contentType: selectedContentType,
          campaignData,
          campaignGoals,
          brandVoice: 'Use the current company brand voice and campaign context.',
          useAI: true,
        }),
      });

      const result = await response.json().catch(() => null) as {
        topic?: string;
        content?: { text?: string; hashtags?: string[]; aiGenerated?: boolean };
      } | null;

      if (!response.ok || !result?.content?.text) {
        throw new Error('Unable to generate campaign content.');
      }

      const contentPlan: CampaignContentPlan = {
        campaignId,
        dayOfWeek: selectedDay,
        platform: selectedPlatform,
        contentType: selectedContentType,
        topic: result.topic || selectedContentType,
        content: result.content.text,
        hashtags: Array.isArray(result.content.hashtags) ? result.content.hashtags : [],
        status: 'created',
        aiGenerated: Boolean(result.content.aiGenerated),
      };

      const saveResponse = await fetch('/api/campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'content-plan',
          data: contentPlan,
        }),
      });

      const saveResult = await saveResponse.json().catch(() => null) as { plan?: CampaignContentPlan } | null;
      if (!saveResponse.ok || !saveResult?.plan) {
        throw new Error('Unable to save generated campaign content.');
      }

      setContentPlans((prev) => [...prev, saveResult.plan as CampaignContentPlan]);
    } catch (error) {
      setCampaignError(error instanceof Error ? error.message : 'Unable to generate campaign content.');
    } finally {
      setCampaignSaving(false);
    }
  }

  async function updateCampaignContentPlan(planId: string, updates: Partial<CampaignContentPlan>) {
    setCampaignSaving(true);
    setCampaignError(null);
    try {
      const response = await fetch('/api/campaigns', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'content-plan',
          data: { id: planId, ...updates },
        }),
      });

      if (!response.ok) throw new Error('Unable to save campaign content update.');
      setContentPlans((prev) => prev.map((plan) => (plan.id === planId ? { ...plan, ...updates } : plan)));
    } catch (error) {
      setCampaignError(error instanceof Error ? error.message : 'Unable to save campaign content update.');
    } finally {
      setCampaignSaving(false);
    }
  }

  async function deleteCampaignContentPlan(planId: string) {
    setCampaignSaving(true);
    setCampaignError(null);
    try {
      const response = await fetch('/api/campaigns', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'content-plan',
          id: planId,
        }),
      });

      if (!response.ok) throw new Error('Unable to delete campaign content.');
      setContentPlans((prev) => prev.filter((plan) => plan.id !== planId));
    } catch (error) {
      setCampaignError(error instanceof Error ? error.message : 'Unable to delete campaign content.');
    } finally {
      setCampaignSaving(false);
    }
  }

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <Loader2 className="h-10 w-10 animate-spin text-gray-400" />
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
        <title>{pageTitle || title} | Omnivyra</title>
      </Head>

      <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 px-3 py-8 sm:px-4 lg:px-6">
        <div className="mx-auto max-w-6xl">
          <Link href={backPath} className="mb-8 inline-flex text-sm text-gray-600 transition-colors hover:text-gray-900">
            &larr; Back
          </Link>

          <div className="mb-8 rounded-[28px] border border-white/80 bg-white/92 p-6 shadow-[0_24px_60px_rgba(15,23,42,0.08)] backdrop-blur-sm md:p-8">
            <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_240px] lg:items-end">
              <div className="max-w-3xl">
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-500">
                  Content Format Selection
                </p>
                <h1 className="flex items-center gap-3 text-3xl font-bold tracking-tight text-gray-900 md:text-4xl">
                  <span className="flex h-12 w-12 items-center justify-center rounded-2xl border border-white/70 bg-white/85 text-2xl shadow-sm">
                    {icon}
                  </span>
                  {title}
                </h1>
                <p className="mt-3 text-sm leading-relaxed text-gray-600 md:text-base">{subtitle}</p>
              </div>

              <div className="grid grid-cols-2 gap-3 lg:w-[240px]">
                <div className="rounded-2xl border border-gray-100 bg-gray-50 px-3.5 py-3">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-gray-400">Formats</p>
                  <p className="mt-1 text-base font-semibold text-gray-900">{formats.length}</p>
                </div>
                <div className="rounded-2xl border border-gray-100 bg-gray-50 px-3.5 py-3">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-gray-400">UX Goal</p>
                  <p className="mt-1 text-base font-semibold text-gray-900">Consistent</p>
                </div>
              </div>
            </div>

            <div className="mt-6 grid gap-4 md:grid-cols-3">
              <div className="rounded-2xl border border-gray-100 bg-gray-50/80 px-4 py-3">
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-gray-400">Why This Step Matters</p>
                <p className="mt-1 text-sm text-gray-700">Pick the right structure before the AI starts writing so the final asset matches the intended authority level.</p>
              </div>
              <div className="rounded-2xl border border-gray-100 bg-gray-50/80 px-4 py-3">
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-gray-400">Output Standard</p>
                <p className="mt-1 text-sm text-gray-700">Structured, executive-ready content paths designed for clearer messaging and stronger editorial discipline.</p>
              </div>
              <div className="rounded-2xl border border-gray-100 bg-gray-50/80 px-4 py-3">
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-gray-400">What Happens Next</p>
                <p className="mt-1 text-sm text-gray-700">After this, we move into intelligence, template selection, and generation guidance tailored to the chosen format.</p>
              </div>
            </div>

            {(campaignId || enableCanonicalHandoffs) && (
              <div className="mt-6 rounded-2xl border border-blue-100 bg-blue-50/80 px-4 py-4">
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-blue-600">
                  Canonical Continuity
                </p>
                <p className="mt-1 text-sm text-gray-700">
                  {campaignId
                    ? 'This canonical post flow is carrying the campaign continuation context for this deep link.'
                    : 'Use this canonical post flow for campaign and scheduler handoffs without returning to legacy content-studio routes.'}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {campaignId ? (
                    <Link
                      href={`/schedule-review?campaignId=${encodeURIComponent(campaignId)}`}
                      className="rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-blue-700 shadow-sm ring-1 ring-blue-100"
                    >
                      Continue Schedule Review
                    </Link>
                  ) : null}
                  {enableCanonicalHandoffs ? (
                    <>
                      <Link
                        href={buildCanonicalHandoffHref('campaign')}
                        className="rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-blue-700 shadow-sm ring-1 ring-blue-100"
                      >
                        Use For Campaign
                      </Link>
                      <Link
                        href={buildCanonicalHandoffHref('scheduler')}
                        className="rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-blue-700 shadow-sm ring-1 ring-blue-100"
                      >
                        Send To Scheduler
                      </Link>
                    </>
                  ) : null}
                </div>
              </div>
            )}

            {campaignId && (
              <div className="mt-6 rounded-2xl border border-emerald-100 bg-emerald-50/80 px-4 py-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-emerald-700">
                      Campaign Content Plan
                    </p>
                    <p className="mt-1 text-sm text-gray-700">
                      Canonical content-plan generation, save, edit, retry, and schedule handoff for this campaign.
                    </p>
                  </div>
                  <span className="rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-emerald-700 shadow-sm ring-1 ring-emerald-100">
                    {campaignLoading ? 'Loading' : `${contentPlans.length} plan${contentPlans.length === 1 ? '' : 's'}`}
                  </span>
                </div>

                <div className="mt-4 grid gap-2 md:grid-cols-4">
                  <select
                    value={selectedDay}
                    onChange={(event) => setSelectedDay(event.target.value)}
                    className="rounded-xl border border-emerald-100 bg-white px-3 py-2 text-sm text-gray-700"
                  >
                    {CANONICAL_CONTENT_DAYS.map((day) => (
                      <option key={day.id} value={day.id}>{day.name}</option>
                    ))}
                  </select>
                  <select
                    value={selectedPlatform}
                    onChange={(event) => setSelectedPlatform(event.target.value)}
                    className="rounded-xl border border-emerald-100 bg-white px-3 py-2 text-sm text-gray-700"
                  >
                    {CANONICAL_CONTENT_PLATFORMS.map((platform) => (
                      <option key={platform} value={platform}>{platform}</option>
                    ))}
                  </select>
                  <select
                    value={selectedContentType}
                    onChange={(event) => setSelectedContentType(event.target.value)}
                    className="rounded-xl border border-emerald-100 bg-white px-3 py-2 text-sm text-gray-700"
                  >
                    {formats.map((format) => (
                      <option key={format.value} value={format.value}>{format.label}</option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => void generateCampaignContentPlan()}
                    disabled={campaignSaving || campaignLoading}
                    className="rounded-xl bg-emerald-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-50"
                  >
                    {campaignSaving ? 'Saving...' : 'Generate & Save'}
                  </button>
                </div>

                {campaignError ? (
                  <p className="mt-3 rounded-xl border border-red-100 bg-white px-3 py-2 text-sm text-red-600">{campaignError}</p>
                ) : null}

                {contentPlans.length > 0 ? (
                  <div className="mt-4 grid gap-3">
                    {contentPlans.map((plan, index) => {
                      const planId = plan.id || `${plan.dayOfWeek || 'day'}-${plan.platform || 'platform'}-${index}`;
                      return (
                        <div key={planId} className="rounded-2xl border border-emerald-100 bg-white p-3">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <p className="text-sm font-semibold text-gray-900">
                              {plan.topic || plan.contentType || 'Campaign content'}
                            </p>
                            <p className="text-xs font-medium text-emerald-700">
                              {[plan.dayOfWeek, plan.platform, plan.status].filter(Boolean).join(' / ')}
                            </p>
                          </div>
                          <textarea
                            value={plan.content || ''}
                            onChange={(event) => {
                              const content = event.target.value;
                              setContentPlans((prev) => prev.map((item, itemIndex) => (
                                itemIndex === index ? { ...item, content } : item
                              )));
                            }}
                            className="mt-3 min-h-[96px] w-full rounded-xl border border-emerald-100 px-3 py-2 text-sm leading-6 text-gray-700"
                          />
                          <div className="mt-3 flex flex-wrap gap-2">
                            {plan.id ? (
                              <>
                                <button
                                  type="button"
                                  onClick={() => void updateCampaignContentPlan(plan.id as string, { content: plan.content, status: 'created' })}
                                  disabled={campaignSaving}
                                  className="rounded-full bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                                >
                                  Save Update
                                </button>
                                <button
                                  type="button"
                                  onClick={() => void deleteCampaignContentPlan(plan.id as string)}
                                  disabled={campaignSaving}
                                  className="rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-red-600 ring-1 ring-red-100 disabled:opacity-50"
                                >
                                  Delete
                                </button>
                              </>
                            ) : null}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            )}
          </div>

          <div className="mb-5 flex items-center justify-between">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-400">Select A Format</p>
              <p className="mt-1 text-sm text-gray-600">Every path below is designed to keep the workflow consistent while changing the structure and editorial shape of the output.</p>
            </div>
            <div className="inline-flex items-center gap-2 rounded-full border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-600 shadow-sm">
              <CheckCircle2 className={`h-3.5 w-3.5 ${c.text}`} />
              {formatCountLabel}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {formats.map((fmt) => (
              <button
                key={fmt.value}
                onClick={() => router.push(buildFormatHref(fmt.value))}
                className={`group relative flex min-h-[320px] flex-col overflow-hidden rounded-2xl border ${c.cardBorder} ${c.cardHoverBorder} bg-white/92 p-6 text-left shadow-[0_8px_28px_rgba(15,23,42,0.06)] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_18px_40px_rgba(15,23,42,0.10)]`}
              >
                <div className={`absolute inset-x-0 top-0 h-1.5 bg-gradient-to-r ${c.ribbon}`} />

                <div className="mb-3 flex items-start justify-between">
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-gray-400">Format</p>
                    <h3 className="mt-2 text-lg font-semibold text-gray-900 group-hover:text-gray-700">
                      {fmt.label}
                    </h3>
                  </div>

                  <span className={`ml-2 shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${c.badge}`}>
                    {fmt.wordRange || 'Structured path'}
                  </span>
                </div>

                <p className="mb-5 min-h-[96px] text-sm leading-relaxed text-gray-600">{fmt.description}</p>

                <div className="mb-5 rounded-2xl border border-gray-100 bg-gray-50/80 px-4 py-3">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-gray-400">Designed For</p>
                  <p className="mt-1 text-sm text-gray-700">
                    Teams that need sharper structure, stronger messaging discipline, and a more executive-ready output.
                  </p>
                </div>

                <span className={`mt-auto inline-flex items-center gap-1.5 text-sm font-semibold ${c.text} transition-all group-hover:gap-2.5`}>
                  Continue with this format <ArrowRight className="h-4 w-4" />
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
