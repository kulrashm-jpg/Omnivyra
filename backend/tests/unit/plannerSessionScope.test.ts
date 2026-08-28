/**
 * BLOCK-3 — the storage-ownership rule, in isolation.
 *
 * The scenario matrix (plannerSessionScoping.dom.test.tsx) proves the
 * behaviour against the real provider. This pins the rule itself, including
 * the part that is easy to "simplify" away later: the company scope is
 * CORRECT for the draft, and only non-draft entries must be excluded from it.
 */

import {
  resolvePlannerStorageKey,
  plannerEntryOwnsDraftCache,
  PLANNER_STORAGE_KEY_PREFIX,
} from '../../../lib/campaign/plannerSessionScope';

const CO = 'company-a';

describe('the draft owns the company slot', () => {
  it('a draft-mode entry keys on the company', () => {
    expect(resolvePlannerStorageKey({ companyId: CO }))
      .toBe(`${PLANNER_STORAGE_KEY_PREFIX}${CO}`);
  });

  it('the key is unchanged from what shipped — existing sessions still restore', () => {
    // Re-keying would silently orphan every in-flight draft session.
    expect(resolvePlannerStorageKey({ companyId: CO })).toBe('omnivyra_planner_session_company-a');
  });

  it('different companies never share a slot', () => {
    expect(resolvePlannerStorageKey({ companyId: 'a' }))
      .not.toBe(resolvePlannerStorageKey({ companyId: 'b' }));
  });

  it('a missing company falls back to one stable slot, as before', () => {
    expect(resolvePlannerStorageKey({ companyId: null })).toBe(`${PLANNER_STORAGE_KEY_PREFIX}default`);
    expect(resolvePlannerStorageKey({ companyId: '   ' })).toBe(`${PLANNER_STORAGE_KEY_PREFIX}default`);
  });

  it('whitespace around a company id does not fork the slot', () => {
    expect(resolvePlannerStorageKey({ companyId: `  ${CO}  ` }))
      .toBe(resolvePlannerStorageKey({ companyId: CO }));
  });
});

describe('an explicit campaign entry owns no slot', () => {
  it('returns null so the entry neither restores nor persists', () => {
    expect(resolvePlannerStorageKey({ companyId: CO, campaignId: 'campaign-1' })).toBeNull();
  });

  it('the campaign id wins over the company — it is the more specific identity', () => {
    expect(plannerEntryOwnsDraftCache({ companyId: CO })).toBe(true);
    expect(plannerEntryOwnsDraftCache({ companyId: CO, campaignId: 'campaign-1' })).toBe(false);
  });

  it('an empty/whitespace campaignId is NOT a campaign entry', () => {
    // `?campaignId=` with no value must not silently disable the draft cache.
    expect(resolvePlannerStorageKey({ companyId: CO, campaignId: '' }))
      .toBe(`${PLANNER_STORAGE_KEY_PREFIX}${CO}`);
    expect(resolvePlannerStorageKey({ companyId: CO, campaignId: '   ' }))
      .toBe(`${PLANNER_STORAGE_KEY_PREFIX}${CO}`);
  });

  it('no campaign entry can ever collide with a draft slot', () => {
    for (const id of ['campaign-1', CO, 'default', 'x']) {
      expect(resolvePlannerStorageKey({ companyId: CO, campaignId: id })).toBeNull();
    }
  });
});
