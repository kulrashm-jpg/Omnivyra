/**
 * Validation — Step-R2 pure RenderRequestProjector + safety boundary.
 *
 *   1  identical inputs → identical hash/spec_id
 *   2  forbidden-field rejection (fail-closed)
 *   3  text-like rejection
 *   4  unsupported asset rejection
 *   5  deterministic serialization (key-order independent)
 *   6  deep-freeze immutability
 *   7  scene-order sensitivity (semantic array order)
 *   8  no scheduler contamination
 *   9  no strategic leakage (planning_context never projected)
 *   10 no runtime side effects (no DB, input not mutated)
 *
 * supabase mocked = purity proof (the workspace builder transitively
 * imports the engine + weekly-structure-helpers lazy supabase Proxy).
 */

const fromSpy = jest.fn(() => { throw new Error('DB access in pure projector'); });
jest.mock('../../db/supabaseClient', () => ({
  __esModule: true,
  supabase: new Proxy({}, { get: () => fromSpy }),
}));

import {
  buildCreatorBlueprintCard,
  expandCardToDailyTasks,
} from '../../services/creator/intelligence/planning';
import { toCreatorWorkspaceTask } from '../../services/creator/intelligence/workspace';
import {
  projectRenderRequest,
  RenderProjectionError,
} from '../../services/creator/rendering/projector';
import { RENDER_FORBIDDEN_FIELDS } from '../../services/creator/rendering/contracts';

const ADAPT = 'ENABLE_CREATOR_BLUEPRINT_ADAPTERS';
const SIX = ['LinkedIn', 'Instagram', 'facebook', 'TikTok', 'YouTube', 'X'];

function wsTask(fmt: string, over: Record<string, unknown> = {}) {
  const card = buildCreatorBlueprintCard({
    topic: 'From Data to Decisions', objective: 'Brand awareness',
    contentType: fmt, format: fmt, platforms: SIX,
    campaignTheme: 'Smarter marketing', creativeObjective: 'data-to-decision bridge',
    coreMessage: 'Turn analytics into decisions', tone: 'authoritative',
    cta: 'Book a walkthrough', campaignId: 'camp-123', weekIndex: 2,
    continuityContext: { campaign_id: 'camp-123', week_index: 2 },
    ...over,
  } as any);
  const task = expandCardToDailyTasks(card).tasks[0]!;
  return toCreatorWorkspaceTask(card, task);
}

const O = process.env[ADAPT];
beforeEach(() => { process.env[ADAPT] = '1'; });
afterEach(() => {
  if (O === undefined) delete process.env[ADAPT]; else process.env[ADAPT] = O;
  fromSpy.mockClear();
});

function deepKeys(v: unknown, acc: Set<string> = new Set()): Set<string> {
  if (Array.isArray(v)) v.forEach((x) => deepKeys(x, acc));
  else if (v && typeof v === 'object') {
    for (const k of Object.keys(v)) { acc.add(k); deepKeys((v as any)[k], acc); }
  }
  return acc;
}

describe('Validation-1/5/8/9/10 — deterministic + leak-free + pure', () => {
  it('builds a valid image RenderSpec; identical inputs → identical', () => {
    const ws = wsTask('image', { distributionMode: 'shared' });
    const a = projectRenderRequest(ws, { platform: 'instagram' });
    const b = projectRenderRequest(ws, { platform: 'instagram' });
    expect(a.spec_id).toMatch(/^render:[0-9a-f]{64}$/);
    expect(a.spec_id).toBe(`render:${a.deterministic_input_hash}`);
    expect(JSON.stringify(a)).toEqual(JSON.stringify(b));
    expect(a.canonical_asset_family).toBe('image');
    expect(a.render_modality).toBe('image');
    expect(a.platform_projection).toEqual({ platform: 'instagram', aspect_ratio: '1:1', resolution: { w: 1080, h: 1080 } });
    expect(fromSpy).not.toHaveBeenCalled();
  });

  it('key-order in production_context does not change the hash', () => {
    const ws: any = wsTask('carousel', { distributionMode: 'shared' });
    const reordered = JSON.parse(JSON.stringify(ws));
    // rebuild production_context with reversed key order
    const pc = reordered.production_context;
    reordered.production_context = Object.fromEntries(Object.entries(pc).reverse());
    const a = projectRenderRequest(ws, { platform: 'linkedin' });
    const b = projectRenderRequest(reordered, { platform: 'linkedin' });
    expect(a.deterministic_input_hash).toBe(b.deterministic_input_hash);
  });

  it('NO scheduler / strategic leakage in the projected spec', () => {
    const ws = wsTask('carousel', { distributionMode: 'shared' });
    const spec = projectRenderRequest(ws, { platform: 'facebook' });
    const keys = deepKeys(spec);
    for (const f of RENDER_FORBIDDEN_FIELDS) expect(keys.has(f)).toBe(false);
    for (const strategic of [
      'scheduler_row', 'planning_context', 'emotional_goal', 'creative_objective',
      'continuity_context', 'adaptation_context', 'workspace_meta', 'creator_planning_source',
    ]) expect(keys.has(strategic)).toBe(false);
    // it DID carry render-safe content
    expect(typeof spec.blueprint_projection.visual_prompt).toBe('string');
    expect(Array.isArray(spec.blueprint_projection.storyboard)).toBe(true);
  });

  it('does not mutate the input task; no DB touched', () => {
    const ws = wsTask('image', { distributionMode: 'shared' });
    const snapshot = JSON.stringify(ws);
    projectRenderRequest(ws, { platform: 'instagram', seed: 7 });
    expect(JSON.stringify(ws)).toEqual(snapshot);
    expect(fromSpy).not.toHaveBeenCalled();
  });
});

