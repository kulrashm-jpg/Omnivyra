/**
 * Validation — Step-9 Creator Workspace persistence + round-trip.
 *
 *   1  reconstruction determinism
 *   2  scheduler-boundary enforcement (fail-closed)
 *   3  editable packaging persistence (whitelist + revision)
 *   4  no blueprint leakage
 *   5  shared-content reconstruction
 *   6  hybrid override reconstruction
 *   7  human-production state transitions
 *   8  backward compatibility (legacy / non-creator rows)
 *   9  constraint-valid persistence (offline mirror + LIVE SQL)
 *   10 frozen scheduler projection integrity
 *
 * supabase mocked = purity proof.
 */

const fromSpy = jest.fn(() => { throw new Error('DB access in pure persistence layer'); });
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
  fromPersistedCreatorRow,
  applyWorkspaceEdits,
  toPersistableSchedulerRow,
  toPersistableContent,
  advanceProductionStatus,
  isConstraintValidSchedulerRow,
} from '../../services/creator/intelligence/workspace';

const ADAPT = 'ENABLE_CREATOR_BLUEPRINT_ADAPTERS';
const SIX = ['LinkedIn', 'Instagram', 'facebook', 'TikTok', 'YouTube', 'X'];

function cardInput(format: string, over: Record<string, unknown> = {}) {
  return {
    topic: 'From Data to Decisions', objective: 'Brand awareness',
    contentType: format, format, platforms: SIX,
    campaignTheme: 'Smarter marketing', creativeObjective: 'data-to-decision bridge',
    coreMessage: 'Turn analytics into decisions', tone: 'authoritative',
    cta: 'Book a walkthrough', campaignId: 'camp-123', weekIndex: 2,
    continuityContext: { campaign_id: 'camp-123', week_index: 2 },
    ...over,
  } as any;
}
const CTX = { now: '2026-05-16T00:00:00.000Z', editor: 'tester', change_source: 'unit' };

/** Build a persisted-row stand-in from a workspace task. */
function persistRow(ws: any, over: Record<string, unknown> = {}) {
  return {
    content: JSON.stringify(toPersistableContent(ws)),
    content_type: ws.asset_family,
    platform: ws.platform_context.platform,
    asset_type: ws.asset_family,
    intent_type: 'creator',
    week_number: ws.planning_context.week_index,
    content_status: ws.production_status,
    ...over,
  };
}

const O = process.env[ADAPT];
beforeEach(() => { process.env[ADAPT] = '1'; });
afterEach(() => {
  if (O === undefined) delete process.env[ADAPT]; else process.env[ADAPT] = O;
  fromSpy.mockClear();
});

function wsFor(fmt: string, over: Record<string, unknown> = {}) {
  const card = buildCreatorBlueprintCard(cardInput(fmt, over));
  const task = expandCardToDailyTasks(card).tasks[0]!;
  return toCreatorWorkspaceTask(card, task);
}

describe('Validation-1 — reconstruction determinism', () => {
  it('same persisted row → byte-identical workspace task', () => {
    const row = persistRow(wsFor('carousel', { distributionMode: 'shared' }));
    const a = fromPersistedCreatorRow(row, { now: CTX.now });
    const b = fromPersistedCreatorRow(row, { now: CTX.now });
    expect(a).not.toBeNull();
    expect(JSON.stringify(a)).toEqual(JSON.stringify(b));
    expect(fromSpy).not.toHaveBeenCalled();
  });
});

describe('Validation-2/4/10 — scheduler boundary + no leakage + frozen', () => {
  it('toPersistableSchedulerRow → exactly 5 keys, frozen, constraint-valid', () => {
    const ws = wsFor('image', { distributionMode: 'shared' });
    const row = toPersistableSchedulerRow(ws);
    expect(Object.keys(row).sort()).toEqual(
      ['asset_instruction', 'asset_payload', 'asset_type', 'intent_type', 'packaging'],
    );
    expect(isConstraintValidSchedulerRow(row)).toBe(true);
    expect(Object.isFrozen(row)).toBe(true);
    expect(() => { (row as any).packaging = {}; }).toThrow();
  });

  it('persistable content scheduler-part carries NO strategic keys', () => {
    const content = toPersistableContent(wsFor('carousel', { distributionMode: 'shared' }));
    for (const k of ['blueprint', 'emotional_goal', 'hook_strategy',
      'planning_context', 'production_context', 'adaptation_context']) {
      expect(k in content).toBe(false);
    }
    // reconstruct → blueprint never resurrected
    const back = fromPersistedCreatorRow(persistRow(wsFor('carousel', { distributionMode: 'shared' })))!;
    expect(back.production_context.blueprint).toBeNull();
    expect(back.blueprint_id).toBeNull();
  });

  it('leak-proof by construction: a tampered input is structurally scrubbed', () => {
    const ws = wsFor('image', { distributionMode: 'shared' });
    const tampered = JSON.parse(JSON.stringify(ws));
    // inject strategic leakage into BOTH the frozen row and editable copy
    tampered.scheduler_row.blueprint = { leak: 1 };
    tampered.scheduler_row.emotional_goal = { pain_point: 'leak' };
    tampered.packaging_context.blueprint = { leak: 2 };
    const row = toPersistableSchedulerRow(tampered);
    // re-projection rebuilds a clean 5-key row — leak eliminated, not
    // passed through (the strongest boundary guarantee).
    expect(Object.keys(row).sort()).toEqual(
      ['asset_instruction', 'asset_payload', 'asset_type', 'intent_type', 'packaging'],
    );
    expect('blueprint' in row).toBe(false);
    expect('emotional_goal' in row).toBe(false);
    expect('blueprint' in (row.packaging as any)).toBe(false);
    expect(isConstraintValidSchedulerRow(row)).toBe(true);
  });
});

