/**
 * A1 ↔ A2 Semantic Identity Interop — permanent TD-13 regression guard
 * (OMNIVYRA-PMO-001 · WS-1a-fix · ICR-1).
 *
 * TD-13 was the bug where the Generation Spine (Zone A1) and the Coordination
 * Intelligence Layer (Zone A2) minted the semantic identity DIVERGENTLY, so their
 * ids never matched and continuity across zones broke. ICR-1 reconciled both onto
 * the ONE canonical platform derivation. This test locks that reconciliation in
 * PERMANENTLY by proving the WIRED paths agree end-to-end:
 *
 *   • A1's real `buildSemanticRoot` (semanticSpine.ts) mints the `semanticRootId`
 *     via the platform derive from a resolved GenerationContext.
 *   • A2's re-exported `deriveSemanticRootId` (imported from the coordination
 *     module's `coordinationKeys`, NOT the raw platform fn) derives it from the
 *     same normalized seed.
 *   • The two MUST be byte-equal — that is the cross-zone contract.
 *
 * The identity is derived deterministically from a fixed seed
 * `(companyId, communicationIntent, campaignId, topic)`; no network, no DB, no AI.
 * The builder's one non-deterministic seam (the per-run `generationInstanceId`)
 * is asserted to VARY across runs while the grouping id stays stable — the exact
 * two-level split whose conflation caused TD-13.
 */

import { buildSemanticRoot } from '../../services/content/runtime/semanticSpine';
// A2's WIRED re-export — proving A1 and A2 agree, not merely the raw platform fn.
import { deriveSemanticRootId } from '../../services/intelligence/coordination/coordinationKeys';
import { isSemanticRootId } from '../../platform/intelligence';
import type { GenerationContext } from '../../services/content/runtime/contracts';

// ── Fixed seed ────────────────────────────────────────────────────────────────
// `objective` is the free-form producer input A1 carries; it is a SYNONYM ('sell')
// that must normalize onto the canonical vocabulary token ('promote'). Using a
// synonym proves both zones run the SAME normalization, not just string equality.
const SEED = {
  companyId: 'company-interop-A',
  objective: 'sell', // free-form → canonical 'promote'
  canonicalIntent: 'promote' as const,
  campaignId: 'camp-interop-1',
  topic: 'Launch  New Pricing Tiers!', // messy on purpose → normalized for keying
};

/** Build the minimal resolved GenerationContext the A1 builder reads. */
function seedContext(): GenerationContext {
  return {
    companyId: SEED.companyId,
    contentType: 'post',
    campaignId: SEED.campaignId,
    objective: SEED.objective,
    raw: { topic: SEED.topic },
  };
}

describe('A1↔A2 semantic identity interop (TD-13 permanent guard)', () => {
  it('A1 buildSemanticRoot id EQUALS A2 re-exported deriveSemanticRootId (wired path agrees)', () => {
    const root = buildSemanticRoot(seedContext());

    // A2's re-export, fed the SAME normalized seed A1 keyed on.
    const a2Id = deriveSemanticRootId({
      companyId: SEED.companyId,
      communicationIntent: SEED.canonicalIntent,
      campaignId: SEED.campaignId,
      topic: SEED.topic,
    });

    expect(root.semanticRootId).toBe(a2Id);
    expect(isSemanticRootId(root.semanticRootId)).toBe(true);
  });

  it('A2 derive agrees whether fed the free-form synonym or the canonical token (shared normalization)', () => {
    const root = buildSemanticRoot(seedContext());

    const fromSynonym = deriveSemanticRootId({
      companyId: SEED.companyId,
      communicationIntent: SEED.objective, // 'sell'
      campaignId: SEED.campaignId,
      topic: SEED.topic,
    });
    const fromCanonical = deriveSemanticRootId({
      companyId: SEED.companyId,
      communicationIntent: SEED.canonicalIntent, // 'promote'
      campaignId: SEED.campaignId,
      topic: SEED.topic,
    });

    // A1 normalized 'sell'→'promote' internally; A2 normalizes both inputs too, so
    // all three converge on the one id.
    expect(fromSynonym).toBe(fromCanonical);
    expect(root.semanticRootId).toBe(fromSynonym);
  });

  it('two runs of the same seed SHARE the grouping id but get DISTINCT generation instance ids', () => {
    const a = buildSemanticRoot(seedContext());
    const b = buildSemanticRoot(seedContext());

    // Grouping key is deterministic — same seed ⇒ same semanticRootId.
    expect(a.semanticRootId).toBe(b.semanticRootId);

    // Per-run provenance is unique — the two-level split that fixed TD-13.
    expect(a.generationInstanceId).not.toBe(b.generationInstanceId);
    expect(a.generationInstanceId).toMatch(/^sgen_/);
    expect(b.generationInstanceId).toMatch(/^sgen_/);
  });

  it('communicationIntent on the root is the NORMALIZED canonical value (not the free-form input)', () => {
    const root = buildSemanticRoot(seedContext());
    expect(root.communicationIntent).toBe(SEED.canonicalIntent); // 'promote', not 'sell'
  });
});
