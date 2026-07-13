/**
 * CKRE-001R §1/§2 — canonical fingerprint registry + dependency graph.
 */
import {
  FINGERPRINT_REGISTRY,
  FINGERPRINT_TYPE_IDS,
  getFingerprintDefinition,
  dependenciesOf,
  dependentsOf,
  downstreamOf,
  upstreamOf,
  topologicalOrder,
  affectedByChanges,
  type FingerprintTypeId,
} from '../../services/crawl/fingerprintRegistry';

describe('CKRE-001R §1 — registry', () => {
  test('defines every required fingerprint type with complete metadata', () => {
    const required: FingerprintTypeId[] = [
      'HTTP_METADATA', 'HTML', 'NAVIGATION', 'LOGO', 'FAVICON', 'OPENGRAPH',
      'SITEMAP', 'ROBOTS', 'SEO', 'SOCIAL', 'BUSINESS', 'STRUCTURED_DATA', 'CMS',
    ];
    for (const id of required) {
      const def = FINGERPRINT_REGISTRY[id];
      expect(def).toBeDefined();
      expect(def.id).toBe(id);
      expect(def.schemaVersion).toBeTruthy();
      expect(['sha256', 'none']).toContain(def.hashAlgorithm);
      expect(def.producer).toBeTruthy();
      expect(Array.isArray(def.dependencies)).toBe(true);
      expect(def.freshnessPolicy.maxAgeDays).toBeGreaterThan(0);
      expect(def.storageKey).toBeTruthy();
    }
  });

  test('getFingerprintDefinition throws on unknown id', () => {
    expect(() => getFingerprintDefinition('NOPE' as FingerprintTypeId)).toThrow(/UNKNOWN_FINGERPRINT_TYPE/);
  });

  test('all dependency references point at defined types (no dangling edges)', () => {
    for (const id of FINGERPRINT_TYPE_IDS) {
      for (const dep of dependenciesOf(id)) {
        expect(FINGERPRINT_TYPE_IDS).toContain(dep);
      }
    }
  });
});

describe('CKRE-001R §2 — dependency graph', () => {
  test('BUSINESS depends on HTML, NAVIGATION, HTTP_METADATA, SOCIAL (audit example)', () => {
    const deps = dependenciesOf('BUSINESS');
    for (const d of ['HTML', 'NAVIGATION', 'HTTP_METADATA', 'SOCIAL'] as FingerprintTypeId[]) {
      expect(deps).toContain(d);
    }
  });

  test('dependents / downstream closure of HTML includes the derived types', () => {
    expect(dependentsOf('HTML')).toContain('NAVIGATION');
    const down = downstreamOf('HTML');
    expect(down).toContain('NAVIGATION');
    expect(down).toContain('SOCIAL');
    expect(down).toContain('BUSINESS'); // transitive via NAVIGATION/SOCIAL
    // deterministic (sorted)
    expect(down).toEqual([...down].sort());
  });

  test('upstream of BUSINESS reaches HTML', () => {
    expect(upstreamOf('BUSINESS')).toContain('HTML');
  });

  test('topological order is deterministic and dependency-respecting', () => {
    const order = topologicalOrder();
    expect(order).toEqual(topologicalOrder()); // deterministic
    const idx = (t: FingerprintTypeId) => order.indexOf(t);
    for (const id of FINGERPRINT_TYPE_IDS) {
      for (const dep of dependenciesOf(id)) {
        expect(idx(dep)).toBeLessThan(idx(id)); // dep comes before dependent
      }
    }
  });

  test('affectedByChanges returns changed + transitive dependents (skip-calculation surface)', () => {
    const affected = affectedByChanges(['HTML']);
    expect(affected).toContain('HTML');
    expect(affected).toContain('BUSINESS');
    expect(affected).toEqual([...affected].sort());
    // A leaf that nothing depends on affects only itself.
    expect(affectedByChanges(['CMS'])).toEqual(['CMS']);
  });
});
