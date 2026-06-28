import { evaluateDesignSystemCoverage, coverageWarnings } from '../../../lib/creator-templates/designSystemCoverage';

describe('Design System coverage validation (CREATOR-029)', () => {
  it('flags a requested family (frequency > 0) with zero templates as a gap', () => {
    const r = evaluateDesignSystemCoverage({
      requestedFamilies: [{ family: 'carousel', frequency: 3 }, { family: 'image', frequency: 2 }],
      selectedCountByFamily: { image: 2 },
    });
    expect(r.ok).toBe(false);
    expect(r.gaps).toEqual([{ family: 'carousel', frequency: 3, selected: 0 }]);
    expect(r.covered).toEqual(['image']);
    expect(coverageWarnings(r)).toEqual(['Carousel requested but Design System has zero Carousel templates.']);
  });

  it('passes when every requested family has at least one template', () => {
    const r = evaluateDesignSystemCoverage({
      requestedFamilies: [{ family: 'carousel', frequency: 1 }, { family: 'infographic', frequency: 4 }],
      selectedCountByFamily: { carousel: 2, infographic: 1 },
    });
    expect(r.ok).toBe(true);
    expect(r.gaps).toEqual([]);
    expect(r.covered.sort()).toEqual(['carousel', 'infographic']);
  });

  it('ignores families with frequency 0 (not requested) — even with no templates', () => {
    const r = evaluateDesignSystemCoverage({
      requestedFamilies: [{ family: 'pdf', frequency: 0 }],
      selectedCountByFamily: {},
    });
    expect(r.ok).toBe(true);
    expect(r.gaps).toEqual([]);
  });

  it('unused templates for un-requested families are never a gap', () => {
    const r = evaluateDesignSystemCoverage({
      requestedFamilies: [{ family: 'image', frequency: 1 }],
      selectedCountByFamily: { image: 1, carousel: 5 },
    });
    expect(r.ok).toBe(true);
  });

  it('de-dupes repeated family rows', () => {
    const r = evaluateDesignSystemCoverage({
      requestedFamilies: [{ family: 'carousel', frequency: 2 }, { family: 'carousel', frequency: 1 }],
      selectedCountByFamily: {},
    });
    expect(r.gaps.length).toBe(1);
  });
});
