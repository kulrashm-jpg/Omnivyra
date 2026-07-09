/** Part 2/3 of CreatorContentPanel.tsx — verbatim split (barrel preserved; importers unchanged). */
/**
 * Creator Content Panel
 *
 * Sections:
 *   1. Creator Profile  — who is creating: name, handle, profile URL, bio
 *   2. Media Asset      — master URL + apply-to-all, per-platform upload cards
 *   3. Marketing Package — AI-generated: title, summary, meta description, SEO keywords,
 *                          universal hashtags, per-platform hashtag sets, CTA
 *   4. Actions          — Save Asset | Generate Promotion Content
 */

import React, { useState, useMemo, useRef, useEffect } from 'react';
import {
  Video,
  Image,
  LayoutGrid,
  Link2,
  ExternalLink,
  Loader2,
  Sparkles,
  Upload,
  ChevronDown,
  ChevronUp,
  Copy,
  Check,
  User,
  Tag,
  Search,
  Hash,
  FileText,
  Megaphone,
  RefreshCw,
  Users,
  Plus,
  Trash2,
} from 'lucide-react';
import { useCompanyContext } from '../CompanyContext';
import {
  getVideoFormatsForPlatform,
  isValidPlatformVideoFormat,
  platformSupportsVideo,
  normalizeVideoPlatform,
  listVideoCapablePlatforms,
} from '../../lib/shared/videoFormatCapabilities';

/* ────────────────────── types ────────────────────── */

import { type AttachmentRowState, type CreatorContentPanelProps, SectionHeader, UploadedMediaPreview, type UploadUiStatus } from './CreatorContentPanelModel';

