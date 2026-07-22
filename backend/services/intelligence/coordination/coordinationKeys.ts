/**
 * Coordination Intelligence Layer — deterministic key derivation.
 *
 * These are KEY-GENERATION helpers (hashing / normalization), NOT text
 * comparison. The semantic *decision* is made by embedding cosine
 * (see `duplicateIntentDetector.ts`); these helpers only produce a stable
 * grouping handle so producers that describe the same intent seed converge on
 * the same `semanticRootId`.
 *
 * ICR-1 (TD-13): `deriveSemanticRootId` and `normalizeTopic` are now the ONE
 * canonical platform implementation. This module re-exports them so existing
 * importers keep working unchanged, while the definition lives in a single place
 * shared with the A1 generation producer — so an id derived here EQUALS the id
 * A1 produces for the same (company, intent, campaign, normalized topic).
 * Consume-only: do NOT re-implement these locally.
 */
export { deriveSemanticRootId, normalizeTopic } from '../../../platform/intelligence';
