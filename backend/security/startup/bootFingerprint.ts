/**
 * bootFingerprint — produce + emit a deterministic, structured "what's
 * deployed" log line so a single grep across server logs answers the
 * question "which version of the auth contract is this process running?"
 *
 * Why this exists
 * ───────────────
 * When the Phase 2.B login loop hit production, multiple environments
 * were running different combinations of: (a) deployed application code,
 * (b) applied migrations, (c) PostgREST schema cache state. Each layer
 * made the symptom look slightly different. Without a single artifact
 * naming all three, debugging required reading and correlating three log
 * surfaces.
 *
 * The fingerprint captures all three:
 *   - auth_contract_version: bumped manually when AUTH_ERROR_CODE / the
 *     resolver protocol changes shape.
 *   - schema_manifest_hash: derived from the migration tree at build time
 *     (see `scripts/generate-schema-manifest.js`).
 *   - runtime: node version, NODE_ENV, deployment id (Vercel / Railway
 *     env vars when present).
 *
 * `fingerprint` is a stable digest of the above so two processes with
 * the same fingerprint are interchangeable from an auth-contract POV.
 */

import { createHash } from 'crypto';
import { logger } from '../../services/logger';
import fs from 'fs';
import path from 'path';

/**
 * Bump this when the AUTH_ERROR_CODE enum, the resolver protocol, or the
 * client decision matrix changes shape. Major version is a breaking
 * change to the response envelope; minor is additive.
 */
export const AUTH_CONTRACT_VERSION = '2.B.2' as const;

export interface BootFingerprint {
  /** Stable digest of contract version + schema hash + Node version. */
  fingerprint:           string;
  authContractVersion:   string;
  schemaManifestHash:    string | null;
  nodeVersion:           string;
  nodeEnv:               string;
  /** Best-effort platform identifiers — null when not present. */
  deploymentId:          string | null;
  vercelEnv:             string | null;
  railwayEnv:            string | null;
  emittedAt:             string;
}

/**
 * Try to read the schema manifest hash off disk. If the file isn't
 * present (dev environment that never ran `generate:schema-manifest`),
 * we fall back to null — the fingerprint still has value via the
 * contract version + runtime fields.
 */
function readSchemaManifestHash(): string | null {
  try {
    const p = path.resolve(__dirname, '..', '..', '..', 'generated', 'schema-column-manifest.json');
    if (!fs.existsSync(p)) return null;
    const raw = fs.readFileSync(p, 'utf8');
    const parsed = JSON.parse(raw) as { manifest_hash?: string };
    return parsed.manifest_hash ?? null;
  } catch {
    return null;
  }
}

function digestFingerprint(parts: ReadonlyArray<string | null>): string {
  return createHash('sha256').update(parts.map((p) => p ?? '').join('|')).digest('hex');
}

let cached: BootFingerprint | null = null;

/**
 * Compute (cached) + emit the fingerprint exactly once. Returns the
 * snapshot. Subsequent calls are no-ops returning the same object.
 *
 * `schemaManifestHash` may be passed in by the boot orchestrator if it
 * already loaded the manifest — we accept it as a hint and fall back to
 * reading the file otherwise.
 */
export function emitBootFingerprint(hint?: { schemaManifestHash?: string }): BootFingerprint {
  if (cached) return cached;

  const schemaManifestHash =
    hint?.schemaManifestHash && hint.schemaManifestHash.length > 16
      ? hint.schemaManifestHash
      : readSchemaManifestHash();

  const nodeVersion = process.version;
  const nodeEnv = process.env.NODE_ENV ?? 'unknown';
  const vercelEnv = process.env.VERCEL_ENV ?? null;
  const railwayEnv = process.env.RAILWAY_ENVIRONMENT ?? null;
  const deploymentId =
    process.env.VERCEL_GIT_COMMIT_SHA
    ?? process.env.RAILWAY_DEPLOYMENT_ID
    ?? process.env.GIT_COMMIT_SHA
    ?? null;

  const fingerprint = digestFingerprint([
    AUTH_CONTRACT_VERSION,
    schemaManifestHash,
    nodeVersion,
    nodeEnv,
    vercelEnv,
    railwayEnv,
  ]).slice(0, 32);

  const snapshot: BootFingerprint = {
    fingerprint,
    authContractVersion: AUTH_CONTRACT_VERSION,
    schemaManifestHash,
    nodeVersion,
    nodeEnv,
    deploymentId,
    vercelEnv,
    railwayEnv,
    emittedAt: new Date().toISOString(),
  };

  logger.info('auth_boot_fingerprint', {
    fingerprint:           snapshot.fingerprint,
    auth_contract_version: snapshot.authContractVersion,
    schema_manifest_hash:  snapshot.schemaManifestHash,
    node_version:          snapshot.nodeVersion,
    node_env:              snapshot.nodeEnv,
    deployment_id:         snapshot.deploymentId,
    vercel_env:            snapshot.vercelEnv,
    railway_env:           snapshot.railwayEnv,
  });

  cached = snapshot;
  return snapshot;
}

/** Reset for tests only. */
export function resetBootFingerprint(): void {
  cached = null;
}
