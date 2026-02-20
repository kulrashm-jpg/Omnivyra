import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import {
  ArrowLeft,
  Sparkles,
  MessageCircle,
  CheckCircle,
  Loader2,
  Calendar,
  Target,
  TrendingUp,
  ExternalLink,
  FileText,
  Globe,
  Users,
} from 'lucide-react';
import { useCompanyContext } from '../../../components/CompanyContext';
import { fetchWithAuth } from '../../../components/community-ai/fetchWithAuth';
import Header from '../../../components/Header';

interface RecWeek {
  id: string;
  week_number: number;
  session_id: string;
  status: string;
  topics_to_cover?: string[] | null;
  primary_objective?: string | null;
  summary?: string | null;
  objectives?: string[] | null;
  goals?: string[] | null;
  suggested_days_to_post?: string[] | null;
  platform_allocation?: Record<string, number> | null;
  platform_content_breakdown?: Record<string, any[]> | null;
  content_type_mix?: string[] | null;
}

const IMPROVE_AREAS = [
  { id: 'topics_objectives', label: 'Topics & objectives', icon: Target },
  { id: 'content_types_platform', label: 'Content types & platform mix', icon: FileText },
  { id: 'geo_focus', label: 'Geo/regional focus', icon: Globe },
  { id: 'scheduling', label: 'Scheduling & posting times', icon: Calendar },
  { id: 'target_customer', label: 'Target customer segments', icon: Users },
] as const;

type ImproveAreaId = (typeof IMPROVE_AREAS)[number]['id'];

