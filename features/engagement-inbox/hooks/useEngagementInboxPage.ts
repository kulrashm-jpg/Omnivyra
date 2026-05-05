import { useCallback, useEffect, useState } from 'react';
import { useCompanyContext } from '@/components/CompanyContext';
import {
  sendReply as apiSendReply,
  sendAISuggestion,
  trackAISuggestionShown,
  trackAISuggestionUsed,
  getIntelligenceContext,
  generateResponse as apiGenerateResponse,
  updateSignalStatus as apiUpdateSignalStatus,
  exportToCRM as apiExportToCRM,
  getCampaignSignals,
  getCampaigns,
} from '@/features/engagement-inbox/data/engagementInbox.api';

import type {
  CampaignSignal,
  IntelligenceState,
  ActionNotice,
  Campaign,
} from '@/features/engagement-inbox/types';

export function useEngagementInboxPage() {
  const { selectedCompanyId } = useCompanyContext();
  const companyId = selectedCompanyId || '';

  // ── State ──────────────────────────────────────────────────────────────────
  const [signals, setSignals] = useState<CampaignSignal[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedSignal, setSelectedSignal] = useState<CampaignSignal | null>(null);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
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
  const [actionNotice, setActionNotice] = useState<ActionNotice>(null);
  // Suggestion lifecycle
  const [suggestion, setSuggestion] = useState<string | null>(null);
  const [suggestionId, setSuggestionId] = useState<string | null>(null);
  const [suggestionCorrelationId, setSuggestionCorrelationId] = useState<string | null>(null);
  const [suggestionModel, setSuggestionModel] = useState<string | null>(null);
  const [suggestionBusy, setSuggestionBusy] = useState(false);
  const [suggestionError, setSuggestionError] = useState<string | null>(null);
  const [suggestionUsed, setSuggestionUsed] = useState(false);
  // Intelligence
  const [intelligence, setIntelligence] = useState<IntelligenceState>(null);
  const [intelligenceBusy, setIntelligenceBusy] = useState(false);

  // ── Suggestion telemetry (thin wrappers per spec) ──────────────────────────
  const handleSuggestionShown = useCallback(async (payload: Record<string, unknown>) => {
    return trackAISuggestionShown(payload);
  }, []);

  const handleSuggestionUsed = useCallback(async (payload: Record<string, unknown>) => {
    return trackAISuggestionUsed(payload);
  }, []);

  const handleSuggestionRejected = useCallback(async (payload: Record<string, unknown>) => {
    return sendAISuggestion(payload);
  }, []);

  // ── Intelligence ───────────────────────────────────────────────────────────
  const handleIntelligenceFetch = useCallback(async (signal: CampaignSignal) => {
    if (!companyId) return;
    setIntelligenceBusy(true);
    try {
      const res = await getIntelligenceContext({
        organization_id: companyId,
        platform: signal.platform,
        action_type: 'reply',
        target_id: signal.id,
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
  }, [companyId]);

  // ── Reset suggestion (internal — called on signal change + dismiss) ────────
  const resetSuggestion = useCallback((fromSignalChange: boolean) => {
    if (suggestion && suggestionId && !suggestionUsed) {
      sendAISuggestion({
        event: 'rejected',
        suggestion_id: suggestionId,
        reason: fromSignalChange ? 'dismissed' : 'cleared',
      }).catch(() => {});
    }
    setSuggestion(null);
    setSuggestionId(null);
    setSuggestionCorrelationId(null);
    setSuggestionModel(null);
    setSuggestionError(null);
    setSuggestionUsed(false);
  }, [suggestion, suggestionId, suggestionUsed]);

  // ── Signal status update ───────────────────────────────────────────────────
  const handleSignalStatusUpdate = useCallback(async (signalId: string, status: string) => {
    try {
      const res = await apiUpdateSignalStatus({ signalId, status, companyId });
      if (!res.ok) throw new Error(res.statusText);
      setSelectedSignal(s => s?.id === signalId ? { ...s, signal_status: status } : s);
      setSignals(prev => prev.map(x => x.id === signalId ? { ...x, signal_status: status } : x));
    } catch {
      // ignore
    }
  }, [companyId]);

  // ── Reply ──────────────────────────────────────────────────────────────────
  const handleReply = useCallback(async () => {
    if (!selectedSignal || !replyText.trim() || !companyId) return;
    setReplying(true);
    setReplyError(null);
    setReplySuccess(false);
    try {
      const verbatim = Boolean(
        suggestion && suggestionId && replyText.trim() === suggestion.trim()
      );
      const body: Record<string, unknown> = {
        organization_id: companyId,
        signal_id: selectedSignal.id,
        reply_text: replyText.trim(),
        platform: selectedSignal.platform,
      };
      if (verbatim && suggestionId) body.suggestion_id = suggestionId;
      if (suggestionCorrelationId) body.correlation_id = suggestionCorrelationId;

      const res = await apiSendReply(body);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Reply failed');
      setReplyText('');
      setReplySuccess(true);
      setSuggestionUsed(true);

      if (suggestion && suggestionId && !verbatim) {
        trackAISuggestionUsed({
          event: 'rejected',
          suggestion_id: suggestionId,
          reason: 'edited',
        }).catch(() => {});
      }

      await handleSignalStatusUpdate(selectedSignal.id, 'actioned');
    } catch (err: any) {
      setReplyError(err.message);
    } finally {
      setReplying(false);
    }
  }, [companyId, selectedSignal, replyText, suggestion, suggestionId, suggestionCorrelationId, handleSignalStatusUpdate]);

  // ── Generate suggestion ────────────────────────────────────────────────────
  const handleGenerateResponse = useCallback(async () => {
    if (!selectedSignal || !companyId) return;
    resetSuggestion(false);
    setSuggestionBusy(true);
    setSuggestionError(null);
    try {
      const genRes = await apiGenerateResponse({
        organization_id: companyId,
        platform: selectedSignal.platform,
        original_message: selectedSignal.content ?? '',
        author_name: selectedSignal.author ?? null,
        signal_id: selectedSignal.id,
      });
      const genData = await genRes.json().catch(() => ({} as Record<string, unknown>));
      if (!genRes.ok) {
        throw new Error(((genData as { error?: string }).error) ?? 'Suggestion generation failed');
      }
      const text =
        (genData as { text?: string; suggested_text?: string }).text ??
        (genData as { suggested_text?: string }).suggested_text ??
        '';
      const model = (genData as { model?: string }).model ?? null;
      if (!text) throw new Error('Suggestion text was empty');

      const shownRes = await trackAISuggestionShown({
        event: 'shown',
        organization_id: companyId,
        platform: selectedSignal.platform,
        action_type: 'reply',
        content: text,
        model,
        target_id: selectedSignal.id,
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

      if (selectedSignal) handleIntelligenceFetch(selectedSignal);
    } catch (err: any) {
      setSuggestionError(err?.message ?? 'Suggestion failed');
    } finally {
      setSuggestionBusy(false);
    }
  }, [companyId, selectedSignal, resetSuggestion, handleIntelligenceFetch]);

  // ── Suggestion accept / dismiss ────────────────────────────────────────────
  const acceptSuggestion = useCallback(() => {
    if (!suggestion) return;
    setReplyText(suggestion);
  }, [suggestion]);

  const dismissSuggestion = useCallback(() => {
    resetSuggestion(false);
  }, [resetSuggestion]);

  // ── Signal selection (compound) ────────────────────────────────────────────
  const selectSignal = useCallback((sig: CampaignSignal) => {
    resetSuggestion(true);
    setSelectedSignal(sig);
    setReplyText('');
    setReplyError(null);
    setReplySuccess(false);
    setIntelligence(null);
    handleIntelligenceFetch(sig);
  }, [resetSuggestion, handleIntelligenceFetch]);

  // ── Bookmark / Mark as lead / Export to CRM ────────────────────────────────
  const toggleBookmark = useCallback(async () => {
    if (!selectedSignal || !companyId) return;
    setBookmarkBusy(true);
    setActionNotice(null);
    try {
      const next = selectedSignal.signal_status === 'reviewed' ? 'new' : 'reviewed';
      await handleSignalStatusUpdate(selectedSignal.id, next);
      setActionNotice({
        kind: 'success',
        text: next === 'reviewed' ? 'Bookmarked.' : 'Bookmark removed.',
      });
    } catch (err: any) {
      setActionNotice({ kind: 'error', text: err?.message ?? 'Bookmark failed' });
    } finally {
      setBookmarkBusy(false);
    }
  }, [selectedSignal, companyId, handleSignalStatusUpdate]);

  const markAsLead = useCallback(async () => {
    if (!selectedSignal || !companyId) return;
    setLeadBusy(true);
    setActionNotice(null);
    try {
      const res = await apiUpdateSignalStatus({
        signalId: selectedSignal.id,
        status: 'actioned',
        companyId,
        lead: true,
      });
      if (!res.ok) {
        const msg = await res.text().catch(() => res.statusText);
        throw new Error(msg || 'Mark as lead failed');
      }
      setSelectedSignal(s =>
        s?.id === selectedSignal.id ? { ...s, signal_status: 'actioned' } : s,
      );
      setSignals(prev =>
        prev.map(x => x.id === selectedSignal.id ? { ...x, signal_status: 'actioned' } : x),
      );
      setActionNotice({ kind: 'success', text: 'Marked as lead.' });
    } catch (err: any) {
      setActionNotice({ kind: 'error', text: err?.message ?? 'Mark as lead failed' });
    } finally {
      setLeadBusy(false);
    }
  }, [selectedSignal, companyId]);

  const handleCRMExport = useCallback(async () => {
    if (!selectedSignal || !companyId) return;
    setCrmBusy(true);
    setActionNotice(null);
    try {
      const res = await apiExportToCRM({
        organization_id: companyId,
        signal_id: selectedSignal.id,
        platform: selectedSignal.platform,
        author: selectedSignal.author,
        content: selectedSignal.content,
        conversation_url: selectedSignal.conversation_url,
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
  }, [selectedSignal, companyId]);

  // ── Reply text input handler (compound — also clears flags) ────────────────
  const handleReplyTextChange = useCallback((text: string) => {
    setReplyText(text);
    setReplyError(null);
    setReplySuccess(false);
    setSuggestionUsed(false);
  }, []);

  // ── "Try this" recommendation handler ──────────────────────────────────────
  const tryRecommendation = useCallback(() => {
    const rec = intelligence?.recommendation;
    if (!rec) return;
    if (rec.type === 'ask_question' && !replyText.trim()) {
      setReplyText('What specifically are you trying to solve? ');
    } else if (rec.type === 'short_reply' && replyText.length > 160) {
      setReplyText(replyText.slice(0, 160));
    }
  }, [intelligence, replyText]);

  // ── Loaders ────────────────────────────────────────────────────────────────
  const loadSignals = useCallback(async () => {
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
      const res = await getCampaignSignals(params);
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setSignals(data.signals ?? []);
      if (selectedSignal && !(data.signals ?? []).some((s: CampaignSignal) => s.id === selectedSignal.id)) {
        setSelectedSignal(null);
        setReplyText('');
        setReplyError(null);
        setReplySuccess(false);
      }
    } catch {
      setSignals([]);
    } finally {
      setLoading(false);
    }
  }, [companyId, campaignId, platform, signalType, timeRange, selectedSignal?.id]);

  const loadCampaigns = useCallback(async () => {
    if (!companyId) {
      setCampaigns([]);
      return;
    }
    try {
      const r = await getCampaigns(companyId);
      const data = r.ok ? await r.json() : { campaigns: [] };
      setCampaigns(data.campaigns ?? []);
    } catch {
      setCampaigns([]);
    }
  }, [companyId]);

  // ── Effects ────────────────────────────────────────────────────────────────
  useEffect(() => {
    loadSignals();
  }, [loadSignals]);

  useEffect(() => {
    loadCampaigns();
  }, [loadCampaigns]);

  return {
    state: {
      companyId,
      signals,
      loading,
      selectedSignal,
      campaigns,
      campaignId,
      platform,
      signalType,
      timeRange,
      replyText,
      replying,
      replyError,
      replySuccess,
      bookmarkBusy,
      leadBusy,
      crmBusy,
      actionNotice,
      suggestion,
      suggestionId,
      suggestionCorrelationId,
      suggestionModel,
      suggestionBusy,
      suggestionError,
      suggestionUsed,
      intelligence,
      intelligenceBusy,
    },
    actions: {
      // Filter setters
      setCampaignId,
      setPlatform,
      setSignalType,
      setTimeRange,
      // Loaders
      loadSignals,
      loadCampaigns,
      // Reply flow
      handleReply,
      handleReplyTextChange,
      // Suggestion flow
      handleGenerateResponse,
      acceptSuggestion,
      dismissSuggestion,
      handleSuggestionShown,
      handleSuggestionUsed,
      handleSuggestionRejected,
      // Signal actions
      selectSignal,
      handleSignalStatusUpdate,
      toggleBookmark,
      markAsLead,
      // CRM + intelligence
      handleCRMExport,
      handleIntelligenceFetch,
      tryRecommendation,
    },
  };
}