describe('Validation-2 — forbidden-field rejection (fail-closed)', () => {
  it('a forbidden key in a non-projected location is structurally dropped (leak-proof by construction)', () => {
    const ws: any = wsTask('image', { distributionMode: 'shared' });
    ws.production_context.scheduler_row = { intent_type: 'creator' };
    ws.production_context.continuity_context = { campaign_id: 'leak' };
    // The allowlist projector never READS these → they cannot reach the
    // spec at all (stronger than fail-closed: leakage is impossible here).
    const spec = projectRenderRequest(ws, { platform: 'instagram' });
    expect(deepKeys(spec).has('scheduler_row')).toBe(false);
    expect(deepKeys(spec).has('continuity_context')).toBe(false);
  });

  it('a nested forbidden key inside storyboard throws', () => {
    const ws: any = wsTask('carousel', { distributionMode: 'shared' });
    ws.production_context.storyboard = [{ headline: 'ok', emotional_goal: { pain_point: 'leak' } }];
    let code = '';
    try { projectRenderRequest(ws, { platform: 'linkedin' }); }
    catch (e: any) { code = e.code; }
    expect(code).toBe('FORBIDDEN_LEAKAGE');
  });

  it('non-deterministic value (function/Date) is rejected', () => {
    const ws: any = wsTask('image', { distributionMode: 'shared' });
    ws.production_context.storyboard = [{ subject: 's', when: new Date() }];
    let code = '';
    try { projectRenderRequest(ws, { platform: 'instagram' }); }
    catch (e: any) { code = e.code; }
    expect(code).toBe('NON_DETERMINISTIC');
  });
});

describe('Validation-3/4 — asset enforcement (fail-closed)', () => {
  it('text-like asset is rejected', () => {
    const ws: any = wsTask('image', { distributionMode: 'shared' });
    ws.asset_family = 'post_with_asset';
    ws.production_context.asset_family = 'post_with_asset';
    let code = '';
    try { projectRenderRequest(ws, { platform: 'linkedin' }); }
    catch (e: any) { code = e.code; }
    expect(code).toBe('TEXT_LIKE_NOT_RENDERABLE');
  });

  it('unsupported asset is rejected', () => {
    const ws: any = wsTask('image', { distributionMode: 'shared' });
    ws.asset_family = 'hologram';
    ws.production_context.asset_family = 'hologram';
    let code = '';
    try { projectRenderRequest(ws, { platform: 'instagram' }); }
    catch (e: any) { code = e.code; }
    expect(code).toBe('UNSUPPORTED_ASSET');
  });
});

describe('Validation-6 — deep-freeze immutability', () => {
  it('the returned RenderSpec is deeply frozen', () => {
    const spec = projectRenderRequest(wsTask('image', { distributionMode: 'shared' }), { platform: 'instagram' });
    expect(Object.isFrozen(spec)).toBe(true);
    expect(Object.isFrozen(spec.blueprint_projection)).toBe(true);
    expect(Object.isFrozen(spec.blueprint_projection.storyboard)).toBe(true);
    expect(() => { (spec as any).spec_id = 'x'; }).toThrow();
    expect(() => { (spec.platform_projection as any).platform = 'x'; }).toThrow();
  });
});

describe('Validation-7 — scene-order sensitivity', () => {
  it('reordering storyboard scenes changes the deterministic hash', () => {
    const ws: any = wsTask('reel', { distributionMode: 'unique' });
    const a = projectRenderRequest(ws, { platform: 'instagram' });
    const reordered = JSON.parse(JSON.stringify(ws));
    reordered.production_context.storyboard =
      [...reordered.production_context.storyboard].reverse();
    const b = projectRenderRequest(reordered, { platform: 'instagram' });
    expect(a.deterministic_input_hash).not.toBe(b.deterministic_input_hash);
    // reel → video modality + video geometry
    expect(a.render_modality).toBe('video');
    expect(a.platform_projection.aspect_ratio).toBe('9:16');
  });
});
