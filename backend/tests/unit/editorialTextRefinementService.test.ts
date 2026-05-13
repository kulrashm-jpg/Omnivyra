import {
  refineCampaignTopicForHeadlines,
  refineGeneratedText,
  refineStrategicCardTitle,
  refineSubjectLine,
} from '../../services/editorialTextRefinementService';

describe('editorialTextRefinementService', () => {
  it('turns launch commands into readable campaign headline topics', () => {
    expect(refineCampaignTopicForHeadlines('Launch Omnivyra in Sep 2026')).toBe("Omnivyra's September 2026 launch");
  });

  it('rewrites strategy card templates that paste launch commands awkwardly', () => {
    expect(refineStrategicCardTitle('The Rise of Launch Omnivyra In Sep 2026', 'Launch Omnivyra in Sep 2026', 0))
      .toBe("Building Momentum for Omnivyra's September 2026 Launch");
    expect(refineStrategicCardTitle('The Launch Omnivyra In Sep 2026 Myth, Debunked', 'Launch Omnivyra in Sep 2026', 1))
      .toBe("Debunking the Myths Around Omnivyra's September 2026 Launch");
    expect(refineStrategicCardTitle('The Future Belongs to Launch Omnivyra In Sep 2026', 'Launch Omnivyra in Sep 2026', 2))
      .toBe("What Omnivyra's September 2026 Launch Needs to Win");
  });

  it('removes dangling words from short generated copy', () => {
    expect(refineStrategicCardTitle('The Future Belongs to Omnivyra in')).toBe('Why Omnivyra Is Becoming Hard to Ignore');
  });

  it('repairs common possessive-pronoun misses in generated posts', () => {
    expect(refineGeneratedText('This helps you audience understand the offer.')).toBe('This helps your audience understand the offer.');
    expect(refineSubjectLine('launch omnivyra in sep 2026')).toBe('Launching Omnivyra in September 2026');
  });
});
