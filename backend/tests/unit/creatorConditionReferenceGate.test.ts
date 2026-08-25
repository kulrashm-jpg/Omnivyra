/**
 * The CONDITION feature gate — release safety.
 *
 * Reference-conditioned generation has been behind CREATOR_IMAGE_REFERENCE_MODE
 * since the img2img spike, but the canonical CONDITION lane arrived without
 * consulting it. That was harmless for exactly as long as nothing called the
 * resolver; once the lane got a runtime caller, an attached image would reach
 * `images.edit` in a release whose intended state is OFF — and nothing anywhere
 * would have said so.
 *
 * So this suite asserts the gate the way a release depends on it: by counting
 * provider invocations, bytes and storage reads. A test that reads a boolean
 * back would have passed against the broken build too.
 *
 * WHAT THE GATE MUST NOT DO
 * -------------------------
 * It governs DELIVERY only. Upload, canonical asset persistence, reference
 * persistence, routing and COMPOSE placement all continue while it is off —
 * otherwise turning it on later would need a backfill, and a deterministic logo
 * would disappear for a reason that has nothing to do with it.
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
    toFile: async (bytes: Buffer, filename: string, opts: { type: string }) =>
      ({ filename, type: opts.type, bytes }),
  };
});

/* ── Storage + rows ─────────────────────────────────────────────────────── */
const objects = new Map<string, Buffer>();
let storageReads = 0;
const assets: Array<Record<string, unknown>> = [];
const refs: Array<Record<string, unknown>> = [];
const SOURCE_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);

function rowsFor(table: string) { return table === 'canonical_media_assets' ? assets : refs; }
function builderFor(table: string) {
  const f: Record<string, unknown> = {};
  const b: Record<string, unknown> = {
    select: () => b, order: () => b, limit: () => b,
    eq(c: string, v: unknown) { f[c] = v; return b; },
    maybeSingle: () => Promise.resolve({
      data: rowsFor(table).find((r) => Object.entries(f).every(([k, v]) => r[k] === v)) ?? null, error: null }),
    single: () => Promise.resolve({ data: null, error: null }),
    then: (res: (r: { data: unknown[]; error: null }) => unknown) =>
      Promise.resolve(res({
        data: rowsFor(table).filter((r) => Object.entries(f).every(([k, v]) => r[k] === v)), error: null })),
  };
  return b;
}
jest.mock('../../db/writeOwner', () => ({ ownedDbTable: (t: string) => builderFor(t) }));
jest.mock('../../db/supabaseClient', () => ({
  supabase: {
    from: (t: string) => builderFor(t),
    rpc: jest.fn(),
    storage: {
      from: (bucket: string) => ({
        async download(objectPath: string) {
          storageReads += 1;
          const key = `${bucket}/${objectPath}`;
          if (!objects.has(key)) return { data: null, error: { message: 'missing' } };
          const buf = objects.get(key)!;
          return {
            data: { arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) },
            error: null,
          };
        },
      }),
    },
  },
}));

jest.mock('../../services/billing/blackHoleCostCapture', () => ({ captureImageProviderCost: jest.fn() }));
jest.mock('../../services/aiUsageCollector', () => ({ recordAssetCredits: jest.fn() }));

import * as fs from 'fs';
import * as path from 'path';
import { generateProviderImage } from '../../services/creatorAssetRendererMedia';
import { resolveCompositionAssets } from '../../services/compositionAssetResolutionService';
import { resolveConditionReferenceBytes } from '../../services/compositionAssetConditionService';
import { buildComposeLayers } from '../../services/compositionAssetComposeService';
import {
  creatorImageReferenceModeEnabled,
  resolveCreatorImageEndpoint,
  resolveProviderCapabilities,
} from '../../services/creator/creatorMultimodalReferences';
import type { TemplateAssetSlot } from '../../../lib/content/compositionAssetRouting';
import type { CompositionAssetPurpose, CompositionAssetMode } from '../../../lib/content/compositionAssetReference';

