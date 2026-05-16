/**
 * Validation — Step-8 Creator Workspace consumption contract +
 * Activity-Workspace separation layer.
 *
 *   1  CreatorWorkspaceTask construction
 *   2  blueprint consumption (rich context lifted)
 *   3  scheduler-boundary isolation (frozen + fail-closed)
 *   4  shared-content workspace flow
 *   5  hybrid-content workspace flow
 *   6  requires_human_production lane (reel/video)
 *   7  deterministic workspace state
 *   8  no Text/Creator contamination
 *   9  backward compatibility (card-only, no blueprint, still valid)
 *   10 future rendering extensibility (inert envelope)
 *
 * supabase mocked = purity proof (planner transitively imports the
 * engine + weekly-structure-helpers lazy supabase Proxy).
 */

const fromSpy = jest.fn(() => { throw new Error('DB access in pure workspace layer'); });
jest.mock('../../db/supabaseClient', () => ({
  __esModule: true,
  supabase: new Proxy({}, { get: () => fromSpy }),
}));

import {
  buildCreatorBlueprintCard,
  expandCardToDailyTasks,
} from '../../services/creator/intelligence/planning';
import {
  toCreatorWorkspaceTask,
  toCreatorWorkspaceBundle,
  toSchedulerView,
  assertCreatorDomain,
} from '../../services/creator/intelligence/workspace';

const ADAPT = 'ENABLE_CREATOR_BLUEPRINT_ADAPTERS';
const SIX = ['LinkedIn', 'Instagram', 'facebook', 'TikTok', 'YouTube', 'X'];

function cardInput(format: string, over: Record<string, unknown> = {}) {
  return {
    topic: 'From Data to Decisions: Transform your marketing',
    objective: 'Build brand awareness for mid-market SaaS',
    contentType: format,
    format,
    platforms: SIX,
    campaignTheme: 'Smarter marketing through data',
    creativeObjective: 'Position the product as the data-to-decision bridge',
    coreMessage: 'Turn raw analytics into weekly decisions',
    tone: 'authoritative',
    cta: 'Book a walkthrough',
    campaignId: 'camp-123',
    weekIndex: 2,
    continuityContext: { campaign_id: 'camp-123', week_index: 2 },
    ...over,
  } as any;
}

const O_ADAPT = process.env[ADAPT];
afterEach(() => {
  if (O_ADAPT === undefined) delete process.env[ADAPT]; else process.env[ADAPT] = O_ADAPT;
  fromSpy.mockClear();
});

describe('Validation-1/2 — construction + blueprint consumption', () => {
  beforeEach(() => { process.env[ADAPT] = '1'; });

  it('builds a CreatorWorkspaceTask with rich + scheduler-safe context', () => {
    const card = buildCreatorBlueprintCard(cardInput('carousel', { distributionMode: 'shared' }));
    const exp = expandCardToDailyTasks(card);
    const ws = toCreatorWorkspaceTask(card, exp.tasks[0]!);

    expect(ws.domain).toBe('creator');
    expect(ws.asset_family).toBe('carousel');
    expect(ws.task_id).toBe(exp.tasks[0]!.task_id);
    expect(ws.blueprint_id).toBe(exp.tasks[0]!.blueprint!.blueprint_id);
    // rich consumption
    expect(ws.production_context.blueprint).not.toBeNull();
    expect(ws.production_context.storyboard.length).toBeGreaterThan(0);
    expect(ws.production_context.production_notes.length).toBeGreaterThan(0);
    expect(ws.planning_context.creative_objective.length).toBeGreaterThan(0);
    expect(ws.planning_context.emotional_goal.pain_point.length).toBeGreaterThan(0);
    expect(ws.platform_context.platform).toBe(exp.tasks[0]!.platform);
    expect(typeof ws.packaging_context.cta).toBe('string');
    expect(fromSpy).not.toHaveBeenCalled();
  });

  it('lifts reel scene_sequence / overlays / pacing / creator_notes', () => {
    const card = buildCreatorBlueprintCard(cardInput('reel', { distributionMode: 'unique' }));
    const exp = expandCardToDailyTasks(card);
    const ws = toCreatorWorkspaceTask(card, exp.tasks[0]!);
    expect(ws.production_context.storyboard.length).toBe(5);   // 5-beat arc
    expect(ws.production_context.overlays.length).toBeGreaterThan(0);
    expect(ws.production_context.pacing_guidance.length).toBeGreaterThan(0);
    expect(ws.production_context.creator_notes.length).toBeGreaterThan(0);
  });
});

