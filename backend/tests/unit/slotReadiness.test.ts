/**
 * P3-B — per-slot review package + derived readiness (PURE).
 *
 * The invariant under test: what the CMO approves is the same package the
 * scheduler will attempt. Text approval alone is not slot readiness when an
 * asset is assigned, and an approved package on a media-incapable platform is
 * not execution-ready.
 */

import {
  deriveSlotReviewPackages,
  deriveSlotReadiness,
  summarizeSlotReadiness,
  type ReviewableAssetSource,
} from '../../../lib/campaign/slotReadiness';
import type { CampaignAssignment } from '../../../lib/campaign/campaignAssignments';

/* ── fixtures ── */

const activity = (over: Record<string, unknown> = {}) => ({
  execution_id: 'slot-1',
  week_number: 1,
  day: 'Monday',
  platform: 'linkedin',
  content_type: 'post',
  title: 'Twelve-day close',
  ...over,
});

const plan = (activities: Array<Record<string, unknown>>) => ({ activities } as never);

const approvedText = { draft_content: { body: 'Approved copy.', source: 'ai', updated_at: 'x' }, content_planning_status: 'approved' };
const draftText = { draft_content: { body: 'Half written.', source: 'manual', updated_at: 'x' }, content_planning_status: 'draft' };
const reviewText = { draft_content: { body: 'Pending.', source: 'ai', updated_at: 'x' }, content_planning_status: 'review' };

const assignment = (over: Partial<CampaignAssignment> = {}): CampaignAssignment => ({
  id: 'as-1', campaign_id: 'camp-1', asset_id: 'asset-1', asset_version: 1,
  structure_id: 'slot-1', week: 1, day: 'Monday', platform: 'linkedin',
  content_type: 'image', slot: 'primary', status: 'confirmed', notes: '', ordering: 0,
  created_at: 'x', updated_at: 'x', ...over,
} as CampaignAssignment);

const lib = (entries: ReviewableAssetSource[]) =>
  new Map(entries.map((e) => [e.id, e]));

const image: ReviewableAssetSource = { id: 'asset-1', title: 'Hero image', url: 'https://cdn/x.png', files: null, creatorType: 'image', version: 1 };
const carousel = (urls: Array<string | null>): ReviewableAssetSource => ({
  id: 'asset-1', title: 'Five-slide deck', url: null,
  files: urls.map((u) => (u === null ? {} : { url: u })), creatorType: 'carousel', version: 2,
});
const video: ReviewableAssetSource = { id: 'asset-1', title: 'Demo', url: 'https://youtu.be/abc', files: null, creatorType: 'video', version: 1 };

const pkg = (over: {
  activityOver?: Record<string, unknown>;
  assignments?: CampaignAssignment[];
  assets?: Map<string, ReviewableAssetSource>;
  requireApproval?: boolean;
  capability?: Record<string, boolean>;
} = {}) =>
  deriveSlotReviewPackages({
    plan: plan([activity(over.activityOver ?? approvedText)]),
    assignments: over.assignments ?? [],
    assets: over.assets ?? null,
    requireApproval: over.requireApproval,
    capability: over.capability ? { mediaCapableByPlatform: over.capability } : undefined,
  })[0];

/* ── TEXT ── */

describe('text-only slots', () => {
  it('approved text with no asset required → READY', () => {
    const p = pkg();
    expect(p.readiness.code).toBe('ready');
    expect(p.readiness.review_ready).toBe(true);
    expect(p.readiness.execution_ready).toBe(true);
  });

  it('draft text → blocked_text', () => {
    expect(pkg({ activityOver: draftText }).readiness).toMatchObject({ code: 'blocked_text', review_ready: false });
  });

  it('review text → blocked_text with an actionable reason', () => {
    const r = pkg({ activityOver: reviewText }).readiness;
    expect(r.code).toBe('blocked_text');
    expect(r.reason).toMatch(/awaiting approval/i);
  });

  it('no content at all → blocked_text', () => {
    expect(pkg({ activityOver: {} }).readiness.code).toBe('blocked_text');
  });
});