export function AttachmentUploadSection({
  state,
  onUploadMedia,
  onUploadFile,
  onReschedule,
  onUnschedule,
  resumableUploadHandle,
  onResumeUpload,
  onDiscardResumableUpload,
  onNotice,
}: {
  state: AttachmentRowState;
  onUploadMedia: NonNullable<CreatorContentPanelProps['onUploadMedia']>;
  onUploadFile?: CreatorContentPanelProps['onUploadFile'];
  onReschedule?: CreatorContentPanelProps['onReschedule'];
  onUnschedule?: CreatorContentPanelProps['onUnschedule'];
  resumableUploadHandle?: CreatorContentPanelProps['resumableUploadHandle'];
  onResumeUpload?: CreatorContentPanelProps['onResumeUpload'];
  onDiscardResumableUpload?: CreatorContentPanelProps['onDiscardResumableUpload'];
  onNotice?: (type: 'success' | 'error' | 'info', message: string) => void;
}) {
  const [url, setUrl] = useState(state.uploadedMediaUrl ?? '');
  const [source, setSource] = useState<'user_upload' | 'external_link'>(
    state.uploadSource === 'user_upload' ? 'user_upload' : 'external_link',
  );
  const [submitting, setSubmitting] = useState(false);
  const [uiStatus, setUiStatus] = useState<UploadUiStatus>('idle');
  const [progress, setProgress] = useState(0);
  const [localError, setLocalError] = useState<string | null>(null);
  const [localOk, setLocalOk] = useState<string | null>(null);
  const [rescheduleOpen, setRescheduleOpen] = useState(false);
  const [rescheduleAt, setRescheduleAt] = useState('');
  const [replaceMediaEnabled, setReplaceMediaEnabled] = useState(false);
  const [unscheduleConfirmOpen, setUnscheduleConfirmOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const dropZoneRef = useRef<HTMLDivElement | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const isReady = state.lifecycle === 'ready_for_schedule' || state.lifecycle === 'media_uploaded';
  const isFailed = state.lifecycle === 'upload_failed';
  const isScheduled = state.lifecycle === 'scheduled';
  const isAwaiting = state.lifecycle === 'awaiting_media_upload';
  const directUploadEnabled = typeof onUploadFile === 'function';
  const rescheduleEnabled = typeof onReschedule === 'function';
  const unscheduleEnabled = typeof onUnschedule === 'function';
  // Resume banner shows ONLY when a prior session is detected AND the row
  // is still in a state where resuming makes sense (awaiting / failed).
  // Scheduled / ready rows never show the banner — the row already has
  // a finalized upload.
  const resumeBannerVisible = !!resumableUploadHandle
    && typeof onResumeUpload === 'function'
    && (state.lifecycle === 'awaiting_media_upload' || state.lifecycle === 'upload_failed');
  const [resumeBusy, setResumeBusy] = useState<'idle' | 'resuming' | 'discarding'>('idle');
  // The drop zone / URL field are enabled when the row is editable:
  //   - any non-scheduled state, OR
  //   - scheduled + user clicked "Replace media" (replaceMediaEnabled)
  const uploadControlsLocked = isScheduled && !replaceMediaEnabled;

  const statusBadge = isScheduled
    ? { label: 'Scheduled', cls: 'bg-emerald-100 text-emerald-700 border-emerald-200' }
    : isReady
      ? { label: 'Ready to schedule', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' }
      : isFailed
        ? { label: 'Upload failed — retry', cls: 'bg-red-50 text-red-700 border-red-200' }
        : { label: 'Awaiting media upload', cls: 'bg-amber-50 text-amber-700 border-amber-200' };

  const validationErrors = state.uploadValidation?.errors ?? [];
  const showThemeSummary = !!state.themeTreatmentSummary;
  const showGuidance = !!state.creatorGuidance;
  const previewUrl = state.uploadedMediaUrl ?? null;
  const previewMime = state.uploadedMimeType ?? null;

  function resetFeedback() {
    setLocalError(null);
    setLocalOk(null);
  }

  // ── URL submit (link-based path, with concurrency token) ───────────────
  async function submitUrl() {
    if (!url.trim()) {
      setLocalError('Provide a media URL first.');
      return;
    }
    setSubmitting(true);
    setUiStatus('validating');
    resetFeedback();
    try {
      const result = await onUploadMedia({
        mediaUrl: url.trim(),
        source,
        expectedRevision: typeof state.revision === 'number' ? state.revision : undefined,
      });
      if (result.ok) {
        const message = isScheduled
          ? 'Media replaced; row remains scheduled.'
          : 'Media validated. Row is ready to schedule.';
        setLocalOk(message);
        setUiStatus('ready');
        setReplaceMediaEnabled(false);
        onNotice?.('success', message);
      } else if (result.conflict) {
        const message = result.message || 'This row changed in another tab. Refresh to continue.';
        setLocalError(message);
        setUiStatus('failed');
        onNotice?.('error', message);
      } else {
        const message = result.message
          || (result.validation && !result.validation.valid && Array.isArray(result.validation.errors) ? result.validation.errors.join(' | ') : 'Validation failed.');
        setLocalError(message);
        setUiStatus('failed');
        onNotice?.('error', message);
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Upload request failed.';
      setLocalError(message);
      setUiStatus('failed');
      onNotice?.('error', message);
    } finally {
      setSubmitting(false);
      setProgress(0);
    }
  }

  // ── Direct file upload (multipart, with progress + abort support) ─────
  async function submitFile(file: File) {
    if (!directUploadEnabled || !onUploadFile) return;
    setSubmitting(true);
    setUiStatus('uploading');
    setProgress(0);
    resetFeedback();
    const controller = new AbortController();
    abortControllerRef.current = controller;
    try {
      const result = await onUploadFile({
        file,
        source: 'direct_upload',
        signal: controller.signal,
        expectedRevision: typeof state.revision === 'number' ? state.revision : undefined,
        onProgress: (pct) => {
          setProgress(Math.max(0, Math.min(100, Math.round(pct))));
          // While bytes are still streaming we stay in 'uploading'.
          // Once we hit 100 (or close to it) and we're awaiting a server
          // response we flip to 'validating' so the UI reflects that the
          // server-side validator is now running.
          if (pct >= 99) setUiStatus('validating');
        },
      });
      if (result.aborted) {
        // User-initiated cancellation: NO lifecycle transition occurred.
        // Just clear the UI state and let the user retry.
        setUiStatus(state.lifecycle === 'upload_failed' ? 'failed' : 'idle');
        onNotice?.('info', 'Upload cancelled.');
      } else if (result.conflict) {
        const message = result.message || 'This row changed in another tab. Refresh to continue.';
        setLocalError(message);
        setUiStatus('failed');
        onNotice?.('error', message);
      } else if (result.ok) {
        const message = isScheduled
          ? 'Media replaced; row remains scheduled.'
          : 'File uploaded and validated. Row is ready to schedule.';
        setLocalOk(message);
        setUiStatus('ready');
        setReplaceMediaEnabled(false);
        onNotice?.('success', message);
      } else {
        const message = result.message
          || (result.validation && !result.validation.valid && Array.isArray(result.validation.errors) ? result.validation.errors.join(' | ') : 'Upload validation failed.');
        setLocalError(message);
        setUiStatus('failed');
        onNotice?.('error', message);
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Upload request failed.';
      setLocalError(message);
      setUiStatus('failed');
      onNotice?.('error', message);
    } finally {
      setSubmitting(false);
      setProgress(0);
      abortControllerRef.current = null;
    }
  }

  function cancelUpload() {
    abortControllerRef.current?.abort();
  }

  async function resumePersistedUpload() {
    if (!resumableUploadHandle || !onResumeUpload || resumeBusy !== 'idle') return;
    setResumeBusy('resuming');
    resetFeedback();
    setUiStatus('uploading');
    try {
      const result = await onResumeUpload(resumableUploadHandle);
      if (result.aborted) {
        setUiStatus('idle');
        onNotice?.('info', 'Resume cancelled.');
        return;
      }
      if (result.ok) {
        setUiStatus('ready');
        const msg = 'Upload resumed and finalized.';
        setLocalOk(msg);
        onNotice?.('success', msg);
      } else if (result.conflict) {
        const msg = result.message || 'This row changed in another tab. Refresh to continue.';
        setLocalError(msg);
        setUiStatus('failed');
        onNotice?.('error', msg);
      } else {
        const msg = result.message || 'Resume failed.';
        setLocalError(msg);
        setUiStatus('failed');
        onNotice?.('error', msg);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Resume request failed.';
      setLocalError(msg);
      setUiStatus('failed');
      onNotice?.('error', msg);
    } finally {
      setResumeBusy('idle');
    }
  }

  async function discardPersistedUpload() {
    if (!resumableUploadHandle || !onDiscardResumableUpload || resumeBusy !== 'idle') return;
    setResumeBusy('discarding');
    try {
      await onDiscardResumableUpload(resumableUploadHandle);
      onNotice?.('info', 'Discarded the in-progress upload. You can start over below.');
    } catch (e) {
      onNotice?.('error', e instanceof Error ? e.message : 'Failed to discard upload.');
    } finally {
      setResumeBusy('idle');
    }
  }

  async function submitUnschedule() {
    if (!unscheduleEnabled || !onUnschedule) return;
    setSubmitting(true);
    setUiStatus('validating');
    resetFeedback();
    try {
      const result = await onUnschedule({
        expectedRevision: typeof state.revision === 'number' ? state.revision : undefined,
      });
      if (result.ok) {
        const message = 'Unscheduled. Uploaded media + guidance preserved.';
        setLocalOk(message);
        setUiStatus('idle');
        setUnscheduleConfirmOpen(false);
        onNotice?.('success', message);
      } else if (result.conflict) {
        const message = result.message || 'This row changed in another tab. Refresh to continue.';
        setLocalError(message);
        setUiStatus('failed');
        onNotice?.('error', message);
      } else {
        const message = result.message || 'Unschedule failed.';
        setLocalError(message);
        setUiStatus('failed');
        onNotice?.('error', message);
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Unschedule request failed.';
      setLocalError(message);
      setUiStatus('failed');
      onNotice?.('error', message);
    } finally {
      setSubmitting(false);
    }
  }

  async function submitReschedule() {
    if (!rescheduleEnabled || !onReschedule) return;
    if (!rescheduleAt.trim()) {
      setLocalError('Pick a new scheduled time first.');
      return;
    }
    setSubmitting(true);
    setUiStatus('validating');
    resetFeedback();
    try {
      const isoAt = new Date(rescheduleAt).toISOString();
      const result = await onReschedule({
        scheduledAt: isoAt,
        expectedRevision: typeof state.revision === 'number' ? state.revision : undefined,
      });
      if (result.ok) {
        setRescheduleOpen(false);
        setRescheduleAt('');
        setUiStatus('ready');
        const message = 'Reschedule applied.';
        setLocalOk(message);
        onNotice?.('success', message);
      } else if (result.conflict) {
        const message = result.message || 'This row changed in another tab. Refresh to continue.';
        setLocalError(message);
        setUiStatus('failed');
        onNotice?.('error', message);
      } else {
        const message = result.message || 'Reschedule failed.';
        setLocalError(message);
        setUiStatus('failed');
        onNotice?.('error', message);
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Reschedule request failed.';
      setLocalError(message);
      setUiStatus('failed');
      onNotice?.('error', message);
    } finally {
      setSubmitting(false);
    }
  }

  // ── Drag / drop handlers ───────────────────────────────────────────────
  function onDragEnter(e: React.DragEvent<HTMLDivElement>) {
    if (!directUploadEnabled || submitting || uploadControlsLocked) return;
    e.preventDefault();
    e.stopPropagation();
    setUiStatus((prev) => (prev === 'uploading' || prev === 'validating' ? prev : 'dragging'));
  }
  function onDragOver(e: React.DragEvent<HTMLDivElement>) {
    if (!directUploadEnabled || submitting || uploadControlsLocked) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'copy';
  }
  function onDragLeave(e: React.DragEvent<HTMLDivElement>) {
    if (!directUploadEnabled || submitting || uploadControlsLocked) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.currentTarget === e.target) {
      setUiStatus((prev) => (prev === 'dragging' ? 'idle' : prev));
    }
  }
  function onDrop(e: React.DragEvent<HTMLDivElement>) {
    if (!directUploadEnabled || submitting || uploadControlsLocked) return;
    e.preventDefault();
    e.stopPropagation();
    setUiStatus('idle');
    const file = e.dataTransfer.files?.[0];
    if (file) submitFile(file);
  }
  function onPickerChange(e: React.ChangeEvent<HTMLInputElement>) {
    if (!directUploadEnabled || submitting || uploadControlsLocked) return;
    const file = e.target.files?.[0];
    if (file) submitFile(file);
    e.target.value = '';
  }
  function onDropZoneClick() {
    if (!directUploadEnabled || submitting || uploadControlsLocked) return;
    fileInputRef.current?.click();
  }

  // ── Paste-from-clipboard: if a file is in the clipboard, upload it ─────
  useEffect(() => {
    const node = dropZoneRef.current;
    if (!node || !directUploadEnabled) return;
    const handler = (e: ClipboardEvent) => {
      if (submitting || uploadControlsLocked) return;
      const items = e.clipboardData?.items;
      if (!items) return;
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.kind === 'file') {
          const f = item.getAsFile();
          if (f) {
            e.preventDefault();
            submitFile(f);
            return;
          }
        }
      }
    };
    node.addEventListener('paste', handler as EventListener);
    return () => node.removeEventListener('paste', handler as EventListener);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [directUploadEnabled, submitting, uploadControlsLocked]);

  const placeholderLabel = state.contentType === 'podcast' ? 'audio file' : 'video file';
  const acceptAttr = state.contentType === 'podcast' ? 'audio/*' : 'video/*';
  const dropZoneClass = (() => {
    if (uploadControlsLocked) return 'border-gray-200 bg-gray-50 cursor-not-allowed opacity-60';
    if (uiStatus === 'uploading' || uiStatus === 'validating') return 'border-indigo-300 bg-indigo-50';
    if (uiStatus === 'dragging') return 'border-indigo-400 bg-indigo-50 ring-2 ring-indigo-200';
    if (uiStatus === 'failed') return 'border-red-300 bg-red-50';
    if (uiStatus === 'ready') return 'border-emerald-300 bg-emerald-50';
    return 'border-gray-300 bg-white hover:border-indigo-300';
  })();

  return (
    <div className="px-5 py-4 border-b border-gray-100 bg-amber-50/30">
      <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
        <SectionHeader
          icon={<Upload className="h-3.5 w-3.5" />}
          title={`Attachment-required: ${state.contentType}`}
          subtitle="AI cannot render this format — upload finished media to unlock scheduling."
        />
        <span className={`text-[11px] font-semibold px-2 py-1 rounded-full border ${statusBadge.cls}`}>
          {statusBadge.label}
        </span>
      </div>

      {resumeBannerVisible && resumableUploadHandle && (
        <div className="mt-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-3 text-xs leading-5 text-amber-900" role="region" aria-label="Resume upload">
          <div className="font-semibold mb-1">Resume previous upload?</div>
          <p className="mb-2">
            A {state.contentType} upload session is in progress.
            {resumableUploadHandle.createdAt ? <> Started <time dateTime={resumableUploadHandle.createdAt}>{new Date(resumableUploadHandle.createdAt).toLocaleString()}</time>.</> : null}
            {resumableUploadHandle.hasPersistedFingerprint
              ? ' tus-js-client has a matching local fingerprint — resume will continue from the last successful chunk.'
              : ' Resume will continue from the server-known offset; if none, it restarts.'}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={resumePersistedUpload}
              disabled={resumeBusy !== 'idle'}
              className="inline-flex items-center gap-2 px-3 py-1.5 text-xs font-semibold rounded-md bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {resumeBusy === 'resuming' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />}
              Resume upload
            </button>
            <button
              type="button"
              onClick={discardPersistedUpload}
              disabled={resumeBusy !== 'idle'}
              className="inline-flex items-center gap-2 px-3 py-1.5 text-xs font-semibold rounded-md border border-amber-200 text-amber-700 bg-white hover:bg-amber-100 disabled:opacity-50"
            >
              {resumeBusy === 'discarding' ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
              Discard &amp; start over
            </button>
          </div>
        </div>
      )}

      {showThemeSummary && (
        <div className="mt-2 rounded-lg border border-indigo-100 bg-indigo-50/60 px-3 py-2 text-xs leading-5 text-indigo-900">
          <div className="font-semibold mb-1">Theme treatment</div>
          {state.themeTreatmentSummary?.hookText && (
            <p className="text-indigo-900"><span className="font-medium">Hook:</span> {state.themeTreatmentSummary.hookText}</p>
          )}
          <p className="text-indigo-800">
            {state.themeTreatmentSummary?.sceneCount ?? 0} scenes
            {state.themeTreatmentSummary?.durationSeconds ? ` · ${state.themeTreatmentSummary.durationSeconds}s target` : ''}
            {state.themeTreatmentSummary?.aspectRatio ? ` · ${state.themeTreatmentSummary.aspectRatio}` : ''}
          </p>
          {state.themeTreatmentSummary?.ctaText && (
            <p className="text-indigo-900"><span className="font-medium">CTA:</span> {state.themeTreatmentSummary.ctaText}</p>
          )}
        </div>
      )}

      {showGuidance && state.creatorGuidance && (
        <details className="mt-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs leading-5 text-gray-700">
          <summary className="cursor-pointer font-semibold text-gray-800">Creator guidance</summary>
          {state.creatorGuidance.production_notes && (
            <p className="mt-2"><span className="font-medium">Production notes:</span> {state.creatorGuidance.production_notes}</p>
          )}
          {Array.isArray(state.creatorGuidance.production_checklist) && state.creatorGuidance.production_checklist.length > 0 && (
            <div className="mt-2">
              <div className="font-medium">Checklist:</div>
              <ul className="list-disc pl-5">
                {state.creatorGuidance.production_checklist.map((item, i) => <li key={i}>{item}</li>)}
              </ul>
            </div>
          )}
          {Array.isArray(state.creatorGuidance.talking_points) && state.creatorGuidance.talking_points.length > 0 && (
            <div className="mt-2">
              <div className="font-medium">Talking points:</div>
              <ul className="list-disc pl-5">
                {state.creatorGuidance.talking_points.map((item, i) => <li key={i}>{item}</li>)}
              </ul>
            </div>
          )}
          {Array.isArray(state.creatorGuidance.b_roll_ideas) && state.creatorGuidance.b_roll_ideas.length > 0 && (
            <div className="mt-2">
              <div className="font-medium">B-roll ideas:</div>
              <ul className="list-disc pl-5">
                {state.creatorGuidance.b_roll_ideas.map((item, i) => <li key={i}>{item}</li>)}
              </ul>
            </div>
          )}
        </details>
      )}

      {/* Scheduled-row controls: Replace Media + Reschedule */}
      {isScheduled && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {!replaceMediaEnabled && (
            <button
              type="button"
              onClick={() => { setReplaceMediaEnabled(true); resetFeedback(); }}
              className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold rounded-md border border-indigo-200 text-indigo-700 bg-white hover:bg-indigo-50"
            >
              <Upload className="h-3 w-3" /> Replace media
            </button>
          )}
          {replaceMediaEnabled && (
            <button
              type="button"
              onClick={() => setReplaceMediaEnabled(false)}
              className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold rounded-md border border-gray-200 text-gray-700 bg-white hover:bg-gray-50"
            >
              Cancel replace
            </button>
          )}
          {rescheduleEnabled && (
            <button
              type="button"
              onClick={() => setRescheduleOpen((v) => !v)}
              className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold rounded-md border border-amber-200 text-amber-700 bg-white hover:bg-amber-50"
            >
              {rescheduleOpen ? 'Close reschedule' : 'Reschedule'}
            </button>
          )}
          {unscheduleEnabled && (
            <button
              type="button"
              onClick={() => setUnscheduleConfirmOpen((v) => !v)}
              className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold rounded-md border border-red-200 text-red-700 bg-white hover:bg-red-50"
            >
              {unscheduleConfirmOpen ? 'Cancel' : 'Unschedule'}
            </button>
          )}
        </div>
      )}

      {isScheduled && unscheduleConfirmOpen && unscheduleEnabled && (
        <div className="mt-3 rounded-lg border border-red-200 bg-red-50/60 px-3 py-3 space-y-2">
          <p className="text-xs leading-snug text-red-900">
            Unscheduling cancels the queued publish. Your uploaded media, theme treatment, and marketing package stay attached — you can re-schedule later without re-uploading.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={submitUnschedule}
              disabled={submitting}
              className="inline-flex items-center gap-2 px-3 py-2 text-sm font-semibold rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              Confirm unschedule
            </button>
            <button
              type="button"
              onClick={() => setUnscheduleConfirmOpen(false)}
              disabled={submitting}
              className="inline-flex items-center px-3 py-2 text-sm font-semibold rounded-lg border border-gray-200 text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50"
            >
              Keep scheduled
            </button>
          </div>
        </div>
      )}

      {isScheduled && rescheduleOpen && rescheduleEnabled && (
        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50/60 px-3 py-3">
          <label className="block text-xs font-medium text-amber-900 mb-1">New scheduled time</label>
          <input
            type="datetime-local"
            value={rescheduleAt}
            onChange={(e) => setRescheduleAt(e.target.value)}
            disabled={submitting}
            className="w-full px-3 py-2 text-sm border border-amber-200 rounded-lg bg-white focus:outline-none focus:border-amber-400"
          />
          <button
            type="button"
            onClick={submitReschedule}
            disabled={submitting || !rescheduleAt.trim()}
            className="mt-2 inline-flex items-center gap-2 px-3 py-2 text-sm font-semibold rounded-lg bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
            Apply reschedule
          </button>
        </div>
      )}

      {/* Drag-drop / file-picker zone (direct upload) */}
      {directUploadEnabled && (
        <div className="mt-3">
          <div
            ref={dropZoneRef}
            tabIndex={uploadControlsLocked ? -1 : 0}
            onDragEnter={onDragEnter}
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
            onClick={onDropZoneClick}
            onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && !uploadControlsLocked && !submitting) { e.preventDefault(); onDropZoneClick(); } }}
            role="button"
            aria-label={`Drop a ${placeholderLabel} here or click to choose`}
            aria-disabled={uploadControlsLocked || submitting}
            className={`flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-4 py-6 transition-colors text-center ${dropZoneClass}`}
          >
            <Upload className={`h-5 w-5 ${uiStatus === 'failed' ? 'text-red-500' : uiStatus === 'ready' ? 'text-emerald-600' : 'text-indigo-500'}`} />
            <div className="text-sm font-medium text-gray-800">
              {uiStatus === 'uploading' && <>Uploading {placeholderLabel}… {progress}%</>}
              {uiStatus === 'validating' && <>Validating upload server-side…</>}
              {uiStatus === 'dragging' && <>Release to upload</>}
              {uiStatus === 'ready' && <>Upload complete — ready to schedule</>}
              {uiStatus === 'failed' && <>Upload failed — try again</>}
              {uiStatus === 'idle' && (uploadControlsLocked
                ? <>Click "Replace media" above to upload a new file.</>
                : <>Drag &amp; drop your {placeholderLabel}, or click to select</>)}
            </div>
            <div className="text-[11px] text-gray-500">
              Accepted: {acceptAttr.replace('/*', '/*')} · max 2 GB · paste a file from clipboard
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept={acceptAttr}
              onChange={onPickerChange}
              disabled={submitting || uploadControlsLocked}
              className="hidden"
            />
          </div>
          {(uiStatus === 'uploading' || uiStatus === 'validating') && (
            <div className="mt-2 flex items-center gap-2">
              <div className="flex-1 h-1.5 rounded-full bg-indigo-100 overflow-hidden">
                <div
                  className={`h-full bg-indigo-500 transition-all duration-150 ${uiStatus === 'validating' ? 'animate-pulse' : ''}`}
                  style={{ width: `${uiStatus === 'validating' ? 100 : progress}%` }}
                  aria-valuenow={progress}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  role="progressbar"
                />
              </div>
              {uiStatus === 'uploading' && (
                <button
                  type="button"
                  onClick={cancelUpload}
                  className="text-[11px] font-semibold text-red-600 hover:text-red-800 underline"
                >
                  Cancel
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* URL paste field (preserved) */}
      <div className="mt-3 space-y-2">
        <label className="text-xs font-medium text-gray-700">
          {directUploadEnabled ? 'Or paste a media URL' : 'Media URL'}
        </label>
        <input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder={state.contentType === 'podcast' ? 'https://...mp3 or platform episode link' : 'https://...mp4 or platform link (YouTube, Vimeo, etc.)'}
          disabled={submitting || uploadControlsLocked}
          className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:border-indigo-400 disabled:bg-gray-50"
        />
        <div className="flex items-center gap-3 text-xs text-gray-600">
          <label className="flex items-center gap-1">
            <input type="radio" name={`upload-source-${state.dailyPlanId}`} checked={source === 'external_link'} onChange={() => setSource('external_link')} disabled={submitting || uploadControlsLocked} /> External link
          </label>
          <label className="flex items-center gap-1">
            <input type="radio" name={`upload-source-${state.dailyPlanId}`} checked={source === 'user_upload'} onChange={() => setSource('user_upload')} disabled={submitting || uploadControlsLocked} /> User upload
          </label>
        </div>
        <button
          type="button"
          onClick={submitUrl}
          disabled={submitting || uploadControlsLocked || !url.trim()}
          className="inline-flex items-center gap-2 px-3 py-2 text-sm font-semibold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
          {isFailed ? 'Retry URL upload' : (isReady || isScheduled ? 'Re-upload from URL' : 'Submit URL')}
        </button>
      </div>

      {/* Preview of the currently-persisted uploaded media */}
      {previewUrl && (isReady || isScheduled) && (
        <UploadedMediaPreview url={previewUrl} mime={previewMime} />
      )}

      {localOk && (
        <p className="mt-2 text-xs text-emerald-700 bg-emerald-50 border border-emerald-100 rounded px-2 py-1.5">
          <Check className="h-3 w-3 inline mr-1" /> {localOk}
        </p>
      )}
      {localError && (
        <p className="mt-2 text-xs text-red-700 bg-red-50 border border-red-100 rounded px-2 py-1.5">{localError}</p>
      )}
      {!localError && isFailed && validationErrors.length > 0 && (
        <ul className="mt-2 text-xs text-red-700 bg-red-50 border border-red-100 rounded px-2 py-1.5 list-disc pl-5">
          {validationErrors.map((err, i) => <li key={i}>{err}</li>)}
        </ul>
      )}
      {(isReady || isScheduled) && state.uploadedMediaUrl && (
        <p className="mt-2 text-xs text-gray-600">
          <span className="font-medium">Uploaded:</span>{' '}
          <a href={state.uploadedMediaUrl} target="_blank" rel="noopener noreferrer" className="text-indigo-600 hover:underline break-all">
            {state.uploadedMediaUrl}
          </a>
        </p>
      )}
      {isAwaiting && !localError && !localOk && (
        <p className="mt-2 text-xs text-amber-700">
          Provide the finished {state.contentType} URL (platform link or direct media), or drop a file above. Validation runs server-side before the row becomes schedulable.
        </p>
      )}
    </div>
  );
}

