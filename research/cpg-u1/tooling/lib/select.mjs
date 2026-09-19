// Two-stage deterministic stratified draw (candidate-002 §5.5-§5.8). Pure functions:
// the same frame + seed + contamination set always yields the same result.
import { sha256 } from './canonical.mjs';
import { DEVELOPMENT_QUOTA, FAMILY_ORDER, OUTCOME_CLASSES, POOL_MULTIPLIER } from './schema.mjs';

const idKey = (c) => `${c.identifier_scheme}:${c.identifier_value}`;

/**
 * Decision D-C — rank key: sha256("<seed>|<scheme>:<identifier>").
 * Keyed on the identifier, so renaming a row cannot re-roll it. "|" cannot occur in a
 * hex seed or a scheme name, so the concatenation is unambiguous.
 */
export const rankKey = (seed, c) => sha256(`${seed}|${idKey(c)}`);

/** Total order: rank key, then identifier (a tie needs a SHA-256 collision; the tie-break makes order total anyway). */
function byRank(list, seed) {
  return list
    .map((c) => ({ c, k: rankKey(seed, c), i: idKey(c) }))
    .sort((a, b) => (a.k < b.k ? -1 : a.k > b.k ? 1 : a.i < b.i ? -1 : a.i > b.i ? 1 : 0))
    .map((x) => x.c);
}

/**
 * Decision D-A — within one outcome class, interleave jurisdiction families round-robin
 * in FAMILY_ORDER, each family's queue in rank order. A family that runs out simply
 * stops contributing; the others continue.
 */
export function orderedClass(candidates, seed) {
  const queues = FAMILY_ORDER.map((f) => byRank(candidates.filter((c) => c.jurisdiction_family === f), seed));
  const out = [];
  for (let round = 0; queues.some((q) => q.length > round); round++) {
    for (const q of queues) if (q[round]) out.push(q[round]);
  }
  return out;
}

export function assertSeed(seed) {
  if (typeof seed !== 'string' || !/^[0-9a-f]{64}$/.test(seed)) {
    throw new Error('seed must be exactly 64 lowercase hex characters (256 bits)');
  }
}

/** Identifiers and canonical domains must each be unique across the admissible frame (one row per legal entity). */
export function assertUnique(admissible) {
  const ids = new Set(); const domains = new Set();
  for (const c of admissible) {
    if (ids.has(idKey(c))) throw new Error(`duplicate identifier ${idKey(c)} — one row per legal entity`);
    if (domains.has(c.canonical_domain)) throw new Error(`duplicate canonical_domain ${c.canonical_domain} — one row per legal entity`);
    ids.add(idKey(c)); domains.add(c.canonical_domain);
  }
}

/** Pool check without any seed: every class must offer POOL_MULTIPLIER × quota candidates. */
export function poolShortfall(pool, quotas) {
  const shortfall = [];
  for (const cls of OUTCOME_CLASSES) {
    const have = pool.filter((c) => c.expected_outcome_class === cls).length;
    const need = POOL_MULTIPLIER * quotas[cls];
    if (have < need) shortfall.push({ class: cls, quota: quotas[cls], pool_required: need, pool_available: have });
  }
  return shortfall;
}

/**
 * Stage 1 — development. EXACT DEVELOPMENT_QUOTA per class (decision D-B):
 * held-out-ineligible companies first (they can serve nowhere else), then eligible
 * ones, each group in D-A order. Ineligible companies not drawn are DEVELOPMENT_SURPLUS.
 */
export function drawDevelopment(admissible, ineligible, seed) {
  assertSeed(seed);
  assertUnique(admissible);
  const shortfall = poolShortfall(admissible, DEVELOPMENT_QUOTA);
  if (shortfall.length) return { ok: false, shortfall };
  const development = [];
  for (const cls of OUTCOME_CLASSES) {
    const inClass = admissible.filter((c) => c.expected_outcome_class === cls);
    const ordered = [
      ...orderedClass(inClass.filter((c) => ineligible.has(c.candidate_id)), seed),
      ...orderedClass(inClass.filter((c) => !ineligible.has(c.candidate_id)), seed),
    ];
    development.push(...ordered.slice(0, DEVELOPMENT_QUOTA[cls]));
  }
  return { ok: true, development };
}

/**
 * Stage 2 — held-out. Eligible only, never a development company, exact `quotas`
 * (from the sizing rule), pool ≥ POOL_MULTIPLIER × quota per class.
 */
export function drawHeldOut(admissible, ineligible, developmentIds, seed, quotas) {
  assertSeed(seed);
  assertUnique(admissible);
  const pool = admissible.filter((c) => !ineligible.has(c.candidate_id) && !developmentIds.has(c.candidate_id));
  const shortfall = poolShortfall(pool, quotas);
  if (shortfall.length) return { ok: false, shortfall };
  const heldOut = [];
  for (const cls of OUTCOME_CLASSES) {
    heldOut.push(...orderedClass(pool.filter((c) => c.expected_outcome_class === cls), seed).slice(0, quotas[cls]));
  }
  return { ok: true, heldOut };
}
