/**
 * Campaign Engagement Inbox
 * SYSTEM 2: Displays engagement signals from campaign activities.
 * Data source: GET /api/engagement/campaign-signals
 */

import React, { useEffect, useState, useCallback } from 'react';
import Head from 'next/head';
import { useCompanyContext } from '@/components/CompanyContext';
import PlatformIcon from '@/components/ui/PlatformIcon';
import {
  Bookmark,
  ExternalLink,
  Lightbulb,
  Send,
  ShieldCheck,
  Sparkles,
  UserPlus,
  Zap,
} from 'lucide-react';

type CampaignSignal = {
  id: string;
  campaign_id: string;
  activity_id: string;
  platform: string;
  author?: string | null;
  content?: string | null;
  signal_type: string;
  conversation_url?: string | null;
  engagement_score: number;
  detected_at: string;
  signal_status?: string;
};

const SIGNAL_STATUSES = ['new', 'reviewed', 'actioned', 'ignored'] as const;

const SIGNAL_TYPES = ['comment', 'reply', 'mention', 'quote', 'discussion', 'buyer_intent_signal'];
// Must match the backend's PLATFORMS allow-list in /api/engagement/campaign-signals.
// 'x' is included so signals with platform='x' are reachable; the backend
// normalizes 'x' → 'twitter' on filter.
const PLATFORMS = ['linkedin', 'twitter', 'x', 'discord', 'slack', 'reddit', 'github'];
const TIME_RANGES = [
  { value: '7d', label: 'Last 7 days' },
  { value: '14d', label: 'Last 14 days' },
  { value: '30d', label: 'Last 30 days' },
];