export default function CampaignRecommendationsPage() {
  const router = useRouter();
  const { id } = router.query;
  const { selectedCompanyId } = useCompanyContext();
  const campaignId = typeof id === 'string' ? id : null;

  const [campaign, setCampaign] = useState<{ id: string; name: string; current_stage?: string; company_id?: string } | null>(null);
  const [recommendations, setRecommendations] = useState<RecWeek[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isMerging, setIsMerging] = useState(false);
  const [selectedWeeks, setSelectedWeeks] = useState<Set<number>>(new Set());
  const [activeTabWeek, setActiveTabWeek] = useState<number>(1);
  const [selectedAreasByWeek, setSelectedAreasByWeek] = useState<Record<number, Set<ImproveAreaId>>>({});
  const [error, setError] = useState<string | null>(null);

  const urlSessionId = typeof router.query.sessionId === 'string' ? router.query.sessionId : undefined;

  useEffect(() => {
    if (!campaignId) return;
    fetchWithAuth(`/api/campaigns/${campaignId}`)
      .then((r) => r.ok ? r.json() : null)
      .then((d) => setCampaign(d?.campaign || { id: campaignId, name: 'Campaign' }))
      .catch(() => setCampaign({ id: campaignId, name: 'Campaign' }));
  }, [campaignId]);

  useEffect(() => {
    if (campaignId) fetchRecommendations(urlSessionId);
  }, [campaignId, urlSessionId]);

  const [committedWeeks, setCommittedWeeks] = useState<any[]>([]);
  const [durationWeeks, setDurationWeeks] = useState(12);
  const [recByWeek, setRecByWeek] = useState<Record<number, RecWeek>>({});

  const fetchRecommendations = async (sid?: string) => {
    if (!campaignId) return;
    setError(null);
    const params = new URLSearchParams();
    if (sid) params.set('sessionId', sid);
    params.set('status', 'pending');
    const res = await fetchWithAuth(`/api/campaigns/${campaignId}/recommendations?${params}`);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data?.error || 'Failed to fetch recommendations');
      return;
    }
    const data = await res.json();
    const recs = data.recommendations || [];
    setRecommendations(recs);
    setCommittedWeeks(data.committedWeeks || []);
    setDurationWeeks(data.durationWeeks || 12);
    setRecByWeek(data.recByWeek || {});
    if (data.sessionId) setSessionId(data.sessionId);
    else if (recs.length > 0 && recs[0]?.session_id) setSessionId(recs[0].session_id);
  };

  const handleGenerate = async () => {
    if (!campaignId) return;
    setIsGenerating(true);
    setError(null);
    try {
      const res = await fetchWithAuth(`/api/campaigns/${campaignId}/recommendations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(selectedCompanyId ? { companyId: selectedCompanyId } : {}),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error || 'Failed to generate');
      }
      const data = await res.json();
      setSessionId(data.sessionId);
      await fetchRecommendations(data.sessionId);
      const genWeeks = data.weeks ?? [];
      setSelectedWeeks(new Set(genWeeks.map((w: { week_number: number }) => w.week_number)));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to generate');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleMerge = async () => {
    if (!campaignId || !sessionId || selectedWeeks.size === 0) return;
    setIsMerging(true);
    setError(null);
    try {
      const res = await fetchWithAuth(`/api/campaigns/${campaignId}/merge-recommendations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId,
          weekNumbers: Array.from(selectedWeeks),
          ...(selectedCompanyId ? { companyId: selectedCompanyId } : {}),
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error || 'Failed to merge');
      }
      setSelectedWeeks(new Set());
      await fetchRecommendations(sessionId ?? undefined);
      router.push(`/campaign-planning-hierarchical?campaignId=${campaignId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to merge');
    } finally {
      setIsMerging(false);
    }
  };

  const toggleWeek = (n: number) => {
    setSelectedWeeks((s) => {
      const next = new Set(s);
      if (next.has(n)) next.delete(n);
      else next.add(n);
      return next;
    });
  };

  const toggleAreaForWeek = (weekNum: number, areaId: ImproveAreaId) => {
    setSelectedAreasByWeek((prev) => {
      const weekSet = new Set(prev[weekNum] || []);
      if (weekSet.has(areaId)) weekSet.delete(areaId);
      else weekSet.add(areaId);
      return { ...prev, [weekNum]: weekSet };
    });
  };

  const getVetChatUrl = () => {
    const params = new URLSearchParams();
    if (sessionId) params.set('sessionId', sessionId);
    if (selectedWeeks.size > 0) params.set('weeks', Array.from(selectedWeeks).sort().join(','));
    const areasByWeek: Record<number, string[]> = {};
    Object.entries(selectedAreasByWeek).forEach(([w, set]) => {
      if (set.size > 0) areasByWeek[Number(w)] = Array.from(set);
    });
    if (Object.keys(areasByWeek).length > 0) {
      params.set('areasByWeek', JSON.stringify(areasByWeek));
    }
    const qs = params.toString();
    return `/campaigns/${campaignId}/vet-chat${qs ? `?${qs}` : ''}`;
  };

  const weeksWithRecs = Array.from({ length: durationWeeks }, (_, i) => i + 1).filter((wn) => recByWeek[wn]);
  const selectAll = () => {
    if (selectedWeeks.size === weeksWithRecs.length) setSelectedWeeks(new Set());
    else setSelectedWeeks(new Set(weeksWithRecs));
  };

  if (!campaignId) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-gray-600">Campaign ID required</p>
      </div>
    );
  }

  return (
    <>
      <Head>
        <title>Expert Recommendations – {campaign?.name || 'Campaign'}</title>
      </Head>
      <Header />
      <div className="min-h-screen bg-gradient-to-br from-emerald-50 to-teal-50">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="flex justify-between items-center mb-8">
            <div>
              <button
                onClick={() => router.push(`/campaign-details/${campaignId}`)}
                className="flex items-center gap-2 text-gray-600 hover:text-gray-900 mb-2"
              >
                <ArrowLeft className="w-4 h-4" />
                Back to Campaign
              </button>
              <h1 className="text-2xl font-bold text-gray-900">Expert Recommendations</h1>
              <p className="text-sm text-gray-600">{campaign?.name && `Campaign: ${campaign.name}`}</p>
              {campaignId && <p className="text-xs text-gray-500 font-mono">ID: {campaignId}</p>}
              <p className="text-gray-600 mt-1">Improve your plan with AI-suggested topics, scheduling, and platform mix</p>
            </div>
            <div className="flex gap-3">
              <button
                onClick={handleGenerate}
                disabled={isGenerating}
                className="px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50 flex items-center gap-2"
              >
                {isGenerating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                Generate Recommendations
              </button>
              <a
                href={getVetChatUrl()}
                target="_blank"
                rel="noopener noreferrer"
                className="px-4 py-2 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 flex items-center gap-2"
                title="Opens in new tab so you can compare recommendations and chat side by side"
              >
                <MessageCircle className="w-4 h-4" />
                Vet with AI Chat
                <ExternalLink className="w-3.5 h-3.5 text-gray-400" />
              </a>
            </div>
          </div>

          {error && (
            <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">{error}</div>
          )}

          {durationWeeks < 1 && !isGenerating ? (
            <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
              <p className="text-gray-600">No campaign plan yet. Create a committed plan first.</p>
            </div>
          ) : recommendations.length === 0 && committedWeeks.length === 0 && !isGenerating ? (
            <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
              <TrendingUp className="w-16 h-16 text-gray-300 mx-auto mb-4" />
              <h2 className="text-xl font-semibold text-gray-900 mb-2">No plan or recommendations yet</h2>
              <p className="text-gray-600 mb-6">
                Create a committed plan first, then click &quot;Generate Recommendations&quot; for AI suggestions.
              </p>
              <button
                onClick={handleGenerate}
                disabled={isGenerating}
                className="px-6 py-3 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50 flex items-center gap-2 mx-auto"
              >
                {isGenerating ? <Loader2 className="w-5 h-5 animate-spin" /> : <Sparkles className="w-5 h-5" />}
                Generate Recommendations
              </button>
            </div>
          ) : (
            <>
              <div className="flex justify-between items-center mb-4">
                <button
                  onClick={selectAll}
                  className="text-sm text-emerald-600 hover:underline"
                >
                  {selectedWeeks.size === weeksWithRecs.length ? 'Deselect all' : 'Select all'}
                </button>
                <button
                  onClick={handleMerge}
                  disabled={isMerging || selectedWeeks.size === 0 || !sessionId}
                  className="px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50 flex items-center gap-2"
                >
                  {isMerging ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
                  Apply {selectedWeeks.size} week{selectedWeeks.size !== 1 ? 's' : ''} to Campaign
                </button>
              </div>

              <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                {/* One tab per week — no duplicates */}
                <div className="flex border-b border-gray-200 overflow-x-auto">
                  {Array.from({ length: durationWeeks }, (_, i) => i + 1).map((wn) => (
                    <button
                      key={wn}
                      onClick={() => setActiveTabWeek(wn)}
                      className={`flex items-center gap-2 px-4 py-3 text-sm font-medium shrink-0 border-b-2 transition-colors ${
                        activeTabWeek === wn
                          ? 'border-emerald-600 text-emerald-700 bg-emerald-50/50'
                          : 'border-transparent text-gray-600 hover:text-gray-900 hover:bg-gray-50'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={selectedWeeks.has(wn)}
                        onChange={() => toggleWeek(wn)}
                        onClick={(e) => e.stopPropagation()}
                        className="rounded border-gray-300"
                        title="Select this week for apply"
                        disabled={!recByWeek[wn]}
                      />
                      Week {wn}
                    </button>
                  ))}
                </div>

                {/* Content: committed plan summary + topics, then AI areas to improve */}
                <div className="p-4 min-h-[200px]">
                  {(() => {
                    const committed = committedWeeks.find((w: any) => Number(w.week_number ?? w.week ?? 0) === Number(activeTabWeek));
                    const aiRec = recByWeek[activeTabWeek];
                    const hasAiRec = !!aiRec;

                    return (
                      <div className="space-y-4">
                        {/* Committed plan (base) */}
                        <div className="space-y-3 text-sm">
                          <h3 className="font-semibold text-gray-900">From committed plan</h3>
                          {committed ? (
                            <>
                              {(committed.primary_objective || committed.phase_label) && (
                                <div>
                                  <span className="font-medium text-gray-700">Focus:</span>
                                  <p className="text-gray-600 mt-0.5">{committed.primary_objective || committed.phase_label}</p>
                                </div>
                              )}
                              {committed.topics_to_cover?.length ? (
                                <div>
                                  <span className="font-medium text-gray-700">Topics:</span>
                                  <ul className="list-disc list-inside mt-1 text-gray-600">
                                    {committed.topics_to_cover.map((t: string, i: number) => (
                                      <li key={i}>{t}</li>
                                    ))}
                                  </ul>
                                </div>
                              ) : null}
                            </>
                          ) : (
                            <p className="text-gray-500 italic">No committed data for this week yet.</p>
                          )}
                        </div>

                        {/* AI recommended content (from Generate Recommendations) — shown by default */}
                        {hasAiRec ? (
                          <div className="bg-emerald-50/50 border border-emerald-200 rounded-lg p-4 text-sm space-y-3">
                            <h3 className="font-semibold text-emerald-800">AI recommended content (from Generate Recommendations)</h3>
                            {aiRec.primary_objective && (
                              <div><span className="font-medium text-gray-700">Focus:</span> <span className="text-gray-600">{aiRec.primary_objective}</span></div>
                            )}
                            {aiRec.topics_to_cover?.length ? (
                              <div><span className="font-medium text-gray-700">Topics:</span>
                                <ul className="list-disc list-inside mt-0.5 text-gray-600">{aiRec.topics_to_cover.map((t, i) => <li key={i}>{t}</li>)}</ul>
                              </div>
                            ) : null}
                            {aiRec.summary && <div><span className="font-medium text-gray-700">Summary:</span> <span className="text-gray-600">{aiRec.summary}</span></div>}
                            {aiRec.platform_allocation && Object.keys(aiRec.platform_allocation).length > 0 && (
                              <div><span className="font-medium text-gray-700">Platform mix:</span>
                                <div className="flex flex-wrap gap-1 mt-0.5">{Object.entries(aiRec.platform_allocation).map(([p, c]) => (
                                  <span key={p} className="px-2 py-0.5 bg-white rounded text-gray-700">{p}: {c}</span>
                                ))}</div>
                              </div>
                            )}
                            {aiRec.suggested_days_to_post?.length ? (
                              <div><span className="font-medium text-gray-700">Best days:</span> <span className="text-gray-600">{aiRec.suggested_days_to_post.join(', ')}</span></div>
                            ) : null}
                          </div>
                        ) : null}

                        <div className="pt-4 border-t border-gray-100">
                          <span className="text-sm font-medium text-gray-700 block mb-2">
                            {hasAiRec ? 'Areas AI recommends to improve:' : 'Generate recommendations to see areas to improve'}
                          </span>
                          {hasAiRec ? (
                            <div className="space-y-3">
                              <div className="flex flex-wrap gap-2">
                                {IMPROVE_AREAS.map((area) => {
                                  const Icon = area.icon;
                                  const hasRecForArea =
                                    (area.id === 'topics_objectives' && aiRec.topics_to_cover?.length) ||
                                    (area.id === 'content_types_platform' && (aiRec.platform_allocation || aiRec.content_type_mix?.length)) ||
                                    (area.id === 'scheduling' && aiRec.suggested_days_to_post?.length) ||
                                    area.id === 'geo_focus' ||
                                    area.id === 'target_customer';
                                  if (!hasRecForArea) return null;
                                  const checked = (selectedAreasByWeek[activeTabWeek] || new Set()).has(area.id);
                                  return (
                                    <label
                                      key={area.id}
                                      className={`flex items-center gap-2 px-3 py-2 rounded-lg border cursor-pointer transition-colors ${
                                        checked ? 'bg-emerald-50 border-emerald-300 text-emerald-800' : 'bg-gray-50 border-gray-200 text-gray-700 hover:border-gray-300'
                                      }`}
                                    >
                                      <input
                                        type="checkbox"
                                        checked={checked}
                                        onChange={() => toggleAreaForWeek(activeTabWeek, area.id)}
                                        className="rounded border-gray-300"
                                      />
                                      <Icon className="w-4 h-4 shrink-0" />
                                      <span className="text-sm">{area.label}</span>
                                    </label>
                                  );
                                })}
                              </div>
                              <div className="text-xs text-gray-500 mt-2">
                                Select areas above, then click &quot;Apply&quot; to add, or &quot;Vet with AI Chat&quot; to discuss and finalize.
                              </div>
                            </div>
                          ) : (
                            <button
                              onClick={handleGenerate}
                              disabled={isGenerating}
                              className="px-3 py-2 bg-emerald-50 text-emerald-700 rounded-lg hover:bg-emerald-100 text-sm"
                            >
                              {isGenerating ? <Loader2 className="w-4 h-4 animate-spin inline" /> : <Sparkles className="w-4 h-4 inline" />}
                              {' '}Generate Recommendations
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })()}
                </div>
              </div>
            </>
          )}
        </div>

      </div>
    </>
  );
}
