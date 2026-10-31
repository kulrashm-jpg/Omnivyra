/**
 * Creator media upload handlers — shared, reusable implementation.
 *
 * These functions were previously defined inline in the (orphaned)
 * pages/activity-workspace/ActivityWorkspacePrimaryBrief.tsx. They are the
 * SINGLE source of truth for the attachment-required (video/reel/short/
 * podcast) upload journey:
 *
 *   extractAttachmentRowState   → builds AttachmentRowState from a daily row
 *   postUploadMedia             → POST /upload-media          (URL / link)
 *   postUploadFileResumable     → /upload-media-authorize → TUS (signed, private
 *                                 quarantine) → /upload-media-finalize (file, resumable)
 *   postUploadFileDirect        → POST /upload-media-direct    (file, multipart)
 *   postReschedule/postUnschedule, resume/discard helpers
 *
 * Pure transport wrappers — they call existing endpoints and return the
 * server's reported lifecycle. They contain NO scheduling/lifecycle logic of
 * their own; auto-scheduling happens server-side (autoScheduleReadyCreatorRowById).
 */

import { createIdempotentOperation } from '../../lib/idempotency';
import { getSupabasePublishableKey } from '../../lib/supabase/publishableKey';
import {
  isAttachmentRequiredFormat,
  normalizeCreatorFormat,
} from '@/lib/shared/creatorGovernanceRegistry';
import type {
  AttachmentRowState,
  UploadMediaResult,
  ResumableUploadHandle,
} from '@/components/activity-workspace/CreatorContentPanel';

export function extractAttachmentRowState(input: {
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

export async function postUploadMedia(input: {
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
export async function postReschedule(input: {
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
 * Inspect `localStorage` for a previously-started resumable upload tied
 * to the daily plan. Used at workspace mount to surface a "Resume
 * upload?" banner when the lifecycle suggests the user was mid-upload.
 */
export function detectResumableUploadHandle(dailyPlanId: string): ResumableUploadHandle | null {
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
      hasPersistedFingerprint: true,
    };
  } catch {
    return null;
  }
}

/**
 * Resume a previously-started TUS upload. Without the original File
 * reference we can only prompt the user to re-pick the file; tus-js-client
 * then detects the prior session automatically.
 */
export async function resumePersistedUpload(input: {
  dailyPlanId: string;
  handle: ResumableUploadHandle;
  expectedRevision?: number;
}): Promise<UploadMediaResult> {
  const supabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim();
  const supabasePublishableKey = getSupabasePublishableKey();
  if (!supabaseUrl || !supabasePublishableKey) {
    return { ok: false, message: 'Resumable uploads require Supabase configuration in the browser.' };
  }
  try {
    await import('tus-js-client');
  } catch {
    return { ok: false, message: 'tus-js-client unavailable.' };
  }
  return {
    ok: false,
    message: 'Re-select the same file to continue the upload. tus-js-client will detect the prior session and resume from the last completed chunk.',
  };
}

/**
 * Forget a persisted resumable-upload session. Clears the workspace's
 * localStorage marker AND best-effort the tus-js-client fingerprint.
 */
export async function discardPersistedUploadSession(input: {
  dailyPlanId: string;
  handle: ResumableUploadHandle;
}): Promise<void> {
  if (typeof window === 'undefined') return;
  try { window.localStorage.removeItem(`creator-upload-resume:${input.dailyPlanId}`); } catch { /* ignore */ }
  try {
    const tusModule = await import('tus-js-client');
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

export async function postUnschedule(input: { dailyPlanId: string; reason?: string; expectedRevision?: number }): Promise<UploadMediaResult> {
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
 * MEDIA-H3 — the server-issued upload authorization the browser needs before
 * any byte is sent. The browser never chooses the bucket or the object key and
 * never writes with the publishable key's own (anon) privileges.
 */
export type UploadAuthorization = {
  bucket: string;
  object_path: string;
  token: string;
  upload_session_id: string;
  resumable_endpoint: string;
};

export async function requestUploadAuthorization(input: {
  dailyPlanId: string;
  file: File;
}): Promise<{ ok: true; auth: UploadAuthorization } | { ok: false; message: string; status?: number }> {
  try {
    const res = await fetch(`/api/activity-workspace/${encodeURIComponent(input.dailyPlanId)}/upload-media-authorize`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mime_type: input.file.type || 'application/octet-stream', size_bytes: input.file.size }),
    });
    const data = await res.json().catch(() => ({} as any));
    if (!res.ok) {
      return { ok: false, status: res.status, message: typeof data?.error === 'string' ? data.error : `HTTP ${res.status}` };
    }
    const fields = ['bucket', 'object_path', 'token', 'upload_session_id', 'resumable_endpoint'] as const;
    if (!fields.every((f) => typeof data?.[f] === 'string' && data[f].length > 0)) {
      return { ok: false, message: 'Upload authorization response was incomplete.' };
    }
    return { ok: true, auth: data as UploadAuthorization };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : 'Upload authorization failed.' };
  }
}

/**
 * Resumable upload: server authorization → tus-js-client to Supabase's SIGNED
 * resumable endpoint (private quarantine bucket, server-minted key, no
 * overwrite) → finalize via our Next.js API, which validates the stored bytes
 * and only then publishes them. Falls back to the multipart direct path when
 * Supabase config isn't available in the browser.
 */
export async function postUploadFileResumable(input: {
  dailyPlanId: string;
  file: File;
  source?: 'user_upload' | 'direct_upload';
  onProgress?: (percent: number) => void;
  signal?: AbortSignal;
  expectedRevision?: number;
}): Promise<UploadMediaResult> {
  const supabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim();
  const supabasePublishableKey = getSupabasePublishableKey();
  if (!supabaseUrl || !supabasePublishableKey) {
    return postUploadFileDirect(input);
  }

  let tusModule: typeof import('tus-js-client');
  try {
    tusModule = await import('tus-js-client');
  } catch {
    return postUploadFileDirect(input);
  }

  if (input.signal?.aborted) {
    return { ok: false, aborted: true, message: 'Upload aborted before send.' };
  }
  const authorization = await requestUploadAuthorization({ dailyPlanId: input.dailyPlanId, file: input.file });
  if (authorization.ok === false) {
    return { ok: false, message: authorization.message };
  }
  const { auth } = authorization;
  const sessionId = auth.upload_session_id;
  const objectPath = auth.object_path;

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
      endpoint: `${supabaseUrl}${auth.resumable_endpoint}`,
      retryDelays: [0, 1000, 3000, 5000, 10000],
      chunkSize: 6 * 1024 * 1024,
      removeFingerprintOnSuccess: true,
      // MEDIA-H3: the signed token authorizes exactly one key in the private
      // quarantine bucket. No bearer credential and no x-upsert (no overwrite).
      headers: {
        apikey: supabasePublishableKey,
        'x-signature': auth.token,
      },
      uploadDataDuringCreation: true,
      metadata: {
        bucketName: auth.bucket,
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

export function postUploadFileDirect(input: {
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
