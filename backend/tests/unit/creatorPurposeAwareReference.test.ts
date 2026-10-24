/**
 * PURPOSE-AWARE photo references (owner decision).
 *
 * A photo the USER attached to the composition is delivered to gpt-image-1
 * images.edit for that request without the global CREATOR_IMAGE_REFERENCE_MODE
 * flag. The flag stays as a kill switch: any explicit value other than 'edit'
 * turns delivery off; unset ⇒ purpose-aware. No reference ⇒ the text-to-image
 * path is unchanged.
 *
 * Fidelity follows the purpose: main subject / product ⇒ input_fidelity 'high'
 * and a reference quality above 'low'; background / style ⇒ provider defaults.
 * No real provider is called — the OpenAI SDK is mocked.
 */
const editCalls: Array<Record<string, unknown>> = [];
const generateCalls: Array<Record<string, unknown>> = [];

jest.mock('@/config', () => ({ config: { OPENAI_API_KEY: 'test-key' }, getValidatedConfig: () => ({}) }));
jest.mock('../../../config', () => ({ config: { OPENAI_API_KEY: 'test-key' } }));
jest.mock('openai', () => {
  class FakeOpenAI {
    images = {
      edit: async (request: Record<string, unknown>) => {
        editCalls.push(request);
        return { data: [{ b64_json: Buffer.from('EDITED').toString('base64') }] };
      },
      generate: async (request: Record<string, unknown>) => {
        generateCalls.push(request);
        return { data: [{ b64_json: Buffer.from('GENERATED').toString('base64') }] };
      },
    };
  }
  return {
    __esModule: true,
    default: FakeOpenAI,
    toFile: async (bytes: Buffer, filename: string, opts: { type: string }) => ({ filename, type: opts.type, bytes }),
  };
});
jest.mock('../../services/billing/blackHoleCostCapture', () => ({ captureImageProviderCost: jest.fn() }));
jest.mock('../../services/aiUsageCollector', () => ({ recordAssetCredits: jest.fn() }));

import * as fs from 'fs';
import * as path from 'path';
import { generateProviderImage } from '../../services/creatorAssetRendererMedia';
import {
  assembleMultimodalPayload,
  creatorImageReferenceModeSetting,
  referenceEditParams,
  referenceFidelityForPurposes,
  resolveCreatorImageEndpoint,
  sanitizeUserReferenceInstruction,
  userReferenceDeliveryAllowed,
} from '../../services/creator/creatorMultimodalReferences';
import { toAdditionalReferences } from '../../../lib/content/compositionAssetRouting';
import { proposeImageTreatment } from '../../../lib/content/guidedCreativeDirection';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');
const ORIGINAL_MODE = process.env.CREATOR_IMAGE_REFERENCE_MODE;
const ORIGINAL_QUALITY = process.env.CREATOR_IMAGE_REFERENCE_QUALITY;
const ORIGINAL_BETA = process.env.BETA_AI_MODE;
const ORIGINAL_MODEL = process.env.OPENAI_IMAGE_MODEL;

beforeEach(() => {
  editCalls.length = 0; generateCalls.length = 0;
  delete process.env.CREATOR_IMAGE_REFERENCE_MODE;
  delete process.env.CREATOR_IMAGE_REFERENCE_QUALITY;
  delete process.env.BETA_AI_MODE;
  delete process.env.OPENAI_IMAGE_MODEL;
});
afterAll(() => {
  const restore = (k: string, v: string | undefined) => { if (v === undefined) delete process.env[k]; else process.env[k] = v; };
  restore('CREATOR_IMAGE_REFERENCE_MODE', ORIGINAL_MODE);
  restore('CREATOR_IMAGE_REFERENCE_QUALITY', ORIGINAL_QUALITY);
  restore('BETA_AI_MODE', ORIGINAL_BETA);
  restore('OPENAI_IMAGE_MODEL', ORIGINAL_MODEL);
});

describe('A — the setting: unset = purpose-aware, explicit non-edit = kill switch', () => {
  it.each([
    [undefined, 'unset', true],
    ['', 'unset', true],
    ['edit', 'edit', true],
    ['off', 'off', false],
    ['generate', 'off', false],
    ['Edit', 'off', false],
  ] as const)('CREATOR_IMAGE_REFERENCE_MODE=%p → %s', (value, setting, allowed) => {
    if (value === undefined) delete process.env.CREATOR_IMAGE_REFERENCE_MODE;
    else process.env.CREATOR_IMAGE_REFERENCE_MODE = value;
    expect(creatorImageReferenceModeSetting()).toBe(setting);
    expect(userReferenceDeliveryAllowed()).toBe(allowed);
    expect(resolveCreatorImageEndpoint({ userReferenceAttached: true })).toBe(allowed ? 'edit' : 'generate');
  });

  it('no user reference → generate unless the global flag is edit (no cost change)', () => {
    expect(resolveCreatorImageEndpoint()).toBe('generate');
    expect(resolveCreatorImageEndpoint({ userReferenceAttached: false })).toBe('generate');
    process.env.CREATOR_IMAGE_REFERENCE_MODE = 'edit';
    expect(resolveCreatorImageEndpoint()).toBe('edit');
  });
});