const CO = 'company-a';
const COMP = 'composition-gate';
const BUCKET = 'media-images';
const PLACEMENT = { top: 0.1, left: 0.1, maxWidth: 0.2, maxHeight: 0.2, fit: 'contain' as const };
let seq = 0;

function seedAsset(): string {
  const n = ++seq;
  const storagePath = `uploads/${n}.png`;
  const id = `asset-${n}`;
  assets.push({
    id, company_id: CO, created_by: 'u1',
    storage_bucket: BUCKET, storage_path: storagePath, mime_type: 'image/png',
    byte_size: 1024, width: 8, height: 8, original_filename: null, source_url: null,
    origin: 'upload', lifecycle_state: 'ready', metadata: {},
    checksum_sha256: null, created_at: 'T0', updated_at: 'T0',
  });
  objects.set(`${BUCKET}/${storagePath}`, SOURCE_PNG);
  return id;
}

function seedRef(assetId: string, purpose: CompositionAssetPurpose, mode: CompositionAssetMode, ordinal = 0): void {
  refs.push({
    id: `ref-${++seq}`, company_id: CO, composition_type: 'creator-composition',
    composition_id: COMP, asset_id: assetId, purpose, mode, ordinal, metadata: {},
    created_at: 'T0', updated_at: 'T0',
  });
}

const resolve = (slots: readonly TemplateAssetSlot[]) => resolveCompositionAssets({
  companyId: CO,
  compositionType: 'creator-composition',
  compositionId: COMP,
  templateSlots: slots,
  // Capacity is asked of the reference-capable endpoint on purpose: the gate
  // governs DELIVERY, not whether a reference may be stored or routed.
  provider: resolveProviderCapabilities('openai-gpt-image-1', 'edit'),
});

/**
 * Exactly what the image renderer does: resolve condition bytes for whichever
 * endpoint the gate permits, then hand whatever came back to the provider.
 */
async function renderConditionLane(renderer: Awaited<ReturnType<typeof resolve>>['renderer']) {
  const resolved = await resolveConditionReferenceBytes({
    companyId: renderer.conditionPlan.companyId,
    condition: renderer.conditionPlan.condition,
    providerId: 'openai-gpt-image-1',
    endpoint: resolveCreatorImageEndpoint(),
  });
  await generateProviderImage({
    prompt: 'a prompt',
    referenceImages: resolved.references.map((r) => ({ bytes: r.bytes, mimeType: r.mimeType })),
  });
  return resolved;
}

const ORIGINAL_MODE = process.env.CREATOR_IMAGE_REFERENCE_MODE;
const ORIGINAL_BETA = process.env.BETA_AI_MODE;

beforeEach(() => {
  editCalls.length = 0; generateCalls.length = 0;
  assets.length = 0; refs.length = 0; objects.clear();
  storageReads = 0; seq = 0;
  delete process.env.BETA_AI_MODE;
  delete process.env.CREATOR_IMAGE_REFERENCE_MODE;
});
afterAll(() => {
  if (ORIGINAL_MODE === undefined) delete process.env.CREATOR_IMAGE_REFERENCE_MODE;
  else process.env.CREATOR_IMAGE_REFERENCE_MODE = ORIGINAL_MODE;
  if (ORIGINAL_BETA !== undefined) process.env.BETA_AI_MODE = ORIGINAL_BETA;
});

/* ── A. Policy ───────────────────────────────────────────────────────────── */

