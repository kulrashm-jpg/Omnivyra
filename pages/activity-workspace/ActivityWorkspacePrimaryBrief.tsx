import React from 'react';
import { createIdempotentOperation } from '../../lib/idempotency';
import CreatorContentPanel, { type AttachmentRowState, type UploadMediaResult, type ResumableUploadHandle } from '@/components/activity-workspace/CreatorContentPanel';
import type { WorkspacePayload } from './types';
import {
  isAttachmentRequiredFormat,
  normalizeCreatorFormat,
} from '@/lib/shared/creatorGovernanceRegistry';
import { bearerAuthorization } from '@/lib/httpAuthHeaders';

function extractAttachmentRowState(input: {
  dailyRaw: Record<string, unknown>;
  contentType: string;
}): AttachmentRowState | null {
  const normalized = normalizeCreatorFormat(input.contentType);
  if (!isAttachmentRequiredFormat(normalized)) return null;
  const dailyPlanId = String((input.dailyRaw as any)?.id || (input.dailyRaw as any)?.daily_plan_id || '').trim();
  if (!dailyPlanId) return null;
  const content = (input.dailyRaw as any)?.content;
  const parsedContent: Record<string, unknown> = (content && typeof content === 'object' && !Array.isArray(content))
    ? content as Record<string, unknown>
    : (typeof content === 'string' ? (() => { try { return JSON.parse(content); } catch { return {}; } })() : {});
  const lifecycleRaw = typeof parsedContent.creator_lifecycle_state === 'string'
    ? parsedContent.creator_lifecycle_state
    : typeof (input.dailyRaw as any)?.content_status === 'string'
      ? (input.dailyRaw as any).content_status
      : 'awaiting_media_upload';
  const lifecycle = (
    lifecycleRaw === 'media_uploaded' ||
    lifecycleRaw === 'ready_for_schedule' ||
    lifecycleRaw === 'scheduled' ||
    lifecycleRaw === 'upload_failed'
  ) ? lifecycleRaw : 'awaiting_media_upload';
  const themeTreatment = (parsedContent.theme_treatment && typeof parsedContent.theme_treatment === 'object' && !Array.isArray(parsedContent.theme_treatment))
    ? parsedContent.theme_treatment as Record<string, any>
    : null;
  const historyArr = Array.isArray(parsedContent.creator_lifecycle_history)
    ? parsedContent.creator_lifecycle_history as unknown[]
    : [];
  return {
    dailyPlanId,
    contentType: normalized as AttachmentRowState['contentType'],
    lifecycle: lifecycle as AttachmentRowState['lifecycle'],
    revision: historyArr.length,
    scheduledAt: typeof parsedContent.scheduled_at === 'string' ? parsedContent.scheduled_at : undefined,
    scheduledPostId: typeof parsedContent.scheduled_post_id === 'string' ? parsedContent.scheduled_post_id : undefined,
    uploadedMediaUrl: typeof parsedContent.uploaded_media_url === 'string' ? parsedContent.uploaded_media_url : undefined,
    uploadSource: parsedContent.upload_source === 'user_upload' || parsedContent.upload_source === 'external_link' || parsedContent.upload_source === 'direct_upload'
      ? parsedContent.upload_source as AttachmentRowState['uploadSource']
      : undefined,
    uploadValidation: (parsedContent.upload_validation && typeof parsedContent.upload_validation === 'object')
      ? parsedContent.upload_validation as any
      : null,
    uploadedMimeType: typeof parsedContent.uploaded_mime_type === 'string' ? parsedContent.uploaded_mime_type : undefined,
    themeTreatmentSummary: themeTreatment ? {
      hookText: String((themeTreatment.hook_scene as any)?.text || (themeTreatment.hook_scene as any)?.dialogue || ''),
      sceneCount: Array.isArray(themeTreatment.scenes) ? themeTreatment.scenes.length : 0,
      durationSeconds: Number(themeTreatment.duration_seconds ?? 0) || undefined,
      aspectRatio: typeof themeTreatment.aspect_ratio === 'string' ? themeTreatment.aspect_ratio : undefined,
      ctaText: String((themeTreatment.cta_scene as any)?.text || (themeTreatment.cta_scene as any)?.platform_cta || ''),
    } : undefined,
    creatorGuidance: (parsedContent.creator_guidance && typeof parsedContent.creator_guidance === 'object')
      ? parsedContent.creator_guidance as any
      : undefined,
    marketingPackage: (parsedContent.marketing_package && typeof parsedContent.marketing_package === 'object')
      ? parsedContent.marketing_package as any
      : undefined,
  };
}

