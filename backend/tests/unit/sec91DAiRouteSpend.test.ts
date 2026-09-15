/**
 * SEC91-D (STEP 3AH-91) — direct AI routes: spend control on the platform key.
 *
 *   D1  per-IP limits are keyed on the PLATFORM-TRUSTED client IP (never the
 *       client-written first x-forwarded-for hop); authenticated routes key
 *       their limits by USER; an error escaping the guard fails CLOSED.
 *   D3  claude-chat "platform" mode (platform Anthropic key, no attribution,
 *       no ledger) is refused before any limiter/provider work; BYOK unchanged.
 *       gpt-chat checks BYOK before running platform-key moderation.
 *   D9  every provider request carries an AbortSignal (time-bounded).
 *
 * Real auth chain (routeAuthHarness, read-only); only the DB, identity
 * provider, limiter, guard, moderation and provider HTTP are faked. Every
 * denial asserts the provider is never reached.
 */
import { seed, invoke, CO_A, USER_A } from '../helpers/routeAuthHarness';
import { resolveTrustedClientIp } from '../../services/ai/trustedClientIp';

jest.mock('@/config', () => ({ config: { DEV_USER_ID: '', NODE_ENV: 'production' } }));
jest.mock('../../db/supabaseClient', () => require('../helpers/routeAuthHarness').supabaseModule());
jest.mock('../../db/writeOwner', () => require('../helpers/routeAuthHarness').writeOwnerModule());
jest.mock('../../services/supabaseAuthService', () => require('../helpers/routeAuthHarness').authModule());
jest.mock('../../security/IdentityResolver', () => require('../helpers/routeAuthHarness').identityModule());

const mockGuardAi = jest.fn(async (..._a: any[]) => undefined);
jest.mock('../../services/ai/aiRequestGuard', () => {
  class AiGuardError extends Error { status = 429; code = 'AI_RATE_LIMIT'; retryAfterSecs = 1; }
  return { guardAiRequest: (...a: any[]) => mockGuardAi(...a), AiGuardError };
});
const mockModerate = jest.fn(async (..._a: any[]) => ({ allowed: true }));
jest.mock('../../chatGovernance', () => ({ validateAndModerateUserMessage: (...a: any[]) => mockModerate(...a) }));
const mockRateLimit = jest.fn(async (..._a: any[]) => ({ allowed: true, remaining: 1, resetAt: 0 }));
jest.mock('../../../lib/auth/rateLimit', () => ({ checkRateLimit: (...a: any[]) => mockRateLimit(...a) }));
jest.mock('../../services/billing/blackHoleCostCapture', () => ({ captureFlatProviderCost: jest.fn(async () => undefined) }));

/* eslint-disable @typescript-eslint/no-var-requires */
const claudeChat = require('../../../pages/api/ai/claude-chat').default;
const gptChat = require('../../../pages/api/ai/gpt-chat').default;
const transcribe = require('../../../pages/api/voice/transcribe').default;
/* eslint-enable @typescript-eslint/no-var-requires */

const realFetch = global.fetch;
const defaultFetch = async (..._a: any[]) => ({
  ok: true,
  status: 200,
  json: async () => ({
    content: [{ text: 'claude says hi' }], choices: [{ message: { content: 'gpt says hi' } }],
    usage: {}, model: 'm', text: 'transcribed words', duration: 3,
  }),
  text: async () => '',
});
const mockFetch = jest.fn(defaultFetch);

const SPOOFED = { 'x-forwarded-for': '6.6.6.6, 10.0.0.1' };
const VERCEL_EDGE = { ...SPOOFED, 'x-real-ip': '203.0.113.7' };
const ORIGINAL_VERCEL = process.env.VERCEL;

