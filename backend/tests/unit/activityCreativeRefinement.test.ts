/**
 * Phase 64B — refining the creative that belongs to one activity.
 *
 * WHAT THIS PROTECTS
 * ------------------
 * Campaign generation has always recorded its creative against the activity;
 * Activity Workspace just never read it. Reading it is easy — reading it
 * *safely* is the part worth guarding, because `daily_content_plans` carries no
 * `company_id` of its own. Ownership lives one hop away on the campaign, and
 * `ownedDbTable` is an observability proxy rather than a company-scoped
 * accessor, so nothing enforces tenancy unless this service does.
 *
 * The other thing guarded here is the composition identity. Phase 64 proved the
 * Creator's per-session, per-creator-type token cannot represent one specific
 * piece of scheduled content: a second image made in the same browser session
 * silently displaces the first's references. A refinement that inherited that
 * token would inherit that bug. So the identity must be the ACTIVITY, and these
 * tests pin exactly that.
 */

jest.mock('@/config', () => ({ config: {}, getValidatedConfig: () => ({}) }));

const rows: Record<string, unknown[]> = { daily_content_plans: [], campaigns: [] };

/** Minimal supabase-shaped stub: .select().eq()....maybeSingle() */
function builderFor(table: string) {
  const filters: Array<[string, unknown]> = [];
  const api: Record<string, unknown> = {
    select: () => api,
    eq: (col: string, val: unknown) => { filters.push([col, val]); return api; },
    maybeSingle: async () => {
      const found = (rows[table] ?? []).find((r) =>
        filters.every(([c, v]) => (r as Record<string, unknown>)[c] === v));
      return { data: found ?? null, error: null };
    },
  };
  return api;
}

jest.mock('../../db/writeOwner', () => ({ ownedDbTable: (t: string) => builderFor(t) }));
let libEnvelope: Record<string, unknown> | null = null;
jest.mock('../../services/creatorAssetPersistenceService', () => ({
  libraryReadAsset: async () => (libEnvelope ? { library: libEnvelope } : null),
}));

import {
  resolveActivityCreative,
  activityBelongsToCompany,
  activityCreativeIsRefinable,
} from '../../services/creator/activityCreativeService';
import {
  ACTIVITY_CREATIVE_COMPOSITION_TYPE,
  CREATOR_COMPOSITION_TYPE,
} from '../../../lib/content/creatorCompositionAsset';

const RENDERED = {
  creator_asset_id: 'asset-1',
  rendered_asset: { creator_asset_id: 'asset-1', urls: ['https://cdn/x.png'], export_ready: true },
  content_status: 'render_ready',
};

beforeEach(() => {
  libEnvelope = null;
  rows.campaigns = [
    { id: 'camp-A', company_id: 'co-A' },
    { id: 'camp-B', company_id: 'co-B' },
  ];
  rows.daily_content_plans = [
    {
      id: 'act-A', campaign_id: 'camp-A', asset_type: 'image',
      template_id: 'tpl-1', content_status: 'render_ready', content: JSON.stringify(RENDERED),
    },
    {
      id: 'act-B', campaign_id: 'camp-B', asset_type: 'image',
      template_id: 'tpl-9', content_status: 'render_ready',
      content: JSON.stringify({ ...RENDERED, creator_asset_id: 'asset-B' }),
    },
    {
      id: 'act-pending', campaign_id: 'camp-A', asset_type: 'image',
      template_id: null, content_status: 'planned', content: JSON.stringify({}),
    },
  ];
});

/* ── A. The activity names its own creative ─────────────────────────────────*/