describe('A — one gate, and only the exact value opens it', () => {
  it.each([
    ['unset', undefined],
    ['empty', ''],
    ['off', 'off'],
    ['OFF', 'OFF'],
    ['Edit', 'Edit'],
    ['EDIT', 'EDIT'],
    ['leading space', ' edit'],
    ['trailing space', 'edit '],
    ['surrounded', ' edit '],
    ['true', 'true'],
    ['1', '1'],
  ])('%s → OFF', (_label, value) => {
    if (value === undefined) delete process.env.CREATOR_IMAGE_REFERENCE_MODE;
    else process.env.CREATOR_IMAGE_REFERENCE_MODE = value;
    expect(creatorImageReferenceModeEnabled()).toBe(false);
    expect(resolveCreatorImageEndpoint()).toBe('generate');
  });

  it('exactly `edit` → ON', () => {
    process.env.CREATOR_IMAGE_REFERENCE_MODE = 'edit';
    expect(creatorImageReferenceModeEnabled()).toBe(true);
    expect(resolveCreatorImageEndpoint()).toBe('edit');
  });

  it('the comparison is exact — matching the repository contract, not widened', () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, '../../services/creator/creatorMultimodalReferences.ts'), 'utf8');
    // No toLowerCase()/trim() smuggled in: widening the accepted spellings would
    // be a behaviour change to a gate whose whole job is to stay shut.
    expect(src).toMatch(/process\.env\.CREATOR_IMAGE_REFERENCE_MODE === 'edit'/);
    expect(src).not.toMatch(/CREATOR_IMAGE_REFERENCE_MODE[^\n]*(toLowerCase|trim)\(/);
  });
});

/* ── B. Static audit (§16) ───────────────────────────────────────────────── */

describe('B — one environment read, no bypass', () => {
  /**
   * Both guards below are whole-tree assertions — "no OTHER module does X" can
   * only be proven by looking at every module. That is ~3,000 files, and reading
   * them is blocking synchronous I/O inside one Jest worker.
   *
   * So the scan runs ONCE, in beforeAll, and keeps only the two answers rather
   * than the file contents. The first version walked and read the whole tree
   * TWICE (~10s of blocking I/O), which was enough to starve a sibling worker's
   * 50ms timing budget and make an unrelated chaos-harness test flake. A guard
   * that destabilises the suite it runs in is not a good guard.
   */
  const envReadFiles: string[] = [];
  const editCallSites: Array<{ path: string; gated: boolean }> = [];

  beforeAll(() => {
    const stack = [path.resolve(__dirname, '../../services')];
    while (stack.length > 0) {
      const dir = stack.pop()!;
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== 'tests') stack.push(full);
          continue;
        }
        if (!entry.name.endsWith('.ts')) continue;
        const src = fs.readFileSync(full, 'utf8');
        const posix = full.replace(/\\/g, '/');
        if (/process\.env\.CREATOR_IMAGE_REFERENCE_MODE/.test(src)) envReadFiles.push(posix);
        if (/client\.images\.edit\(|v1\/images\/edits/.test(src)) {
          editCallSites.push({
            path: posix,
            gated: /creatorImageReferenceModeEnabled\(\)|referenceModeEnabled/.test(src),
          });
        }
      }
    }
  });

  it('CRITICAL: exactly ONE runtime read of the environment variable', () => {
    expect(envReadFiles).toEqual([
      expect.stringContaining('creator/creatorMultimodalReferences.ts'),
    ]);
  });

  it('every images.edit call site sits behind the gate', () => {
    // A call site that never consults the gate is a bypass by definition.
    expect(editCallSites.length).toBeGreaterThan(0);
    expect(editCallSites.filter((site) => !site.gated)).toEqual([]);
  });
});

/* ── C. Provider evidence, gate OFF (§7) ─────────────────────────────────── */