/* ── IMAGE ── */

describe('image slots', () => {
  it('approved text + available image → READY when the platform can publish media', () => {
    const p = pkg({ assignments: [assignment()], assets: lib([image]), capability: { linkedin: true } });
    expect(p.readiness.code).toBe('ready');
    expect(p.assets[0].slides).toEqual([{ index: 1, url: 'https://cdn/x.png', available: true }]);
  });

  it('assigned asset missing from the library → blocked_asset', () => {
    const p = pkg({ assignments: [assignment()], assets: lib([]) });
    expect(p.readiness.code).toBe('blocked_asset');
    expect(p.assets[0].missing).toBe(true);
    expect(p.readiness.reason).toMatch(/could not be found/i);
  });

  it('asset present but with no usable URL → blocked_asset', () => {
    const p = pkg({ assignments: [assignment()], assets: lib([{ ...image, url: null }]) });
    expect(p.readiness.code).toBe('blocked_asset');
    expect(p.assets[0].fully_available).toBe(false);
  });

  it('TEXT APPROVAL ALONE does not make an image slot ready', () => {
    // The defect P3-B closes: approved text, unavailable asset.
    expect(pkg({ assignments: [assignment()], assets: lib([{ ...image, url: null }]) }).readiness.code)
      .not.toBe('ready');
  });
});

/* ── CAROUSEL ── */

describe('carousel slots', () => {
  it('all slides available → READY, ordering preserved', () => {
    const urls = ['https://cdn/1.png', 'https://cdn/2.png', 'https://cdn/3.png'];
    const p = pkg({ assignments: [assignment({ content_type: 'carousel' })], assets: lib([carousel(urls)]), capability: { linkedin: true } });
    expect(p.readiness.code).toBe('ready');
    expect(p.assets[0].slides.map((s) => s.index)).toEqual([1, 2, 3]);
    expect(p.assets[0].slides.map((s) => s.url)).toEqual(urls);
  });

  it('4 of 5 slides available → blocked_asset, and the missing slide is NOT dropped', () => {
    const p = pkg({
      assignments: [assignment({ content_type: 'carousel' })],
      assets: lib([carousel(['https://cdn/1.png', 'https://cdn/2.png', null, 'https://cdn/4.png', 'https://cdn/5.png'])]),
      capability: { linkedin: true },
    });
    expect(p.readiness.code).toBe('blocked_asset');
    // Five slides are still reported — an omitted slide would read as complete.
    expect(p.assets[0].slides).toHaveLength(5);
    expect(p.assets[0].slides[2]).toMatchObject({ index: 3, url: null, available: false });
    expect(p.readiness.reason).toMatch(/1 asset file/);
  });

  it('a partially available carousel never reads as an approved complete carousel', () => {
    const p = pkg({
      assignments: [assignment({ content_type: 'carousel' })],
      assets: lib([carousel(['https://cdn/1.png', null])]),
      capability: { linkedin: true },
    });
    expect(p.readiness.review_ready).toBe(false);
    expect(p.assets[0].fully_available).toBe(false);
  });
});

/* ── VIDEO ── */

describe('video slots', () => {
  it('available video is reviewable and flagged as video', () => {
    const p = pkg({ assignments: [assignment({ content_type: 'video' })], assets: lib([video]), capability: { linkedin: true } });
    expect(p.assets[0].is_video).toBe(true);
    expect(p.readiness.code).toBe('ready');
  });

  it('unavailable external video → blocked_asset', () => {
    const p = pkg({ assignments: [assignment({ content_type: 'video' })], assets: lib([{ ...video, url: null }]) });
    expect(p.readiness.code).toBe('blocked_asset');
  });
});

/* ── MULTI-ASSET ── */

