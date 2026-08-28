/**
 * Phase 103 — a campaign is allowed to be about one thing.
 *
 * THE PRODUCTION FAILURE THIS ENCODES
 * -----------------------------------
 * Campaign 4ead230b (LinkedIn + Facebook, poll + article, 1 week) planned six
 * activities correctly — `daily_content_plans` held all six, across both
 * platforms. Generation then produced all six. Semantic validation dropped five:
 *
 *     generated: 6, validated: 1, accepted: 1, dropped: 5,
 *     reasons: { duplicate_narrative: 5 }
 *
 * One scheduled_post survived out of six, silently.
 *
 * WHY IT HAPPENED
 * ---------------
 * `narrative_fingerprint` and `idea_fingerprint` are sourced from FIXED campaign
 * metadata, so every activity of a campaign carries the same value by
 * construction. Held in a campaign-global Set, the first activity was accepted
 * and every sibling after it looked like a duplicate — of its own campaign.
 *
 * `headlines` and `ctas` had this identical bug and were already scoped to
 * platform+content_type, with the reason recorded in their docblocks. The two
 * fingerprints were never scoped, and they are worse because they are TERMINAL:
 * a collision DROPS rather than regenerates.
 *
 * These tests pin the scoped meaning across every platform in the registry and
 * all three campaign modes' shapes, so no future change can quietly restore a
 * campaign-global set.
 */

export {};

import {
  ValidationContext,
  InMemoryLedger,
  validateAsset,
  type GeneratedAsset,
} from '../../../lib/shared/campaign/semanticValidation';

/** Every platform the authoritative registry declares. */
const REGISTRY_PLATFORMS = [
  'linkedin', 'x', 'facebook', 'instagram', 'pinterest',
  'tiktok', 'youtube', 'reddit', 'whatsapp', 'threads', 'blog',
];

const NARRATIVE = 'narr-campaign-one';
const IDEA = 'idea-campaign-one';

/** An activity of the one campaign: same narrative, distinct text. */
function activity(platform: string, contentType: string, n: number): GeneratedAsset {
  return {
    platform,
    content_type: contentType,
    text: `Distinct body copy number ${n} for ${platform} ${contentType}.`,
    headline: `Headline ${n} ${platform} ${contentType}`,
    cta: `Call to action ${n} ${platform} ${contentType}`,
    opening: `Opening sentence ${n} for ${platform} ${contentType}.`,
    idea_fingerprint: IDEA,
    narrative_fingerprint: NARRATIVE,
  } as GeneratedAsset;
}

/** Run a list of activities through one context, as a campaign run does. */
function runCampaign(items: GeneratedAsset[]) {
  const ctx = new ValidationContext();
  const results = items.map((a) => {
    const r = validateAsset(a, ctx);
    if (r.decision === 'ACCEPT') ctx.commit(a);
    return r;
  });
  return {
    results,
    accepted: results.filter((r) => r.decision === 'ACCEPT').length,
    dropped: results.filter((r) => r.decision === 'DROP').length,
  };
}

describe('A — the exact production campaign now schedules in full', () => {
  // The real allocation: {facebook: 2, linkedin: 4}, mix ["poll","article"].
  const SIX = [
    activity('linkedin', 'article', 1),
    activity('linkedin', 'poll', 2),
    activity('linkedin', 'poll', 3),
    activity('linkedin', 'article', 4),
    activity('facebook', 'poll', 5),
    activity('facebook', 'article', 6),
  ];

  it('CRITICAL: all six planned activities are accepted', () => {
    const { accepted, dropped } = runCampaign(SIX);
    // Production produced accepted=1, dropped=5. Planner allocation is
    // authoritative: six planned slots must yield six schedulable activities,
    // including the second li/article and second li/poll on different days.
    expect(accepted).toBe(6);
    expect(dropped).toBe(0);
  });

  it('CRITICAL: Facebook activities survive alongside LinkedIn', () => {
    const { results } = runCampaign(SIX);
    // Facebook is the 5th and 6th; both must be ACCEPT. In production both were
    // dropped, which is why the campaign showed LinkedIn only.
    expect(results[4].decision).toBe('ACCEPT');
    expect(results[5].decision).toBe('ACCEPT');
  });

  it('CRITICAL: both content types survive on both platforms', () => {
    const { results } = runCampaign(SIX);
    // li/article, li/poll, fb/poll, fb/article — one of each, all accepted.
    expect(results[0].decision).toBe('ACCEPT');   // linkedin article
    expect(results[1].decision).toBe('ACCEPT');   // linkedin poll
    expect(results[4].decision).toBe('ACCEPT');   // facebook poll
    expect(results[5].decision).toBe('ACCEPT');   // facebook article
  });

  it('CRITICAL: a distinct platform+type is never dropped for duplicate_narrative', () => {
    const distinct = [
      activity('linkedin', 'article', 1),
      activity('linkedin', 'poll', 2),
      activity('facebook', 'poll', 3),
      activity('facebook', 'article', 4),
    ];
    const { results, dropped } = runCampaign(distinct);
    expect(dropped).toBe(0);
    expect(results.flatMap((r) => r.findings).filter((f) => f.dimension === 'duplicate_narrative')).toHaveLength(0);
  });
});

