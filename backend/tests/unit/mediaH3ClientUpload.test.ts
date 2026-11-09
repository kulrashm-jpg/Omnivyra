/**
 * MEDIA-H3 — browser resumable upload (components/activity-workspace/
 * creatorMediaUploadHandlers.ts → postUploadFileResumable).
 *
 * The TUS client is mocked: this proves what the browser SENDS (endpoint,
 * credentials, bucket, key) and in what order. It cannot prove Supabase's
 * handling of the signed resumable endpoint — see the remediation report.
 */
const mockTus: { options: any[]; started: number } = { options: [], started: 0 };
jest.mock('tus-js-client', () => ({
  Upload: class {
    url = 'https://proj.supabase.co/storage/v1/upload/resumable/sign/abc';
    opts: any;
    constructor(_file: unknown, opts: any) { this.opts = opts; mockTus.options.push(opts); }
    start() { mockTus.started += 1; this.opts.onSuccess?.(); }
    abort() { return Promise.resolve(); }
  },
}));

import fs from 'fs';
import path from 'path';
import { postUploadFileResumable } from '../../../components/activity-workspace/creatorMediaUploadHandlers';

const ROOT = path.resolve(__dirname, '..', '..', '..');
const AUTH = {
  bucket: 'media-quarantine',
  object_path: 'company-a/plan-a/video/1700000000000-0123456789abcdef0123456789abcdef.mp4',
  token: 'signed-upload-token',
  upload_session_id: '1700000000000-0123456789abcdef0123456789abcdef',
  resumable_endpoint: '/storage/v1/upload/resumable/sign',
};
const file = { type: 'video/mp4', size: 4242, name: 'clip.mp4' } as unknown as File;
const savedEnv = { ...process.env };
const realFetch = (global as any).fetch;
let calls: Array<{ url: string; body: any }> = [];

function mockFetch(authResponse: { status: number; body: any }) {
  (global as any).fetch = jest.fn(async (url: string, init: any) => {
    calls.push({ url, body: init?.body ? JSON.parse(init.body) : null });
    if (url.endsWith('/upload-media-authorize')) {
      return { ok: authResponse.status === 200, status: authResponse.status, json: async () => authResponse.body };
    }
    return { ok: true, status: 200, json: async () => ({ success: true, to: 'ready_for_schedule', uploaded_media_url: 'https://proj.supabase.co/storage/v1/object/public/media-uploads/k' }) };
  });
}

beforeEach(() => {
  mockTus.options.length = 0;
  mockTus.started = 0;
  calls = [];
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://proj.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_test';
  const store = new Map<string, string>();
  (global as any).window = {
    localStorage: {
      getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v),
      removeItem: (k: string) => store.delete(k), key: () => null, length: 0,
    },
  };
});
afterEach(() => {
  process.env = { ...savedEnv };
  (global as any).fetch = realFetch;
  delete (global as any).window;
});

it('asks the server for an upload authorization BEFORE sending any byte, then uploads to the SIGNED endpoint', async () => {
  mockFetch({ status: 200, body: AUTH });
  const r = await postUploadFileResumable({ dailyPlanId: 'plan-a', file });
  expect(r.ok).toBe(true);
  expect(calls[0].url).toBe('/api/activity-workspace/plan-a/upload-media-authorize');
  expect(calls[0].body).toEqual({ mime_type: 'video/mp4', size_bytes: 4242 });
  expect(mockTus.options).toHaveLength(1);
  const o = mockTus.options[0];
  expect(o.endpoint).toBe('https://proj.supabase.co/storage/v1/upload/resumable/sign');
  expect(o.headers['x-signature']).toBe('signed-upload-token');
  // No bearer credential (the publishable key used to authorize the write as anon) and no overwrite.
  expect(Object.keys(o.headers).map((k) => k.toLowerCase())).not.toContain('authorization');
  expect(Object.keys(o.headers).map((k) => k.toLowerCase())).not.toContain('x-upsert');
  expect(o.metadata.bucketName).toBe('media-quarantine');
  expect(o.metadata.objectName).toBe(AUTH.object_path);
});

it('finalize names the SERVER-issued key and session, never a client-minted one', async () => {
  mockFetch({ status: 200, body: AUTH });
  await postUploadFileResumable({ dailyPlanId: 'plan-a', file });
  const fin = calls.find((c) => c.url.endsWith('/upload-media-finalize'));
  expect(fin?.body.storage_path).toBe(AUTH.object_path);
  expect(fin?.body.upload_session_id).toBe(AUTH.upload_session_id);
});

it.each([
  ['403 cross-tenant', { status: 403, body: { error: 'FORBIDDEN' } }],
  ['401 unauthenticated', { status: 401, body: { error: 'UNAUTHORIZED' } }],
  ['415 disallowed type', { status: 415, body: { error: 'Type not allowed' } }],
  ['200 but incomplete', { status: 200, body: { bucket: 'media-uploads', object_path: 'x' } }],
])('authorization refused (%s) → no TUS upload is created', async (_n, resp) => {
  mockFetch(resp);
  const r = await postUploadFileResumable({ dailyPlanId: 'plan-a', file });
  expect(r.ok).toBe(false);
  expect(mockTus.options).toHaveLength(0);
  expect(calls.some((c) => c.url.endsWith('/upload-media-finalize'))).toBe(false);
});

it('source guard: no browser code writes to media-uploads or uses the unsigned resumable endpoint', () => {
  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name === 'api') continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (/\.(tsx?|jsx?)$/.test(e.name)) {
        const src = fs.readFileSync(full, 'utf8');
        if (/bucketName:\s*['"]media-uploads['"]/.test(src) || /\/storage\/v1\/upload\/resumable[`'"]/.test(src) || /'x-upsert'/.test(src)) {
          offenders.push(path.relative(ROOT, full));
        }
      }
    }
  };
  for (const top of ['components', 'pages', 'hooks', 'lib']) walk(path.join(ROOT, top));
  expect(offenders).toEqual([]);
  // Non-empty match set: the guard is looking at the real uploader.
  expect(fs.readFileSync(path.join(ROOT, 'components/activity-workspace/creatorMediaUploadHandlers.ts'), 'utf8')).toMatch(/x-signature/);
});

it('uploads disabled (503 UPLOADS_UNAVAILABLE) → ok:false with the server message; no TUS, no finalize', async () => {
  const message = 'Media file uploads are currently unavailable. Nothing was uploaded.';
  mockFetch({ status: 503, body: { error: message, code: 'UPLOADS_UNAVAILABLE', retryable: false } });
  const r = await postUploadFileResumable({ dailyPlanId: 'plan-a', file });
  expect(r.ok).toBe(false);
  expect(r.message).toBe(message);
  expect(mockTus.options).toHaveLength(0);
  expect(calls.some((c) => c.url.endsWith('/upload-media-finalize'))).toBe(false);
});
