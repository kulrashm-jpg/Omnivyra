/**
 * WRITER-EXEC-005 Wave 4 — unit tests for the additive 'quality_reviewed'
 * lifecycle gate (lib/content/contentLifecycle).
 *
 * Asserts:
 *   1. the new state + its three intended transitions work,
 *   2. the EXTENDED_LIFECYCLE ordering inserts it between 'edited' and 'approved',
 *   3. every PRE-EXISTING transition + the DEFAULT_LIFECYCLE 8-state contract
 *      still hold (no regression — the Wave-1 test asserts DEFAULT_LIFECYCLE by
 *      value, so the gate lives in EXTENDED_LIFECYCLE, not DEFAULT_LIFECYCLE).
 *
 * Pure functions — no db, no mocks.
 */
import {
  ALLOWED_TRANSITIONS,
  DEFAULT_LIFECYCLE,
  EXTENDED_LIFECYCLE,
  canTransition,
  mapLegacyStatus,
} from '../../../lib/content/contentLifecycle';
import type { ContentLifecycleStatus } from '../../../lib/content/canonicalContent';

describe('quality_reviewed — new state', () => {
  it('is a valid transition source with its own entry', () => {
    expect(ALLOWED_TRANSITIONS.quality_reviewed).toBeDefined();
    expect(Array.isArray(ALLOWED_TRANSITIONS.quality_reviewed)).toBe(true);
  });

  it('EXTENDED_LIFECYCLE inserts it between edited and approved', () => {
    expect(EXTENDED_LIFECYCLE).toEqual([
      'draft',
      'generated',
      'edited',
      'quality_reviewed',
      'approved',
      'adapted',
      'scheduled',
      'published',
      'archived',
    ]);
    const idx = EXTENDED_LIFECYCLE.indexOf('quality_reviewed');
    expect(EXTENDED_LIFECYCLE[idx - 1]).toBe('edited');
    expect(EXTENDED_LIFECYCLE[idx + 1]).toBe('approved');
  });
});

describe('quality_reviewed — transitions', () => {
  it('edited → quality_reviewed', () => {
    expect(canTransition('edited', 'quality_reviewed')).toBe(true);
  });
  it('quality_reviewed → approved (advance)', () => {
    expect(canTransition('quality_reviewed', 'approved')).toBe(true);
  });
  it('quality_reviewed → edited (revise)', () => {
    expect(canTransition('quality_reviewed', 'edited')).toBe(true);
  });
  it('quality_reviewed → archived (active-state invariant)', () => {
    expect(canTransition('quality_reviewed', 'archived')).toBe(true);
  });

  it('rejects self-transition and nonsensical jumps from quality_reviewed', () => {
    expect(canTransition('quality_reviewed', 'quality_reviewed')).toBe(false);
    expect(canTransition('quality_reviewed', 'scheduled')).toBe(false);
    expect(canTransition('quality_reviewed', 'published')).toBe(false);
    expect(canTransition('quality_reviewed', 'draft')).toBe(false);
  });

  it('rejects skipping the gate from non-edited states', () => {
    expect(canTransition('draft', 'quality_reviewed')).toBe(false);
    expect(canTransition('generated', 'quality_reviewed')).toBe(false);
    expect(canTransition('approved', 'quality_reviewed')).toBe(false);
  });
});

describe('no regression — pre-existing lifecycle contract still holds', () => {
  it('DEFAULT_LIFECYCLE remains the canonical 8-state order (unchanged)', () => {
    expect(DEFAULT_LIFECYCLE).toEqual([
      'draft',
      'generated',
      'edited',
      'approved',
      'adapted',
      'scheduled',
      'published',
      'archived',
    ]);
  });

  it('the original forward spine is intact', () => {
    expect(canTransition('draft', 'generated')).toBe(true);
    expect(canTransition('generated', 'edited')).toBe(true);
    // The Wave-1 direct hop remains legal alongside the new gate.
    expect(canTransition('edited', 'approved')).toBe(true);
    expect(canTransition('approved', 'adapted')).toBe(true);
    expect(canTransition('adapted', 'scheduled')).toBe(true);
    expect(canTransition('scheduled', 'published')).toBe(true);
    expect(canTransition('published', 'archived')).toBe(true);
  });

  it('the original product loops are intact', () => {
    expect(canTransition('edited', 'generated')).toBe(true);
    expect(canTransition('approved', 'edited')).toBe(true);
    expect(canTransition('scheduled', 'edited')).toBe(true);
    expect(canTransition('published', 'edited')).toBe(true);
  });

  it('archiving remains legal from every original active state', () => {
    const active: ContentLifecycleStatus[] = [
      'draft', 'generated', 'edited', 'approved', 'adapted', 'scheduled', 'published',
    ];
    for (const state of active) expect(canTransition(state, 'archived')).toBe(true);
  });

  it('archived still restores to draft only', () => {
    expect(canTransition('archived', 'draft')).toBe(true);
    expect(canTransition('archived', 'published')).toBe(false);
  });
});

describe('mapLegacyStatus — additive quality_reviewed mappings', () => {
  it('maps the new legacy vocab without disturbing existing mappings', () => {
    // New additive keys.
    expect(mapLegacyStatus('campaign', 'in_review')).toBe('quality_reviewed');
    expect(mapLegacyStatus('campaign', 'quality_reviewed')).toBe('quality_reviewed');
    expect(mapLegacyStatus('workspace_fsm', 'quality-review')).toBe('quality_reviewed');
    // Pre-existing mappings unchanged.
    expect(mapLegacyStatus('campaign', 'pending')).toBe('generated');
    expect(mapLegacyStatus('campaign', 'approved')).toBe('approved');
    expect(mapLegacyStatus('workspace_fsm', 'needs-review')).toBe('generated');
  });
});