describe('C — gate OFF: zero calls, zero bytes, zero reads', () => {
  it('CRITICAL: a condition reference never reaches images.edit', async () => {
    const subject = seedAsset();
    seedRef(subject, 'subject', 'condition');
    const { renderer } = await resolve([{ purpose: 'subject' }]);

    const resolved = await renderConditionLane(renderer);

    expect(editCalls).toHaveLength(0);
    expect(generateCalls).toHaveLength(1);
    expect(resolved.references).toHaveLength(0);
    // Never fetched: an unsendable reference costs no storage round trip.
    expect(storageReads).toBe(0);
  });

  it('the reference is DEGRADED, not discarded, and the result says so', async () => {
    const subject = seedAsset();
    seedRef(subject, 'subject', 'condition');
    const { renderer } = await resolve([{ purpose: 'subject' }]);

    const resolved = await renderConditionLane(renderer);

    expect(resolved.degradedToText).toBe(true);
    expect(resolved.rejected).toEqual([]);   // refused ≠ degraded
  });

  it('DEFENCE IN DEPTH: bytes handed straight to the provider are still refused', async () => {
    await generateProviderImage({
      prompt: 'p',
      referenceImages: [{ bytes: SOURCE_PNG, mimeType: 'image/png' }],
    });
    expect(editCalls).toHaveLength(0);
    expect(generateCalls).toHaveLength(1);
  });

  it('the reference stays durably resolved and routed while delivery is off', async () => {
    const subject = seedAsset();
    seedRef(subject, 'subject', 'condition');
    const { renderer, rejected } = await resolve([{ purpose: 'subject' }]);

    // Persistence and routing are untouched, so enabling the flag later needs
    // no backfill.
    expect(rejected).toEqual([]);
    expect(renderer.conditionPlan.condition).toHaveLength(1);
  });
});

/* ── D. Provider evidence, gate ON (§8) ──────────────────────────────────── */

describe('D — gate ON: the unchanged PR #60 path', () => {
  beforeEach(() => { process.env.CREATOR_IMAGE_REFERENCE_MODE = 'edit'; });

  it('CRITICAL: exactly one images.edit invocation, carrying the real bytes', async () => {
    const subject = seedAsset();
    seedRef(subject, 'subject', 'condition');
    const { renderer } = await resolve([{ purpose: 'subject' }]);

    const resolved = await renderConditionLane(renderer);

    expect(editCalls).toHaveLength(1);
    expect(generateCalls).toHaveLength(0);
    expect(resolved.degradedToText).toBe(false);
    expect(storageReads).toBe(1);
    const sent = editCalls[0].image as { bytes: Buffer };
    expect(sent.bytes.equals(SOURCE_PNG)).toBe(true);
  });

  it('TWO references produce ONE invocation carrying both', async () => {
    const a = seedAsset();
    const b = seedAsset();
    seedRef(a, 'subject', 'condition', 0);
    seedRef(b, 'background', 'condition', 1);
    const { renderer } = await resolve([{ purpose: 'subject' }, { purpose: 'background' }]);

    const resolved = await renderConditionLane(renderer);

    expect(resolved.references).toHaveLength(2);
    expect(editCalls).toHaveLength(1);
    expect((editCalls[0].image as unknown[]).length).toBe(2);
    expect(storageReads).toBe(2);
  });
});

/* ── E. COMPOSE isolation (§9) ───────────────────────────────────────────── */