describe('A — the existing relationship is read, not invented', () => {
  it('CRITICAL: an activity resolves to the creative the worker recorded', async () => {
    const out = await resolveActivityCreative({ companyId: 'co-A', activityId: 'act-A' });
    expect(out).not.toBeNull();
    expect(out!.creatorAssetId).toBe('asset-1');
    expect(out!.urls).toEqual(['https://cdn/x.png']);
    expect(out!.contentStatus).toBe('render_ready');
    expect(out!.templateId).toBe('tpl-1');
  });

  it('an activity that has not generated yet is NOT refinable, but is still valid', async () => {
    const out = await resolveActivityCreative({ companyId: 'co-A', activityId: 'act-pending' });
    expect(out).not.toBeNull();               // it IS this company's activity
    expect(out!.creatorAssetId).toBeNull();
    expect(activityCreativeIsRefinable(out)).toBe(false);
    // …and its composition identity is still stable, so "nothing generated yet"
    // is distinguishable from "not yours".
    expect(out!.compositionId).toBe('act-pending');
  });

  it('refinable requires BOTH an asset id and a rendered url', async () => {
    expect(activityCreativeIsRefinable(null)).toBe(false);
    expect(activityCreativeIsRefinable({
      activityId: 'a', campaignId: 'c', creatorAssetId: 'x', assetType: null, templateId: null,
      urls: [], contentStatus: null, compositionType: 'activity-creative', compositionId: 'a',
      // Phase 65 added these to the record; an asset with no rendered url is
      // still version 1 and unrefined, which is exactly the case under test.
      currentVersion: 1, isRefined: false,
    })).toBe(false);
  });
});

/* ── B. Tenancy — the hop that is not free ──────────────────────────────────*/

