/**
 * Validation — Step-10 runtime wiring of the Creator Workspace
 * persistence lifecycle (load / edit / save / reload / advance).
 *
 * The runtime helper IS the wiring unit the endpoints call; testing it
 * exercises the end-to-end lifecycle without an HTTP harness (same
 * approach as the Step-4/7 helper suites).
 *
 *   1  load existing Creator row
 *   2  edit packaging
 *   3  save (content-only update, no content_status)
 *   4  reload
 *   5  deterministic reconstruction
 *   6  scheduler-safe persistence (LIVE SQL)
 *   7  no strategic leakage
 *   8  human-production transitions
 *   9  Text flows unchanged (skipped, no mutation)
 *   10 backward compatibility (flag OFF / legacy rows)
 *
 * supabase mocked = purity proof.
 */

const fromSpy = jest.fn(() => { throw new Error('DB access in pure runtime helper'); });
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
} from '../../services/creator/intelligence/workspace';
import {
  isCreatorWorkspaceLifecycleEnabled,
  loadCreatorWorkspace,
  buildCreatorWorkspaceUpdate,
  editCreatorWorkspace,
  advanceCreatorWorkspace,
  toPersistableContent,
} from '../../services/creator/intelligence/workspace';

const LIFE = 'ENABLE_CREATOR_WORKSPACE_LIFECYCLE';
const ADAPT = 'ENABLE_CREATOR_BLUEPRINT_ADAPTERS';
const SIX = ['LinkedIn', 'Instagram', 'facebook', 'TikTok', 'YouTube', 'X'];
const CTX = { now: '2026-05-16T00:00:00.000Z', editor: 'tester', change_source: 'unit' };

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

function dbRowFor(fmt: string, over: Record<string, unknown> = {}) {
  const card = buildCreatorBlueprintCard(cardInput(fmt, over));
  const task = expandCardToDailyTasks(card).tasks[0]!;
  const ws = toCreatorWorkspaceTask(card, task);
  return {
    id: 'row-1',
    campaign_id: 'camp-123',
    execution_id: 'exec-1',
    content: JSON.stringify(toPersistableContent(ws)),
    content_type: ws.asset_family,
    platform: ws.platform_context.platform,
    content_status: 'planned',
    asset_type: ws.asset_family,
    intent_type: 'creator',
    week_number: 2,
    topic: 'From Data to Decisions',
    title: 'From Data to Decisions',
  };
}

const O_LIFE = process.env[LIFE];
const O_ADAPT = process.env[ADAPT];
beforeEach(() => { process.env[LIFE] = '1'; process.env[ADAPT] = '1'; });
afterEach(() => {
  if (O_LIFE === undefined) delete process.env[LIFE]; else process.env[LIFE] = O_LIFE;
  if (O_ADAPT === undefined) delete process.env[ADAPT]; else process.env[ADAPT] = O_ADAPT;
  fromSpy.mockClear();
});

describe('flag gate', () => {
  it('OFF by default → load reports disabled (existing behavior kept)', () => {
    delete process.env[LIFE];
    expect(isCreatorWorkspaceLifecycleEnabled()).toBe(false);
    const r = loadCreatorWorkspace(dbRowFor('carousel') as any);
    expect(r).toEqual({ ok: false, reason: 'disabled' });
  });
});

describe('Validation-1/4/5 — load + reload + determinism', () => {
  it('loads a Creator row; reload from saved content is identical', () => {
    const row = dbRowFor('carousel', { distributionMode: 'shared' });
    const a = loadCreatorWorkspace(row as any, { now: CTX.now });
    const b = loadCreatorWorkspace(row as any, { now: CTX.now });
    expect(a.ok && b.ok).toBe(true);
    expect(JSON.stringify(a)).toEqual(JSON.stringify(b));

    if (!a.ok) throw new Error('unreachable');
    const saved = buildCreatorWorkspaceUpdate(a.task).content;
    const reloaded = loadCreatorWorkspace(
      { ...row, content: saved } as any, { now: CTX.now },
    );
    expect(reloaded.ok).toBe(true);
    expect(fromSpy).not.toHaveBeenCalled();
  });
});

describe('Validation-2/3/7 — edit + save (content-only) + no leakage', () => {
  it('edit persists, save returns ONLY {content}, no strategic keys', () => {
    const row = dbRowFor('carousel', { distributionMode: 'shared' });
    const loaded = loadCreatorWorkspace(row as any, { now: CTX.now });
    if (!loaded.ok) throw new Error('expected creator');

    const edited = editCreatorWorkspace(loaded.task, {
      caption: 'RUNTIME EDIT', hashtags: ['#Run'], cta: 'Talk to us',
    }, CTX);
    expect(edited.packaging_context.caption).toBe('RUNTIME EDIT');
    expect(edited.workspace_meta!.workspace_revision).toBe(
      (loaded.task.workspace_meta?.workspace_revision ?? 0) + 1);

    const update = buildCreatorWorkspaceUpdate(edited);
    // Phase-2: scheduler isolation — ONLY content is written, never
    // content_status (existing scheduler keeps ownership).
    expect(Object.keys(update)).toEqual(['content']);

    const parsed = JSON.parse(update.content);
    for (const k of ['blueprint', 'emotional_goal', 'hook_strategy',
      'planning_context', 'production_context', 'adaptation_context']) {
      expect(k in parsed).toBe(false);
    }
    // round-trip the edit through reload
    const back = loadCreatorWorkspace({ ...row, content: update.content } as any);
    expect(back.ok).toBe(true);
    if (back.ok) {
      expect(back.task.packaging_context.caption).toBe('RUNTIME EDIT');
      expect(back.task.workspace_meta!.last_editor).toBe('tester');
    }
  });
});

