/**
 * Product-first competition gate — locks the classification framework so the engine
 * never again returns media brands / narrow-overlap tools / off-segment products as
 * competitors. Three-part gate: (1) same product category (not facilitated
 * outcome/service/media), (2) >=70% functional overlap, (3) segment alignment.
 */
import { classifyProductFirstCompetition } from '../../services/competitorEngineService';

describe('classifyProductFirstCompetition — product-first, three-part gate', () => {
  const strongProduct = { functionalOverlap: 0.82, segmentOverlap: 0.7 };

  it('FACILITATED: content-based product type (newsletter/creator) is never a competitor', () => {
    expect(
      classifyProductFirstCompetition({ productType: 'content-based', ...strongProduct, isMediaContent: false, trustedProduct: false }),
    ).toBe('facilitated');
  });

  it('FACILITATED: media/content brand detected by signal even without product type (SERP newsletter)', () => {
    // e.g. "Lenny's Newsletter" / "The Hustle" / "Morning Brew" surfaced by SERP with unknown type + high topic overlap
    expect(
      classifyProductFirstCompetition({ productType: null, functionalOverlap: 0.9, segmentOverlap: 0.8, isMediaContent: true, trustedProduct: false }),
    ).toBe('facilitated');
  });

  it('SECONDARY: human-led service agency is adjacent market, not primary competition', () => {
    expect(
      classifyProductFirstCompetition({ productType: 'human-led', ...strongProduct, isMediaContent: false, trustedProduct: false }),
    ).toBe('secondary');
  });

  it('EXCLUDED: product with narrow overlap (~15-20%, Canva-like) is not a competitor', () => {
    expect(
      classifyProductFirstCompetition({ productType: 'software platform', functionalOverlap: 0.18, segmentOverlap: 0.7, isMediaContent: false, trustedProduct: false }),
    ).toBe('excluded');
  });

  it('EXCLUDED: same-category product in a different segment (Mahindra-economy vs Tesla-luxury)', () => {
    expect(
      classifyProductFirstCompetition({ productType: 'software platform', functionalOverlap: 0.85, segmentOverlap: 0.2, isMediaContent: false, trustedProduct: false }),
    ).toBe('excluded');
  });

  it('PRIMARY: same-category product, >=70% overlap, aligned segment (Buffer/HubSpot-like)', () => {
    expect(
      classifyProductFirstCompetition({ productType: 'software platform', functionalOverlap: 0.76, segmentOverlap: 0.65, isMediaContent: false, trustedProduct: false }),
    ).toBe('primary');
  });

  it('PRIMARY: trusted/known product competitor bypasses the soft thresholds', () => {
    expect(
      classifyProductFirstCompetition({ productType: 'AI chatbot', functionalOverlap: 0.5, segmentOverlap: 0.3, isMediaContent: false, trustedProduct: true }),
    ).toBe('primary');
  });

  it('FACILITATED wins even for a trusted source if it is a media brand', () => {
    expect(
      classifyProductFirstCompetition({ productType: 'content-based', functionalOverlap: 0.9, segmentOverlap: 0.9, isMediaContent: true, trustedProduct: true }),
    ).toBe('facilitated');
  });
});