describe('multi-asset slots', () => {
  it('preserves assignment ordering and surfaces every asset', () => {
    const p = pkg({
      assignments: [
        assignment({ id: 'as-2', asset_id: 'asset-2', ordering: 1, slot: 'story' }),
        assignment({ id: 'as-1', asset_id: 'asset-1', ordering: 0, slot: 'primary' }),
      ],
      assets: lib([image, { ...image, id: 'asset-2', title: 'Story card' }]),
      capability: { linkedin: true },
    });
    expect(p.assets.map((a) => a.asset_id)).toEqual(['asset-1', 'asset-2']);
    expect(p.assets.map((a) => a.slot_role)).toEqual(['primary', 'story']);
  });

  it('asset 1 available + asset 2 unavailable → NOT ready', () => {
    const p = pkg({
      assignments: [assignment({ id: 'as-1', asset_id: 'asset-1', ordering: 0 }), assignment({ id: 'as-2', asset_id: 'asset-2', ordering: 1 })],
      assets: lib([image, { ...image, id: 'asset-2', url: null }]),
      capability: { linkedin: true },
    });
    expect(p.readiness.code).toBe('blocked_asset');
  });
});

/* ── APPROVAL INTERACTION ── */

describe('text and asset approval are independent facts', () => {
  it('with approvals required, an unapproved assignment blocks an approved text', () => {
    const p = pkg({
      assignments: [assignment({ approval: 'pending' })], assets: lib([image]),
      requireApproval: true, capability: { linkedin: true },
    });
    expect(p.readiness.code).toBe('blocked_asset');
    expect(p.readiness.reason).toMatch(/need approval/i);
  });

  it('approved assignment + approved text → ready', () => {
    const p = pkg({
      assignments: [assignment({ approval: 'approved' })], assets: lib([image]),
      requireApproval: true, capability: { linkedin: true },
    });
    expect(p.readiness.code).toBe('ready');
  });

  it('asset approval alone does NOT approve the text', () => {
    const p = pkg({
      activityOver: draftText, assignments: [assignment({ approval: 'approved' })],
      assets: lib([image]), requireApproval: true, capability: { linkedin: true },
    });
    expect(p.readiness.code).toBe('blocked_text');
  });

  it('when the company does not require approvals, assignment approval is not demanded', () => {
    const p = pkg({
      assignments: [assignment({ approval: 'pending' })], assets: lib([image]),
      requireApproval: false, capability: { linkedin: true },
    });
    expect(p.readiness.code).toBe('ready');
  });

  it("legacy assignments with no approval field behave as 'not_required'", () => {
    const a = assignment();
    delete (a as unknown as Record<string, unknown>).approval;
    const p = pkg({ assignments: [a], assets: lib([image]), requireApproval: true, capability: { linkedin: true } });
    expect(p.assets[0].approval).toBe('not_required');
    expect(p.readiness.code).toBe('ready');
  });
});

/* ── EXECUTION CAPABILITY (consumed, never decided here) ── */

describe('execution capability', () => {
  it('media on a media-incapable platform → blocked_execution, but review_ready stays true', () => {
    const p = pkg({ assignments: [assignment()], assets: lib([image]), capability: { linkedin: false } });
    expect(p.readiness.code).toBe('blocked_execution');
    expect(p.readiness.review_ready).toBe(true);   // humans DID approve it
    expect(p.readiness.execution_ready).toBe(false);
    expect(p.readiness.reason).toMatch(/text only/i);
  });

  it('unknown capability → execution_unknown, never an unearned "ready"', () => {
    const p = pkg({ assignments: [assignment()], assets: lib([image]) }); // no capability supplied
    expect(p.readiness.code).toBe('execution_unknown');
    expect(p.readiness.execution_ready).toBeNull();
  });

  it('capability is irrelevant to a text-only slot', () => {
    expect(pkg({ capability: { linkedin: false } }).readiness.code).toBe('ready');
  });

  it('review readiness and execution readiness are separate values', () => {
    const r = deriveSlotReadiness({
      text: { body: 'x', status: 'approved', has_content: true, manually_edited: false },
      assets: [{
        assignment_id: 'a', asset_id: 'x', title: null, creator_type: 'image', version: 1,
        slot_role: null, approval: 'not_required',
        slides: [{ index: 1, url: 'https://cdn/a.png', available: true }],
        fully_available: true, missing: false, is_video: false,
      }],
      platform: 'linkedin',
      capability: { mediaCapableByPlatform: { linkedin: false } },
    });
    expect(r.review_ready).toBe(true);
    expect(r.execution_ready).toBe(false);
  });
});

