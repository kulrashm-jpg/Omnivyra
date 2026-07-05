import {
  slidesAreNearDuplicate,
  deckHasNearDuplicateSlides,
  dedupeCarouselSlides,
  isCarouselSlideComplete,
} from '../../services/executionEngines/creatorExecutionEngine';

const slide = (headline: string, body_text: string, visual = 'a visual') => ({
  headline,
  body_text,
  visual_description: visual,
});

describe('carousel slide distinctness + richness', () => {
  it('flags two slides with identical headline as near-duplicate', () => {
    expect(
      slidesAreNearDuplicate(
        slide("Unlock Your Brand's Potential", 'Discover the power of brand awareness and thought'),
        slide("Unlock Your Brand's Potential", 'Discover the power of brand awareness and thought'),
      ),
    ).toBe(true);
  });

  it('flags heavy body overlap as near-duplicate even with different headlines', () => {
    expect(
      slidesAreNearDuplicate(
        slide('A', 'brand awareness drives trust and loyalty over time'),
        slide('B', 'brand awareness drives trust and loyalty over time here'),
      ),
    ).toBe(true);
  });

  it('treats genuinely different slides as distinct', () => {
    expect(
      slidesAreNearDuplicate(
        slide('Hook', 'why brand awareness compounds into pipeline'),
        slide('Proof', 'a step by step system for consistent posting'),
      ),
    ).toBe(false);
  });

  it('detects a deck containing a duplicated hero slide', () => {
    const deck = [
      slide('Hook', 'unlock your brand potential today'),
      slide('Hook', 'unlock your brand potential today'),
      slide('CTA', 'start your free trial now'),
    ];
    expect(deckHasNearDuplicateSlides(deck)).toBe(true);
  });

  it('dedupes a deck down to distinct slides, keeping the first occurrence', () => {
    const deck = [
      slide('Hook', 'unlock your brand potential today'),
      slide('Hook', 'unlock your brand potential today'),
      slide('CTA', 'start your free trial now'),
    ];
    const deduped = dedupeCarouselSlides(deck);
    expect(deduped).toHaveLength(2);
    expect(deduped[0]).toBe(deck[0]);
    expect(deduped[1]).toBe(deck[2]);
  });

  it('rejects a near-blank slide (fewer than 3 body words) as incomplete', () => {
    expect(isCarouselSlideComplete(slide('Title', 'too short'))).toBe(false); // 2 words
    expect(isCarouselSlideComplete(slide('Title', ''))).toBe(false);
    expect(isCarouselSlideComplete(slide('Title', 'this body has enough words'))).toBe(true);
  });

  it('requires a visual and a headline too', () => {
    expect(isCarouselSlideComplete({ headline: '', body_text: 'plenty of words here', visual_description: 'v' })).toBe(false);
    expect(isCarouselSlideComplete({ headline: 'H', body_text: 'plenty of words here', visual_description: '' })).toBe(false);
  });
});