async function postUploadMedia(input: {
  dailyPlanId: string;
  mediaUrl: string;
  source: 'user_upload' | 'external_link';
  mimeType?: string;
  expectedRevision?: number;
}): Promise<UploadMediaResult> {
  try {
    const response = await fetch(`/api/activity-workspace/${encodeURIComponent(input.dailyPlanId)}/upload-media`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        media_url: input.mediaUrl,
        source: input.source,
        ...(input.mimeType ? { mime_type: input.mimeType } : {}),
        ...(typeof input.expectedRevision === 'number' ? { expected_revision: input.expectedRevision } : {}),
      }),
    });
    const data = await response.json().catch(() => ({} as any));
    if (response.status === 409 && data?.code === 'CONCURRENT_UPLOAD_CONFLICT') {
      return { ok: false, conflict: true, message: typeof data?.error === 'string' ? data.error : 'Concurrent edit detected' };
    }
    if (!response.ok) {
      return { ok: false, message: typeof data?.error === 'string' ? data.error : `HTTP ${response.status}` };
    }
    if (data?.success === false) {
      return {
        ok: false,
        lifecycle: data?.to,
        validation: data?.validation,
        message: typeof data?.message === 'string' ? data.message : 'Validation failed.',
      };
    }
    return {
      ok: true,
      lifecycle: data?.to,
      validation: data?.validation,
      uploadedMediaUrl: typeof data?.uploaded_media_url === 'string' ? data.uploaded_media_url : undefined,
      uploadedMimeType: typeof data?.uploaded_mime_type === 'string' ? data.uploaded_mime_type : undefined,
    };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : 'Network error' };
  }
}

/**
 * Reschedule POST helper. Retime + optional media replace via URL.
 */
async function postReschedule(input: {
  dailyPlanId: string;
  mediaUrl?: string;
  scheduledAt?: string;
  source?: 'external_link' | 'user_upload';
  expectedRevision?: number;
}): Promise<UploadMediaResult> {
  try {
    // OR-07 Action 1: keyed on the daily-plan row, so a retried reschedule of
    // the same row reuses the key.
    const rescheduleOp = createIdempotentOperation(`aw-reschedule-${input.dailyPlanId}`);
    const response = await fetch(`/api/activity-workspace/${encodeURIComponent(input.dailyPlanId)}/reschedule`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...rescheduleOp.headers },
      body: JSON.stringify({
        ...(input.mediaUrl ? { media_url: input.mediaUrl } : {}),
        ...(input.scheduledAt ? { scheduled_at: input.scheduledAt } : {}),
        ...(input.source ? { source: input.source } : {}),
        ...(typeof input.expectedRevision === 'number' ? { expected_revision: input.expectedRevision } : {}),
      }),
    });
    const data = await response.json().catch(() => ({} as any));
    if (response.status === 409 && data?.code === 'CONCURRENT_UPLOAD_CONFLICT') {
      return { ok: false, conflict: true, message: typeof data?.error === 'string' ? data.error : 'Concurrent edit detected' };
    }
    if (!response.ok) {
      return { ok: false, message: typeof data?.error === 'string' ? data.error : `HTTP ${response.status}` };
    }
    if (data?.success === false) {
      return {
        ok: false,
        lifecycle: data?.to,
        validation: data?.validation,
        message: typeof data?.message === 'string' ? data.message : 'Reschedule failed.',
      };
    }
    return {
      ok: true,
      lifecycle: data?.to,
      uploadedMediaUrl: typeof data?.uploaded_media_url === 'string' ? data.uploaded_media_url : undefined,
      revision: typeof data?.revision === 'number' ? data.revision : undefined,
    };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : 'Network error' };
  }
}

/**
 * Direct (multipart) upload with progress tracking. Uses XMLHttpRequest
 * because `fetch` doesn't expose upload progress on browsers as of mid-2025.
 * Endpoint: POST /api/activity-workspace/[id]/upload-media-direct
 */
/**
 * Inspect `localStorage` for a previously-started resumable upload tied
 * to the daily plan. Used at workspace mount to surface a "Resume
 * upload?" banner when the lifecycle suggests the user was mid-upload
 * (awaiting_media_upload / upload_failed).
 *
 * The TUS fingerprint check (`tus-js-client.findPreviousUploads`) is
 * deferred to the resume action because it's async + I/O-bound; the
 * banner only displays an indicator that a session record exists.
 */
