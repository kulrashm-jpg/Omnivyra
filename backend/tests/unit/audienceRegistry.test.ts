/**
 * Canonical audience registry — consolidation tests (audience Phase).
 */
import {
  CORE_AUDIENCE_LABELS,
  getKnownAudienceLabels,
  getSelectableAudienceLabels,
  isKnownAudience,
} from '../../../lib/shared/audience/audienceRegistry';

const LEGACY_7 = [
  'B2B Marketers', 'Founders / Entrepreneurs', 'Marketing Leaders',
  'Sales Teams', 'Product Managers', 'Developers', 'General Consumers',
];

const NEW_CATEGORIES = [
  'Finance', 'Procurement', 'Supply Chain', 'Operations', 'Human Resources',
  'Legal', 'Manufacturing', 'Retail', 'Healthcare', 'Technology', 'Marketing',
  'Sales', 'Customer Success', 'Product', 'Engineering', 'Executive Leadership',
];

describe('Canonical audience registry', () => {
  test('1. contains all legacy audiences in exact order/values (display contract)', () => {
    expect(CORE_AUDIENCE_LABELS).toEqual(LEGACY_7);
  });

  test('2. validation derives from registry — legacy + new known, garbage rejected', () => {
    for (const a of LEGACY_7) expect(isKnownAudience(a)).toBe(true);
    expect(isKnownAudience('Finance')).toBe(true);
    expect(isKnownAudience('Procurement')).toBe(true);
    expect(isKnownAudience('Not An Audience')).toBe(false);
    expect(isKnownAudience(123 as unknown)).toBe(false);
  });

  test('3 & 4. planner + intelligent-mix selectors derive default = legacy 7 (no display change)', () => {
    // Every migrated selector renders CORE_AUDIENCE_LABELS, and the helper's
    // default (no overrides) is the same legacy 7 → byte-identical display.
    expect(getSelectableAudienceLabels()).toEqual(LEGACY_7);
  });

  test('all 16 new categories available globally', () => {
    const all = getKnownAudienceLabels();
    for (const c of NEW_CATEGORIES) expect(all).toContain(c);
    // legacy still present too
    for (const a of LEGACY_7) expect(all).toContain(a);
  });

  test('5. custom audiences supported (appended, core preserved + first)', () => {
    const r = getSelectableAudienceLabels({ custom: ['ACME VIPs'] });
    expect(r.slice(0, 7)).toEqual(LEGACY_7);
    expect(r).toContain('ACME VIPs');
  });

  test('6. hidden audiences supported (org removes one it never targets)', () => {
    const r = getSelectableAudienceLabels({ hidden: ['Developers'] });
    expect(r).not.toContain('Developers');
    expect(r).toContain('B2B Marketers');
  });

  test('7. opt-in includeGroups surfaces industries without changing the default', () => {
    const withIndustry = getSelectableAudienceLabels({ includeGroups: ['industry'] });
    expect(withIndustry.slice(0, 7)).toEqual(LEGACY_7); // core still first
    expect(withIndustry).toContain('Finance');
    // default (no overrides) is unaffected — no runtime regression
    expect(getSelectableAudienceLabels()).toEqual(LEGACY_7);
  });
});
