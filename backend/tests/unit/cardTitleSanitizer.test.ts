/**
 * Coverage for the card-title meta-scaffold sanitizer
 * (pages/api/campaigns/weekly-structure-helpers.ts).
 *
 * The activity-card title doubles as the published caption (carousel/image
 * marketing copy mirrors it), so planning scaffold — "5 slides on …",
 * trailing "every {audience} should see", and the upstream "Stop Doing {X}
 * the Hard Way" angle wrapper — used to leak into what the reader sees.
 * sanitizeCardTitle unwraps those; deriveSubTopic applies it so no derived
 * title carries the scaffold.
 */

import { sanitizeCardTitle, deriveSubTopic } from '../../../pages/api/campaigns/weekly-structure-helpers';

describe('sanitizeCardTitle — strips planning meta-scaffold', () => {
  test('removes the "N slides on … every {audience} should see" carousel scaffold', () => {
    const out = sanitizeCardTitle('5 slides on real success stories with omnivyra every B2B marketers should see');
    expect(out.toLowerCase()).not.toContain('slides on');
    expect(out.toLowerCase()).not.toContain('should see');
    expect(out.toLowerCase()).toContain('real success stories with omnivyra');
  });

  test('unwraps the "Stop Doing {X} the Hard Way" angle to its core topic', () => {
    expect(sanitizeCardTitle('Stop Doing real success stories the Hard Way')).toBe('real success stories');
  });

  test('handles the double-angle case from the reported caption', () => {
    const out = sanitizeCardTitle('5 slides on stop doing real success stories with omnivyra the hard way every Marketing teams should see');
    expect(out.toLowerCase()).not.toMatch(/slides on|should see|the hard way/);
    expect(out.toLowerCase()).toContain('real success stories with omnivyra');
  });

  test.each([
    ['A thread on growth loops that every founder should bookmark', /should bookmark|every founder/i],
    ['Conversion rate: the chart every marketer needs to see', /needs to see|every marketer/i],
    ['Retention: the reel every PM should share', /should share|every pm/i],
  ])('drops trailing audience-echo scaffold: %s', (input, banned) => {
    expect(sanitizeCardTitle(input)).not.toMatch(banned);
  });

  test('leaves already-clean titles intact', () => {
    expect(sanitizeCardTitle('Carousel: onboarding funnels — swipe for the full story'))
      .toBe('Carousel: onboarding funnels — swipe for the full story');
    expect(sanitizeCardTitle('The complete guide to retention for SaaS teams'))
      .toBe('The complete guide to retention for SaaS teams');
  });

  test('never returns empty (falls back to the raw input)', () => {
    expect(sanitizeCardTitle('   ')).toBe('');
    expect(sanitizeCardTitle('Growth')).toBe('Growth');
  });
});

describe('deriveSubTopic — applies the sanitizer to every derived title', () => {
  test('carousel slot that uses the "5 slides on … should see" template is cleaned', () => {
    // slotIndex 1 selects the "5 slides on {t} every {a} should see" template.
    const out = deriveSubTopic('real success stories', 'carousel', 1, 'B2B marketers');
    expect(out.toLowerCase()).not.toMatch(/slides on|should see/);
    expect(out.toLowerCase()).toContain('real success stories');
  });

  test('cleans an upstream "Stop Doing … the Hard Way" base theme before angling', () => {
    const out = deriveSubTopic('Stop Doing real success stories the Hard Way', 'carousel', 0, 'founders');
    expect(out.toLowerCase()).not.toContain('the hard way');
    expect(out.toLowerCase()).toContain('real success stories');
  });

  test('is deterministic for a given (theme, type, slot, audience)', () => {
    const a = deriveSubTopic('retention', 'image', 2, 'PMs');
    const b = deriveSubTopic('retention', 'image', 2, 'PMs');
    expect(a).toBe(b);
  });
});