export default function EngagementInboxPage() {
  const { selectedCompanyId } = useCompanyContext();
  const companyId = selectedCompanyId || '';

  const [signals, setSignals] = useState<CampaignSignal[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedSignal, setSelectedSignal] = useState<CampaignSignal | null>(null);
  const [campaigns, setCampaigns] = useState<Array<{ id: string; name: string }>>([]);
  const [campaignId, setCampaignId] = useState('');
  const [platform, setPlatform] = useState('');
  const [signalType, setSignalType] = useState('');
  const [timeRange, setTimeRange] = useState('7d');
  const [replyText, setReplyText] = useState('');
  const [replying, setReplying] = useState(false);
  const [replyError, setReplyError] = useState<string | null>(null);
  const [replySuccess, setReplySuccess] = useState(false);
  const [bookmarkBusy, setBookmarkBusy] = useState(false);
  const [leadBusy, setLeadBusy] = useState(false);
  const [crmBusy, setCrmBusy] = useState(false);
  const [actionNotice, setActionNotice] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  // ── AI-suggestion state ───────────────────────────────────────────────────
  // A suggestion's full lifecycle is:
  //   shown → accepted-as-is   → execution uses it verbatim
  //         → edited           → treat edit as reject('edited') + do NOT link acceptance
  //         → dismissed        → reject('dismissed') on panel change / clear
  const [suggestion, setSuggestion] = useState<string | null>(null);
  const [suggestionId, setSuggestionId] = useState<string | null>(null);
  const [suggestionCorrelationId, setSuggestionCorrelationId] = useState<string | null>(null);
  const [suggestionModel, setSuggestionModel] = useState<string | null>(null);
  const [suggestionBusy, setSuggestionBusy] = useState(false);
  const [suggestionError, setSuggestionError] = useState<string | null>(null);
  const [suggestionUsed, setSuggestionUsed] = useState(false);
  // ai_draft_id is set when /api/engagement/ai-suggestion?event=shown
  // returns one (i.e. the server resolved a thread for the signal). When
  // present and the user clicks Send, we route through the draft system
  // (ai_generated=true + ai_draft_id) so /api/engagement/reply can verify
  // an approved-and-matching draft exists. See migration 20260506000011.
  const [aiDraftId, setAiDraftId] = useState<string | null>(null);
  // ── Intelligence state ────────────────────────────────────────────────────
  // Fetched from /api/intelligence/context on signal select and on
  // suggestion generate. UI rules:
  //   · max 1 insight, max 2 hints
  //   · recommendation CTA only when confidence.level === 'high'
  //   · hide everything if no useful data (all fields nullish)
  type ConfidenceLevel = 'high' | 'medium' | 'low';
  type IntelligenceState = {
    insight: string | null;
    hints: string[];
    confidence: { level: ConfidenceLevel; score: number };
    recommendation?: { type: string; label: string } | null;
  } | null;
  const [intelligence, setIntelligence] = useState<IntelligenceState>(null);
  const [intelligenceBusy, setIntelligenceBusy] = useState(false);

  const sendReply = async () => {
    if (!selectedSignal || !replyText.trim() || !companyId) return;
    setReplying(true);
    setReplyError(null);
    setReplySuccess(false);
    try {
      // Determine suggestion linkage. If we have a suggestion, the text
      // was either accepted verbatim OR edited. Only verbatim matches
      // count as accepted; edits record a reject('edited') AFTER the
      // reply succeeds so execution still completes.
      const verbatim = Boolean(
        suggestion && suggestionId && replyText.trim() === suggestion.trim()
      );
      const body: Record<string, unknown> = {
        organization_id: companyId,
        // The inbox UI works on campaign_activity_engagement_signals rows,
        // so we pass signal_id; the API translates to target/platform
        // internally. message_id path is reserved for engagement_messages.
        signal_id: selectedSignal.id,
        reply_text: replyText.trim(),
        platform: selectedSignal.platform,
      };
      if (verbatim && suggestionId) body.suggestion_id = suggestionId;
      if (suggestionCorrelationId) body.correlation_id = suggestionCorrelationId;
      // ── AI safety hard-fail at the UI boundary ────────────────────────
      //    If a suggestion was generated for this signal but no draft id
      //    is available (generate-response failed to create one — e.g.
      //    thread resolution failed, or the response came from the queued
      //    path that doesn't yet support drafts), the user must regenerate
      //    instead of sending AI text without an audit row. There is no
      //    fallback path; the API would reject this anyway via
      //    AI_DRAFT_REQUIRED, but failing fast in the UI surfaces it as a
      //    clearer message and avoids a wasted round-trip.
      if (suggestion && !aiDraftId) {
        throw new Error('AI_DRAFT_MISSING_UI: regenerate the suggestion to obtain a draft before sending');
      }
      // Route AI-derived sends through the ai_message_drafts pipeline.
      // The server-side guard validates the draft is approved and matches
      // thread + platform; the DB trigger blocks any direct-to-sent
      // tampering. See /api/engagement/reply AI guard + migration
      // 20260506000011.
      if (aiDraftId) {
        body.ai_generated = true;
        body.ai_draft_id = aiDraftId;
      }

      const res = await fetch('/api/engagement/reply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Reply failed');
      setReplyText('');
      setReplySuccess(true);
      setSuggestionUsed(true);

      // Edited suggestion: record rejection with reason='edited'. Verbatim
      // acceptance was already recorded server-side via suggestion_id.
      if (suggestion && suggestionId && !verbatim) {
        fetch('/api/engagement/ai-suggestion', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            event: 'rejected',
            suggestion_id: suggestionId,
            reason: 'edited',
          }),
        }).catch(() => {});
      }

      await updateSignalStatus(selectedSignal.id, 'actioned');
    } catch (err: any) {
      setReplyError(err.message);
    } finally {
      setReplying(false);
    }
  };

  const fetchIntelligence = async (signal: CampaignSignal) => {
    if (!companyId) return;
    setIntelligenceBusy(true);
    try {
      const res = await fetch('/api/intelligence/context', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          organization_id: companyId,
          platform: signal.platform,
          action_type: 'reply',
          target_id: signal.id,
        }),
      });
      if (!res.ok) {
        setIntelligence(null);
        return;
      }
      const data = await res.json();
      setIntelligence({
        insight: data.insight ?? null,
        hints: Array.isArray(data.hints) ? data.hints.slice(0, 2) : [],
        confidence: data.confidence ?? { level: 'low', score: 0 },
        recommendation: data.recommendation ?? null,
      });
    } catch {
      setIntelligence(null);
    } finally {
      setIntelligenceBusy(false);
    }
  };

  const resetSuggestion = (fromSignalChange: boolean) => {
    // If the user is switching signals or clearing the UI and the shown
    // suggestion was never used, record it as dismissed so intelligence
    // can distinguish "user didn't engage" from "user rejected content".
    if (suggestion && suggestionId && !suggestionUsed) {
      fetch('/api/engagement/ai-suggestion', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          event: 'rejected',
          suggestion_id: suggestionId,
          reason: fromSignalChange ? 'dismissed' : 'cleared',
        }),
      }).catch(() => {});
    }
    setSuggestion(null);
    setSuggestionId(null);
    setSuggestionCorrelationId(null);
    setSuggestionModel(null);
    setSuggestionError(null);
    setSuggestionUsed(false);
    setAiDraftId(null);
  };

  const generateSuggestion = async () => {
    if (!selectedSignal || !companyId) return;
    resetSuggestion(false);
    setSuggestionBusy(true);
    setSuggestionError(null);
    try {
      // 1. Generate a reply. /api/engagement/generate-response is the
      //    existing path the UI uses for inline AI. Any reply-generating
      //    endpoint that returns { text, model } would work.
      const genRes = await fetch('/api/engagement/generate-response', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          organization_id: companyId,
          platform: selectedSignal.platform,
          original_message: selectedSignal.content ?? '',
          author_name: selectedSignal.author ?? null,
          signal_id: selectedSignal.id,
        }),
      });
      const genData = await genRes.json().catch(() => ({} as Record<string, unknown>));
      if (!genRes.ok) {
        throw new Error(((genData as { error?: string }).error) ?? 'Suggestion generation failed');
      }
      const text =
        (genData as { text?: string; suggested_text?: string; immediate_response?: string }).text ??
        (genData as { suggested_text?: string }).suggested_text ??
        (genData as { immediate_response?: string }).immediate_response ??
        '';
      const model = (genData as { model?: string }).model ?? null;
      // ai_draft_id is created by /api/engagement/generate-response when it
      // produces text on the deterministic fast-path. It is the audit row
      // /api/engagement/reply will require on send. If null here, AI send
      // is blocked at the UI hard-fail in sendReply (no silent bypass).
      const generatedDraftId =
        (genData as { ai_draft_id?: string | null }).ai_draft_id ?? null;
      if (!text) throw new Error('Suggestion text was empty');

      // 2. Record suggestion shown.
      const shownRes = await fetch('/api/engagement/ai-suggestion', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          event: 'shown',
          organization_id: companyId,
          platform: selectedSignal.platform,
          action_type: 'reply',
          content: text,
          model,
          target_id: selectedSignal.id,
        }),
      });
      const shownData = (await shownRes.json().catch(() => ({}))) as {
        suggestion_id?: string;
        correlation_id?: string;
        error?: string;
      };
      if (!shownRes.ok) {
        throw new Error(shownData.error ?? 'Could not record suggestion');
      }

      setSuggestion(text);
      setSuggestionId(shownData.suggestion_id ?? null);
      setSuggestionCorrelationId(shownData.correlation_id ?? null);
      setSuggestionModel(model);
      // ai_draft_id now comes from generate-response (the AI source) so the
      // draft is guaranteed to exist before any UI state references it.
      setAiDraftId(generatedDraftId);

      // Refresh intelligence after generating a suggestion — the
      // acceptance-rate signal changes as soon as the suggestion row
      // lands. Fire-and-forget; the UI already has the prior snapshot.
      if (selectedSignal) fetchIntelligence(selectedSignal);
    } catch (err: any) {
      setSuggestionError(err?.message ?? 'Suggestion failed');
    } finally {
      setSuggestionBusy(false);
    }
  };

  const acceptSuggestion = () => {
    if (!suggestion) return;
    setReplyText(suggestion);
  };

  const dismissSuggestion = () => {
    resetSuggestion(false);
  };

  const toggleBookmark = async () => {
    if (!selectedSignal || !companyId) return;
    setBookmarkBusy(true);
    setActionNotice(null);
    try {
      // Status-first bookmarking: 'reviewed' is the closest standing state
      // in the signal_status enum. Switches back to 'new' on a second click.
      const next = selectedSignal.signal_status === 'reviewed' ? 'new' : 'reviewed';
      await updateSignalStatus(selectedSignal.id, next);
      setActionNotice({
        kind: 'success',
        text: next === 'reviewed' ? 'Bookmarked.' : 'Bookmark removed.',
      });
    } catch (err: any) {
      setActionNotice({ kind: 'error', text: err?.message ?? 'Bookmark failed' });
    } finally {
      setBookmarkBusy(false);
    }
  };

  const markAsLead = async () => {
    if (!selectedSignal || !companyId) return;
    setLeadBusy(true);
    setActionNotice(null);
    try {
      const res = await fetch('/api/engagement/signal/status', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          signalId: selectedSignal.id,
          status: 'actioned',
          companyId,
          lead: true,
        }),
      });
      if (!res.ok) {
        const msg = await res.text().catch(() => res.statusText);
        throw new Error(msg || 'Mark as lead failed');
      }
      setSelectedSignal((s) =>
        s?.id === selectedSignal.id ? { ...s, signal_status: 'actioned' } : s,
      );
      setSignals((prev) =>
        prev.map((x) => (x.id === selectedSignal.id ? { ...x, signal_status: 'actioned' } : x)),
      );
      setActionNotice({ kind: 'success', text: 'Marked as lead.' });
    } catch (err: any) {
      setActionNotice({ kind: 'error', text: err?.message ?? 'Mark as lead failed' });
    } finally {
      setLeadBusy(false);
    }
  };

  const exportToCrm = async () => {
    if (!selectedSignal || !companyId) return;
    setCrmBusy(true);
    setActionNotice(null);
    try {
      const res = await fetch('/api/engagement/crm-export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          organization_id: companyId,
          signal_id: selectedSignal.id,
          platform: selectedSignal.platform,
          author: selectedSignal.author,
          content: selectedSignal.content,
          conversation_url: selectedSignal.conversation_url,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error((data as { error?: string }).error ?? 'Export failed');
      }
      setActionNotice({
        kind: 'success',
        text: (data as { message?: string }).message ?? 'Exported to CRM.',
      });
    } catch (err: any) {
      setActionNotice({ kind: 'error', text: err?.message ?? 'Export failed' });
    } finally {
      setCrmBusy(false);
    }
  };

  const updateSignalStatus = async (signalId: string, status: string) => {
    try {
      const res = await fetch('/api/engagement/signal/status', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ signalId, status, companyId }),
      });
      if (!res.ok) throw new Error(res.statusText);
      setSelectedSignal((s) => (s?.id === signalId ? { ...s, signal_status: status } : s));
      setSignals((prev) => prev.map((x) => (x.id === signalId ? { ...x, signal_status: status } : x)));
    } catch {
      // ignore
    }
  };

  const fetchSignals = useCallback(async () => {
    if (!companyId) {
      setSignals([]);
      return;
    }
    setLoading(true);
    const params = new URLSearchParams({ companyId });
    if (campaignId) params.set('campaignId', campaignId);
    if (platform) params.set('platform', platform);
    if (signalType) params.set('signalType', signalType);
    const days = parseInt(String(timeRange).replace('d', ''), 10) || 7;
    const from = new Date();
    from.setDate(from.getDate() - days);
    params.set('dateFrom', from.toISOString());
    params.set('dateTo', new Date().toISOString());

    try {
      const res = await fetch(`/api/engagement/campaign-signals?${params}`, { credentials: 'include' });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setSignals(data.signals ?? []);
      if (selectedSignal && !(data.signals ?? []).some((s: CampaignSignal) => s.id === selectedSignal.id)) {
        setSelectedSignal(null);
        setReplyText('');
        setReplyError(null);
        setReplySuccess(false);
      }
    } catch (err) {
      setSignals([]);
    } finally {
      setLoading(false);
    }
  }, [companyId, campaignId, platform, signalType, timeRange, selectedSignal?.id]);

  useEffect(() => {
    fetchSignals();
  }, [fetchSignals]);

  useEffect(() => {
    if (!companyId) return;
    fetch(`/api/campaigns/list?companyId=${encodeURIComponent(companyId)}`, { credentials: 'include' })
      .then((r) => r.ok ? r.json() : { campaigns: [] })
      .then((data) => setCampaigns(data.campaigns ?? []))
      .catch(() => setCampaigns([]));
  }, [companyId]);

  return (
    <>
      <Head>
        <title>Campaign Engagement Inbox</title>
      </Head>
      <div className="min-h-screen bg-gray-50 flex flex-col">
        <header className="bg-white border-b border-gray-200 px-6 py-4">
          <h1 className="text-xl font-semibold text-gray-900">Campaign Engagement Inbox</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Conversations and signals from your campaign activities
          </p>
        </header>

        <div className="flex flex-1 overflow-hidden">
          {/* Left: Filters */}
          <aside className="w-64 bg-white border-r border-gray-200 p-4 shrink-0 overflow-y-auto">
            <h2 className="text-sm font-semibold text-gray-900 mb-3">Filters</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Campaign</label>
                <select
                  value={campaignId}
                  onChange={(e) => setCampaignId(e.target.value)}
                  className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
                >
                  <option value="">All campaigns</option>
                  {campaigns.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Platform</label>
                <select
                  value={platform}
                  onChange={(e) => setPlatform(e.target.value)}
                  className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
                >
                  <option value="">All</option>
                  {PLATFORMS.map((p) => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Signal type</label>
                <select
                  value={signalType}
                  onChange={(e) => setSignalType(e.target.value)}
                  className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
                >
                  <option value="">All</option>
                  {SIGNAL_TYPES.map((s) => (
                    <option key={s} value={s}>{s.replace('_', ' ')}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Time range</label>
                <select
                  value={timeRange}
                  onChange={(e) => setTimeRange(e.target.value)}
                  className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
                >
                  {TIME_RANGES.map((t) => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
              </div>
            </div>
          </aside>

          {/* Main: Signal list */}
          <main className="flex-1 min-w-0 border-r border-gray-200 flex flex-col bg-white">
            <div className="p-3 border-b border-gray-100 text-sm text-gray-500">
              {loading ? 'Loading...' : `${signals.length} signal${signals.length !== 1 ? 's' : ''}`}
            </div>
            <div className="flex-1 overflow-y-auto">
              {loading ? (
                <div className="p-8 text-center text-gray-500">Loading signals...</div>
              ) : signals.length === 0 ? (
                <div className="p-8 text-center text-gray-500">
                  No campaign signals yet. Engagement from campaign activities will appear here.
                </div>
              ) : (
                <ul className="divide-y divide-gray-100">
                  {signals.map((sig) => (
                    <li
                      key={sig.id}
                      onClick={() => {
                        // Switching signals resets reply state + dismisses
                        // any unused suggestion on the prior signal.
                        resetSuggestion(true);
                        setSelectedSignal(sig);
                        setReplyText('');
                        setReplyError(null);
                        setReplySuccess(false);
                        setIntelligence(null);
                        fetchIntelligence(sig);
                      }}
                      className={`p-3 cursor-pointer hover:bg-gray-50 ${
                        selectedSignal?.id === sig.id ? 'bg-indigo-50' : ''
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 text-xs text-gray-500">
                            <span className="font-medium text-gray-900">{sig.author || 'Anonymous'}</span>
                            <PlatformIcon platform={sig.platform} size={12} showLabel />
                            <span className="capitalize">{sig.signal_type.replace('_', ' ')}</span>
                            <span>{(Number(sig.engagement_score) * 100).toFixed(0)}%</span>
                          </div>
                          <p className="text-sm text-gray-800 line-clamp-2 mt-0.5">{sig.content || '—'}</p>
                          <p className="text-xs text-gray-400 mt-1">
                            {sig.detected_at ? new Date(sig.detected_at).toLocaleString() : '—'}
                          </p>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </main>

          {/* Right: Detail */}
          <aside className="w-96 bg-white flex flex-col shrink-0">
            {selectedSignal ? (
              <>
                <div className="p-4 border-b border-gray-200">
                  <h2 className="text-sm font-semibold text-gray-900">Conversation detail</h2>
                </div>
                <div className="flex-1 overflow-y-auto p-4 space-y-4">
                  <div>
                    <div className="text-xs text-gray-500 mb-1">Author</div>
                    <div className="text-sm font-medium text-gray-900">
                      {selectedSignal.author || 'Anonymous'}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-gray-500 mb-1">Content</div>
                    <p className="text-sm text-gray-800 whitespace-pre-wrap">
                      {selectedSignal.content || '—'}
                    </p>
                  </div>
                  <div>
                    <div className="text-xs text-gray-500 mb-1">Platform · Type · Score</div>
                    <div className="flex items-center gap-2 text-sm">
                      <PlatformIcon platform={selectedSignal.platform} size={14} showLabel />
                      <span className="capitalize">{selectedSignal.signal_type.replace('_', ' ')}</span>
                      <span>{(Number(selectedSignal.engagement_score) * 100).toFixed(0)}%</span>
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-gray-500 mb-1">Date</div>
                    <div className="text-sm text-gray-700">
                      {selectedSignal.detected_at
                        ? new Date(selectedSignal.detected_at).toLocaleString()
                        : '—'}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-gray-500 mb-1">Status</div>
                    <select
                      value={selectedSignal.signal_status || 'new'}
                      onChange={(e) => updateSignalStatus(selectedSignal.id, e.target.value)}
                      className="rounded border border-gray-300 px-2 py-1 text-sm"
                    >
                      {SIGNAL_STATUSES.map((s) => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </select>
                  </div>
                  {selectedSignal.conversation_url && (
                    <a
                      href={selectedSignal.conversation_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-sm text-indigo-600 hover:underline"
                    >
                      <ExternalLink className="h-4 w-4" />
                      View thread
                    </a>
                  )}
                  <div className="text-xs text-gray-500 pt-2">
                    Linked activity: {selectedSignal.activity_id}
                  </div>
                  {/* AI suggestion panel */}
                  <div className="pt-4 space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="block text-xs font-medium text-gray-700">
                        AI suggestion
                      </label>
                      <button
                        type="button"
                        disabled={suggestionBusy}
                        onClick={generateSuggestion}
                        className="text-xs text-indigo-600 hover:underline disabled:opacity-50 inline-flex items-center gap-1"
                      >
                        <Sparkles className="h-3 w-3" />
                        {suggestionBusy ? 'Generating...' : suggestion ? 'Regenerate' : 'Generate'}
                      </button>
                    </div>
                    {suggestion && (
                      <div className="rounded border border-indigo-200 bg-indigo-50 px-3 py-2 space-y-2">
                        <p className="text-sm text-gray-900 whitespace-pre-wrap">{suggestion}</p>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={acceptSuggestion}
                            className="px-2 py-1 rounded bg-indigo-600 text-white text-xs hover:bg-indigo-700"
                          >
                            Use suggestion
                          </button>
                          <button
                            type="button"
                            onClick={dismissSuggestion}
                            className="px-2 py-1 rounded border border-gray-300 text-xs hover:bg-white"
                          >
                            Dismiss
                          </button>
                          {suggestionModel && (
                            <span className="text-[10px] text-gray-500 ml-auto">model: {suggestionModel}</span>
                          )}
                        </div>
                      </div>
                    )}
                    {suggestionError && (
                      <p className="text-xs text-red-600">{suggestionError}</p>
                    )}

                    {/*
                      Intelligence block.
                      · Insight line (max 1) under the suggestion panel.
                      · Confidence badge always shown when intelligence loaded.
                      · Recommendation CTA only when confidence === 'high'.
                      Hidden entirely if no useful data arrived.
                    */}
                    {intelligence && (intelligence.insight || intelligence.confidence) && (
                      <div className="space-y-1.5 pt-1">
                        {intelligence.insight && (
                          <div className="flex items-start gap-1.5 text-xs text-gray-700">
                            <Lightbulb className="h-3.5 w-3.5 mt-0.5 text-amber-500 shrink-0" />
                            <span>{intelligence.insight}</span>
                          </div>
                        )}
                        {intelligence.confidence && (
                          <div className="flex items-center gap-1.5 text-xs">
                            <ShieldCheck
                              className={`h-3.5 w-3.5 ${
                                intelligence.confidence.level === 'high'
                                  ? 'text-green-600'
                                  : intelligence.confidence.level === 'medium'
                                  ? 'text-yellow-600'
                                  : 'text-gray-400'
                              }`}
                            />
                            <span className="text-gray-600">
                              Execution Confidence:{' '}
                              <span className="font-medium capitalize">
                                {intelligence.confidence.level}
                              </span>{' '}
                              ({intelligence.confidence.score}%)
                            </span>
                          </div>
                        )}
                        {intelligence.confidence?.level === 'high' &&
                          intelligence.recommendation && (
                            <div className="rounded border border-emerald-200 bg-emerald-50 px-2 py-1.5 text-xs flex items-center justify-between gap-2">
                              <div className="flex items-start gap-1.5 min-w-0">
                                <Zap className="h-3.5 w-3.5 text-emerald-600 mt-0.5 shrink-0" />
                                <div className="min-w-0">
                                  <div className="font-medium text-emerald-900">
                                    Suggested Action
                                  </div>
                                  <div className="text-emerald-800 truncate">
                                    {intelligence.recommendation.label}
                                  </div>
                                </div>
                              </div>
                              <button
                                type="button"
                                onClick={() => {
                                  // "Try This" opts into the recommendation type.
                                  // For short_reply / ask_question we nudge the
                                  // text state; for dm_followup we leave the
                                  // action explicit to the user.
                                  const rec = intelligence.recommendation;
                                  if (!rec) return;
                                  if (rec.type === 'ask_question' && !replyText.trim()) {
                                    setReplyText('What specifically are you trying to solve? ');
                                  } else if (rec.type === 'short_reply' && replyText.length > 160) {
                                    setReplyText(replyText.slice(0, 160));
                                  }
                                }}
                                className="px-2 py-1 rounded bg-emerald-600 text-white text-[11px] hover:bg-emerald-700 shrink-0"
                              >
                                Try This
                              </button>
                            </div>
                          )}
                      </div>
                    )}
                    {intelligenceBusy && !intelligence && (
                      <p className="text-[11px] text-gray-400">Analyzing context…</p>
                    )}
                  </div>

                  {/* Reply input */}
                  <div className="pt-2 space-y-2">
                    <label className="block text-xs font-medium text-gray-700">Reply</label>
                    <textarea
                      rows={3}
                      value={replyText}
                      onChange={(e) => {
                        setReplyText(e.target.value);
                        setReplyError(null);
                        setReplySuccess(false);
                        // Once the user types, the suggestion is no longer
                        // "fresh" — resets used flag so dismiss records
                        // truthfully on panel change.
                        setSuggestionUsed(false);
                      }}
                      placeholder="Type your reply..."
                      className="w-full rounded border border-gray-300 px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                    {replyError && (
                      <p className="text-xs text-red-600">{replyError}</p>
                    )}
                    {replySuccess && (
                      <p className="text-xs text-green-600">Reply sent successfully.</p>
                    )}
                    {/*
                      Hints block. Max 2, rendered as a tight bulleted list
                      immediately below the reply input so they sit at the
                      user's decision point. Hidden when no hints returned.
                    */}
                    {intelligence && intelligence.hints && intelligence.hints.length > 0 && (
                      <ul className="text-xs text-gray-600 space-y-0.5 pt-1">
                        {intelligence.hints.slice(0, 2).map((hint, i) => (
                          <li key={i} className="flex items-start gap-1.5">
                            <span className="text-gray-400 mt-0.5">•</span>
                            <span>{hint}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                    <button
                      type="button"
                      disabled={!replyText.trim() || replying}
                      onClick={sendReply}
                      className="w-full px-3 py-2 rounded bg-indigo-600 text-white text-sm hover:bg-indigo-700 disabled:opacity-50 flex items-center justify-center gap-1.5"
                    >
                      <Send className="h-4 w-4" />
                      {replying ? 'Sending...' : 'Send Reply'}
                    </button>
                  </div>

                  {/*
                    Secondary actions. The primary "Reply" submit lives in
                    the textarea above; the earlier orphan Reply button
                    here was removed so there is exactly one way to send.
                  */}
                  <div className="flex flex-wrap gap-2 pt-2">
                    <button
                      type="button"
                      disabled={bookmarkBusy}
                      onClick={toggleBookmark}
                      className="px-3 py-1.5 rounded border border-gray-300 text-sm hover:bg-gray-50 disabled:opacity-50 flex items-center gap-1.5"
                    >
                      <Bookmark className="h-4 w-4" />
                      {selectedSignal.signal_status === 'reviewed' ? 'Bookmarked' : 'Bookmark'}
                    </button>
                    <button
                      type="button"
                      disabled={leadBusy}
                      onClick={markAsLead}
                      className="px-3 py-1.5 rounded border border-gray-300 text-sm hover:bg-gray-50 disabled:opacity-50 flex items-center gap-1.5"
                    >
                      <UserPlus className="h-4 w-4" />
                      Mark as lead
                    </button>
                    <button
                      type="button"
                      disabled={crmBusy}
                      onClick={exportToCrm}
                      className="px-3 py-1.5 rounded border border-gray-300 text-sm hover:bg-gray-50 disabled:opacity-50 flex items-center gap-1.5"
                    >
                      <Send className="h-4 w-4" />
                      Export to CRM
                    </button>
                  </div>
                  {actionNotice && (
                    <p
                      className={`text-xs ${
                        actionNotice.kind === 'success' ? 'text-green-600' : 'text-red-600'
                      }`}
                    >
                      {actionNotice.text}
                    </p>
                  )}
                </div>
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center p-8 text-center text-gray-500 text-sm">
                Select a signal to view details
              </div>
            )}
          </aside>
        </div>
      </div>
    </>
  );
}