describe('B — genuine duplicate protection is intact', () => {
  it('CRITICAL: identical TEXT on the same platform+type is still caught', () => {
    // In-run protection now rests on real generated content, not a constant.
    const ctx = new ValidationContext();
    const first = activity('linkedin', 'article', 1);
    ctx.commit(first);

    const clone = { ...activity('linkedin', 'article', 2), text: first.text } as GeneratedAsset;
    const r = validateAsset(clone, ctx);
    expect(r.findings.some((f) => f.dimension === 'duplicate_asset')).toBe(true);
    expect(r.decision).toBe('REGENERATE');
  });

  it('CRITICAL: a repeated headline is still caught', () => {
    const ctx = new ValidationContext();
    const first = activity('linkedin', 'article', 1);
    ctx.commit(first);
    const same = { ...activity('linkedin', 'article', 2), headline: first.headline } as GeneratedAsset;
    expect(validateAsset(same, ctx).findings.some((f) => f.dimension === 'duplicate_headline')).toBe(true);
  });

  it('CRITICAL: a repeated opening is still caught', () => {
    const ctx = new ValidationContext();
    const first = activity('linkedin', 'article', 1);
    ctx.commit(first);
    const same = { ...activity('facebook', 'post', 2), opening: first.opening } as GeneratedAsset;
    expect(validateAsset(same, ctx).findings.some((f) => f.dimension === 'duplicate_opening')).toBe(true);
  });

  it('CRITICAL: cross-campaign reuse of an IDEA is still caught, via the ledger', () => {
    // Unchanged behaviour: `historical_duplication` consults the ledger and
    // keeps its REGENERATE policy — the caller can rewrite the content even
    // though it cannot change a fixed fingerprint.
    const ledger = new InMemoryLedger();
    ledger.add(IDEA);
    const ctx = new ValidationContext(ledger);

    const r = validateAsset(activity('linkedin', 'article', 1), ctx);
    expect(r.findings.some((f) => f.dimension === 'historical_duplication')).toBe(true);
    expect(r.decision).toBe('REGENERATE');
  });

  it('CRITICAL: accepting one activity does NOT poison the ledger for its siblings', () => {
    // The historical door must not reintroduce the in-run bug: committing an
    // accepted activity must not write its campaign-constant fingerprint back.
    const ledger = new InMemoryLedger();
    const ctx = new ValidationContext(ledger);
    const first = activity('linkedin', 'article', 1);
    expect(validateAsset(first, ctx).decision).toBe('ACCEPT');
    ctx.commit(first);

    expect(ledger.has(NARRATIVE)).toBe(false);
    expect(ledger.has(IDEA)).toBe(false);
    expect(validateAsset(activity('facebook', 'poll', 2), ctx).decision).toBe('ACCEPT');
  });
});

describe('C — every platform in the registry, one shared narrative', () => {
  it('CRITICAL: one narrative fans out across all registry platforms', () => {
    const items = REGISTRY_PLATFORMS.map((p, i) => activity(p, 'post', i + 1));
    const { accepted, dropped } = runCampaign(items);
    expect(accepted).toBe(REGISTRY_PLATFORMS.length);
    expect(dropped).toBe(0);
  });

  it('CRITICAL: and across all registry platforms × two content types', () => {
    const items = REGISTRY_PLATFORMS.flatMap((p, i) => [
      activity(p, 'article', i * 2 + 1),
      activity(p, 'poll', i * 2 + 2),
    ]);
    const { accepted, dropped } = runCampaign(items);
    expect(accepted).toBe(REGISTRY_PLATFORMS.length * 2);
    expect(dropped).toBe(0);
  });

  it('CRITICAL: repeated platform+type in one campaign is accepted, whatever the casing', () => {
    const ctx = new ValidationContext();
    const a = activity('LinkedIn', 'Article', 1);
    ctx.commit(a);
    // Two slots of the same format on one platform is a legitimate plan, and
    // casing must not resurrect a drop through a scope-key difference.
    expect(validateAsset(activity('linkedin', 'article', 2), ctx).decision).toBe('ACCEPT');
  });
});

describe('D — campaign-mode shapes', () => {
  it('CRITICAL: a creator-style deck sharing the campaign narrative is not dropped', () => {
    // Bold Creator: carousel + image variants of one campaign idea.
    const items = [
      activity('linkedin', 'carousel', 1),
      activity('linkedin', 'image', 2),
      activity('instagram', 'carousel', 3),
    ];
    expect(runCampaign(items).dropped).toBe(0);
  });

  it('CRITICAL: an intelligent-mix week mixing formats and platforms is not dropped', () => {
    const items = [
      activity('linkedin', 'article', 1),
      activity('x', 'post', 2),
      activity('facebook', 'post', 3),
      activity('instagram', 'image', 4),
      activity('youtube', 'video', 5),
    ];
    expect(runCampaign(items).dropped).toBe(0);
  });

  it('a long single-topic campaign schedules every slot across its weeks', () => {
    // 4 weeks × 3 slots, rotating two formats on one platform pair.
    const items: GeneratedAsset[] = [];
    let n = 0;
    for (let week = 0; week < 4; week += 1) {
      items.push(activity('linkedin', 'article', ++n));
      items.push(activity('linkedin', 'poll', ++n));
      items.push(activity('facebook', 'post', ++n));
    }
    const { accepted, dropped } = runCampaign(items);
    // 4 weeks × 3 slots = 12 planned activities, all on one campaign narrative.
    // Every one must schedule: the planner decided the cadence, and a constant
    // fingerprint cannot argue with it.
    expect(accepted).toBe(12);
    expect(dropped).toBe(0);
  });
});