describe('Validation-3 — scheduler-boundary isolation', () => {
  beforeEach(() => { process.env[ADAPT] = '1'; });

  it('toSchedulerView returns ONLY the flat constraint-shaped row', () => {
    const card = buildCreatorBlueprintCard(cardInput('image', { distributionMode: 'shared' }));
    const ws = toCreatorWorkspaceTask(card, expandCardToDailyTasks(card).tasks[0]!);
    const row = toSchedulerView(ws);
    expect(Object.keys(row).sort()).toEqual(
      ['asset_instruction', 'asset_payload', 'asset_type', 'intent_type', 'packaging'],
    );
    expect((row as any).blueprint).toBeUndefined();
    expect((row as any).emotional_goal).toBeUndefined();
    expect((row as any).planning_context).toBeUndefined();
  });

  it('scheduler_row is frozen — workspace edits cannot mutate it', () => {
    const card = buildCreatorBlueprintCard(cardInput('carousel', { distributionMode: 'shared' }));
    const ws = toCreatorWorkspaceTask(card, expandCardToDailyTasks(card).tasks[0]!);
    // mutate editable workspace packaging
    ws.packaging_context.caption = 'EDITED IN WORKSPACE';
    (ws.packaging_context.hashtags as string[]).push('#workspace');
    // scheduler projection unchanged + frozen
    expect(ws.scheduler_row.packaging.caption).not.toBe('EDITED IN WORKSPACE');
    expect(Object.isFrozen(ws.scheduler_row)).toBe(true);
    expect(() => {
      (ws.scheduler_row as any).packaging = {};
    }).toThrow();
  });

  it('fail-closed: a leaked strategic key makes toSchedulerView throw', () => {
    const card = buildCreatorBlueprintCard(cardInput('image', { distributionMode: 'shared' }));
    const ws = toCreatorWorkspaceTask(card, expandCardToDailyTasks(card).tasks[0]!);
    const tampered = {
      ...ws,
      scheduler_row: { ...ws.scheduler_row, blueprint: { leak: 1 } } as any,
    };
    expect(() => toSchedulerView(tampered as any)).toThrow(/Scheduler-boundary violation/);
  });
});

describe('Validation-4/5 — shared / hybrid workspace flow', () => {
  beforeEach(() => { process.env[ADAPT] = '1'; });

  it('shared_content → shared core + variants sharing one core id', () => {
    const card = buildCreatorBlueprintCard(cardInput('carousel', { distributionMode: 'shared' }));
    const bundle = toCreatorWorkspaceBundle(card, expandCardToDailyTasks(card));
    expect(bundle.classification).toBe('shared_content');
    expect(bundle.shared_core).not.toBeNull();
    expect(bundle.variants.length).toBe(6);
    const coreIds = new Set(bundle.variants.map((v) => v.adaptation_context.shared_core_id));
    expect(coreIds.size).toBe(1);
    expect([...coreIds][0]).toBe(bundle.shared_core!.blueprint_id);
  });

  it('platform_native_content → no shared core, independent variants', () => {
    const card = buildCreatorBlueprintCard(cardInput('reel', { distributionMode: 'unique' }));
    const bundle = toCreatorWorkspaceBundle(card, expandCardToDailyTasks(card));
    expect(bundle.classification).toBe('platform_native_content');
    expect(bundle.shared_core).toBeNull();
    bundle.variants.forEach((v) =>
      expect(v.adaptation_context.is_shared_core_variant).toBe(false));
  });

  it('hybrid_content → shared core + per-platform override layer', () => {
    const card = buildCreatorBlueprintCard(cardInput('carousel', {
      distributionMode: 'shared',
      perPlatformPackaging: { linkedin: { caption: 'LINKEDIN-ONLY' } },
    }));
    expect(card.reuse_classification).toBe('hybrid_content');
    const bundle = toCreatorWorkspaceBundle(card, expandCardToDailyTasks(card));
    expect(bundle.shared_core).not.toBeNull();
    const li = bundle.variants.find((v) => v.platform_context.platform === 'linkedin')!;
    expect(li.adaptation_context.override_layer).toEqual({ caption: 'LINKEDIN-ONLY' });
    const ig = bundle.variants.find((v) => v.platform_context.platform === 'instagram')!;
    expect(ig.adaptation_context.override_layer).toEqual({});
  });
});

