/**
 * useBoltPlatformPicker — pure-resolver contract tests (Round 6).
 *
 * The project's Jest env is `node` (no DOM / RTL). We test the hook's
 * deterministic resolver (`resolveBoltPickerState`) which converts an API
 * body into picker state. The hook itself is a thin fetch+effect wrapper
 * over this resolver; the centralization test asserts that all 4 BOLT
 * surfaces consume the hook.
 */

import { resolveBoltPickerState, type BoltMode } from '../../../hooks/useBoltPlatformPicker';

const sampleBody = (overrides: Record<string, unknown> = {}) => ({
  mode: 'bolt-text',
  capability: 'text',
  supported: ['linkedin', 'x', 'facebook'],
  hidden: [{ platform: 'instagram', reason: 'Instagram requires media (image or video) for publishing.' }],
  unregistered: [{ platform: 'mystery-net', reason: 'mystery-net is not registered for content publishing.' }],
  ...overrides,
});

describe('resolveBoltPickerState — BOLT mode → picker state contract', () => {
  test('bolt-text: text capability, Instagram hidden, mystery-net unregistered, not blocked', () => {
    const state = resolveBoltPickerState('bolt-text', sampleBody());
    expect(state.capability).toBe('text');
    expect(state.supported).toEqual(['linkedin', 'x', 'facebook']);
    expect(state.hidden.map((h) => h.platform)).toEqual(['instagram']);
    expect(state.unregistered.map((u) => u.platform)).toEqual(['mystery-net']);
    expect(state.blocked).toBe(false);
    expect(state.loading).toBe(false);
  });

  test('bolt-creator: creator capability, text-only platforms hidden', () => {
    const state = resolveBoltPickerState('bolt-creator', {
      capability: 'creator',
      supported: ['instagram', 'tiktok', 'youtube'],
      hidden: [{ platform: 'linkedin', reason: 'linkedin does not support creator content.' }],
      unregistered: [],
    });
    expect(state.capability).toBe('creator');
    expect(state.supported).toEqual(['instagram', 'tiktok', 'youtube']);
    expect(state.hidden.map((h) => h.platform)).toEqual(['linkedin']);
    expect(state.blocked).toBe(false);
  });

  test('intelligent-mix: capability=null is the LEGITIMATE union contract — must NOT block', () => {
    const state = resolveBoltPickerState('intelligent-mix', {
      capability: null,
      supported: ['linkedin', 'x', 'facebook', 'instagram', 'tiktok', 'youtube', 'pinterest'],
      hidden: [],
      unregistered: [{ platform: 'mystery-net', reason: 'mystery-net is not registered for content publishing.' }],
    });
    expect(state.capability).toBeNull();
    expect(state.supported).toHaveLength(7);
    expect(state.blocked).toBe(false);
    expect(state.unregistered.map((u) => u.platform)).toEqual(['mystery-net']);
  });

  test('strategy-mix: capability=null is the LEGITIMATE union contract — must NOT block', () => {
    const state = resolveBoltPickerState('strategy-mix', {
      capability: null,
      supported: ['linkedin', 'instagram'],
      hidden: [],
      unregistered: [],
    });
    expect(state.capability).toBeNull();
    expect(state.blocked).toBe(false);
    expect(state.supported).toEqual(['linkedin', 'instagram']);
  });

  test('bolt-text: capability=null AND no supported → BLOCKED (single-capability mode)', () => {
    const state = resolveBoltPickerState('bolt-text', {
      capability: null,
      supported: [],
      hidden: [],
      unregistered: [],
    });
    expect(state.blocked).toBe(true);
    expect(state.capability).toBeNull();
  });

  test('bolt-creator: capability=null AND no supported → BLOCKED', () => {
    const state = resolveBoltPickerState('bolt-creator', {
      capability: null,
      supported: [],
      hidden: [],
      unregistered: [],
    });
    expect(state.blocked).toBe(true);
  });

  test('malformed body (null fields) → empty state, not blocked for mix modes', () => {
    for (const mode of ['intelligent-mix', 'strategy-mix'] as BoltMode[]) {
      const state = resolveBoltPickerState(mode, null);
      expect(state.supported).toEqual([]);
      expect(state.hidden).toEqual([]);
      expect(state.unregistered).toEqual([]);
      expect(state.blocked).toBe(false);
    }
  });

  test('malformed body → blocked for single-capability modes (fail closed)', () => {
    for (const mode of ['bolt-text', 'bolt-creator'] as BoltMode[]) {
      const state = resolveBoltPickerState(mode, null);
      expect(state.blocked).toBe(true);
    }
  });

  test('unknown platforms NEVER appear in supported or hidden — only unregistered', () => {
    const state = resolveBoltPickerState('bolt-text', {
      capability: 'text',
      supported: ['linkedin'],
      hidden: [{ platform: 'instagram', reason: 'requires media' }],
      unregistered: [
        { platform: 'mystery-net', reason: 'not registered' },
        { platform: 'fake-rooms', reason: 'not registered' },
      ],
    });
    expect(state.supported).not.toContain('mystery-net');
    expect(state.hidden.map((h) => h.platform)).not.toContain('mystery-net');
    expect(state.unregistered.map((u) => u.platform).sort()).toEqual(['fake-rooms', 'mystery-net']);
  });
});
