/**
 * PI-LDB — the guard that stops a canonical destination being silently dropped.
 *
 * `CanonicalFieldKey` is what the mapping engine may PROPOSE. `CsvLeadInput`
 * (= `ManualLeadInput`) is what the ingestion contract ACCEPTS. They are nearly
 * identical, and the gap is invisible at runtime: a record submitted with a
 * property the adapter does not read imports "successfully" minus that column.
 *
 * So this suite asserts the partition in `submittableTargets.ts` against the
 * LIVE registry. Its whole value is that it fails when someone adds a registry
 * key — forcing a decision about whether imports can carry it — rather than
 * letting the new destination quietly lose data.
 *
 * A gate that cannot fail is worse than no gate, so the final test asserts the
 * match set is non-empty: a registry that failed to load would otherwise make
 * every assertion here vacuously true.
 */

import {
  CANONICAL_FIELDS,
  isCanonicalFieldKey,
  type CanonicalFieldKey,
} from '../../services/leadMapping/canonicalFieldRegistry';
import {
  IDENTITY_TARGETS,
  NON_SUBMITTABLE_TARGETS,
  SUBMITTABLE_TARGETS,
  isSubmittableTarget,
  nonSubmittableReason,
} from '../../../lib/prospects/import/submittableTargets';

const registryKeys = CANONICAL_FIELDS.map((f) => f.key);

describe('the partition is total', () => {
  it('every canonical key is either submittable or explicitly non-submittable', () => {
    const unclassified = registryKeys.filter(
      (key) => !isSubmittableTarget(key) && !(key in NON_SUBMITTABLE_TARGETS),
    );
    // If this fails, a destination was added to the registry without deciding
    // whether an import can write to it. Add it to SUBMITTABLE_TARGETS, or to
    // NON_SUBMITTABLE_TARGETS with a reason a tenant can read.
    expect(unclassified).toEqual([]);
  });

  it('nothing is claimed submittable that the registry does not know', () => {
    const unknown = SUBMITTABLE_TARGETS.filter((key) => !isCanonicalFieldKey(key));
    expect(unknown).toEqual([]);
  });

  it('nothing is in both halves of the partition', () => {
    const both = SUBMITTABLE_TARGETS.filter((key) => key in NON_SUBMITTABLE_TARGETS);
    expect(both).toEqual([]);
    // VACUITY GUARD. `NON_SUBMITTABLE_TARGETS` is now empty, so this filter
    // cannot match anything and the assertion above would hold against any
    // implementation at all. The left side must be non-empty for "no overlap"
    // to mean something.
    expect(SUBMITTABLE_TARGETS.length).toBeGreaterThan(0);
  });

  it('every non-submittable key is a real registry key with a tenant-readable reason', () => {
    const keys = Object.keys(NON_SUBMITTABLE_TARGETS);
    // DECLARED, not hidden: the map is empty by design, so this loop runs zero
    // times and the checks inside it assert nothing today. This file's own
    // header says a gate that cannot fail is worse than no gate, so the
    // iteration count is asserted — the body goes live the moment a key is
    // added, and the count below says plainly that it is currently dormant.
    let checked = 0;
    for (const key of keys) {
      expect(isCanonicalFieldKey(key)).toBe(true);
      const reason = nonSubmittableReason(key);
      expect(typeof reason).toBe('string');
      // A reason that does not say anything is not a reason.
      expect((reason as string).length).toBeGreaterThan(20);
      checked += 1;
    }
    expect(checked).toBe(keys.length);
    expect(keys).toHaveLength(0);
  });
});

describe('the last known gap is closed', () => {
  // This block replaces its own inverse. It used to assert that `description`
  // was a registry key imports could NOT carry, on the premise — stated in its
  // own comment — that `ManualLeadInput` had no such field and neither adapter
  // read one. The sprint added the field, the adapter reads it onto the
  // normalized account and the orchestrator persists it to
  // `prospect_accounts.description`, so the premise is gone. Two green suites
  // asserted opposite things about this key; this is the side that was stale.
  it("'description' is a registry key that imports CAN now carry", () => {
    expect(isCanonicalFieldKey('description')).toBe(true);
    expect(isSubmittableTarget('description')).toBe(true);
    expect(nonSubmittableReason('description')).toBeNull();
  });

  it('records that the gap list is empty, rather than leaving it to be inferred', () => {
    // Asserted as a VALUE, not skipped. The reason-quality test above iterates
    // this map, so an empty map makes it vacuous — this is the assertion that
    // says the emptiness is intended, so a key reappearing here is a decision
    // someone took and not an accident nothing checks.
    expect(Object.keys(NON_SUBMITTABLE_TARGETS)).toEqual([]);
  });
});

describe('the browser cannot invent a destination', () => {
  it.each([
    'id',
    'organizationId',
    'company_id',
    'password',
    'canonical_leads.qualification_score',
    '__proto__',
    'DROP TABLE users',
    '',
  ])('refuses %p', (candidate) => {
    expect(isSubmittableTarget(candidate)).toBe(false);
  });
});

describe('identity targets are a subset of what can be submitted', () => {
  it('every identity target is submittable', () => {
    const notSubmittable = IDENTITY_TARGETS.filter((key) => !isSubmittableTarget(key));
    expect(notSubmittable).toEqual([]);
  });

  it('matches the registry on identity criticality', () => {
    // The registry is the authority; this list exists only so the UI can
    // explain itself. It must not claim a field is identity-critical when the
    // registry says otherwise.
    const registryIdentity = new Set(
      CANONICAL_FIELDS.filter((f) => f.identityCritical).map((f) => f.key),
    );
    const overclaimed = IDENTITY_TARGETS.filter(
      (key) => !registryIdentity.has(key as CanonicalFieldKey),
    );
    expect(overclaimed).toEqual([]);
  });
});

describe('the gate can actually fail', () => {
  it('the registry loaded and the match set is non-empty', () => {
    // Without this, a registry that failed to import would make every
    // "unclassified is empty" assertion above trivially pass.
    expect(registryKeys.length).toBeGreaterThan(20);
    expect(SUBMITTABLE_TARGETS.length).toBeGreaterThan(20);
    // NOT `NON_SUBMITTABLE_TARGETS.length > 0` any more: that map is now
    // legitimately empty, so the old assertion would have failed for the right
    // reason and been "fixed" by deleting it. What this gate actually needs to
    // prove is that the partition COVERS the registry — every key classified,
    // which is what makes the "unclassified is empty" assertions meaningful.
    const classified = new Set<string>([...SUBMITTABLE_TARGETS, ...Object.keys(NON_SUBMITTABLE_TARGETS)]);
    expect(registryKeys.filter((k) => !classified.has(k))).toEqual([]);
    expect(classified.size).toBeGreaterThanOrEqual(registryKeys.length);
  });
});