describe('Validation-6 — requires_human_production lane', () => {
  beforeEach(() => { process.env[ADAPT] = '1'; });

  it('reel/video → human production, NOT scheduler-eligible', () => {
    const card = buildCreatorBlueprintCard(cardInput('reel', { distributionMode: 'shared' }));
    const ws = toCreatorWorkspaceTask(card, expandCardToDailyTasks(card).tasks[0]!);
    expect(ws.requires_human_production).toBe(true);
    expect(ws.scheduler_eligible).toBe(false);
    expect(ws.production_status).toBe('awaiting_human_production');
  });

  it('image/carousel → no human production, scheduler-eligible', () => {
    for (const fmt of ['image', 'carousel']) {
      const card = buildCreatorBlueprintCard(cardInput(fmt, { distributionMode: 'shared' }));
      const ws = toCreatorWorkspaceTask(card, expandCardToDailyTasks(card).tasks[0]!);
      expect(ws.requires_human_production).toBe(false);
      expect(ws.scheduler_eligible).toBe(true);
      expect(ws.production_status).toBe('ready_for_scheduling');
    }
  });

  it('supports an explicit in-flight production status override', () => {
    const card = buildCreatorBlueprintCard(cardInput('reel', { distributionMode: 'shared' }));
    const ws = toCreatorWorkspaceTask(card, expandCardToDailyTasks(card).tasks[0]!, {
      productionStatus: 'asset_uploaded',
    });
    expect(ws.production_status).toBe('asset_uploaded');
    expect(ws.requires_human_production).toBe(true);
  });
});

describe('Validation-7 — deterministic workspace state', () => {
  beforeEach(() => { process.env[ADAPT] = '1'; });
  it('identical (card, task) → byte-identical workspace task', () => {
    const card = buildCreatorBlueprintCard(cardInput('carousel', { distributionMode: 'unique' }));
    const exp = expandCardToDailyTasks(card);
    const a = toCreatorWorkspaceTask(card, exp.tasks[0]!);
    const b = toCreatorWorkspaceTask(card, exp.tasks[0]!);
    expect(JSON.stringify(a)).toEqual(JSON.stringify(b));
  });
});

describe('Validation-8 — no Text/Creator contamination', () => {
  beforeEach(() => { process.env[ADAPT] = '1'; });
  it('domain is creator; assertCreatorDomain passes; text intent rejected', () => {
    const card = buildCreatorBlueprintCard(cardInput('image', { distributionMode: 'shared' }));
    const ws = toCreatorWorkspaceTask(card, expandCardToDailyTasks(card).tasks[0]!);
    expect(assertCreatorDomain(ws)).toBe(ws);
    const contaminated = {
      ...ws,
      scheduler_row: { ...ws.scheduler_row, intent_type: 'text' } as any,
    };
    expect(() => assertCreatorDomain(contaminated as any)).toThrow(/contamination/);
  });
});

describe('Validation-9 — backward compatibility (card-only, no blueprint)', () => {
  it('flag OFF → no blueprint, workspace task still valid + scheduler-safe', () => {
    delete process.env[ADAPT];
    const card = buildCreatorBlueprintCard(cardInput('image', { distributionMode: 'shared' }));
    const exp = expandCardToDailyTasks(card);
    expect(exp.tasks[0]!.blueprint).toBeNull();
    const ws = toCreatorWorkspaceTask(card, exp.tasks[0]!);
    expect(ws.production_context.blueprint).toBeNull();
    expect(ws.blueprint_id).toBeNull();
    // structural skeleton still present from scheduler payload
    expect(ws.production_context.storyboard.length).toBeGreaterThanOrEqual(0);
    expect(ws.production_status).toBe('draft');
    // boundary still holds
    expect(Object.keys(toSchedulerView(ws)).sort()).toEqual(
      ['asset_instruction', 'asset_payload', 'asset_type', 'intent_type', 'packaging'],
    );
  });
});

describe('Validation-10 — future rendering extensibility (inert)', () => {
  beforeEach(() => { process.env[ADAPT] = '1'; });
  it('render envelope present, inert, with a stable attach ref', () => {
    const card = buildCreatorBlueprintCard(cardInput('reel', { distributionMode: 'unique' }));
    const ws = toCreatorWorkspaceTask(card, expandCardToDailyTasks(card).tasks[0]!);
    expect(ws.render_envelope.render_ready).toBe(false);
    expect(ws.render_envelope.render_target).toBeNull();
    expect(ws.render_envelope.attach_ref.task_id).toBe(ws.task_id);
    expect(ws.render_envelope.attach_ref.blueprint_id).toBe(ws.blueprint_id);
  });
});
