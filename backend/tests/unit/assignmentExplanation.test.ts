/**
 * Phase 6G-2 — assignment explainability tests.
 *
 * Pure, deterministic, combined-only. Re-derives 6G-1 / 6D-C / 6D-D1 decisions
 * into fixed strings; mutates nothing.
 */

import {
  buildAssignmentExplanation,
  buildAssignmentDecisions,
  type AssignmentExplanation,
  type AssignmentDecision,
} from '@/lib/shared/intelligence/assignmentExplanation';

const COMBINED = { isCombined: true } as const;
const messages = (arr: { message: string }[]) => arr.map((e) => e.message).join(' | ');

describe('6G-2 — removal / unsupported explanations', () => {
  test('carousel → youtube explains removal', () => {
    const e = buildAssignmentExplanation({ ...COMBINED, selectedPlatforms: ['youtube'], selectedFormats: ['carousel'] });
    // carousel can't run on youtube → unsupported pair AND format removed (only platform)
    expect(e.unsupportedAssignments.some((u) => u.platform === 'youtube' && u.format === 'carousel')).toBe(true);
    expect(e.removedFormats.some((f) => f.name === 'carousel')).toBe(true);
    expect(messages(e.unsupportedAssignments)).toContain('youtube');
  });

  test('tweet → linkedin explains exclusivity', () => {
    const e = buildAssignmentExplanation({ ...COMBINED, selectedPlatforms: ['linkedin'], selectedFormats: ['tweet'] });
    const tweetEntry = e.unsupportedAssignments.find((u) => u.format === 'tweet' && u.platform === 'linkedin');
    expect(tweetEntry?.reason).toBe('exclusivity');
    expect(tweetEntry?.message.toLowerCase()).toContain('exclusive');
  });

  test('podcast explains unresolved destination', () => {
    const e = buildAssignmentExplanation({ ...COMBINED, selectedPlatforms: ['linkedin', 'youtube'], selectedFormats: ['podcast'] });
    expect(e.unresolvedFormats.some((f) => f.name === 'podcast')).toBe(true);
    expect(messages(e.unresolvedFormats).toLowerCase()).toContain('no publish destination');
    expect(e.diagnostics.unresolved_formats_detected).toBe(1);
  });

  test('platform removed when it supports none of the selected formats', () => {
    // pinterest supports neither video nor article → removed.
    const e = buildAssignmentExplanation({ ...COMBINED, selectedPlatforms: ['linkedin', 'pinterest'], selectedFormats: ['video', 'article'] });
    expect(e.removedPlatforms.some((p) => p.name === 'pinterest')).toBe(true);
    expect(e.removedPlatforms.some((p) => p.name === 'linkedin')).toBe(false); // linkedin runs both
  });
});

describe('6G-2 — intelligence reorder explanations', () => {
  test('platform reorder explanation generated (advisory) only when order changed', () => {
    const e = buildAssignmentExplanation({
      ...COMBINED,
      selectedPlatforms: ['linkedin', 'facebook', 'youtube'],
      selectedFormats: ['video'],
      platformPriorities: [{ platform: 'youtube', score: 9 }],
      platformPriorityMode: 'advisory',
    });
    expect(e.reorderedPlatforms.length).toBe(1);
    expect(e.reorderedPlatforms[0].order[0]).toBe('youtube');
    expect(e.reorderedPlatforms[0].message.toLowerCase()).toContain('prioritized');
  });

  test('format reorder explanation generated (advisory)', () => {
    const e = buildAssignmentExplanation({
      ...COMBINED,
      selectedPlatforms: ['linkedin', 'instagram'],
      selectedFormats: ['post', 'carousel'],
      formatPriorities: [{ format: 'carousel', score: 9 }],
      formatPriorityMode: 'advisory',
    });
    expect(e.reorderedFormats.length).toBe(1);
    expect(e.reorderedFormats[0].order[0]).toBe('carousel');
  });

  test('no reorder explanation in shadow / off (nothing applied)', () => {
    const e = buildAssignmentExplanation({
      ...COMBINED,
      selectedPlatforms: ['linkedin', 'facebook', 'youtube'],
      selectedFormats: ['post', 'video'],
      platformPriorities: [{ platform: 'youtube', score: 9 }],
      formatPriorities: [{ format: 'video', score: 9 }],
      platformPriorityMode: 'shadow',
      formatPriorityMode: 'shadow',
    });
    expect(e.reorderedPlatforms).toEqual([]);
    expect(e.reorderedFormats).toEqual([]);
  });
});

