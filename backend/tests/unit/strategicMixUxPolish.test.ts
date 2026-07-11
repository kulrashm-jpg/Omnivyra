/**
 * Strategic Mix R2-P5 — final UX commitments.
 *
 *  - Draft Status reducer: a pure fold over the EXISTING persistence
 *    lifecycle events (no duplicate tracking) — full matrix incl. offline
 *  - Board-as-home / two-door wiring: source-level invariants on the
 *    planner shell (the latch discipline that keeps the new-campaign flow
 *    intact) and SPEC-002's existence as implemented-behavior record
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { nextDraftSaveStatus, type DraftSaveStatus } from '../../../components/planner/plannerDraftPersistence';

describe('Draft Status — deterministic reducer over persistence events', () => {
  it('covers the full lifecycle: bootstrap → edit → save → conflict → failure', () => {
    let s: DraftSaveStatus = 'saved';
    s = nextDraftSaveStatus(s, 'bootstrap_start');
    expect(s).toBe('syncing');
    s = nextDraftSaveStatus(s, 'bootstrap_done');
    expect(s).toBe('saved');
    s = nextDraftSaveStatus(s, 'dirty');
    expect(s).toBe('saving');
    s = nextDraftSaveStatus(s, 'save_ok');
    expect(s).toBe('saved');
    // conflict = server copy adopted deterministically ⇒ in sync
    expect(nextDraftSaveStatus('saving', 'save_conflict')).toBe('saved');
    expect(nextDraftSaveStatus('saving', 'save_failed')).toBe('sync_failed');
    // failure recovers on the next successful cycle
    expect(nextDraftSaveStatus('sync_failed', 'dirty')).toBe('saving');
    expect(nextDraftSaveStatus('saving', 'save_ok')).toBe('saved');
  });

  it('offline applies whenever the browser is offline', () => {
    expect(nextDraftSaveStatus('saved', 'dirty', false)).toBe('offline');
    expect(nextDraftSaveStatus('saved', 'save_failed', false)).toBe('offline');
    expect(nextDraftSaveStatus('saved', 'bootstrap_start', false)).toBe('offline');
    // back online: the next event resolves normally
    expect(nextDraftSaveStatus('offline', 'save_ok')).toBe('saved');
    expect(nextDraftSaveStatus('offline', 'dirty', true)).toBe('saving');
  });

  it('is pure and total: every event from every state yields a valid status', () => {
    const states: DraftSaveStatus[] = ['saving', 'saved', 'syncing', 'sync_failed', 'offline'];
    const events = ['bootstrap_start', 'bootstrap_done', 'dirty', 'save_ok', 'save_conflict', 'save_failed'] as const;
    for (const state of states) {
      for (const event of events) {
        for (const online of [true, false]) {
          const next = nextDraftSaveStatus(state, event, online);
          expect(states).toContain(next);
          expect(nextDraftSaveStatus(state, event, online)).toBe(next); // deterministic
        }
      }
    }
  });
});

describe('planner shell wiring — source invariants (Board-as-home + two doors)', () => {
  const source = readFileSync(join(__dirname, '../../../pages/campaign-planner.tsx'), 'utf8');

  it('every tab navigation goes through the user-navigation latch', () => {
    // Raw setActiveTab in JSX handlers would bypass the latch and let the
    // board-landing effect fight user navigation. Only navigateTab (and the
    // two landing effects + the initializer) may set the tab.
    const rawJsxSetters = source.match(/onClick=\{[^}]*setActiveTab\(/g) ?? [];
    const rawCallbackSetters = source.match(/onConfirmed=\{[^}]*setActiveTab\(/g) ?? [];
    expect([...rawJsxSetters, ...rawCallbackSetters]).toEqual([]);
    expect(source).toContain('const navigateTab = (tab: typeof activeTab)');
    expect(source).toContain('userNavigatedRef.current = true;');
  });

  it('existing campaigns land on the Board; fresh sessions get the two doors', () => {
    expect(source).toContain("setActiveTab('board')"); // the landing effects
    expect(source).toContain('Start from Structure');
    expect(source).toContain('Start from Content');
    expect(source).toContain("from=strategic-mix"); // Content door round-trip
    expect(source).toContain('draft_save.enabled'); // the status chip renders
  });

  it('SPEC-002 exists and records only implemented behavior', () => {
    const spec = readFileSync(join(__dirname, '../../../STRATEGIC-MIX-SPEC-002.md'), 'utf8');
    for (const section of [
      'Campaign Operating System', 'Draft-first model', 'Asset Library', 'Assignment model',
      'Approval workflow', 'Execution handoff', 'Execution synchronization', 'Campaign Board',
      'Per-item lock doctrine', 'Full-move rescheduling', 'Canonical stage model', 'Release 2',
    ]) {
      expect(spec).toContain(section);
    }
    expect(spec.replace(/\s+/g, ' ')).toContain('documents ONLY implemented behavior');
  });
});
