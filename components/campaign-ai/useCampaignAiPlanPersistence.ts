import type React from 'react';
import { fetchWithAuth } from '../community-ai/fetchWithAuth';
import type { AIProvider, ChatMessage, StructuredPlan } from './types';

type Setter<T> = React.Dispatch<React.SetStateAction<T>>;

type UseCampaignAiPlanPersistenceParams = {
  campaignId?: string;
  messages: ChatMessage[];
  setMessages: Setter<ChatMessage[]>;
  selectedProvider: AIProvider;
  getProviderName: (provider: AIProvider) => string;
  getChatStorageKey: (campaignId: string) => string;
  planSource: 'ai' | 'committed' | 'draft';
  onProgramGenerated?: (program: any) => void;
  structuredPlan: StructuredPlan | null;
  setStructuredPlan: Setter<StructuredPlan | null>;
  setStructuredPlanMessageId: Setter<number | null>;
  retrievePlanData: { savedPlan?: { content: string; savedAt: string }; committedPlan?: { weeks: any[] }; draftPlan?: { weeks: any[]; savedAt: string } } | null;
  setPlanSource: Setter<'ai' | 'committed' | 'draft'>;
  setShowPlanOverview: Setter<boolean>;
  setShowPlanPreview: Setter<boolean>;
  setSelectedPlan: Setter<string>;
  setHasViewedPlanMessageId: Setter<number | null>;
  setIsSavingDraftForView: Setter<boolean>;
  setUiErrorMessage: Setter<string | null>;
  setIsParsingSavedPlan: Setter<boolean>;
  commitStartDate: string;
  setCommitStartDate: Setter<string>;
  prefilledPlanning?: Record<string, unknown> | null;
  collectedPlanningContext?: Record<string, unknown> | null;
  campaignData?: any;
  commitDurationWeeks: number;
  setCommitDurationWeeks: Setter<number>;
  setShowDateSelection: Setter<boolean>;
  resolveWorkingDurationWeeks: () => number;
  convertStructuredPlanToProgram: (plan: StructuredPlan) => any;
  create12WeekPlan: (startDate: string, durationWeeks?: number) => Promise<void>;
};