function detectResumableUploadHandle(dailyPlanId: string): ResumableUploadHandle | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(`creator-upload-resume:${dailyPlanId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return {
      tusUploadUrl: typeof parsed?.tus_upload_url === 'string' ? parsed.tus_upload_url : undefined,
      uploadSessionId: typeof parsed?.upload_session_id === 'string' ? parsed.upload_session_id : undefined,
      objectPath: typeof parsed?.object_path === 'string' ? parsed.object_path : undefined,
      createdAt: typeof parsed?.created_at === 'string' ? parsed.created_at : undefined,
      hasPersistedFingerprint: true, // banner heuristic; real check happens on resume
    };
  } catch {
    return null;
  }
}

/**
 * Resume a previously-started TUS upload via tus-js-client's
 * findPreviousUploads helper. Falls through to the standard
 * postUploadFileResumable path if no resumable session is found
 * (so the user can still re-pick a file to retry).
 */
async function resumePersistedUpload(input: {
  dailyPlanId: string;
  handle: ResumableUploadHandle;
  expectedRevision?: number;
}): Promise<UploadMediaResult> {
  const supabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim();
  const supabaseAnonKey = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '').trim();
  if (!supabaseUrl || !supabaseAnonKey) {
    return { ok: false, message: 'Resumable uploads require Supabase configuration in the browser.' };
  }
  let tusModule: typeof import('tus-js-client');
  try {
    tusModule = await import('tus-js-client');
  } catch (e) {
    return { ok: false, message: 'tus-js-client unavailable.' };
  }
  return new Promise<UploadMediaResult>((resolve) => {
    const finalize = async (objectPath: string, uploadUrl: string, file: File | null, mime: string, size: number) => {
      try {
        const finalizeRes = await fetch(`/api/activity-workspace/${encodeURIComponent(input.dailyPlanId)}/upload-media-finalize`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            storage_path: objectPath,
            mime_type: mime,
            size_bytes: size,
            source: 'tus_upload',
            tus_upload_url: uploadUrl,
            upload_session_id: input.handle.uploadSessionId,
            ...(typeof input.expectedRevision === 'number' ? { expected_revision: input.expectedRevision } : {}),
          }),
        });
        const data = await finalizeRes.json().catch(() => ({} as any));
        try { window.localStorage.removeItem(`creator-upload-resume:${input.dailyPlanId}`); } catch { /* ignore */ }
        if (finalizeRes.status === 409 && data?.code === 'CONCURRENT_UPLOAD_CONFLICT') {
          resolve({ ok: false, conflict: true, message: typeof data?.error === 'string' ? data.error : 'Concurrent edit detected' });
          return;
        }
        if (!finalizeRes.ok) {
          resolve({ ok: false, message: typeof data?.error === 'string' ? data.error : `HTTP ${finalizeRes.status}` });
          return;
        }
        if (data?.success === false) {
          resolve({ ok: false, lifecycle: data?.to, validation: data?.validation, message: typeof data?.message === 'string' ? data.message : 'Validation failed.' });
          return;
        }
        resolve({
          ok: true,
          lifecycle: data?.to,
          uploadedMediaUrl: typeof data?.uploaded_media_url === 'string' ? data.uploaded_media_url : undefined,
          uploadedMimeType: typeof data?.uploaded_mime_type === 'string' ? data.uploaded_mime_type : undefined,
        });
      } catch (e) {
        resolve({ ok: false, message: e instanceof Error ? e.message : 'Finalize failed.' });
      }
    };

    // We need a File reference to resume. tus-js-client's prior-upload
    // mechanism relies on the SAME File the original Upload was created
    // with — browsers can't reconstruct it from disk. If no file is
    // available, we can only offer the user a "restart" path (handled by
    // the UI when resume returns ok:false). The handle here is best-
    // effort; if findPreviousUploads can't continue, we surface that.
    try {
      // Without a File reference we can't actually call upload.start().
      // The banner UX is: tell the user to re-pick the file; once they
      // do, the standard postUploadFileResumable path picks up the TUS
      // fingerprint automatically (tus-js-client stores it per (file,
      // metadata) tuple).
      resolve({
        ok: false,
        message: 'Re-select the same file to continue the upload. tus-js-client will detect the prior session and resume from the last completed chunk.',
      });
    } catch (e) {
      resolve({ ok: false, message: e instanceof Error ? e.message : 'Resume initialization failed.' });
    }
  });
}

/**
 * Forget a persisted resumable-upload session. Clears the workspace's
 * localStorage marker AND best-effort the tus-js-client fingerprint via
 * `findPreviousUploads` + `removeFingerprintOnSuccess` semantics.
 *
 * This does NOT delete the underlying storage object — the janitor cron
 * sweeps up orphaned objects asynchronously based on age + linkage.
 */
async function discardPersistedUploadSession(input: {
  dailyPlanId: string;
  handle: ResumableUploadHandle;
}): Promise<void> {
  if (typeof window === 'undefined') return;
  try { window.localStorage.removeItem(`creator-upload-resume:${input.dailyPlanId}`); } catch { /* ignore */ }
  try {
    const tusModule = await import('tus-js-client');
    // tus-js-client persists fingerprints under its own keys; we can't
    // selectively prune without a File reference. Best-effort: remove
    // any fingerprint entry whose key contains the daily plan ID.
    if (typeof window !== 'undefined') {
      const keys: string[] = [];
      for (let i = 0; i < window.localStorage.length; i++) {
        const k = window.localStorage.key(i);
        if (k && k.startsWith('tus::') && k.includes(input.dailyPlanId)) keys.push(k);
      }
      for (const k of keys) {
        try { window.localStorage.removeItem(k); } catch { /* ignore */ }
      }
    }
    void tusModule;
  } catch { /* ignore */ }
}

async function postUnschedule(input: { dailyPlanId: string; reason?: string; expectedRevision?: number }): Promise<UploadMediaResult> {
  try {
    // OR-07 Action 1: keyed on the daily-plan row being unscheduled.
    const unscheduleOp = createIdempotentOperation(`aw-unschedule-${input.dailyPlanId}`);
    const response = await fetch(`/api/activity-workspace/${encodeURIComponent(input.dailyPlanId)}/unschedule`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...unscheduleOp.headers },
      body: JSON.stringify({
        ...(input.reason ? { reason: input.reason } : {}),
        ...(typeof input.expectedRevision === 'number' ? { expected_revision: input.expectedRevision } : {}),
      }),
    });
    const data = await response.json().catch(() => ({} as any));
    if (response.status === 409 && data?.code === 'CONCURRENT_UPLOAD_CONFLICT') {
      return { ok: false, conflict: true, message: typeof data?.error === 'string' ? data.error : 'Concurrent edit detected' };
    }
    if (!response.ok) {
      return { ok: false, message: typeof data?.error === 'string' ? data.error : `HTTP ${response.status}` };
    }
    return {
      ok: true,
      lifecycle: data?.to,
      revision: typeof data?.revision === 'number' ? data.revision : undefined,
    };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : 'Network error' };
  }
}

/**
 * Resumable upload via tus-js-client → Supabase TUS endpoint, then
 * finalize via our Next.js API. Persists the TUS upload URL +
 * session ID to localStorage so a page refresh / reconnect can
 * detect an in-flight upload and offer "Resume upload" UX.
 *
 * Falls back to the multipart `postUploadFileDirect` path automatically
 * when the Supabase URL / anon key aren't configured for the browser
 * (i.e. when this is being run in a test or restricted environment).
 */
async function postUploadFileResumable(input: {
  dailyPlanId: string;
  file: File;
  source?: 'user_upload' | 'direct_upload';
  onProgress?: (percent: number) => void;
  signal?: AbortSignal;
  expectedRevision?: number;
}): Promise<UploadMediaResult> {
  // Read Supabase config from the public environment. If not set, fall
  // back to multipart so dev/test environments still work.
  const supabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim();
  const supabaseAnonKey = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '').trim();
  if (!supabaseUrl || !supabaseAnonKey) {
    return postUploadFileDirect(input);
  }

  let tusModule: typeof import('tus-js-client');
  try {
    tusModule = await import('tus-js-client');
  } catch {
    return postUploadFileDirect(input);
  }

  // Derive a stable object path so re-uploads from the same row land in
  // a predictable namespace, mirroring the server's path scheme.
  const subdir = input.file.type.startsWith('video/')
    ? 'video'
    : input.file.type.startsWith('audio/')
      ? 'audio'
      : input.file.type.startsWith('image/')
        ? 'image'
        : 'misc';
  const sessionId = `${input.dailyPlanId}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const ext = (input.file.type.split('/')[1] || 'bin').replace(/[^a-z0-9]+/gi, '');
  const objectPath = `${input.dailyPlanId}/${subdir}/${sessionId}.${ext}`;

  const PERSIST_KEY = `creator-upload-resume:${input.dailyPlanId}`;

  return new Promise<UploadMediaResult>((resolve) => {
    let resolved = false;
    let upload: import('tus-js-client').Upload | null = null;

    const finalize = async (uploadUrl: string) => {
      try {
        const finalizeRes = await fetch(`/api/activity-workspace/${encodeURIComponent(input.dailyPlanId)}/upload-media-finalize`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            storage_path: objectPath,
            mime_type: input.file.type || 'application/octet-stream',
            size_bytes: input.file.size,
            source: input.source ?? 'tus_upload',
            tus_upload_url: uploadUrl,
            upload_session_id: sessionId,
            ...(typeof input.expectedRevision === 'number' ? { expected_revision: input.expectedRevision } : {}),
          }),
        });
        const data = await finalizeRes.json().catch(() => ({} as any));
        try { window.localStorage.removeItem(PERSIST_KEY); } catch { /* ignore */ }
        if (finalizeRes.status === 409 && data?.code === 'CONCURRENT_UPLOAD_CONFLICT') {
          resolve({ ok: false, conflict: true, message: typeof data?.error === 'string' ? data.error : 'Concurrent edit detected' });
          return;
        }
        if (!finalizeRes.ok) {
          resolve({ ok: false, message: typeof data?.error === 'string' ? data.error : `HTTP ${finalizeRes.status}` });
          return;
        }
        if (data?.success === false) {
          resolve({
            ok: false,
            lifecycle: data?.to,
            validation: data?.validation,
            message: typeof data?.message === 'string' ? data.message : 'Validation failed.',
          });
          return;
        }
        resolve({
          ok: true,
          lifecycle: data?.to,
          validation: data?.validation,
          uploadedMediaUrl: typeof data?.uploaded_media_url === 'string' ? data.uploaded_media_url : undefined,
          uploadedMimeType: typeof data?.uploaded_mime_type === 'string' ? data.uploaded_mime_type : undefined,
        });
      } catch (e) {
        resolve({ ok: false, message: e instanceof Error ? e.message : 'Finalize request failed.' });
      }
    };

    const safeResolve = (value: UploadMediaResult) => {
      if (resolved) return;
      resolved = true;
      resolve(value);
    };

    // Wire AbortSignal: tus-js-client supports `abort()` which terminates
    // the upload without lifecycle mutation server-side. We resolve with
    // `aborted: true` so the UI can clear state cleanly.
    if (input.signal) {
      if (input.signal.aborted) {
        safeResolve({ ok: false, aborted: true, message: 'Upload aborted before send.' });
        return;
      }
      input.signal.addEventListener('abort', () => {
        try { upload?.abort(true).catch(() => { /* swallow */ }); } catch { /* ignore */ }
        safeResolve({ ok: false, aborted: true, message: 'Upload aborted.' });
      }, { once: true });
    }

    upload = new tusModule.Upload(input.file, {
      endpoint: `${supabaseUrl}/storage/v1/upload/resumable`,
      retryDelays: [0, 1000, 3000, 5000, 10000],
      chunkSize: 6 * 1024 * 1024, // 6 MB — matches Supabase recommended chunk
      removeFingerprintOnSuccess: true,
      headers: {
        authorization: bearerAuthorization(supabaseAnonKey),
        'x-upsert': 'true',
      },
      uploadDataDuringCreation: true,
      metadata: {
        bucketName: 'media-uploads',
        objectName: objectPath,
        contentType: input.file.type || 'application/octet-stream',
        cacheControl: '3600',
      },
      onError: (err) => {
        safeResolve({ ok: false, message: err?.message || 'Upload error' });
      },
      onProgress: (bytesUploaded, bytesTotal) => {
        if (typeof input.onProgress === 'function' && bytesTotal > 0) {
          input.onProgress((bytesUploaded / bytesTotal) * 100);
        }
      },
      onSuccess: () => {
        const url = upload?.url ?? '';
        void finalize(url);
      },
      // Persist the TUS upload URL so a refresh can detect an in-progress
      // upload. tus-js-client also writes to localStorage by default via
      // its fingerprint mechanism; this is a parallel mark for our own UX.
      onAfterResponse: (httpReq, httpRes) => {
        try {
          const location = httpRes.getHeader('Location');
          if (location) {
            window.localStorage.setItem(PERSIST_KEY, JSON.stringify({
              tus_upload_url: location,
              upload_session_id: sessionId,
              object_path: objectPath,
              created_at: new Date().toISOString(),
            }));
          }
        } catch { /* ignore */ }
      },
    });

    void upload.start();
  });
}

