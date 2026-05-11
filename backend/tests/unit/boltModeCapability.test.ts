/**
 * BOLT Mode × Capability tests (Round 5).
 *
 * Validates that each BOLT mode (text / creator / intelligent-mix /
 * strategy-mix) resolves to capability-correct connected platform sets via
 * the centralized helpers — no new filtering systems, no parallel logic.
 *
 * Surfaces the four bullet-point requirements from the implementation brief:
 *   • bolt-text hides Instagram, shows LinkedIn/X
 *   • bolt-creator shows Instagram/TikTok
 *   • intelligent-mix shows all compatible connected platforms
 *   • strategy-mix shows all compatible connected platforms
 *   • unknown platforms are hidden (fail closed)
 *   • unresolved mode blocks rendering
 */

import { filterConnectedPlatformsForContent } from '../../../lib/shared/social/platformContentFilter';
import {
  getPlatformCapability,
  normalizePlatformKey,
} from '../../../lib/shared/social/platformCapabilities';

// Connected set used across every test case. Includes one capability-known
// platform per supported family, plus an unknown to validate fail-closed.
const CONNECTED = ['linkedin', 'x', 'facebook', 'instagram', 'tiktok', 'youtube', 'pinterest', 'mystery-net'];

/** Mix-mode resolution mirrors what the API handler does. Exposed here only
 *  to keep tests close to the contract — it does NOT introduce a new helper. */
function resolveMixMode(connected: string[]) {
  const supported: string[] = [];
  const unregistered: string[] = [];
  const seen = new Set<string>();
  for (const raw of connected) {
    const platform = normalizePlatformKey(raw);
    if (!platform || seen.has(platform)) continue;
    seen.add(platform);
    if (getPlatformCapability(platform)) supported.push(platform);
    else unregistered.push(platform);
  }
  return { supported, unregistered };
}

describe('BOLT mode → capability resolution (Round 5)', () => {
  test('bolt-text hides Instagram, shows LinkedIn/X/Facebook', () => {
    const result = filterConnectedPlatformsForContent(CONNECTED, { workflowType: 'text' });
    expect(result.capability).toBe('text');
    expect(result.supported).toEqual(expect.arrayContaining(['linkedin', 'x', 'facebook']));
    expect(result.supported).not.toContain('instagram');
    expect(result.supported).not.toContain('tiktok');
    expect(result.supported).not.toContain('youtube');
    expect(result.supported).not.toContain('pinterest');
    // Instagram is registered but text-incompatible → disabled chip.
    expect(result.hidden.map((h) => h.platform)).toEqual(expect.arrayContaining(['instagram', 'tiktok', 'youtube', 'pinterest']));
    // mystery-net is unknown → must NEVER appear as supported or hidden.
    expect(result.supported).not.toContain('mystery-net');
    expect(result.hidden.map((h) => h.platform)).not.toContain('mystery-net');
    expect(result.unregistered.map((u) => u.platform)).toContain('mystery-net');
  });

  test('bolt-creator shows Instagram/TikTok/YouTube, hides text-only', () => {
    const result = filterConnectedPlatformsForContent(CONNECTED, { workflowType: 'creator' });
    expect(result.capability).toBe('creator');
    expect(result.supported).toEqual(expect.arrayContaining(['instagram', 'tiktok', 'youtube']));
    // LinkedIn, X, Facebook, Pinterest don't list 'creator' as a supported
    // capability → they go to hidden as disabled chips.
    expect(result.supported).not.toContain('linkedin');
    expect(result.supported).not.toContain('x');
    expect(result.supported).not.toContain('facebook');
    expect(result.hidden.map((h) => h.platform)).toEqual(
      expect.arrayContaining(['linkedin', 'x', 'facebook', 'pinterest']),
    );
    expect(result.unregistered.map((u) => u.platform)).toContain('mystery-net');
  });

  test('intelligent-mix shows ALL registry-known connected platforms', () => {
    const result = resolveMixMode(CONNECTED);
    expect(result.supported.sort()).toEqual(['facebook', 'instagram', 'linkedin', 'pinterest', 'tiktok', 'x', 'youtube']);
    expect(result.unregistered).toEqual(['mystery-net']);
  });

  test('strategy-mix shows ALL registry-known connected platforms (same union as intelligent-mix)', () => {
    const result = resolveMixMode(CONNECTED);
    expect(result.supported.sort()).toEqual(['facebook', 'instagram', 'linkedin', 'pinterest', 'tiktok', 'x', 'youtube']);
    expect(result.unregistered).toEqual(['mystery-net']);
  });

  test('unknown platforms NEVER render as publishable in any BOLT mode (fail-closed)', () => {
    for (const capability of ['text', 'creator'] as const) {
      const result = filterConnectedPlatformsForContent(['mystery-net', 'another-fake', 'linkedin'], { workflowType: capability });
      expect(result.supported).not.toContain('mystery-net');
      expect(result.supported).not.toContain('another-fake');
      expect(result.hidden.map((h) => h.platform)).not.toContain('mystery-net');
      expect(result.hidden.map((h) => h.platform)).not.toContain('another-fake');
      expect(result.unregistered.map((u) => u.platform).sort()).toEqual(['another-fake', 'mystery-net']);
    }
    // Mix mode also fails closed for unknowns.
    const mix = resolveMixMode(['mystery-net', 'linkedin']);
    expect(mix.supported).toEqual(['linkedin']);
    expect(mix.unregistered).toEqual(['mystery-net']);
  });

  test('unresolved capability triggers blocking-state contract (capability=null, supported=[])', () => {
    // Simulates a BOLT mode whose signal cannot be normalized — the API
    // returns `capability: null` and the view must surface the blocking
    // state, never the supported list.
    const result = filterConnectedPlatformsForContent(CONNECTED, { workflowType: 'totally-unknown-mode' });
    expect(result.capability).toBeNull();
    expect(result.supported).toEqual([]);
  });
});

describe('BOLT API mode parser sanity (Round 5)', () => {
  // The API parses mode strings into the canonical 4-mode set. This test
  // documents the expected aliases without importing the private parser —
  // we just exercise filterConnectedPlatformsForContent the same way the
  // API does for each canonical mode.
  test('text mode + text capability mapping is consistent', () => {
    const a = filterConnectedPlatformsForContent(['linkedin', 'instagram'], { workflowType: 'text' });
    expect(a.capability).toBe('text');
    expect(a.supported).toEqual(['linkedin']);
  });
  test('creator mode + creator capability mapping is consistent', () => {
    const a = filterConnectedPlatformsForContent(['instagram', 'linkedin'], { workflowType: 'creator' });
    expect(a.capability).toBe('creator');
    expect(a.supported).toEqual(['instagram']);
  });
});

describe('Legacy filterBoltPlatforms removal (Round 5)', () => {
  test('filterBoltPlatforms is no longer exported from boltTextContentConfig', async () => {
    const mod: Record<string, unknown> = await import('../../utils/boltTextContentConfig');
    expect(mod.filterBoltPlatforms).toBeUndefined();
    expect((mod as { BOLT_EXCLUDED_PLATFORMS?: unknown }).BOLT_EXCLUDED_PLATFORMS).toBeUndefined();
  });
});