beforeAll(() => {
  global.fetch = mockFetch as never;
  process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test-only-platform-openai';
  process.env.ANTHROPIC_API_KEY = 'sk-ant-PLATFORM-KEY-MUST-NOT-LEAVE';
});
afterAll(() => {
  global.fetch = realFetch;
  if (ORIGINAL_VERCEL === undefined) delete process.env.VERCEL; else process.env.VERCEL = ORIGINAL_VERCEL;
});
beforeEach(() => {
  seed();
  for (const m of [mockGuardAi, mockModerate, mockRateLimit, mockFetch]) m.mockClear();
  mockGuardAi.mockImplementation(async () => undefined);
  mockFetch.mockImplementation(defaultFetch);
  delete process.env.VERCEL;
});

const guardCtx = () => mockGuardAi.mock.calls[0][0] as { userId?: string; ip?: string | null; companyId?: string | null };
const providerCalls = () => mockFetch.mock.calls.map((c) => String(c[0]));

// ── trusted client IP (pure) ────────────────────────────────────────────────
describe('SEC91-D1 resolveTrustedClientIp', () => {
  it('never returns the client-written first x-forwarded-for hop (off Vercel: TCP peer)', () => {
    expect(resolveTrustedClientIp({ headers: SPOOFED, socket: { remoteAddress: '198.51.100.2' } }, {})).toBe('198.51.100.2');
    // a client-supplied x-real-ip is NOT trusted off Vercel either
    expect(resolveTrustedClientIp({ headers: VERCEL_EDGE, socket: { remoteAddress: '198.51.100.2' } }, {})).toBe('198.51.100.2');
  });
  it('on Vercel reads the edge-set x-real-ip / x-vercel-forwarded-for, not x-forwarded-for', () => {
    const env = { VERCEL: '1' } as NodeJS.ProcessEnv;
    expect(resolveTrustedClientIp({ headers: VERCEL_EDGE, socket: { remoteAddress: '10.9.9.9' } }, env)).toBe('203.0.113.7');
    expect(resolveTrustedClientIp({ headers: { ...SPOOFED, 'x-vercel-forwarded-for': '203.0.113.8' } }, env)).toBe('203.0.113.8');
    expect(resolveTrustedClientIp({ headers: SPOOFED, socket: { remoteAddress: '10.9.9.9' } }, env)).toBe('10.9.9.9');
  });
  it('an operator-declared proxy header is honoured; x-forwarded-for cannot be declared', () => {
    expect(resolveTrustedClientIp({ headers: { 'cf-connecting-ip': '192.0.2.5' } }, { TRUSTED_CLIENT_IP_HEADER: 'CF-Connecting-IP' } as NodeJS.ProcessEnv)).toBe('192.0.2.5');
    expect(resolveTrustedClientIp({ headers: SPOOFED, socket: { remoteAddress: '10.1.1.1' } }, { TRUSTED_CLIENT_IP_HEADER: 'x-forwarded-for' } as NodeJS.ProcessEnv)).toBe('10.1.1.1');
  });
  it('rejects non-IP garbage in a trusted header (falls back to the peer)', () => {
    expect(resolveTrustedClientIp({ headers: { 'x-real-ip': 'evil<script>' }, socket: { remoteAddress: '10.2.2.2' } }, { VERCEL: '1' } as NodeJS.ProcessEnv)).toBe('10.2.2.2');
  });
});