export function useCampaignAiPlanPersistence({
  campaignId,
  messages,
  setMessages,
  selectedProvider,
  getProviderName,
  getChatStorageKey,
  planSource,
  onProgramGenerated,
  structuredPlan,
  setStructuredPlan,
  setStructuredPlanMessageId,
  retrievePlanData,
  setPlanSource,
  setShowPlanOverview,
  setShowPlanPreview,
  setSelectedPlan,
  setHasViewedPlanMessageId,
  setIsSavingDraftForView,
  setUiErrorMessage,
  setIsParsingSavedPlan,
  commitStartDate,
  setCommitStartDate,
  prefilledPlanning,
  collectedPlanningContext,
  campaignData,
  commitDurationWeeks,
  setCommitDurationWeeks,
  setShowDateSelection,
  resolveWorkingDurationWeeks,
  convertStructuredPlanToProgram,
  create12WeekPlan,
}: UseCampaignAiPlanPersistenceParams) {
  const persistChatDraft = () => {
    if (!campaignId || typeof window === 'undefined') return;
    try {
      window.sessionStorage.setItem(
        getChatStorageKey(campaignId),
        JSON.stringify({ messages, savedAt: new Date().toISOString() })
      );
    } catch (e) {
      console.warn('Could not persist chat to sessionStorage', e);
    }
  };

  const serializeStructuredPlanToText = (plan: StructuredPlan): string => {
    const fmt = (s: unknown) => String(s ?? '').trim();
    const oneLine = (s: unknown, max = 180) => {
      const t = fmt(s).replace(/\s+/g, ' ');
      if (!t) return '';
      return t.length > max ? t.slice(0, max - 1) + '...' : t;
    };
    const serializeBreakdown = (w: any) => {
      const b = w?.platform_content_breakdown;
      if (!b || typeof b !== 'object') return '';
      const lines: string[] = [];
      for (const [platform, items] of Object.entries(b as any)) {
        if (!Array.isArray(items) || items.length === 0) continue;
        const parts = items.map((it: any) => {
          const type = fmt(it?.type) || 'item';
          const count = Number(it?.count ?? 0);
          const topics = Array.isArray(it?.topics) ? it.topics.map((t: any) => oneLine(t, 80)).filter(Boolean) : [];
          const topicSeed = topics.length > 0 ? ` - topics: ${topics.slice(0, 4).join(' | ')}${topics.length > 4 ? ' ...' : ''}` : '';
          return `${type}${Number.isFinite(count) && count > 1 ? ` (${count})` : ''}${topicSeed}`;
        });
        lines.push(`${platform}: ${parts.join('; ')}`);
      }
      return lines.length > 0 ? `Platform breakdown:\n${lines.map((l) => `- ${l}`).join('\n')}` : '';
    };
    const serializeTopicBriefs = (w: any) => {
      const topics = Array.isArray(w?.topics) ? w.topics : [];
      if (topics.length === 0) return '';
      const lines = topics.slice(0, 6).map((t: any, idx: number) => {
        const title = fmt(t?.topicTitle) || `Topic ${idx + 1}`;
        const intent = oneLine(t?.topicContext?.writingIntent, 140);
        const who = oneLine(t?.whoAreWeWritingFor, 90);
        const problem = oneLine(t?.whatProblemAreWeAddressing, 90);
        return `- ${title}${intent ? ` - ${intent}` : ''}${who ? ` (who: ${who})` : ''}${problem ? ` (problem: ${problem})` : ''}`;
      });
      return `Writer briefs (sample):\n${lines.join('\n')}${topics.length > 6 ? `\n- ... +${topics.length - 6} more` : ''}`;
    };

    return plan.weeks.map((w: any) => {
      const theme = fmt(w.theme || w.phase_label) || `Week ${w.week}`;
      const objective = oneLine(w.primary_objective || w.objective, 220);
      const platforms = w.platform_allocation ? Object.entries(w.platform_allocation).map(([p, n]) => `${p}: ${n}`).join(', ') : '';
      const content = Array.isArray(w.content_type_mix) ? w.content_type_mix.join(', ') : '';
      const capsule = w?.weeklyContextCapsule;
      const audience = capsule ? oneLine(capsule.audienceProfile, 120) : '';
      const weeklyIntent = capsule ? oneLine(capsule.weeklyIntent, 160) : '';
      const tone = capsule ? oneLine(capsule.toneGuidance, 120) : '';
      const topicsToCover = Array.isArray(w.topics_to_cover) ? w.topics_to_cover.map((t: any) => oneLine(t, 80)).filter(Boolean) : [];
      return [
        `Week ${w.week}: ${theme}`,
        objective ? `Objective: ${objective}` : '',
        platforms ? `Platforms: ${platforms}` : 'Platforms: -',
        content ? `Content mix: ${content}` : 'Content mix: -',
        audience ? `Audience: ${audience}` : '',
        weeklyIntent ? `Weekly intent: ${weeklyIntent}` : '',
        tone ? `Tone: ${tone}` : '',
        topicsToCover.length > 0 ? `Topics to cover:\n${topicsToCover.slice(0, 10).map((t: string) => `- ${t}`).join('\n')}${topicsToCover.length > 10 ? '\n- ...' : ''}` : '',
        serializeBreakdown(w),
        serializeTopicBriefs(w),
      ].filter(Boolean).join('\n');
    }).join('\n\n');
  };

  const saveAIContentForPlan = async (aiMessage: string, structuredPlanToSave?: StructuredPlan | null) => {
    if (!campaignId) return;
    try {
      if (structuredPlanToSave?.weeks?.length) {
        const isEditOfCommitted = planSource === 'committed';
        const api = isEditOfCommitted ? '/api/campaigns/update-edited-committed' : '/api/campaigns/save-draft-plan';
        const draftRes = await fetchWithAuth(api, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ campaignId, structuredPlan: { weeks: structuredPlanToSave.weeks } }),
        });
        if (!draftRes.ok) {
          const err = await draftRes.json().catch(() => ({}));
          throw new Error(err?.error ?? err?.message ?? 'Failed to save draft plan');
        }
        persistChatDraft();
        setMessages((prev) => [...prev, {
          id: Date.now(),
          type: 'ai',
          message: isEditOfCommitted ? 'Changes saved to submitted plan (edited).' : 'Plan saved as draft. Topics, platforms, and content breakdown preserved.',
          timestamp: new Date().toLocaleTimeString(),
          provider: getProviderName(selectedProvider),
          campaignId,
        }]);
        return;
      }

      const response = await fetchWithAuth('/api/campaigns/save-ai-content', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ campaignId, aiContent: aiMessage, timestamp: new Date().toISOString(), provider: selectedProvider }),
      });
      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error((errData?.error ?? errData?.message ?? response.statusText) || 'Failed to save content');
      }
      persistChatDraft();
      setMessages((prev) => [...prev, {
        id: Date.now(),
        type: 'ai',
        message: 'Chat saved! Open Campaign planning (draft or edit) to continue with this conversation on the same page.',
        timestamp: new Date().toLocaleTimeString(),
        provider: getProviderName(selectedProvider),
        campaignId,
      }]);
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Unknown error';
      setMessages((prev) => [...prev, {
        id: Date.now(),
        type: 'ai',
        message: `Error: Failed to save AI content. ${detail}`,
        timestamp: new Date().toLocaleTimeString(),
        provider: getProviderName(selectedProvider),
        campaignId,
      }]);
    }
  };

  const saveDraftAndViewOnCampaign = async () => {
    if (!campaignId || !structuredPlan?.weeks?.length || !onProgramGenerated) return;
    setIsSavingDraftForView(true);
    setUiErrorMessage(null);
    const weeksToSave = structuredPlan.weeks.map((w: any, idx: number) => ({
      ...w,
      week: Number(w.week ?? w.week_number ?? idx + 1) || idx + 1,
      week_number: Number(w.week_number ?? w.week ?? idx + 1) || idx + 1,
    }));
    let saveSucceeded = false;
    try {
      const saveRes = await fetchWithAuth('/api/campaigns/save-draft-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ campaignId, structuredPlan: { weeks: weeksToSave } }),
      });
      if (saveRes.ok) saveSucceeded = true;
      else setUiErrorMessage('Plan could not be saved. Try again or use "Create week plan from stored context" on the campaign page.');
    } catch {
      setUiErrorMessage('Plan could not be saved. Try again or use "Create week plan from stored context" on the campaign page.');
    }
    onProgramGenerated({ program: convertStructuredPlanToProgram(structuredPlan), structuredPlan, saveSucceeded });
    setIsSavingDraftForView(false);
  };

  const commitPlan = (aiMessage?: string) => {
    const today = new Date().toISOString().split('T')[0];
    const resolvedStartDate =
      (commitStartDate && /^\d{4}-\d{2}-\d{2}$/.test(commitStartDate) ? commitStartDate : '') ||
      (typeof (prefilledPlanning as any)?.tentative_start === 'string' ? (prefilledPlanning as any).tentative_start : '') ||
      (typeof (collectedPlanningContext as any)?.tentative_start === 'string' ? (collectedPlanningContext as any).tentative_start : '') ||
      (typeof (campaignData as any)?.start_date === 'string' ? (campaignData as any).start_date : '') ||
      today;
    const resolvedWeeks =
      (structuredPlan?.weeks?.length && structuredPlan.weeks.length > 0 ? structuredPlan.weeks.length : undefined) ??
      (typeof commitDurationWeeks === 'number' && commitDurationWeeks >= 1 && commitDurationWeeks <= 52 ? commitDurationWeeks : undefined) ??
      resolveWorkingDurationWeeks();

    if (structuredPlan) {
      setSelectedPlan(serializeStructuredPlanToText(structuredPlan));
      setCommitDurationWeeks(structuredPlan.weeks.length);
    } else if (aiMessage) {
      setSelectedPlan(aiMessage);
    }
    setCommitStartDate(resolvedStartDate);
    setShowPlanOverview(false);
    setShowPlanPreview(false);
    setShowDateSelection(false);
    void create12WeekPlan(resolvedStartDate, resolvedWeeks);
  };

  const viewPlan = (aiMessage?: string, messageId?: number) => {
    if (aiMessage) setSelectedPlan(aiMessage);
    if (messageId != null) setHasViewedPlanMessageId(messageId);
    if (structuredPlan) setShowPlanOverview(true);
    else setShowPlanPreview(true);
  };

  const loadDraftPlanAndEdit = () => {
    const plan = retrievePlanData?.draftPlan;
    if (!plan?.weeks?.length) return;
    setStructuredPlan({ weeks: plan.weeks, format: 'blueprint' });
    setStructuredPlanMessageId(Date.now());
    setPlanSource('draft');
    setShowPlanOverview(true);
  };

  const loadCommittedPlanAndEdit = () => {
    const plan = retrievePlanData?.committedPlan;
    if (!plan?.weeks?.length) return;
    setStructuredPlan({ weeks: plan.weeks, format: 'blueprint' });
    setStructuredPlanMessageId(Date.now());
    setPlanSource('committed');
    setShowPlanOverview(true);
  };

  const loadSavedPlanAndEdit = async () => {
    const saved = retrievePlanData?.savedPlan;
    if (!saved?.content) return;
    setIsParsingSavedPlan(true);
    try {
      const res = await fetch('/api/campaigns/parse-saved-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: saved.content }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setUiErrorMessage(err.details || err.error || 'Failed to parse saved plan.');
      } else {
        const { weeks } = await res.json();
        if (Array.isArray(weeks) && weeks.length > 0) {
          setStructuredPlan({ weeks, format: 'blueprint' });
          setStructuredPlanMessageId(Date.now());
          setPlanSource('draft');
          setShowPlanOverview(true);
        } else {
          setUiErrorMessage('Could not parse saved plan into editable format.');
        }
      }
    } catch {
      setUiErrorMessage('Failed to parse saved plan. Please try again.');
    } finally {
      setIsParsingSavedPlan(false);
    }
  };

  return {
    serializeStructuredPlanToText,
    saveAIContentForPlan,
    saveDraftAndViewOnCampaign,
    commitPlan,
    viewPlan,
    loadDraftPlanAndEdit,
    loadCommittedPlanAndEdit,
    loadSavedPlanAndEdit,
  };
}