describe('6G-2 — no-op & gating', () => {
  test('no explanations when every pair is valid and nothing reordered', () => {
    // linkedin + facebook both support text(post) + writer(article) → all valid.
    const e = buildAssignmentExplanation({ ...COMBINED, selectedPlatforms: ['linkedin', 'facebook'], selectedFormats: ['post', 'article'] });
    expect(e.unsupportedAssignments).toEqual([]);
    expect(e.removedPlatforms).toEqual([]);
    expect(e.removedFormats).toEqual([]);
    expect(e.unresolvedFormats).toEqual([]);
    expect(e.diagnostics.assignment_explanations_generated).toBe(0);
  });

  test('BOLT Text / Creator (not combined) → empty explanation', () => {
    const e: AssignmentExplanation = buildAssignmentExplanation({ selectedPlatforms: ['youtube'], selectedFormats: ['carousel'], isCombined: false });
    expect(e.diagnostics.assignment_explanations_generated).toBe(0);
    expect(e.unsupportedAssignments).toEqual([]);
    expect(e.unresolvedFormats).toEqual([]);
  });

  test('pure — does not mutate input arrays', () => {
    const selectedPlatforms = ['youtube', 'linkedin'];
    const selectedFormats = ['carousel', 'video'];
    buildAssignmentExplanation({ ...COMBINED, selectedPlatforms, selectedFormats });
    expect(selectedPlatforms).toEqual(['youtube', 'linkedin']); // membership unchanged
    expect(selectedFormats).toEqual(['carousel', 'video']);
  });
});

describe('6G-2 (refined) — buildAssignmentDecisions (flat contract)', () => {
  const decide = (platforms: string[], formats: string[]): AssignmentDecision[] =>
    buildAssignmentDecisions({ selectedPlatforms: platforms, selectedFormats: formats, isCombined: true });
  const find = (ds: AssignmentDecision[], format: string, platform: string) =>
    ds.find((d) => d.format === format && d.platform === platform);

  test('carousel → youtube REMOVED (reason cites platform)', () => {
    const d = find(decide(['youtube', 'linkedin'], ['carousel']), 'carousel', 'youtube');
    expect(d?.action).toBe('REMOVED');
    expect(d?.reason.toLowerCase()).toContain('youtube');
  });

  test('infographic → youtube REMOVED', () => {
    expect(find(decide(['youtube'], ['infographic']), 'infographic', 'youtube')?.action).toBe('REMOVED');
  });

  test('tweet → linkedin REMOVED with exclusivity reason', () => {
    const d = find(decide(['linkedin', 'x'], ['tweet']), 'tweet', 'linkedin');
    expect(d?.action).toBe('REMOVED');
    expect(d?.reason.toLowerCase()).toContain('exclusive');
  });

  test('tweet → x RESTRICTED', () => {
    const d = find(decide(['x'], ['tweet']), 'tweet', 'x');
    expect(d?.action).toBe('RESTRICTED');
    expect(d?.reason.toLowerCase()).toContain('exclusive');
  });

  test('video → youtube ALLOWED', () => {
    expect(find(decide(['youtube'], ['video']), 'video', 'youtube')?.action).toBe('ALLOWED');
  });

  test('decision collection: one decision per (format × platform)', () => {
    expect(decide(['linkedin', 'youtube'], ['carousel', 'video']).length).toBe(4);
  });

  test('reason generation: every decision has a non-empty derived reason', () => {
    for (const d of decide(['linkedin', 'youtube', 'x'], ['carousel', 'video', 'tweet', 'post'])) {
      expect(typeof d.reason).toBe('string');
      expect(d.reason.length).toBeGreaterThan(0);
      expect(['ALLOWED', 'REMOVED', 'RESTRICTED']).toContain(d.action);
    }
  });

  test('not combined → empty (no behavior anywhere else)', () => {
    expect(buildAssignmentDecisions({ selectedPlatforms: ['youtube'], selectedFormats: ['carousel'], isCombined: false })).toEqual([]);
  });
});
