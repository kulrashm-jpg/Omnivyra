/**
 * SEC91-D5 — an image generation the caller has given up on must not keep
 * running (and retrying, and billing) in the background.
 *
 * generateProviderImage races the OpenAI SDK call against a wall-clock budget
 * (AI_IMAGE_TIMEOUT_MS). Before this fix the losing SDK call was never
 * cancelled, and the SDK retries timeouts by default — so one abandoned image
 * could be generated up to three more times. Each call now carries an
 * AbortSignal that is aborted the moment the race settles.
 */
export {};

const generateOptions: Array<{ timeout?: number; signal?: AbortSignal }> = [];
let generateBehaviour: 'hang' | 'ok' = 'hang';

jest.mock('@/config', () => ({ config: { OPENAI_API_KEY: 'test-key' }, getValidatedConfig: () => ({}) }));
jest.mock('../../../config', () => ({ config: { OPENAI_API_KEY: 'test-key' } }));
jest.mock('openai', () => {
  class FakeOpenAI {
    images = {
      edit: async () => ({ data: [] }),
      generate: (_request: Record<string, unknown>, options: { timeout?: number; signal?: AbortSignal }) => {
        generateOptions.push(options ?? {});
        if (generateBehaviour === 'ok') {
          return Promise.resolve({ data: [{ b64_json: Buffer.from('GENERATED').toString('base64') }] });
        }
        return new Promise(() => { /* upstream never answers */ });
      },
    };
  }
  return { __esModule: true, default: FakeOpenAI, toFile: async () => ({}) };
});
jest.mock('../../db/writeOwner', () => ({ ownedDbTable: () => ({}) }));
jest.mock('../../db/supabaseClient', () => ({ supabase: { from: () => ({}), rpc: jest.fn(), storage: { from: () => ({}) } } }));
jest.mock('../../services/billing/blackHoleCostCapture', () => ({ captureImageProviderCost: jest.fn() }));
jest.mock('../../services/aiUsageCollector', () => ({ recordAssetCredits: jest.fn() }));

/* eslint-disable @typescript-eslint/no-var-requires */
const { generateProviderImage } = require('../../services/creatorAssetRendererMedia');
const { AI_IMAGE_TIMEOUT_MS } = require('../../services/creatorAssetRendererContracts');
/* eslint-enable @typescript-eslint/no-var-requires */

const ORIGINAL_MODEL = process.env.OPENAI_IMAGE_MODEL;
beforeEach(() => {
  generateOptions.length = 0;
  delete process.env.OPENAI_IMAGE_MODEL;
  delete process.env.BETA_AI_MODE;
});
afterAll(() => { if (ORIGINAL_MODEL !== undefined) process.env.OPENAI_IMAGE_MODEL = ORIGINAL_MODEL; });

describe('SEC91-D5 generateProviderImage cancels the abandoned provider call', () => {
  it('when the wall-clock budget wins, the SDK call is aborted (no background retries)', async () => {
    generateBehaviour = 'hang';
    jest.useFakeTimers();
    try {
      const pending = generateProviderImage({ prompt: 'a lighthouse at dawn' });
      await jest.advanceTimersByTimeAsync(AI_IMAGE_TIMEOUT_MS + 10);
      const result = await pending;
      expect(result.image).toBeNull();
    } finally {
      jest.useRealTimers();
    }
    expect(generateOptions).toHaveLength(1);
    expect(generateOptions[0].signal).toBeInstanceOf(AbortSignal);
    expect(generateOptions[0].signal?.aborted).toBe(true);
    expect(generateOptions[0].timeout).toBe(AI_IMAGE_TIMEOUT_MS);
  });

  it('a successful generation is returned unchanged', async () => {
    generateBehaviour = 'ok';
    const result = await generateProviderImage({ prompt: 'a lighthouse at dawn' });
    expect(result.image?.buffer.toString()).toBe('GENERATED');
    expect(generateOptions[0].timeout).toBe(AI_IMAGE_TIMEOUT_MS);
  });
});
