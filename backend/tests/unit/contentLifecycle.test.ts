/**
 * Unit tests for the canonical content lifecycle (lib/content/contentLifecycle).
 * Covers the transition map and every mapLegacyStatus source. Pure functions —
 * no db, no mocks.
 */
import {
  ALLOWED_TRANSITIONS,
  DEFAULT_LIFECYCLE,
  canTransition,
  mapLegacyStatus,
} from '../../../lib/content/contentLifecycle';
import type { ContentLifecycleStatus } from '../../../lib/content/canonicalContent';

describe('contentLifecycle — ordered states', () => {
  it('DEFAULT_LIFECYCLE is the canonical 8-state order', () => {
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

  it('every state has a transition entry', () => {
    for (const state of DEFAULT_LIFECYCLE) {
      expect(ALLOWED_TRANSITIONS[state]).toBeDefined();
    }
  });
});

describe('contentLifecycle — canTransition', () => {
  it('walks the canonical forward spine', () => {
    expect(canTransition('draft', 'generated')).toBe(true);
    expect(canTransition('generated', 'edited')).toBe(true);
    expect(canTransition('edited', 'approved')).toBe(true);
    expect(canTransition('approved', 'adapted')).toBe(true);
    expect(canTransition('adapted', 'scheduled')).toBe(true);
    expect(canTransition('scheduled', 'published')).toBe(true);
    expect(canTransition('published', 'archived')).toBe(true);
  });

  it('rejects self-transitions', () => {
    for (const state of DEFAULT_LIFECYCLE) {
      expect(canTransition(state, state)).toBe(false);
    }
  });

  it('allows archiving from every active state', () => {
    const active: ContentLifecycleStatus[] = [
      'draft',
      'generated',
      'edited',
      'approved',
      'adapted',
      'scheduled',
      'published',
    ];
    for (const state of active) {
      expect(canTransition(state, 'archived')).toBe(true);
    }
  });

  it('permits real product loops (re-edit, regenerate, un-schedule)', () => {
    expect(canTransition('edited', 'generated')).toBe(true); // regenerate
    expect(canTransition('approved', 'edited')).toBe(true); // re-edit after approval
    expect(canTransition('scheduled', 'edited')).toBe(true); // un-schedule to edit
    expect(canTransition('published', 'edited')).toBe(true); // correct a published item
  });

  it('restores archived back to draft only', () => {
    expect(canTransition('archived', 'draft')).toBe(true);
    expect(canTransition('archived', 'published')).toBe(false);
    expect(canTransition('archived', 'scheduled')).toBe(false);
  });

  it('rejects nonsensical jumps', () => {
    expect(canTransition('draft', 'published')).toBe(false);
    expect(canTransition('draft', 'scheduled')).toBe(false);
    expect(canTransition('published', 'draft')).toBe(false);
    expect(canTransition('generated', 'published')).toBe(false);
  });
});

describe('mapLegacyStatus — scheduled_post', () => {
  it('maps every known status', () => {
    expect(mapLegacyStatus('scheduled_post', 'draft')).toBe('draft');
    expect(mapLegacyStatus('scheduled_post', 'scheduled')).toBe('scheduled');
    expect(mapLegacyStatus('scheduled_post', 'publishing')).toBe('scheduled');
    expect(mapLegacyStatus('scheduled_post', 'published')).toBe('published');
    expect(mapLegacyStatus('scheduled_post', 'failed')).toBe('scheduled');
  });
});

describe('mapLegacyStatus — campaign', () => {
  it('maps every known status', () => {
    expect(mapLegacyStatus('campaign', 'draft')).toBe('draft');
    expect(mapLegacyStatus('campaign', 'pending')).toBe('generated');
    expect(mapLegacyStatus('campaign', 'approved')).toBe('approved');
    expect(mapLegacyStatus('campaign', 'scheduled')).toBe('scheduled');
    expect(mapLegacyStatus('campaign', 'published')).toBe('published');
  });
});

describe('mapLegacyStatus — creator_asset', () => {
  it('maps every known status', () => {
    expect(mapLegacyStatus('creator_asset', 'awaiting_media_upload')).toBe('generated');
    expect(mapLegacyStatus('creator_asset', 'media_uploaded')).toBe('edited');
    expect(mapLegacyStatus('creator_asset', 'ready_for_schedule')).toBe('approved');
    expect(mapLegacyStatus('creator_asset', 'scheduled')).toBe('scheduled');
  });
});

describe('mapLegacyStatus — workspace_fsm (retired FSM)', () => {
  it('maps every known status', () => {
    expect(mapLegacyStatus('workspace_fsm', 'planned')).toBe('draft');
    expect(mapLegacyStatus('workspace_fsm', 'queued')).toBe('draft');
    expect(mapLegacyStatus('workspace_fsm', 'generating')).toBe('draft');
    expect(mapLegacyStatus('workspace_fsm', 'needs-review')).toBe('generated');
    expect(mapLegacyStatus('workspace_fsm', 'approved')).toBe('approved');
    expect(mapLegacyStatus('workspace_fsm', 'published')).toBe('published');
    expect(mapLegacyStatus('workspace_fsm', 'failed')).toBe('draft');
  });
});

describe('mapLegacyStatus — normalization & fallback', () => {
  it('normalizes case and whitespace', () => {
    expect(mapLegacyStatus('campaign', '  PENDING ')).toBe('generated');
    expect(mapLegacyStatus('scheduled_post', 'Published')).toBe('published');
  });

  it('falls back to draft on unknown/empty status (with a warning)', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(mapLegacyStatus('campaign', 'totally-unknown')).toBe('draft');
    expect(mapLegacyStatus('scheduled_post', '')).toBe('draft');
    expect(mapLegacyStatus('creator_asset', null)).toBe('draft');
    expect(mapLegacyStatus('workspace_fsm', undefined)).toBe('draft');
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('every mapped legacy value resolves to a canonical lifecycle state', () => {
    const canonical = new Set<string>(DEFAULT_LIFECYCLE);
    const sources = ['scheduled_post', 'campaign', 'creator_asset', 'workspace_fsm'] as const;
    const samples: Record<(typeof sources)[number], string[]> = {
      scheduled_post: ['draft', 'scheduled', 'publishing', 'published', 'failed'],
      campaign: ['draft', 'pending', 'approved', 'scheduled', 'published'],
      creator_asset: ['awaiting_media_upload', 'media_uploaded', 'ready_for_schedule', 'scheduled'],
      workspace_fsm: ['planned', 'queued', 'generating', 'needs-review', 'approved', 'published', 'failed'],
    };
    for (const source of sources) {
      for (const raw of samples[source]) {
        expect(canonical.has(mapLegacyStatus(source, raw))).toBe(true);
      }
    }
  });
});
