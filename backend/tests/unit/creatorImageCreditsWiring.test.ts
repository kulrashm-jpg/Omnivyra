/**
 * Owner ruling 2026-11-11 (BLOCKING, money): the creator gpt-image flow charges
 * image credits BEFORE the provider call. generateProviderImage reserves per
 * paid call, settles the call that delivers, releases the ones that do not, and
 * makes NO provider call when the reservation is refused.
 */
const editCalls: unknown[] = [];
const generateCalls: unknown[] = [];
let generateOutcomes: Array<'image' | 'empty' | 'throw_model' | 'throw_other'> = [];

jest.mock('@/config', () => ({ config: { OPENAI_API_KEY: 'test-key' }, getValidatedConfig: () => ({}) }), { virtual: true });
jest.mock('../../../config', () => ({ config: { OPENAI_API_KEY: 'test-key' } }));
jest.mock('openai', () => {
  class FakeOpenAI {
    images = {
      edit: async (r: unknown) => { editCalls.push(r); return { data: [{ b64_json: Buffer.from('E').toString('base64') }] }; },
      generate: async (r: unknown) => {
        generateCalls.push(r);
        const o = generateOutcomes.shift() ?? 'image';
        if (o === 'throw_model') throw Object.assign(new Error('The model does not exist'), { status: 404, code: 'model_not_found' });
        if (o === 'throw_other') throw new Error('boom');
        if (o === 'empty') return { data: [] };
        return { data: [{ b64_json: Buffer.from('G').toString('base64') }] };
      },
    };
  }
  return { __esModule: true, default: FakeOpenAI, toFile: async (b: Buffer, n: string) => ({ n, b }) };
});
jest.mock('../../services/billing/blackHoleCostCapture', () => ({ captureImageProviderCost: jest.fn(async () => undefined) }));

const reserves: Array<Record<string, unknown>> = [];
const settles: string[] = [];
const releases: Array<[string, string]> = [];
let refuse: string | null = null;
jest.mock('../../services/billing/imageCredits', () => ({
  reserveImageCredits: jest.fn(async (i: Record<string, unknown>) => {
    reserves.push(i);
    if (refuse) return { ok: false, reason: refuse };
    return { ok: true, billingOperationId: `op-${reserves.length}`, creditsReserved: 5 };
  }),
  settleImageCredits: jest.fn(async ({ billingOperationId }: { billingOperationId: string }) => { settles.push(billingOperationId); return { ok: true, creditsCharged: 5 }; }),
  releaseImageCredits: jest.fn(async ({ billingOperationId, reason }: { billingOperationId: string; reason: string }) => { releases.push([billingOperationId, reason]); return { ok: true }; }),
}));

import { generateProviderImage } from '../../services/creatorAssetRendererMedia';

const ORG = '00000000-0000-4000-8000-0000000000aa';
const go = (org: string | null = ORG) => generateProviderImage({ prompt: 'a cat', attribution: { organizationId: org, campaignId: 'c1', userId: 'u1' } });

beforeEach(() => {
  editCalls.length = 0; generateCalls.length = 0; generateOutcomes = [];
  reserves.length = 0; settles.length = 0; releases.length = 0; refuse = null;
  delete process.env.OPENAI_IMAGE_MODEL;
});

it('success: ONE reservation before the call, settled once, nothing released', async () => {
  const r = await go();
  expect(r.image).not.toBeNull();
  expect(generateCalls).toHaveLength(1);
  expect(reserves).toHaveLength(1);
  expect(reserves[0]).toMatchObject({ organizationId: ORG, provider: 'openai', model: 'gpt-image-1.5', quality: 'low' });
  expect(settles).toEqual(['op-1']);
  expect(releases).toEqual([]);
});

it.each(['insufficient_credits', 'not_priced', 'org_blocked', 'unavailable'])('refused (%s): NO provider call, no settle', async (reason) => {
  refuse = reason;
  const r = await go();
  expect(r.image).toBeNull();
  expect(r.fallbackReason).toBe(`image credits: ${reason}`);
  expect(generateCalls).toHaveLength(0);
  expect(editCalls).toHaveLength(0);
  expect(settles).toEqual([]);
});

it('no organization to charge: NO provider call (fail closed)', async () => {
  const r = await go(null);
  expect(r.image).toBeNull();
  expect(r.fallbackReason).toBe('image credits: no_billing_org');
  expect(generateCalls).toHaveLength(0);
  expect(reserves).toHaveLength(0);
});

it('provider failure: the reservation is RELEASED, nothing settled', async () => {
  generateOutcomes = ['throw_other'];
  const r = await go();
  expect(r.image).toBeNull();
  expect(releases).toEqual([['op-1', 'generate failed']]);
  expect(settles).toEqual([]);
});

it('provider returned no image (each model): every reservation released, nothing settled', async () => {
  generateOutcomes = ['empty', 'empty'];
  const r = await go();
  expect(r.image).toBeNull();
  expect(generateCalls).toHaveLength(2);
  expect(releases.map(([id]) => id)).toEqual(['op-1', 'op-2']);
  expect(settles).toEqual([]);
});

it('model unavailable then fallback succeeds: first call released, second settled - exactly ONE charge', async () => {
  generateOutcomes = ['throw_model', 'image'];
  const r = await go();
  expect(r.image).not.toBeNull();
  expect(generateCalls).toHaveLength(2);
  expect(reserves).toHaveLength(2);
  expect(new Set(reserves.map((x) => x.idempotencyKey)).size).toBe(2); // one key per paid call
  expect(releases.map(([id]) => id)).toEqual(['op-1']);
  expect(settles).toEqual(['op-2']);
});
