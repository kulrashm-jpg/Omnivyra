import { weightedAssignment } from '../../services/campaignAiOrchestrator/topicAssignmentHelpers';

describe('weightedAssignment — repeated topics are differentiated with angle facets', () => {
  it('no two slots carry the identical topic string when a topic must repeat', () => {
    const slots = weightedAssignment([{ topic: 'Brand Awareness', weight: 1 }], 4);
    expect(slots.length).toBe(4);
    const unique = new Set(slots);
    expect(unique.size).toBe(4); // all distinct — no duplicate topic downstream
    // first occurrence stays clean, later ones get a facet
    expect(slots[0]).toBe('Brand Awareness');
    slots.slice(1).forEach((s) => expect(String(s)).toContain('Brand Awareness — '));
  });

  it('distinct topics used once each are left untouched', () => {
    const slots = weightedAssignment(
      [{ topic: 'A', weight: 1 }, { topic: 'B', weight: 1 }, { topic: 'C', weight: 1 }],
      3
    );
    expect(slots).toEqual(['A', 'B', 'C']);
  });

  it('differentiates per-topic independently across a mixed week', () => {
    const slots = weightedAssignment(
      [{ topic: 'A', weight: 1 }, { topic: 'B', weight: 1 }],
      5
    );
    expect(new Set(slots).size).toBe(5); // every slot unique
    expect(slots.filter((s) => String(s).startsWith('A')).length).toBeGreaterThan(0);
    expect(slots.filter((s) => String(s).startsWith('B')).length).toBeGreaterThan(0);
  });
});