describe('Validation-3 — editable packaging persistence', () => {
  it('whitelisted edits persist + round-trip; locked fields ignored; revision bumps', () => {
    const ws = wsFor('carousel', { distributionMode: 'shared' });
    const edited = applyWorkspaceEdits(ws, {
      caption: 'HUMAN EDIT CAPTION',
      hashtags: ['#Edited'],
      cta: 'Talk to us',
      creator_notes: ['shoot tighter'],
      // locked attempt — must be ignored:
      ...( { card_id: 'HACKED', scheduler_row: {} } as any),
    }, CTX);

    expect(edited.packaging_context.caption).toBe('HUMAN EDIT CAPTION');
    expect(edited.workspace_meta!.workspace_revision).toBe(
      (ws.workspace_meta?.workspace_revision ?? 0) + 1);
    expect(edited.workspace_meta!.last_editor).toBe('tester');
    expect(edited.planning_context.card_id).toBe(ws.planning_context.card_id); // locked
    expect(ws.packaging_context.caption).not.toBe('HUMAN EDIT CAPTION'); // input not mutated

    // round-trip the edit
    const back = fromPersistedCreatorRow(persistRow(edited))!;
    expect(back.packaging_context.caption).toBe('HUMAN EDIT CAPTION');
    expect(back.packaging_context.hashtags).toEqual(['#Edited']);
    expect(back.production_context.creator_notes).toContain('shoot tighter');
    expect(back.workspace_meta!.workspace_revision).toBe(
      edited.workspace_meta!.workspace_revision);
  });
});

describe('Validation-5/6 — shared / hybrid round-trip', () => {
  it('shared_core_id + classification survive the round trip', () => {
    const ws = wsFor('carousel', { distributionMode: 'shared' });
    expect(ws.adaptation_context.is_shared_core_variant).toBe(true);
    const back = fromPersistedCreatorRow(persistRow(ws))!;
    expect(back.adaptation_context.classification).toBe('shared_content');
    expect(back.adaptation_context.shared_core_id)
      .toBe(ws.adaptation_context.shared_core_id);
  });

  it('hybrid override_layer reconstructs deterministically', () => {
    const card = buildCreatorBlueprintCard(cardInput('carousel', {
      distributionMode: 'shared',
      perPlatformPackaging: { linkedin: { caption: 'LI-ONLY' } },
    }));
    const task = expandCardToDailyTasks(card).tasks
      .find((t) => t.platform === 'linkedin')!;
    const ws = toCreatorWorkspaceTask(card, task);
    expect(ws.adaptation_context.classification).toBe('hybrid_content');
    const back = fromPersistedCreatorRow(persistRow(ws))!;
    expect(back.adaptation_context.classification).toBe('hybrid_content');
    expect(back.adaptation_context.override_layer).toEqual({ caption: 'LI-ONLY' });
  });

  it('platform_native reconstructs with no shared core variant flag', () => {
    const back = fromPersistedCreatorRow(persistRow(wsFor('reel', { distributionMode: 'unique' })))!;
    expect(back.adaptation_context.classification).toBe('platform_native_content');
    expect(back.adaptation_context.is_shared_core_variant).toBe(false);
  });
});

