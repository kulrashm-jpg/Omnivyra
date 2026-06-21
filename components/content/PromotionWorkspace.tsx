'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Loader2, RefreshCw, Save, Calendar, Send, X, AlertTriangle, CheckCircle2, Trash2 } from 'lucide-react';
import { fetchWithAuth } from '../community-ai/fetchWithAuth';
import {
  PROMOTION_URL_REQUIRED_MESSAGE,
  promotionCharLimitFor,
  composePromotionPayloadText,
  savePromotionDraft,
  loadPromotionDrafts,
  deletePromotionDraft,
  type PromotionContentType,
  type PromotionDraftStatus,
} from '../../lib/content/promotionDraft';

export type WorkspacePlatformSeed = {
  platform: string;
  label: string;
  accountId: string | null;
  promotionalText: string;
};

type PlatformState = {
  label: string;
  accountId: string | null;
  promotionalText: string;
  status: PromotionDraftStatus;
  statusDetail: string | null;
  busy: null | 'regenerate' | 'save' | 'schedule' | 'post' | 'delete';
  scheduledFor: string; // datetime-local value
};

function defaultScheduleValue(): string {
  // Default to ~1 hour out (scheduling floor); local-time string for the input.
  const d = new Date(Date.now() + 60 * 60 * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Promotion Workspace (PHASE BLOG-PROMOTION-2). Text-only. Renders internal
 * tabs (one per selected platform) for reviewing, editing, regenerating,
 * saving, scheduling, or posting platform-native promotional copy. No browser
 * tabs/popups, no creator/asset/visual generation. Reuses the existing
 * adaptation, scheduler, and publishing engines.
 */
export default function PromotionWorkspace({
  open,
  contentId,
  contentType,
  title,
  topic,
  sourceContent,
  companyId,
  blogUrl,
  seeds,
  onClose,
}: {
  open: boolean;
  contentId: string;
  contentType: PromotionContentType;
  title: string;
  topic: string;
  sourceContent: string;
  companyId: string | null;
  blogUrl: string; // '' when the content is unpublished
  seeds: WorkspacePlatformSeed[];
  onClose: () => void;
}) {
  const [states, setStates] = useState<Record<string, PlatformState>>(() => {
    const init: Record<string, PlatformState> = {};
    seeds.forEach((s) => {
      init[s.platform] = {
        label: s.label,
        accountId: s.accountId,
        promotionalText: s.promotionalText,
        status: 'draft',
        statusDetail: null,
        busy: null,
        scheduledFor: defaultScheduleValue(),
      };
    });
    return init;
  });
  const [active, setActive] = useState<string>(seeds[0]?.platform || '');

  const platformKeys = useMemo(() => seeds.map((s) => s.platform), [seeds]);
  const urlMissing = !blogUrl;

  if (!open || platformKeys.length === 0) return null;

  const cur = states[active];

  const patch = (platform: string, next: Partial<PlatformState>) =>
    setStates((prev) => ({ ...prev, [platform]: { ...prev[platform], ...next } }));

  // Load any saved (DB-backed) drafts when the workspace opens, preferring them
  // over the freshly generated seeds so edits survive refresh / logout / device.
  useEffect(() => {
    if (!open || !companyId) return;
    let active = true;
    loadPromotionDrafts(companyId, contentType, contentId)
      .then((saved) => {
        if (!active || saved.length === 0) return;
        setStates((prev) => {
          const next = { ...prev };
          for (const d of saved) {
            if (next[d.platform]) {
              next[d.platform] = {
                ...next[d.platform],
                promotionalText: d.promotionalText,
                status: d.status,
                statusDetail: 'Loaded saved draft.',
              };
            }
          }
          return next;
        });
      })
      .catch(() => { /* non-fatal: fall back to generated seeds */ });
    return () => { active = false; };
  }, [open, companyId, contentId, contentType]);

  // Persist a platform's draft to the DB (Save / status reflection). Best-effort
  // for status updates so a transient save failure never masks a real publish.
  const saveDraftRow = async (platform: string, status: PromotionDraftStatus): Promise<void> => {
    const s = states[platform];
    if (!s || !companyId) return;
    await savePromotionDraft({
      companyId,
      contentId,
      contentType,
      platform,
      promotionalText: s.promotionalText,
      canonicalUrl: blogUrl,
      status,
    });
  };

  const handleRegenerate = async (platform: string) => {
    patch(platform, { busy: 'regenerate', statusDetail: null });
    try {
      const resp = await fetchWithAuth('/api/content/quick-platform-adapt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          platform,
          content: sourceContent,
          contentType: 'post',
          companyId: companyId || undefined,
          topic: topic || title || undefined,
        }),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(data?.error || `Regeneration failed (status ${resp.status}).`);
      const text = String(data?.variant?.generated_content || '').trim();
      if (!text) throw new Error('The platform-adapted post came back empty.');
      patch(platform, { promotionalText: text, status: 'draft', statusDetail: 'Regenerated.' });
    } catch (e) {
      patch(platform, { statusDetail: e instanceof Error ? e.message : 'Regeneration failed.' });
    } finally {
      patch(platform, { busy: null });
    }
  };

  const handleSaveDraft = async (platform: string) => {
    patch(platform, { busy: 'save', statusDetail: null });
    try {
      await saveDraftRow(platform, 'draft');
      patch(platform, { status: 'draft', statusDetail: 'Draft saved.' });
    } catch (e) {
      patch(platform, { statusDetail: e instanceof Error ? e.message : 'Failed to save draft.' });
    } finally {
      patch(platform, { busy: null });
    }
  };

  const handleDiscard = async (platform: string) => {
    if (!companyId) return;
    patch(platform, { busy: 'delete', statusDetail: null });
    try {
      await deletePromotionDraft(companyId, contentType, contentId, platform);
      patch(platform, { status: 'draft', statusDetail: 'Saved draft discarded.' });
    } catch (e) {
      patch(platform, { statusDetail: e instanceof Error ? e.message : 'Failed to discard draft.' });
    } finally {
      patch(platform, { busy: null });
    }
  };

  const handleSchedule = async (platform: string) => {
    const s = states[platform];
    if (!s) return;
    if (urlMissing) {
      patch(platform, { statusDetail: PROMOTION_URL_REQUIRED_MESSAGE });
      return;
    }
    if (!s.accountId) {
      patch(platform, { statusDetail: 'No connected account for this platform.' });
      return;
    }
    patch(platform, { busy: 'schedule', statusDetail: null });
    try {
      const scheduledFor = new Date(s.scheduledFor);
      const resp = await fetchWithAuth('/api/scheduler/schedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId,
          title,
          content: composePromotionPayloadText(s.promotionalText, blogUrl),
          hashtags: '',
          scheduledFor: scheduledFor.toISOString(),
          platform,
          accountId: s.accountId,
          contentType: 'post',
        }),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(data?.error || `Scheduling failed (status ${resp.status}).`);
      patch(platform, { status: 'scheduled', statusDetail: `Scheduled for ${scheduledFor.toLocaleString()}.` });
      await saveDraftRow(platform, 'scheduled').catch(() => {});
    } catch (e) {
      patch(platform, { status: 'failed', statusDetail: e instanceof Error ? e.message : 'Scheduling failed.' });
      await saveDraftRow(platform, 'failed').catch(() => {});
    } finally {
      patch(platform, { busy: null });
    }
  };

  const handlePostNow = async (platform: string) => {
    const s = states[platform];
    if (!s) return;
    if (urlMissing) {
      patch(platform, { statusDetail: PROMOTION_URL_REQUIRED_MESSAGE });
      return;
    }
    if (!s.accountId) {
      patch(platform, { statusDetail: 'No connected account for this platform.' });
      return;
    }
    patch(platform, { busy: 'post', statusDetail: null });
    try {
      const content = composePromotionPayloadText(s.promotionalText, blogUrl);
      // Canonical publish path = schedule-then-publish (same as the
      // multi-platform scheduler). publishNow operates on a scheduled_posts
      // row, so we stage one (near-future to satisfy the future-time check)
      // then publish it immediately via the canonical validator/adapter
      // pipeline. No legacy /api/social/post.
      const scheduledFor = new Date(Date.now() + 2 * 60 * 1000).toISOString();
      const stageRes = await fetchWithAuth('/api/scheduler/schedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId,
          title,
          content,
          hashtags: '',
          scheduledFor,
          platform,
          accountId: s.accountId,
          contentType: 'post',
        }),
      });
      const stageData = await stageRes.json().catch(() => ({}));
      if (!stageRes.ok) throw new Error(stageData?.error || `Could not stage the post (status ${stageRes.status}).`);
      const postId = stageData?.id;
      if (!postId) throw new Error('Scheduler did not return a post id.');

      const pubRes = await fetchWithAuth('/api/social/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ post_id: postId }),
      });
      const pubData = await pubRes.json().catch(() => ({}));
      if (!pubRes.ok) throw new Error(pubData?.error || `Publish failed (status ${pubRes.status}).`);
      // The publish endpoint returns 200 even when the adapter reports FAILED —
      // the truth is in `status`; only PUBLISHED counts.
      if (pubData?.status && pubData.status !== 'PUBLISHED') {
        throw new Error(pubData?.message || 'The platform rejected the post.');
      }
      patch(platform, { status: 'posted', statusDetail: 'Posted.' });
      await saveDraftRow(platform, 'posted').catch(() => {});
    } catch (e) {
      patch(platform, { status: 'failed', statusDetail: e instanceof Error ? e.message : 'Post failed.' });
      await saveDraftRow(platform, 'failed').catch(() => {});
    } finally {
      patch(platform, { busy: null });
    }
  };

  const composed = cur ? composePromotionPayloadText(cur.promotionalText, blogUrl) : '';
  const limit = promotionCharLimitFor(active);
  const overLimit = composed.length > limit;
  const sendDisabled = Boolean(cur?.busy) || urlMissing || !cur?.accountId || overLimit;

  return (
    <div className="fixed inset-0 z-[130] flex items-center justify-center bg-slate-950/45 px-4 py-6 backdrop-blur-sm">
      <div className="flex w-full max-w-3xl flex-col rounded-2xl border border-slate-200 bg-white shadow-2xl">
        {/* Header */}
        <div className="flex items-start justify-between border-b border-slate-100 px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Promotion workspace</h2>
            <p className="text-xs text-slate-500">Review, edit, schedule, or post platform-native promotional copy. Text only.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="text-slate-400 hover:text-slate-700">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* URL warning */}
        {urlMissing ? (
          <div className="mx-5 mt-4 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            {PROMOTION_URL_REQUIRED_MESSAGE}
          </div>
        ) : null}

        {/* Tabs */}
        <div className="flex flex-wrap gap-1 border-b border-slate-100 px-5 pt-4">
          {platformKeys.map((key) => {
            const st = states[key];
            const isActive = key === active;
            return (
              <button
                key={key}
                type="button"
                onClick={() => setActive(key)}
                className={`rounded-t-lg px-3 py-2 text-sm font-medium ${
                  isActive ? 'border-x border-t border-slate-200 bg-white text-slate-900' : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                {st?.label || key}
                {st && st.status !== 'draft' ? (
                  <span className={`ml-1.5 text-[10px] uppercase ${st.status === 'failed' ? 'text-red-600' : 'text-emerald-600'}`}>
                    {st.status}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>

        {/* Active platform panel */}
        {cur ? (
          <div className="px-5 py-4">
            <div className="mb-1 flex items-center justify-between">
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Promotion copy</label>
              <span className={`text-xs ${overLimit ? 'font-semibold text-red-600' : 'text-slate-400'}`}>
                {composed.length} / {limit}
              </span>
            </div>
            <textarea
              value={cur.promotionalText}
              onChange={(e) => patch(active, { promotionalText: e.target.value })}
              rows={8}
              className="w-full resize-y rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-800 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-300"
            />

            <label className="mt-3 block text-xs font-semibold uppercase tracking-wide text-slate-500">Blog URL</label>
            <input
              type="text"
              readOnly
              value={blogUrl || '(no published URL yet)'}
              className="mt-1 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600"
            />
            <p className="mt-1 text-[11px] text-slate-400">
              The URL is appended automatically when scheduling or posting — it never gets stripped by adaptation.
            </p>

            {cur.statusDetail ? (
              <div className={`mt-3 flex items-center gap-1.5 text-xs ${cur.status === 'failed' ? 'text-red-600' : 'text-emerald-700'}`}>
                {cur.status === 'failed' ? <AlertTriangle className="h-3.5 w-3.5" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                {cur.statusDetail}
              </div>
            ) : null}

            {/* Schedule time */}
            <div className="mt-4 flex items-center gap-2">
              <label className="text-xs text-slate-500">Schedule for</label>
              <input
                type="datetime-local"
                value={cur.scheduledFor}
                onChange={(e) => patch(active, { scheduledFor: e.target.value })}
                className="rounded-lg border border-slate-200 px-2 py-1 text-xs text-slate-700"
              />
            </div>

            {/* Actions */}
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => handleRegenerate(active)}
                disabled={Boolean(cur.busy)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                {cur.busy === 'regenerate' ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                Regenerate
              </button>
              <button
                type="button"
                onClick={() => handleSaveDraft(active)}
                disabled={Boolean(cur.busy)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                {cur.busy === 'save' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}Save Draft
              </button>
              <button
                type="button"
                onClick={() => handleDiscard(active)}
                disabled={Boolean(cur.busy)}
                title="Delete the saved draft for this platform"
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
              >
                {cur.busy === 'delete' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}Discard
              </button>
              <button
                type="button"
                onClick={() => handleSchedule(active)}
                disabled={sendDisabled}
                title={urlMissing ? PROMOTION_URL_REQUIRED_MESSAGE : !cur.accountId ? 'No connected account' : undefined}
                className="inline-flex items-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-sm font-medium text-blue-700 hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {cur.busy === 'schedule' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Calendar className="h-4 w-4" />}
                Schedule
              </button>
              <button
                type="button"
                onClick={() => handlePostNow(active)}
                disabled={sendDisabled}
                title={urlMissing ? PROMOTION_URL_REQUIRED_MESSAGE : !cur.accountId ? 'No connected account' : undefined}
                className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {cur.busy === 'post' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                Post Now
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