describe('E — the gate governs CONDITION only', () => {
  const mixedSlots: TemplateAssetSlot[] = [
    { purpose: 'subject' },
    { purpose: 'logo', mode: 'compose', placement: PLACEMENT },
  ];

  async function renderBothLanes(renderer: Awaited<ReturnType<typeof resolve>>['renderer']) {
    const composed = await buildComposeLayers({
      companyId: renderer.composePlan.companyId,
      compose: renderer.composePlan.compose,
      templateSlots: renderer.composePlan.templateSlots,
      width: 500,
      height: 500,
    });
    const conditioned = await renderConditionLane(renderer);
    return { composed, conditioned };
  }

  it('CRITICAL: gate OFF — the logo still composes while the subject degrades', async () => {
    const subject = seedAsset();
    const logo = seedAsset();
    seedRef(subject, 'subject', 'condition', 0);
    seedRef(logo, 'logo', 'compose', 1);
    const { renderer } = await resolve(mixedSlots);

    const { composed, conditioned } = await renderBothLanes(renderer);

    expect(composed.layers).toHaveLength(1);
    expect(composed.layers[0].assetId).toBe(logo);
    expect(editCalls).toHaveLength(0);
    expect(conditioned.references).toHaveLength(0);
    expect(conditioned.degradedToText).toBe(true);
  });

  it('gate ON — both lanes run, and neither suppresses the other', async () => {
    process.env.CREATOR_IMAGE_REFERENCE_MODE = 'edit';
    const subject = seedAsset();
    const logo = seedAsset();
    seedRef(subject, 'subject', 'condition', 0);
    seedRef(logo, 'logo', 'compose', 1);
    const { renderer } = await resolve(mixedSlots);

    const { composed, conditioned } = await renderBothLanes(renderer);

    expect(composed.layers).toHaveLength(1);
    expect(conditioned.references).toHaveLength(1);
    expect(editCalls).toHaveLength(1);
    // The composed logo was never handed to the model — one reference, not two.
    expect(Array.isArray(editCalls[0].image)).toBe(false);
  });

  it('COMPOSE ordering is unaffected by the gate, in both states', async () => {
    for (const mode of [undefined, 'edit']) {
      assets.length = 0; refs.length = 0; objects.clear(); seq = 0;
      if (mode === undefined) delete process.env.CREATOR_IMAGE_REFERENCE_MODE;
      else process.env.CREATOR_IMAGE_REFERENCE_MODE = mode;

      const first = seedAsset();
      const second = seedAsset();
      seedRef(second, 'supporting', 'compose', 1);
      seedRef(first, 'logo', 'compose', 0);
      const { renderer } = await resolve([
        { purpose: 'logo', mode: 'compose', placement: PLACEMENT },
        { purpose: 'supporting', mode: 'compose', placement: PLACEMENT },
      ]);

      const composed = await buildComposeLayers({
        companyId: renderer.composePlan.companyId,
        compose: renderer.composePlan.compose,
        templateSlots: renderer.composePlan.templateSlots,
        width: 400, height: 400,
      });

      expect(composed.layers.map((l) => l.assetId)).toEqual([first, second]);
    }
  });
});

/* ── F. Legacy reference path (§10) ──────────────────────────────────────── */

describe('F — the legacy showcase obeys the same gate', () => {
  it('CRITICAL: gate OFF — referenceImageUrl cannot reach images.edit', async () => {
    await generateProviderImage({
      prompt: 'p',
      referenceImageUrl: 'https://www.omnivyra.com/creator-showcases/corporate/image.webp',
    });
    expect(editCalls).toHaveLength(0);
    expect(generateCalls).toHaveLength(1);
  });

  it('gate OFF — the renderer does not even build a showcase URL', () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, '../../services/creatorAssetRendererImage.ts'), 'utf8');
    expect(src).toContain('if (!creatorImageReferenceModeEnabled()) return null;');
  });

  it('both sources read the SAME gate — no separate legacy switch to drift', () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, '../../services/creatorAssetRendererMedia.ts'), 'utf8');
    expect(src.match(/creatorImageReferenceModeEnabled\(\)/g) ?? []).toHaveLength(1);
    // Canonical and legacy both consult that one resolved value.
    expect(src).toMatch(/referenceModeEnabled \? \(input\.referenceImages \?\? \[\]\) : \[\]/);
    expect(src).toMatch(/if \(referenceModeEnabled && typeof referenceUrl/);
  });
});

/* ── G. The gate does not mask real refusals ─────────────────────────────── */

describe('G — invalid references are refused independently of the gate', () => {
  it.each([undefined, 'edit'])('a purpose the template rejects never reaches the provider (mode=%p)',
    async (mode) => {
      if (mode === undefined) delete process.env.CREATOR_IMAGE_REFERENCE_MODE;
      else process.env.CREATOR_IMAGE_REFERENCE_MODE = mode;

      const subject = seedAsset();
      seedRef(subject, 'subject', 'condition');
      const { renderer, rejected } = await resolve([{ purpose: 'background' }]);

      await renderConditionLane(renderer);

      expect(editCalls).toHaveLength(0);
      expect(rejected[0]).toEqual(expect.objectContaining({
        reason: 'purpose_not_accepted_by_template',
      }));
    });
});
