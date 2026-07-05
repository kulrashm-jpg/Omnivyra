import { composeInfographicCopy } from '../../services/creator/infographicCopyComposer';

describe('Infographic copy — rich-field backfill (fills the canvas)', () => {
  it('every section gets bullets + impact + example so cards render full, not blank', async () => {
    const result = await composeInfographicCopy({
      topic: 'Audience Intelligence',
      layout: 'framework',
      sectionTitles: ['Why It Matters Now', 'Build Trust Through Engagement', 'A Repeatable System'],
      cta: 'Learn more',
      companyId: null,
      staticOnly: true, // deterministic path — no AI call
    } as any);

    expect(result.sections.length).toBe(3);
    for (const s of result.sections) {
      expect(s.bullets.length).toBeGreaterThanOrEqual(3); // real bullet list, not []
      expect(String(s.impact ?? '').length).toBeGreaterThan(10);
      expect(String(s.example ?? '').length).toBeGreaterThan(10);
      expect(s.lead.length).toBeGreaterThan(20);
    }
  });

  it('gives different sections different supporting content (role-varied) and enough to fill the card', async () => {
    const r = await composeInfographicCopy({
      topic: 'Audience Intelligence',
      layout: 'framework',
      sectionTitles: ['First', 'Second', 'Third'],
      cta: 'x',
      staticOnly: true,
    } as any);
    expect(r.sections[0].bullets.join('|')).not.toEqual(r.sections[1].bullets.join('|')); // role-tuned, not identical
    for (const s of r.sections) {
      const chars = s.lead.length + s.bullets.join(' ').length + String(s.impact ?? '').length + String(s.example ?? '').length;
      expect(chars).toBeGreaterThan(260); // clears the near-empty watchdog threshold (rich card)
    }
  });
});