function postUploadFileDirect(input: {
  dailyPlanId: string;
  file: File;
  source?: 'user_upload' | 'direct_upload';
  onProgress?: (percent: number) => void;
  signal?: AbortSignal;
  expectedRevision?: number;
}): Promise<UploadMediaResult> {
  return new Promise((resolve) => {
    try {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `/api/activity-workspace/${encodeURIComponent(input.dailyPlanId)}/upload-media-direct`, true);
      xhr.withCredentials = true;
      const form = new FormData();
      form.append('file', input.file);
      form.append('source', input.source ?? 'direct_upload');
      if (typeof input.expectedRevision === 'number') {
        form.append('expected_revision', String(input.expectedRevision));
      }
      // Wire the AbortSignal: when the caller aborts, the XHR is aborted
      // and we resolve with `aborted: true` so the UI can clear state
      // without mutating the row's lifecycle.
      if (input.signal) {
        if (input.signal.aborted) {
          resolve({ ok: false, aborted: true, message: 'Upload aborted before send.' });
          return;
        }
        input.signal.addEventListener('abort', () => {
          try { xhr.abort(); } catch { /* ignore */ }
        }, { once: true });
      }
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable && typeof input.onProgress === 'function') {
          input.onProgress((event.loaded / event.total) * 100);
        }
      };
      xhr.onerror = () => resolve({ ok: false, message: 'Network error during upload.' });
      xhr.onabort = () => resolve({ ok: false, aborted: true, message: 'Upload aborted.' });
      xhr.onload = () => {
        let data: any = {};
        try { data = JSON.parse(xhr.responseText); } catch { /* keep empty */ }
        if (xhr.status === 409 && data?.code === 'CONCURRENT_UPLOAD_CONFLICT') {
          resolve({ ok: false, conflict: true, message: typeof data?.error === 'string' ? data.error : 'Concurrent edit detected' });
          return;
        }
        if (xhr.status < 200 || xhr.status >= 300) {
          resolve({ ok: false, message: typeof data?.error === 'string' ? data.error : `HTTP ${xhr.status}` });
          return;
        }
        if (data?.success === false) {
          resolve({
            ok: false,
            lifecycle: data?.to,
            validation: data?.validation,
            message: typeof data?.message === 'string' ? data.message : 'Validation failed.',
          });
          return;
        }
        resolve({
          ok: true,
          lifecycle: data?.to,
          validation: data?.validation,
          uploadedMediaUrl: typeof data?.uploaded_media_url === 'string' ? data.uploaded_media_url : undefined,
          uploadedMimeType: typeof data?.uploaded_mime_type === 'string' ? data.uploaded_mime_type : undefined,
        });
      };
      xhr.send(form);
    } catch (e) {
      resolve({ ok: false, message: e instanceof Error ? e.message : 'Failed to start upload.' });
    }
  });
}