describe('Validation-7 — human-production transitions', () => {
  it('legal forward graph; illegal throws; asset_uploaded needs a ref', () => {
    const ws = wsFor('reel', { distributionMode: 'shared' });
    expect(ws.production_status).toBe('awaiting_human_production');
    expect(ws.requires_human_production).toBe(true);

    const inProd = advanceProductionStatus(ws, 'in_production', CTX);
    expect(inProd.production_status).toBe('in_production');

    expect(() => advanceProductionStatus(inProd, 'asset_uploaded', CTX))
      .toThrow(/requires ctx.uploaded_asset_ref/);
    const uploaded = advanceProductionStatus(inProd, 'asset_uploaded',
      { ...CTX, uploaded_asset_ref: 'https://cdn/x.mp4' });
    expect(uploaded.workspace_meta!.uploaded_asset_ref).toBe('https://cdn/x.mp4');

    const approved = advanceProductionStatus(uploaded, 'approval_ready', CTX);
    const ready = advanceProductionStatus(approved, 'ready_for_scheduling', CTX);
    expect(ready.scheduler_eligible).toBe(true);
    expect(() => advanceProductionStatus(ws, 'scheduled', CTX))
      .toThrow(/Illegal production transition/);

    // uploaded asset ref never crosses into the scheduler row
    const row = toPersistableSchedulerRow(ready);
    expect(JSON.stringify(row)).not.toContain('cdn/x.mp4');
  });
});

describe('Validation-8 — backward compatibility', () => {
  it('non-creator row → null (no contamination)', () => {
    expect(fromPersistedCreatorRow({
      content: JSON.stringify({ intent_type: 'text', body: 'a blog' }),
      content_type: 'article', intent_type: 'text',
    })).toBeNull();
    expect(fromPersistedCreatorRow({ content: 'not json' })).toBeNull();
    expect(fromPersistedCreatorRow({ content: null })).toBeNull();
  });

  it('legacy creator row WITHOUT meta/breadcrumb still reconstructs safely', () => {
    const legacy = {
      content: JSON.stringify({
        intent_type: 'creator', asset_type: 'image',
        packaging: { caption: 'old', hashtags: ['#x'], keywords: ['k'], meta_description: 'm', cta: 'go' },
        asset_payload: { visual_descriptor: { subject: 's' } },
        asset_instruction: { note: 'n' },
      }),
      content_type: 'image', platform: 'instagram', asset_type: 'image',
      intent_type: 'creator', week_number: 1, content_status: null,
    };
    const ws = fromPersistedCreatorRow(legacy)!;
    expect(ws.domain).toBe('creator');
    expect(ws.packaging_context.caption).toBe('old');
    expect(ws.workspace_meta!.workspace_revision).toBe(0);
    expect(ws.adaptation_context.classification).toBe('shared_content'); // safe default
    expect(isConstraintValidSchedulerRow(toPersistableSchedulerRow(ws))).toBe(true);
  });

  it('reconstruction rebuilds a corrupted asset_payload to a valid skeleton', () => {
    const broken = {
      content: JSON.stringify({
        intent_type: 'creator', asset_type: 'carousel',
        packaging: { caption: 'c', hashtags: [], keywords: [], meta_description: '', cta: '' },
        asset_payload: { slides: 'NOT-AN-ARRAY' },
        asset_instruction: {},
      }),
      content_type: 'carousel', platform: 'linkedin', asset_type: 'carousel',
      intent_type: 'creator',
    };
    const ws = fromPersistedCreatorRow(broken)!;
    expect(Array.isArray((ws.scheduler_row.asset_payload as any).slides)).toBe(true);
    expect(isConstraintValidSchedulerRow(toPersistableSchedulerRow(ws))).toBe(true);
  });
});

// ── Validation-9 — LIVE deployed-constraint acceptance ───────────────────
const DB_URL = process.env.SUPABASE_DB_URL;
const liveDescribe = DB_URL ? describe : describe.skip;

liveDescribe('Validation-9 — round-trip rows pass deployed SQL', () => {
  it('image/carousel edited + reconstructed rows accepted by live function', async () => {
    const { Client } = require('pg');
    const client = new Client({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });
    await client.connect();
    try {
      for (const fmt of ['image', 'carousel']) {
        for (const mode of ['shared', 'unique'] as const) {
          const ws = wsFor(fmt, { distributionMode: mode });
          const edited = applyWorkspaceEdits(ws,
            { caption: 'edited live', hashtags: ['#live'], cta: 'go' }, CTX);
          const back = fromPersistedCreatorRow(persistRow(edited))!;
          const row = toPersistableSchedulerRow(back);
          const res = await client.query(
            'SELECT public.is_valid_creator_daily_content_payload($1,$2,$3) AS ok',
            ['creator', String(row.asset_type), JSON.stringify(row)],
          );
          expect({ fmt, mode, ok: res.rows[0].ok }).toEqual({ fmt, mode, ok: true });
        }
      }
    } finally {
      await client.end();
    }
  }, 30000);
});