// ── D1: routes key the guard by user + trusted IP, fail closed ──────────────
describe.each([
  ['ai/gpt-chat', () => gptChat, { message: 'hello', apiKey: 'sk-caller-own', stream: false }],
  ['ai/claude-chat (byok)', () => claudeChat, { message: 'hello', apiKey: 'sk-ant-caller-own', credentialMode: 'byok', stream: false }],
  ['voice/transcribe', () => transcribe, { audioFile: 'data:audio/webm;base64,AAAAAAAA', provider: 'whisper' }],
] as const)('SEC91-D1 %s guard identity', (_name, h, body) => {
  it('guard receives the authenticated userId and the edge-trusted IP, not the spoofed XFF hop', async () => {
    process.env.VERCEL = '1';
    const r = await invoke(h(), { method: 'POST', as: 'A', body, headers: VERCEL_EDGE });
    expect(r.status).toBe(200);
    expect(guardCtx().userId).toBe(USER_A);
    expect(guardCtx().ip).toBe('203.0.113.7');
    expect(guardCtx().ip).not.toBe('6.6.6.6');
  });
  it('off Vercel a spoofed XFF never reaches the limiter key (TCP peer used)', async () => {
    await invoke(h(), { method: 'POST', as: 'A', body, headers: SPOOFED });
    expect(guardCtx().ip).toBe('127.0.0.1');
  });
  it('an unexpected (non-AiGuardError) guard failure → 503 and the provider is never called', async () => {
    mockGuardAi.mockImplementation(async () => { throw new TypeError('guard defect'); });
    const r = await invoke(h(), { method: 'POST', as: 'A', body });
    expect(r.status).toBe(503);
    expect(r.body.code).toBe('AI_GUARD_UNAVAILABLE');
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe('SEC91-D1 voice/transcribe with a bound company', () => {
  it('passes the bound companyId so the per-company layer applies', async () => {
    await invoke(transcribe, { method: 'POST', as: 'A', body: { audioFile: 'data:audio/webm;base64,AAAA', provider: 'whisper', companyId: CO_A } });
    expect(guardCtx().userId).toBe(USER_A);
    expect(guardCtx().companyId).toBe(CO_A);
  });
});

describe('SEC91-D1 claude-chat route limiter', () => {
  it('is keyed by user only — rotating the IP does not mint a new bucket', async () => {
    const body = { message: 'hi', apiKey: 'sk-ant-caller-own', credentialMode: 'byok', stream: false };
    await invoke(claudeChat, { method: 'POST', as: 'A', body, headers: { 'x-forwarded-for': '1.1.1.1' } });
    await invoke(claudeChat, { method: 'POST', as: 'A', body, headers: { 'x-forwarded-for': '2.2.2.2' } });
    const ids = mockRateLimit.mock.calls.map((c) => c[0]);
    expect(ids).toEqual([`user:${USER_A}`, `user:${USER_A}`]);
  });
});

// ── D3: claude-chat platform mode refused; BYOK preserved ───────────────────
describe('SEC91-D3 claude-chat credential modes', () => {
  it('platform mode → 403 PLATFORM_MODE_DISABLED; no limiter, guard or provider call; platform key never sent', async () => {
    const r = await invoke(claudeChat, { method: 'POST', as: 'A', body: { message: 'hi', credentialMode: 'platform', stream: false } });
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('PLATFORM_MODE_DISABLED');
    expect(mockRateLimit).not.toHaveBeenCalled();
    expect(mockGuardAi).not.toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();
  });
  it('platform mode is refused even when a key is also supplied', async () => {
    const r = await invoke(claudeChat, { method: 'POST', as: 'A', body: { message: 'hi', apiKey: 'sk-ant-x', credentialMode: 'platform', stream: false } });
    expect(r.status).toBe(403);
    expect(mockFetch).not.toHaveBeenCalled();
  });
  it('BYOK mode → the caller key (never the platform key) reaches Anthropic', async () => {
    const r = await invoke(claudeChat, { method: 'POST', as: 'A', body: { message: 'hi', apiKey: 'sk-ant-caller-own', credentialMode: 'byok', stream: false } });
    expect(r.status).toBe(200);
    expect(r.body.response).toBe('claude says hi');
    const init = mockFetch.mock.calls[0][1] as { headers: Record<string, string> };
    expect(init.headers['x-api-key']).toBe('sk-ant-caller-own');
    expect(JSON.stringify(mockFetch.mock.calls)).not.toContain('PLATFORM-KEY-MUST-NOT-LEAVE');
  });
  it('BYOK mode without a key → 400 and no provider call', async () => {
    const r = await invoke(claudeChat, { method: 'POST', as: 'A', body: { message: 'hi', credentialMode: 'byok', stream: false } });
    expect(r.status).toBe(400);
    expect(mockFetch).not.toHaveBeenCalled();
  });
  it('unauthenticated → 401 and nothing runs', async () => {
    const r = await invoke(claudeChat, { method: 'POST', as: null, body: { message: 'hi', credentialMode: 'platform' } });
    expect(r.status).toBe(401);
    expect(mockGuardAi).not.toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe('SEC91-D3 gpt-chat platform-key moderation', () => {
  it('no BYOK key → 400 BEFORE the platform-key moderation LLM call or the guard', async () => {
    const r = await invoke(gptChat, { method: 'POST', as: 'A', body: { message: 'hello', stream: false } });
    expect(r.status).toBe(400);
    expect(mockModerate).not.toHaveBeenCalled();
    expect(mockGuardAi).not.toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();
  });
  it('with a BYOK key: guard → moderation → provider, using the caller key', async () => {
    const r = await invoke(gptChat, { method: 'POST', as: 'A', body: { message: 'hello', apiKey: 'sk-caller-own', stream: false } });
    expect(r.status).toBe(200);
    expect(mockModerate).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(mockFetch.mock.calls[0])).toContain('sk-caller-own');
  });
});

// ── D9: provider requests are time-bounded ─────────────────────────────────
describe('SEC91-D9 provider requests carry an AbortSignal', () => {
  const signalOf = (i: number) => (mockFetch.mock.calls[i][1] as { signal?: unknown })?.signal;
  it('claude-chat', async () => {
    await invoke(claudeChat, { method: 'POST', as: 'A', body: { message: 'hi', apiKey: 'sk-ant-caller-own', credentialMode: 'byok', stream: false } });
    expect(providerCalls()[0]).toContain('api.anthropic.com');
    expect(signalOf(0)).toBeInstanceOf(AbortSignal);
  });
  it('gpt-chat', async () => {
    await invoke(gptChat, { method: 'POST', as: 'A', body: { message: 'hello', apiKey: 'sk-caller-own', stream: false } });
    expect(providerCalls()[0]).toContain('api.openai.com');
    expect(signalOf(0)).toBeInstanceOf(AbortSignal);
  });
  it('voice/transcribe (Whisper)', async () => {
    await invoke(transcribe, { method: 'POST', as: 'A', body: { audioFile: 'data:audio/webm;base64,AAAA', provider: 'whisper' } });
    expect(providerCalls()[0]).toContain('/audio/transcriptions');
    expect(signalOf(0)).toBeInstanceOf(AbortSignal);
  });
  it('voice/transcribe (AssemblyAI upload, create, poll)', async () => {
    process.env.ASSEMBLYAI_API_KEY = 'test-only-assembly';
    mockFetch.mockImplementation(async (url: any) => ({
      ok: true, status: 200, text: async () => '',
      json: async () => (String(url).endsWith('/upload') ? { upload_url: 'u' }
        : String(url).endsWith('/transcript') ? { id: 't1' }
          : { status: 'completed', text: 'done', audio_duration: 2 }),
    }) as never);
    jest.useFakeTimers();
    try {
      const p = invoke(transcribe, { method: 'POST', as: 'A', body: { audioFile: 'data:audio/webm;base64,AAAA', provider: 'assemblyai' } });
      await jest.advanceTimersByTimeAsync(2_000);
      const r = await p;
      expect(r.status).toBe(200);
    } finally {
      jest.useRealTimers();
    }
    expect(mockFetch.mock.calls.length).toBeGreaterThanOrEqual(3);
    for (let i = 0; i < mockFetch.mock.calls.length; i++) expect(signalOf(i)).toBeInstanceOf(AbortSignal);
  });
});