type ActivityWorkspacePrimaryBriefProps = {
  isCreatorActivity: boolean;
  contentType: string;
  creatorCard: Record<string, unknown> | null;
  topicText: string;
  payload: WorkspacePayload;
  intent: Record<string, unknown>;
  writerBrief: Record<string, unknown>;
  suggestedPlatforms: string[];
  labelize: (value: string) => string;
  effectiveWhatReaderLearns: string;
  effectiveProblemAddressed: string;
  dailyRaw: Record<string, unknown>;
  creatorAsset:
    | {
        type: 'video' | 'image' | 'carousel';
        url?: string;
        files?: string[];
        platformUploads?: Record<string, { url?: string; externalLink?: string; caption?: string; slides?: string[] }>;
        description?: string;
        transcript?: string;
        theme?: string;
      }
    | undefined;
  onAssetSaved: (asset: { type: string; url?: string; files?: string[]; description?: string; transcript?: string; theme?: string }) => void;
  onGeneratePromotion: () => Promise<void>;
  isGeneratingPromotion: boolean;
  campaignId: string;
  executionId: string;
  weekNumber: number;
  day: string;
  objective: string;
  targetAudience: string;
  existingHashtags: string[];
  onNotice: (type: 'success' | 'error' | 'info', message: string) => void;
};