/* ── PLATFORM VARIANTS ── */

describe('platform variants stay independent', () => {
  it('LinkedIn and X slots are separate packages with separate verdicts', () => {
    const packages = deriveSlotReviewPackages({
      plan: plan([
        activity({ execution_id: 'li', platform: 'linkedin', ...approvedText }),
        activity({ execution_id: 'x', platform: 'x', ...draftText }),
      ]),
      assignments: [],
      assets: null,
    });
    expect(packages).toHaveLength(2);
    expect(packages.find((p) => p.slot.structure_id === 'li')!.readiness.code).toBe('ready');
    expect(packages.find((p) => p.slot.structure_id === 'x')!.readiness.code).toBe('blocked_text');
  });

  it('an asset assigned to one platform slot does not leak into the sibling', () => {
    const packages = deriveSlotReviewPackages({
      plan: plan([
        activity({ execution_id: 'li', platform: 'linkedin', ...approvedText }),
        activity({ execution_id: 'x', platform: 'x', ...approvedText }),
      ]),
      assignments: [assignment({ structure_id: 'li' })],
      assets: lib([image]),
      capability: { mediaCapableByPlatform: { linkedin: true, x: true } },
    });
    expect(packages.find((p) => p.slot.structure_id === 'li')!.assets).toHaveLength(1);
    expect(packages.find((p) => p.slot.structure_id === 'x')!.assets).toHaveLength(0);
  });
});

/* ── MANUAL EDITS ── */

describe('manual edits survive review', () => {
  it('the reviewed body is the persisted manual body, and the flag is carried', () => {
    const p = pkg({
      activityOver: {
        draft_content: { body: 'Hand-written by the CMO.', source: 'manual', updated_at: 'x', manually_edited: true },
        content_planning_status: 'approved',
      },
    });
    expect(p.text.body).toBe('Hand-written by the CMO.');
    expect(p.text.manually_edited).toBe(true);
    expect(p.readiness.code).toBe('ready');
  });
});

/* ── DETERMINISM + SUMMARY ── */

describe('determinism and summary', () => {
  it('same facts → identical package', () => {
    const a = pkg({ assignments: [assignment()], assets: lib([image]), capability: { linkedin: true } });
    const b = pkg({ assignments: [assignment()], assets: lib([image]), capability: { linkedin: true } });
    expect(a).toEqual(b);
  });

  it('tolerates empty and absent input', () => {
    expect(deriveSlotReviewPackages({ plan: null, assignments: null })).toEqual([]);
  });

  it('summarizes counts by verdict', () => {
    const packages = deriveSlotReviewPackages({
      plan: plan([
        activity({ execution_id: 'a', ...approvedText }),
        activity({ execution_id: 'b', ...draftText }),
        activity({ execution_id: 'c', ...reviewText }),
      ]),
      assignments: [], assets: null,
    });
    expect(summarizeSlotReadiness(packages)).toMatchObject({ ready: 1, blocked_text: 2, total: 3 });
  });

  it('does NOT consult campaign_readiness (informational since B1)', () => {
    const src = require('fs').readFileSync(
      require('path').join(__dirname, '../../../lib/campaign/slotReadiness.ts'), 'utf8',
    ).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
    expect(src).not.toContain('campaign_readiness');
    expect(src).not.toContain('readiness_state');
  });
});