describe('B — company is the authorization boundary', () => {
  it('CRITICAL: tenant A cannot resolve tenant B activity', async () => {
    expect(await resolveActivityCreative({ companyId: 'co-A', activityId: 'act-B' })).toBeNull();
  });

  it('CRITICAL: and cannot reach tenant B creative even knowing the id', async () => {
    const out = await resolveActivityCreative({ companyId: 'co-A', activityId: 'act-B' });
    // Null, not a record with a stripped asset — nothing about act-B leaks.
    expect(out).toBeNull();
  });

  it('CRITICAL: "not yours" is indistinguishable from "does not exist"', async () => {
    const foreign = await resolveActivityCreative({ companyId: 'co-A', activityId: 'act-B' });
    const missing = await resolveActivityCreative({ companyId: 'co-A', activityId: 'no-such' });
    expect(foreign).toEqual(missing);
  });

  it('ownership is checked through the campaign, which is where company lives', async () => {
    expect(await activityBelongsToCompany('co-A', 'act-A')).toEqual({ ok: true, campaignId: 'camp-A' });
    expect(await activityBelongsToCompany('co-B', 'act-A')).toEqual({ ok: false, campaignId: null });
  });

  it('an activity with no campaign is not owned by anyone', async () => {
    rows.daily_content_plans.push({ id: 'orphan', campaign_id: null, content: '{}' });
    expect(await activityBelongsToCompany('co-A', 'orphan')).toEqual({ ok: false, campaignId: null });
    expect(await resolveActivityCreative({ companyId: 'co-A', activityId: 'orphan' })).toBeNull();
  });

  it('missing identity resolves to nothing rather than to everything', async () => {
    for (const [companyId, activityId] of [['', 'act-A'], ['co-A', ''], ['', '']]) {
      expect(await resolveActivityCreative({ companyId, activityId })).toBeNull();
    }
  });

  it('CRITICAL: authorization never uses user or creator identity', () => {
    // Comments stripped: the docblock EXPLAINS why user identity is not used,
    // and a guard that cannot tell prose from code would fail on the
    // explanation itself.
    const src = require('fs').readFileSync(
      require('path').resolve(__dirname, '../../services/creator/activityCreativeService.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(src).toContain(".eq('company_id', companyId)");
    expect(src).not.toMatch(/created_by|createdBy/);
    expect(src).not.toMatch(/\.eq\('user_id'/);
  });
});

/* ── C. The composition identity ────────────────────────────────────────────*/

describe('C — one activity, one composition, forever', () => {
  it('CRITICAL: the composition IS the activity', async () => {
    const out = await resolveActivityCreative({ companyId: 'co-A', activityId: 'act-A' });
    expect(out!.compositionId).toBe('act-A');
    expect(out!.compositionType).toBe(ACTIVITY_CREATIVE_COMPOSITION_TYPE);
  });

  it('CRITICAL: it is NOT the Creator session token type', async () => {
    const out = await resolveActivityCreative({ companyId: 'co-A', activityId: 'act-A' });
    expect(out!.compositionType).not.toBe(CREATOR_COMPOSITION_TYPE);
    expect(out!.compositionId).not.toMatch(/^creator_/);
  });

  it('CRITICAL: two activities never share a composition', async () => {
    const a = await resolveActivityCreative({ companyId: 'co-A', activityId: 'act-A' });
    const p = await resolveActivityCreative({ companyId: 'co-A', activityId: 'act-pending' });
    expect(a!.compositionId).not.toEqual(p!.compositionId);
  });

  it('CRITICAL: it is stable across reads — regeneration reuses one composition', async () => {
    const first = await resolveActivityCreative({ companyId: 'co-A', activityId: 'act-A' });
    const second = await resolveActivityCreative({ companyId: 'co-A', activityId: 'act-A' });
    expect(first!.compositionId).toEqual(second!.compositionId);
    // No minting: nothing random or time-based can appear in the identity.
    const src = require('fs').readFileSync(
      require('path').resolve(__dirname, '../../services/creator/activityCreativeService.ts'), 'utf8');
    expect(src).not.toContain('Math.random');
    expect(src).not.toContain('Date.now');
    expect(src).not.toContain('mintCreatorCompositionId');
  });

  it('the type sits with the existing vocabulary, not in a new taxonomy', () => {
    const src = require('fs').readFileSync(
      require('path').resolve(__dirname, '../../../lib/content/creatorCompositionAsset.ts'), 'utf8');
    // Both composition types are declared in the SAME module.
    expect(src).toContain('CREATOR_COMPOSITION_TYPE');
    expect(src).toContain('ACTIVITY_CREATIVE_COMPOSITION_TYPE');
  });
});

/* ── D. It adds nothing the architecture already has ────────────────────────*/

describe('D — no second anything', () => {
  const src = require('fs').readFileSync(
    require('path').resolve(__dirname, '../../services/creator/activityCreativeService.ts'), 'utf8');

  it('creates no asset copy and no new table', () => {
    for (const bad of ['insert(', 'upsert(', 'update(', 'delete(']) {
      expect(src).not.toContain(bad);
    }
  });

  it('reads no storage bytes and mints no URL', () => {
    for (const bad of ['readCanonicalAssetBytes', 'storage.from', 'getPublicUrl', 'createSignedUrl']) {
      expect(src).not.toContain(bad);
    }
  });

  it('renders nothing and calls no provider', () => {
    for (const bad of ['renderAsset', 'generateProviderImage', 'images.edit', 'openai']) {
      expect(src).not.toContain(bad);
    }
  });

  it('does not touch the stock-image path', () => {
    expect(src).not.toMatch(/ImagePicker|attribution|unsplash/i);
  });
});

/* ── E. The route keeps the same boundary ───────────────────────────────────*/

describe('E — the endpoint enforces what the service assumes', () => {
  const route = require('fs').readFileSync(
    require('path').resolve(__dirname, '../../../pages/api/activity-workspace/creative.ts'), 'utf8');

  it('CRITICAL: it uses the workspace access gate, not the raw query company', () => {
    expect(route).toContain('enforceCompanyAccess');
    expect(route).toContain('isContentArchitectSession');
  });

  it('CRITICAL: a foreign activity is 404, never 403', () => {
    // 403 would confirm the id exists under another tenant.
    expect(route).toMatch(/if \(!creative\) return res\.status\(404\)/);
    expect(route).not.toContain('status(403)');
  });

  it('it is read-only', () => {
    expect(route).toMatch(/req\.method !== 'GET'/);
    for (const bad of ['insert(', 'upsert(', 'update(', 'delete(']) expect(route).not.toContain(bad);
  });
});

/* ── F. Two controls, two meanings ──────────────────────────────────────────*/

describe('F — the stock picker and the refinement are separate things', () => {
  const read = (rel: string) => require('fs').readFileSync(
    require('path').resolve(__dirname, '../../..', rel), 'utf8');
  const CARD = read('components/activity-workspace/WorkspacePlatformCard.tsx');
  const PANEL = read('components/activity-workspace/ActivityCreativeRefinementPanel.tsx');

  it('CRITICAL: the existing stock-image control is untouched', () => {
    // Same control, same picker, same state keys as before.
    expect(CARD).toContain('+ Add image');
    expect(CARD).toContain('Text only');
    expect(CARD).toContain('<ImagePicker');
    expect(CARD).toContain('setImageByScheduleId');
    expect(CARD).toContain('showImagePickerByScheduleId');
  });

  it('CRITICAL: refinement is a SIBLING, not nested inside the picker', () => {
    const pickerEnd = CARD.indexOf('<ImagePicker');
    const refine = CARD.indexOf('<ActivityCreativeRefinementPanel');
    expect(pickerEnd).toBeGreaterThan(-1);
    expect(refine).toBeGreaterThan(pickerEnd);
    // The refinement panel must not be rendered by the picker's own condition.
    expect(CARD).not.toMatch(/showImagePickerByScheduleId\[item\.id\][\s\S]{0,200}ActivityCreativeRefinementPanel/);
  });

  it('CRITICAL: the refinement never routes a stock image through the guided flow', () => {
    for (const bad of ['ImagePicker', 'attribution', 'imageByScheduleId']) {
      expect(PANEL).not.toContain(bad);
    }
  });

  it('CRITICAL: it reuses the ONE guided panel rather than copying it', () => {
    expect(PANEL).toContain("from '../creator/CreatorImageAssetPanel'");
    expect(PANEL).toContain('<CreatorImageAssetPanel');
    // No second guided-treatment implementation.
    for (const bad of ['proposeImageTreatment', 'describeTreatment', 'slotAcceptance']) {
      expect(PANEL).not.toContain(bad);
    }
  });

  it('CRITICAL: the activity composition id is what it hands the panel', () => {
    expect(PANEL).toContain('compositionId={creative.composition_id}');
    // Never the Creator session token hook.
    expect(PANEL).not.toContain('useCreatorCompositionId');
    expect(PANEL).not.toContain('sessionStorage');
  });

  it('nothing is offered until a creative actually exists', () => {
    expect(PANEL).toContain('if (!creative || !creative.refinable) return null;');
  });

  it('the user is told the original survives', () => {
    expect(PANEL).toContain('The original stays saved.');
  });

  it('it declares the family so infographic wording stays truthful', () => {
    expect(PANEL).toContain('assetFamily={assetFamily(creative.asset_type)}');
    expect(PANEL).toContain("if (t.includes('infographic')) return 'infographic';");
  });
});

/* ── G. Re-entry: what the user sees when they come back ────────────────────*/

describe('G — a refinement survives leaving and returning', () => {
  it('with no refinement, the campaign original is what is shown', async () => {
    const out = await resolveActivityCreative({ companyId: 'co-A', activityId: 'act-A' });
    expect(out!.currentVersion).toBe(1);
    expect(out!.isRefined).toBe(false);
    expect(out!.urls).toEqual(['https://cdn/x.png']);
  });

  it('CRITICAL: after refining, re-entry shows the REFINED render, not the original', async () => {
    // This is the defect Phase 65 set out to find: refinement records a new
    // version on the envelope and deliberately does not rewrite campaign
    // history, so an endpoint reading only the activity row would show the
    // original again and the user would think their work was lost.
    libEnvelope = {
      id: 'asset-1',
      currentVersion: 2,
      versions: [
        { version: 1, op: 'generate', payload: { url: 'https://cdn/x.png' } },
        { version: 2, op: 'version', payload: { url: 'https://cdn/refined.png' } },
      ],
    };
    const out = await resolveActivityCreative({ companyId: 'co-A', activityId: 'act-A' });
    expect(out!.currentVersion).toBe(2);
    expect(out!.isRefined).toBe(true);
    expect(out!.urls).toEqual(['https://cdn/refined.png']);
  });

  it('CRITICAL: the campaign original is still recoverable from the envelope', async () => {
    libEnvelope = {
      id: 'asset-1',
      currentVersion: 3,
      versions: [
        { version: 1, op: 'generate', payload: { url: 'https://cdn/x.png' } },
        { version: 2, op: 'version', payload: { url: 'https://cdn/r2.png' } },
        { version: 3, op: 'version', payload: { url: 'https://cdn/r3.png' } },
      ],
    };
    const out = await resolveActivityCreative({ companyId: 'co-A', activityId: 'act-A' });
    expect(out!.currentVersion).toBe(3);
    expect(out!.urls).toEqual(['https://cdn/r3.png']);
    // Version 1 is untouched in the history the envelope still carries.
    const v1 = (libEnvelope.versions as Record<string, unknown>[])[0];
    expect((v1.payload as Record<string, unknown>).url).toBe('https://cdn/x.png');
  });

  it('the composition is unchanged by refinement — references stay attached', async () => {
    libEnvelope = {
      id: 'asset-1', currentVersion: 2,
      versions: [{ version: 1, op: 'generate', payload: {} }, { version: 2, op: 'version', payload: {} }],
    };
    const out = await resolveActivityCreative({ companyId: 'co-A', activityId: 'act-A' });
    expect(out!.compositionId).toBe('act-A');
  });

  it('an unreadable envelope falls back to the campaign render, never to nothing', async () => {
    libEnvelope = null;   // persistence unavailable
    const out = await resolveActivityCreative({ companyId: 'co-A', activityId: 'act-A' });
    expect(out!.urls).toEqual(['https://cdn/x.png']);
    expect(out!.isRefined).toBe(false);
  });

  it('a refinement with no usable url falls back rather than showing an empty frame', async () => {
    libEnvelope = {
      id: 'asset-1', currentVersion: 2,
      versions: [{ version: 1, op: 'generate', payload: {} }, { version: 2, op: 'version', payload: {} }],
    };
    const out = await resolveActivityCreative({ companyId: 'co-A', activityId: 'act-A' });
    expect(out!.urls).toEqual(['https://cdn/x.png']);
  });

  it('CRITICAL: re-entry depends on no browser state whatsoever', () => {
    const panel = require('fs').readFileSync(require('path').resolve(
      __dirname, '../../../components/activity-workspace/ActivityCreativeRefinementPanel.tsx'), 'utf8');
    for (const bad of ['sessionStorage', 'localStorage', 'useCreatorCompositionId']) {
      expect(panel).not.toContain(bad);
    }
  });

  it('the workspace can name which version it is showing', () => {
    const panel = require('fs').readFileSync(require('path').resolve(
      __dirname, '../../../components/activity-workspace/ActivityCreativeRefinementPanel.tsx'), 'utf8');
    expect(panel).toContain('creative.is_refined');
    expect(panel).toContain('The campaign original is still saved.');
  });
});

/* ── H. The upload must have somewhere to go ────────────────────────────────*/

describe('H — the panel is given the design contract it needs', () => {
  const read = (rel: string) => require('fs').readFileSync(
    require('path').resolve(__dirname, '../../..', rel), 'utf8');
  const ROUTE = read('pages/api/activity-workspace/creative.ts');
  const PANEL = read('components/activity-workspace/ActivityCreativeRefinementPanel.tsx');

  it('CRITICAL: the route resolves the template slots through the ONE resolver', () => {
    // Without slots the panel reads "this design accepts nothing" and the user
    // can upload but never attach — refinement becomes a dead end.
    expect(ROUTE).toContain('getTemplateById');
    expect(ROUTE).toContain('template_slots');
    // No second template registry.
    expect(ROUTE).not.toMatch(/SUPPORTED_SLOTS|TEMPLATE_SLOT_MAP|new Map\(/);
  });

  it('CRITICAL: the panel passes them on', () => {
    expect(PANEL).toContain('templateSlots={(creative.template_slots ?? null) as never}');
  });

  it('an unresolvable template yields no slots rather than invented ones', () => {
    expect(ROUTE).toMatch(/catch \{ return null; \}/);
    expect(ROUTE).toContain('if (!creative.templateId) return null;');
  });
});