describe('Validation-8 — human-production transitions round-trip', () => {
  it('reel advance chain persists; uploaded_asset_ref never in scheduler row', () => {
    const row = dbRowFor('reel', { distributionMode: 'shared' });
    const loaded = loadCreatorWorkspace(row as any, { now: CTX.now });
    if (!loaded.ok) throw new Error('expected creator');
    expect(loaded.task.requires_human_production).toBe(true);
    expect(loaded.task.production_status).toBe('awaiting_human_production');

    const inProd = advanceCreatorWorkspace(loaded.task, 'in_production', CTX);
    const uploaded = advanceCreatorWorkspace(inProd, 'asset_uploaded', {
      ...CTX, uploaded_asset_ref: 'https://cdn/asset.mp4',
    });
    expect(uploaded.workspace_meta!.uploaded_asset_ref).toBe('https://cdn/asset.mp4');

    const update = buildCreatorWorkspaceUpdate(uploaded);
    expect(Object.keys(update)).toEqual(['content']);
    const parsed = JSON.parse(update.content);
    // uploaded ref lives in workspace meta, NEVER in the scheduler row
    expect(parsed.creator_workspace_meta.uploaded_asset_ref).toBe('https://cdn/asset.mp4');
    expect(parsed.packaging?.uploaded_asset_ref).toBeUndefined();
    expect(JSON.stringify({
      intent_type: parsed.intent_type, asset_type: parsed.asset_type,
      packaging: parsed.packaging, asset_payload: parsed.asset_payload,
      asset_instruction: parsed.asset_instruction,
    })).not.toContain('cdn/asset.mp4');

    // reload preserves the lifecycle state
    const back = loadCreatorWorkspace({ ...row, content: update.content } as any);
    expect(back.ok && back.task.production_status).toBe('asset_uploaded');

    // illegal jump rejected (helper throws → endpoint maps to 422)
    expect(() => advanceCreatorWorkspace(loaded.task, 'scheduled', CTX))
      .toThrow(/Illegal production transition/);
  });
});

describe('Validation-9 — Text flows unchanged (no contamination)', () => {
  it('Text / non-creator / malformed rows are skipped (caller falls back)', () => {
    expect(loadCreatorWorkspace({
      content: JSON.stringify({ intent_type: 'text', body: 'blog' }),
      content_type: 'article', intent_type: 'text',
    } as any)).toEqual({ ok: false, reason: 'skipped' });

    expect(loadCreatorWorkspace({ content: 'not-json' } as any))
      .toEqual({ ok: false, reason: 'skipped' });

    expect(loadCreatorWorkspace({ content: null } as any))
      .toEqual({ ok: false, reason: 'skipped' });
  });
});

describe('Validation-10 — backward compatibility', () => {
  it('legacy creator row without meta/breadcrumb still loads + persists valid', () => {
    const legacy = {
      content: JSON.stringify({
        intent_type: 'creator', asset_type: 'image',
        packaging: { caption: 'old', hashtags: ['#x'], keywords: ['k'], meta_description: 'm', cta: 'go' },
        asset_payload: { visual_descriptor: { subject: 's' } },
        asset_instruction: { note: 'n' },
      }),
      content_type: 'image', platform: 'instagram', intent_type: 'creator',
      asset_type: 'image', week_number: 1, content_status: null,
    };
    const loaded = loadCreatorWorkspace(legacy as any);
    expect(loaded.ok).toBe(true);
    if (loaded.ok) {
      const update = buildCreatorWorkspaceUpdate(loaded.task);
      expect(Object.keys(update)).toEqual(['content']);
      const parsed = JSON.parse(update.content);
      expect(parsed.intent_type).toBe('creator');
      expect(Array.isArray(parsed.packaging.hashtags)).toBe(true);
    }
  });
});

// ── Validation-6 — LIVE deployed-constraint acceptance ───────────────────
const DB_URL = process.env.SUPABASE_DB_URL;
const liveDescribe = DB_URL ? describe : describe.skip;

liveDescribe('Validation-6 — persisted content rows pass deployed SQL', () => {
  it('image/carousel load→edit→save content is constraint-valid', async () => {
    const { Client } = require('pg');
    const client = new Client({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });
    await client.connect();
    try {
      for (const fmt of ['image', 'carousel']) {
        for (const mode of ['shared', 'unique'] as const) {
          const row = dbRowFor(fmt, { distributionMode: mode });
          const loaded = loadCreatorWorkspace(row as any, { now: CTX.now });
          if (!loaded.ok) throw new Error('expected creator');
          const edited = editCreatorWorkspace(loaded.task,
            { caption: 'live edit', hashtags: ['#live'] }, CTX);
          const parsed = JSON.parse(buildCreatorWorkspaceUpdate(edited).content);
          const schedulerRow = {
            intent_type: parsed.intent_type,
            asset_type: parsed.asset_type,
            packaging: parsed.packaging,
            asset_payload: parsed.asset_payload,
            asset_instruction: parsed.asset_instruction,
          };
          const r = await client.query(
            'SELECT public.is_valid_creator_daily_content_payload($1,$2,$3) AS ok',
            ['creator', String(parsed.asset_type), JSON.stringify(schedulerRow)],
          );
          expect({ fmt, mode, ok: r.rows[0].ok }).toEqual({ fmt, mode, ok: true });
        }
      }
    } finally {
      await client.end();
    }
  }, 30000);
});