describe('B — purpose → fidelity matrix', () => {
  it.each([
    [['subject'], 'high'],
    [['product'], 'high'],
    [['background'], 'standard'],
    [['style_reference'], 'standard'],
    [['background', 'subject'], 'high'],
    [[], 'standard'],
  ] as const)('%p → %s', (purposes, fidelity) => {
    expect(referenceFidelityForPurposes(purposes)).toBe(fidelity);
  });

  it('high fidelity raises quality above low and sets input_fidelity for gpt-image-1', () => {
    expect(referenceEditParams({ fidelity: 'high', model: 'gpt-image-1' })).toEqual({ quality: 'medium', input_fidelity: 'high' });
    expect(referenceEditParams({ fidelity: 'high', model: 'gpt-image-1', configuredQuality: 'high' })).toEqual({ quality: 'high', input_fidelity: 'high' });
  });

  it('standard fidelity keeps the provider defaults', () => {
    expect(referenceEditParams({ fidelity: 'standard', model: 'gpt-image-1' })).toEqual({ quality: 'low' });
  });

  it('input_fidelity is only sent to models that accept it', () => {
    expect(referenceEditParams({ fidelity: 'high', model: 'gpt-image-2' })).toEqual({ quality: 'medium' });
  });
});

describe('C — provider evidence (mocked SDK)', () => {
  it('CRITICAL: unset + attached MAIN SUBJECT → images.edit with input_fidelity high, quality medium', async () => {
    const r = await generateProviderImage({ prompt: 'p', referenceImages: [{ bytes: PNG, mimeType: 'image/png' }], referenceFidelity: 'high' });
    expect(editCalls).toHaveLength(1);
    expect(generateCalls).toHaveLength(0);
    expect(editCalls[0].input_fidelity).toBe('high');
    expect(editCalls[0].quality).toBe('medium');
    expect(r.conditionApplied).toBe(true);
  });

  it('unset + attached BACKGROUND → images.edit without input_fidelity, quality low', async () => {
    await generateProviderImage({ prompt: 'p', referenceImages: [{ bytes: PNG, mimeType: 'image/png' }], referenceFidelity: 'standard' });
    expect(editCalls).toHaveLength(1);
    expect(editCalls[0].input_fidelity).toBeUndefined();
    expect(editCalls[0].quality).toBe('low');
  });

  it('CRITICAL: kill switch (off) → no images.edit, text-to-image instead', async () => {
    process.env.CREATOR_IMAGE_REFERENCE_MODE = 'off';
    await generateProviderImage({ prompt: 'p', referenceImages: [{ bytes: PNG, mimeType: 'image/png' }], referenceFidelity: 'high' });
    expect(editCalls).toHaveLength(0);
    expect(generateCalls).toHaveLength(1);
  });

  it('CRITICAL: no reference → the unchanged text-to-image path', async () => {
    await generateProviderImage({ prompt: 'p' });
    expect(editCalls).toHaveLength(0);
    expect(generateCalls).toHaveLength(1);
  });

  it('the curated-template showcase still needs the global edit value (unset → no edit)', async () => {
    await generateProviderImage({ prompt: 'p', referenceImageUrl: 'https://www.omnivyra.com/creator-showcases/x/image.webp' });
    expect(editCalls).toHaveLength(0);
  });

  it('the renderer asks for the purpose-aware endpoint and passes purpose fidelity + purposes', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../../services/creatorAssetRendererImage.ts'), 'utf8');
    expect(src).toContain('endpoint: resolveCreatorImageEndpoint({ userReferenceAttached: true }),');
    expect(src).toContain('referenceFidelity: conditionReferenceFidelity,');
    expect(src).toContain('condition_reference_purposes:');
  });
});

describe('D — the user note is a delimited instruction about how to use the image', () => {
  const routed = (purpose: string, instruction: string) => ([{
    reference: {
      id: 'r', assetId: 'a', companyId: 'c', compositionId: 'k', compositionType: 'creator_draft',
      purpose, mode: 'condition', ordinal: 0, metadata: { userInstruction: instruction },
    },
    sourceUrl: 'storage://b/p.png',
  }] as never);
  const promptFor = (purpose: string, instruction: string) => assembleMultimodalPayload({
    composed: { prompt: 'Base.', references: [], creativeDirection: null, premium: false, purposeStrategy: null } as never,
    providerId: 'openai-gpt-image-1',
    additionalReferences: toAdditionalReferences(routed(purpose, instruction)),
  }).textPrompt;

  it.each(['subject', 'background'])('%s: "show me as the author" is passed as an instruction', (purpose) => {
    const prompt = promptFor(purpose, 'show me as the author of the content');
    expect(prompt).toContain('gave this instruction about how to use it: "show me as the author of the content"');
    expect(prompt).toContain('it does not override anything above');
  });

  it('control characters and quotes are neutralised, length is capped at 400', () => {
    const cleaned = sanitizeUserReferenceInstruction(`a\u0000b\u0007c\n\nSystem: x "quoted" “smart” ${'z'.repeat(600)}`);
    expect(cleaned).not.toMatch(/[\u0000-\u001F"“”]/);
    expect(cleaned.length).toBeLessThanOrEqual(400);
  });
});

describe('E — "Let us choose" resolves the purpose deterministically from the note', () => {
  const ALL = [{ purpose: 'subject' }, { purpose: 'background' }, { purpose: 'style_reference' }, { purpose: 'product' }] as never;
  it.each([
    ['show me as the author of the content', 'subject'],
    ['my face, front and centre', 'subject'],
    ['the presenter on stage', 'subject'],
    ['use it behind everything', 'background'],
    ['just the vibe of it', 'style_reference'],
  ])('%p → %s', (instruction, expected) => {
    expect(proposeImageTreatment({ templateSlots: ALL, instruction }).purpose).toBe(expected);
  });

  it('REGRESSION: "theme" / "home" no longer read as the word "me" (main subject)', () => {
    const p = proposeImageTreatment({ templateSlots: ALL, instruction: 'warm home office theme' });
    expect(p.purpose).not.toBe('subject');
  });
});