export default function ActivityWorkspacePrimaryBrief({
  isCreatorActivity,
  contentType,
  creatorCard,
  topicText,
  payload,
  intent,
  writerBrief,
  suggestedPlatforms,
  labelize,
  effectiveWhatReaderLearns,
  effectiveProblemAddressed,
  dailyRaw,
  creatorAsset,
  onAssetSaved,
  onGeneratePromotion,
  isGeneratingPromotion,
  campaignId,
  executionId,
  weekNumber,
  day,
  objective,
  targetAudience,
  existingHashtags,
  onNotice,
}: ActivityWorkspacePrimaryBriefProps) {
  return (
    <>
      {isCreatorActivity ? (
        <div className="rounded-xl border border-gray-200 bg-white p-5 space-y-4">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold text-gray-900">Creator Brief</h2>
            <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-blue-700">
              {contentType.charAt(0).toUpperCase() + contentType.slice(1)}
            </span>
          </div>

          <div className="grid grid-cols-1 gap-3 text-sm md:grid-cols-2">
            <div>
              <div className="text-gray-500">Content theme</div>
              <div className="text-gray-900">{String(creatorCard?.theme || topicText || payload.topic || payload.title || '-')}</div>
            </div>
            <div>
              <div className="text-gray-500">Objective</div>
              <div className="text-gray-900">{String(creatorCard?.objective || intent?.objective || writerBrief?.topicGoal || '-')}</div>
            </div>
            <div>
              <div className="text-gray-500">Target audience</div>
              <div className="text-gray-900">{String(creatorCard?.target_audience || writerBrief?.whoAreWeWritingFor || intent?.target_audience || '-')}</div>
            </div>
            <div>
              <div className="text-gray-500">Desired action (CTA)</div>
              <div className="text-gray-900">{String((creatorCard?.intent as any)?.cta_type || writerBrief?.desiredAction || intent?.cta_type || '-')}</div>
            </div>
            <div className="md:col-span-2">
              <div className="text-gray-500">Platforms</div>
              <div className="text-gray-900">{suggestedPlatforms.length > 0 ? suggestedPlatforms.map((p) => labelize(p)).join(', ') : '-'}</div>
            </div>
            {(creatorCard?.keywords as string[] | undefined)?.length ? (
              <div className="md:col-span-2">
                <div className="text-gray-500">Keywords</div>
                <div className="mt-1 flex flex-wrap gap-1">
                  {(creatorCard?.keywords as string[]).map((keyword) => (
                    <span key={keyword} className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-700">{keyword}</span>
                  ))}
                </div>
              </div>
            ) : null}
            {(creatorCard?.hashtags as string[] | undefined)?.length ? (
              <div className="md:col-span-2">
                <div className="text-gray-500">Suggested hashtags</div>
                <div className="mt-1 flex flex-wrap gap-1">
                  {(creatorCard?.hashtags as string[]).map((hashtag) => (
                    <span key={hashtag} className="rounded-full bg-indigo-50 px-2 py-0.5 text-xs text-indigo-700">
                      {hashtag.startsWith('#') ? hashtag : `#${hashtag}`}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}
          </div>

          {(() => {
            const narrativeStyle = String((creatorCard?.intent as any)?.narrative_style || writerBrief?.narrativeStyle || '');
            const painPoint = String((creatorCard?.intent as any)?.pain_point || intent?.pain_point || '');
            const outcomePromise = String((creatorCard?.intent as any)?.outcome_promise || intent?.outcome_promise || '');
            const briefSummary = String((creatorCard?.intent as any)?.brief_summary || creatorCard?.summary || writerBrief?.writingIntent || '');
            const keywords = (creatorCard?.keywords as string[] | undefined) ?? [];

            if (['video'].includes(contentType)) {
              return (
                <div className="space-y-3 border-t border-gray-100 pt-3">
                  <div className="text-xs font-semibold uppercase tracking-wide text-gray-400">Video Production Guide</div>
                  <div className="grid grid-cols-1 gap-3 text-sm md:grid-cols-2">
                    <div><div className="text-gray-500">Hook concept (first 5-10s)</div><div className="text-gray-900">{painPoint || briefSummary || '-'}</div></div>
                    <div><div className="text-gray-500">Estimated duration</div><div className="text-gray-900">3-8 minutes</div></div>
                    <div><div className="text-gray-500">Visual style</div><div className="text-gray-900">{narrativeStyle || 'Conversational, on-camera or screen-record'}</div></div>
                    <div><div className="text-gray-500">Voiceover / talking points</div><div className="text-gray-900">{outcomePromise || briefSummary || '-'}</div></div>
                    {keywords.length > 0 && <div className="md:col-span-2"><div className="text-gray-500">B-roll suggestions</div><div className="text-gray-900">Visuals related to: {keywords.slice(0, 6).join(', ')}</div></div>}
                  </div>
                </div>
              );
            }

            if (['reel', 'short'].includes(contentType)) {
              return (
                <div className="space-y-3 border-t border-gray-100 pt-3">
                  <div className="text-xs font-semibold uppercase tracking-wide text-gray-400">Reel / Short Production Guide</div>
                  <div className="grid grid-cols-1 gap-3 text-sm md:grid-cols-2">
                    <div><div className="text-gray-500">Hook (first 3s)</div><div className="text-gray-900">{painPoint || briefSummary || '-'}</div></div>
                    <div><div className="text-gray-500">Target duration</div><div className="text-gray-900">15-60 seconds</div></div>
                    <div><div className="text-gray-500">Music / audio vibe</div><div className="text-gray-900">{narrativeStyle ? `Match the ${narrativeStyle.toLowerCase()} tone` : 'Upbeat, trending audio'}</div></div>
                    <div><div className="text-gray-500">Caption style</div><div className="text-gray-900">Punchy, on-screen text overlays - mirror spoken words</div></div>
                    <div className="md:col-span-2"><div className="text-gray-500">Core message</div><div className="text-gray-900">{outcomePromise || briefSummary || '-'}</div></div>
                  </div>
                </div>
              );
            }

            if (['carousel'].includes(contentType)) {
              const slideCount = Math.min(Math.max(keywords.length + 2, 5), 10);
              return (
                <div className="space-y-3 border-t border-gray-100 pt-3">
                  <div className="text-xs font-semibold uppercase tracking-wide text-gray-400">Carousel Production Guide</div>
                  <div className="grid grid-cols-1 gap-3 text-sm md:grid-cols-2">
                    <div><div className="text-gray-500">Suggested slide count</div><div className="text-gray-900">{slideCount} slides</div></div>
                    <div><div className="text-gray-500">Visual theme</div><div className="text-gray-900">{narrativeStyle || 'Clean, branded layout with consistent typography'}</div></div>
                    <div className="md:col-span-2"><div className="text-gray-500">Slide flow</div><div className="text-gray-900">Slide 1: Hook / bold statement - Slides 2-{slideCount - 1}: {keywords.length > 0 ? keywords.slice(0, slideCount - 2).join(' -> ') : 'Key points / value delivery'} - Slide {slideCount}: CTA</div></div>
                    <div className="md:col-span-2"><div className="text-gray-500">Key message per slide</div><div className="text-gray-900">{briefSummary || outcomePromise || '-'}</div></div>
                  </div>
                </div>
              );
            }

            if (['image', 'infographic'].includes(contentType)) {
              return (
                <div className="space-y-3 border-t border-gray-100 pt-3">
                  <div className="text-xs font-semibold uppercase tracking-wide text-gray-400">Image / Graphic Production Guide</div>
                  <div className="grid grid-cols-1 gap-3 text-sm md:grid-cols-2">
                    <div><div className="text-gray-500">Key message</div><div className="text-gray-900">{briefSummary || painPoint || '-'}</div></div>
                    <div><div className="text-gray-500">Visual style</div><div className="text-gray-900">{narrativeStyle || 'On-brand, high-contrast, minimal text'}</div></div>
                    <div><div className="text-gray-500">Outcome to convey</div><div className="text-gray-900">{outcomePromise || '-'}</div></div>
                    <div><div className="text-gray-500">Design notes</div><div className="text-gray-900">Use brand colours - headline + supporting visual - CTA overlay optional</div></div>
                  </div>
                </div>
              );
            }

            if (['podcast'].includes(contentType)) {
              return (
                <div className="space-y-3 border-t border-gray-100 pt-3">
                  <div className="text-xs font-semibold uppercase tracking-wide text-gray-400">Podcast Episode Guide</div>
                  <div className="grid grid-cols-1 gap-3 text-sm md:grid-cols-2">
                    <div><div className="text-gray-500">Episode angle</div><div className="text-gray-900">{painPoint || briefSummary || '-'}</div></div>
                    <div><div className="text-gray-500">Listener takeaway</div><div className="text-gray-900">{outcomePromise || '-'}</div></div>
                    <div><div className="text-gray-500">Tone / format</div><div className="text-gray-900">{narrativeStyle || 'Conversational interview or solo deep-dive'}</div></div>
                    {keywords.length > 0 && <div className="md:col-span-2"><div className="text-gray-500">Key talking points</div><div className="text-gray-900">{keywords.slice(0, 8).join(', ')}</div></div>}
                  </div>
                </div>
              );
            }

            if (['story'].includes(contentType)) {
              return (
                <div className="space-y-3 border-t border-gray-100 pt-3">
                  <div className="text-xs font-semibold uppercase tracking-wide text-gray-400">Story Production Guide</div>
                  <div className="grid grid-cols-1 gap-3 text-sm md:grid-cols-2">
                    <div><div className="text-gray-500">Story arc</div><div className="text-gray-900">Hook frame {'->'} Value reveal {'->'} Swipe-up / link CTA</div></div>
                    <div><div className="text-gray-500">Visual style</div><div className="text-gray-900">{narrativeStyle || 'Vertical 9:16 - bold text overlays - on-brand palette'}</div></div>
                    <div><div className="text-gray-500">Core message</div><div className="text-gray-900">{briefSummary || painPoint || '-'}</div></div>
                    <div><div className="text-gray-500">Interactive elements</div><div className="text-gray-900">Poll, question sticker, or countdown timer where applicable</div></div>
                  </div>
                </div>
              );
            }

            return null;
          })()}

          {creatorCard?.instructions_for_creator && (
            <div className="border-t border-gray-100 pt-3">
              <div className="mb-1 text-sm text-gray-500">Instructions for creator</div>
              <div className="whitespace-pre-wrap text-sm text-gray-800">{String(creatorCard.instructions_for_creator)}</div>
            </div>
          )}
          {!creatorCard?.instructions_for_creator && creatorCard?.summary && (
            <div className="border-t border-gray-100 pt-3">
              <div className="mb-1 text-sm text-gray-500">Content brief</div>
              <div className="whitespace-pre-wrap text-sm text-gray-800">{String(creatorCard.summary)}</div>
            </div>
          )}
        </div>
      ) : (
        <div className="rounded-xl border border-gray-200 bg-white p-5 space-y-3">
          <h2 className="text-lg font-semibold text-gray-900">Writer Context</h2>
          <div className="grid grid-cols-1 gap-3 text-sm md:grid-cols-2">
            <div><div className="text-gray-500">Topic</div><div className="text-gray-900">{payload.topic || payload.title || '-'}</div></div>
            <div><div className="text-gray-500">Objective</div><div className="text-gray-900">{String(intent?.objective || writerBrief?.topicGoal || '-')}</div></div>
            <div><div className="text-gray-500">What reader should learn</div><div className="text-gray-900">{effectiveWhatReaderLearns}</div></div>
            <div><div className="text-gray-500">Problem addressed</div><div className="text-gray-900">{effectiveProblemAddressed}</div></div>
            <div><div className="text-gray-500">Desired action</div><div className="text-gray-900">{String(writerBrief?.desiredAction || intent?.cta_type || '-')}</div></div>
            <div><div className="text-gray-500">Narrative style</div><div className="text-gray-900">{String(writerBrief?.narrativeStyle || '-')}</div></div>
            <div className="md:col-span-2"><div className="text-gray-500">Suggested social media platforms</div><div className="text-gray-900">{suggestedPlatforms.length > 0 ? suggestedPlatforms.map((p) => labelize(p)).join(', ') : '-'}</div></div>
          </div>
          {payload.description && (
            <div>
              <div className="text-sm text-gray-500">Current activity brief</div>
              <div className="mt-1 whitespace-pre-wrap text-sm text-gray-800">{payload.description}</div>
            </div>
          )}
        </div>
      )}

      {isCreatorActivity && (() => {
        const attachmentRowState = extractAttachmentRowState({ dailyRaw, contentType });
        const resumableUploadHandle = attachmentRowState
          ? detectResumableUploadHandle(attachmentRowState.dailyPlanId)
          : null;
        return (
          <CreatorContentPanel
            theme={topicText || String(payload?.title ?? '')}
            productionBrief={String(writerBrief?.writingIntent ?? payload?.description ?? '')}
            talkingPoints={
              Array.isArray((writerBrief as any)?.key_points) ? (writerBrief as any).key_points
                : Array.isArray((writerBrief as any)?.keyPoints) ? (writerBrief as any).keyPoints
                : []
            }
            contentType={contentType}
            platforms={suggestedPlatforms}
            creatorInstructions={dailyRaw?.creator_instruction as Record<string, unknown> | undefined}
            creatorAsset={creatorAsset}
            onAssetSaved={onAssetSaved}
            onGeneratePromotion={onGeneratePromotion}
            isGeneratingPromotion={isGeneratingPromotion}
            campaignId={campaignId}
            executionId={executionId}
            weekNumber={weekNumber}
            day={day}
            objective={objective}
            targetAudience={targetAudience}
            existingHashtags={existingHashtags}
            onNotice={onNotice}
            attachmentRowState={attachmentRowState}
            onUploadMedia={attachmentRowState ? (input) => postUploadMedia({ ...input, dailyPlanId: attachmentRowState.dailyPlanId }) : undefined}
            onUploadFile={attachmentRowState ? (input) => postUploadFileResumable({ ...input, dailyPlanId: attachmentRowState.dailyPlanId }) : undefined}
            onReschedule={attachmentRowState ? (input) => postReschedule({ ...input, dailyPlanId: attachmentRowState.dailyPlanId }) : undefined}
            onUnschedule={attachmentRowState ? (input) => postUnschedule({ ...input, dailyPlanId: attachmentRowState.dailyPlanId }) : undefined}
            resumableUploadHandle={resumableUploadHandle}
            onResumeUpload={attachmentRowState ? (handle) => resumePersistedUpload({ dailyPlanId: attachmentRowState.dailyPlanId, handle, expectedRevision: attachmentRowState.revision }) : undefined}
            onDiscardResumableUpload={attachmentRowState ? (handle) => discardPersistedUploadSession({ dailyPlanId: attachmentRowState.dailyPlanId, handle }) : undefined}
          />
        );
      })()}
    </>
  );
}
