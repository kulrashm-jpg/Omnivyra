import {
  listCreationGoals, getCreationGoal, CONTENT_TYPES, getContentType, listContentTypes,
  routeGoalToContentTypes, emptyMarketingBrief, mergeBrief, buildCreationPlan, type CreationLane,
} from '../../../lib/content/unifiedCreationModel';

const LANES: CreationLane[] = ['writer', 'creator', 'campaign'];

describe('CREATOR-057 — Unified creation model', () => {
  it('STEP 3 — normalized content types: unique ids, every lane populated, real routes', () => {
    expect(new Set(CONTENT_TYPES.map((c) => c.id)).size).toBe(CONTENT_TYPES.length); // no duplicate terminology
    expect(listContentTypes('writer').map((c) => c.id)).toEqual(['blog', 'article', 'story', 'guide', 'newsletter', 'whitepaper', 'case-study']);
    expect(listContentTypes('creator').length).toBe(5);
    expect(listContentTypes('campaign').length).toBe(3);
    for (const c of CONTENT_TYPES) {
      expect(LANES).toContain(c.lane);
      expect(c.entryRoute.startsWith('/')).toBe(true);
      if (c.lane === 'creator') expect(['image', 'carousel', 'infographic']).toContain(c.family);
    }
  });

  it('STEP 4 — goals reuse the canonical outcome registry (no duplicate taxonomy)', () => {
    expect(listCreationGoals().length).toBe(23);
    expect(getCreationGoal('launch-product')).not.toBeNull();
    expect(getCreationGoal('nope')).toBeNull();
  });

  it('STEP 5 — every goal routes to ≥1 valid content type; routes reference real types + lanes', () => {
    for (const g of listCreationGoals()) {
      const routes = routeGoalToContentTypes(g.id);
      expect(routes.length).toBeGreaterThan(0);
      for (const r of routes) {
        expect(getContentType(r.contentType.id)).not.toBeNull();
        expect(r.contentType.lane).toBe(r.lane);
        expect(r.rationale.length).toBeGreaterThan(5);
      }
      // Creator routes mirror the goal's supported families.
      const creatorIds = routes.filter((r) => r.lane === 'creator').map((r) => r.contentType.family);
      for (const f of g.supportedFamilies) expect(creatorIds).toContain(f);
    }
    // Spot-check the spec's routing examples.
    const tl = routeGoalToContentTypes('industry-insight').map((r) => r.contentType.id);
    expect(tl).toEqual(expect.arrayContaining(['article', 'carousel']));
    const launch = routeGoalToContentTypes('launch-product').map((r) => r.contentType.id);
    expect(launch).toEqual(expect.arrayContaining(['image', 'bolt-creator-campaign']));
    const story = routeGoalToContentTypes('customer-success').map((r) => r.contentType.id);
    expect(story).toEqual(expect.arrayContaining(['case-study', 'carousel']));
  });

  it('STEP 6 — one shared brief; merge is last-write-wins and preserves arrays', () => {
    const b = emptyMarketingBrief('launch-product');
    expect(b.goalId).toBe('launch-product');
    expect(b.files).toEqual([]);
    const m = mergeBrief(b, { audience: 'founders', tone: 'confident' });
    expect(m.audience).toBe('founders');
    expect(mergeBrief(m, { audience: 'execs' }).audience).toBe('execs');
    expect(mergeBrief(m, { competitors: ['x'] }).competitors).toEqual(['x']);
  });

  it('STEP 7/8 — one plan fans out across lanes; selection filters; unknown goal → null', () => {
    const plan = buildCreationPlan('launch-product', emptyMarketingBrief('launch-product'));
    expect(plan).not.toBeNull();
    expect(plan!.approved).toBe(false);
    expect(plan!.brief.goalId).toBe('launch-product');
    const all = [...plan!.lanes.writer, ...plan!.lanes.creator, ...plan!.lanes.campaign];
    expect(all.length).toBeGreaterThan(0);
    for (const lane of LANES) for (const ct of plan!.lanes[lane]) expect(ct.lane).toBe(lane);
    // Selection narrows the plan.
    const narrowed = buildCreationPlan('launch-product', emptyMarketingBrief(), ['image']);
    expect(narrowed!.lanes.creator.map((c) => c.id)).toEqual(['image']);
    expect(narrowed!.lanes.campaign.length).toBe(0);
    expect(buildCreationPlan('nope', emptyMarketingBrief())).toBeNull();
  });
});
