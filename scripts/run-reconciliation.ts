/**
 * Operator reconciliation runner — LOCALHOST ONLY.
 *
 * Reads a manifest JSON file (one declarative document containing provider,
 * period bounds, kind, optional providerTag, rates, payload), wires the real
 * orchestrators, dispatches, and prints the structured outcome.
 *
 * Localhost guard: refuses to run unless
 *   1. SUPABASE_URL / NEXT_PUBLIC_SUPABASE_URL points at a local host AND
 *   2. RECONCILE_LOCAL_RUNNER=1 is set in env.
 *
 * Usage:
 *   RECONCILE_LOCAL_RUNNER=1 npx ts-node scripts/run-reconciliation.ts \
 *     --manifest=scripts/reconciliation-fixtures/openai/happy.json
 *
 *   # or via npm scripts (one per provider):
 *   npm run reconcile:openai
 *   npm run reconcile:anthropic
 *   npm run reconcile:gemini
 *   npm run reconcile:audio
 *   npm run reconcile:image
 *   npm run reconcile:stripe
 *
 * The orchestrators are imported here (not at module top in the pure
 * dispatcher) so that unit tests of the dispatcher don't pull supabase in.
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  validateManifest,
  dispatchReconciliation,
  assertLocalhostOnly,
  type DispatchOrchestrators,
  type ReconciliationManifest,
} from '../backend/services/billing/reconciliation/runnerDispatch';

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const a of argv) {
    if (!a.startsWith('--')) continue;
    const eq = a.indexOf('=');
    if (eq < 0) { out[a.slice(2)] = '1'; continue; }
    out[a.slice(2, eq)] = a.slice(eq + 1);
  }
  return out;
}

function readManifest(manifestPath: string): unknown {
  const absPath = path.isAbsolute(manifestPath) ? manifestPath : path.resolve(process.cwd(), manifestPath);
  if (!fs.existsSync(absPath)) {
    throw new Error(`manifest_not_found: ${absPath}`);
  }
  const raw = fs.readFileSync(absPath, 'utf8');
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`manifest_invalid_json: ${absPath}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const manifestPath = args.manifest;
  if (!manifestPath) {
    console.error(JSON.stringify({ ok: false, error: 'missing_--manifest_argument' }));
    process.exitCode = 2;
    return;
  }

  // Localhost-only guard FIRST — before any orchestrator import (which
  // would initialize the supabase client and could touch credentials).
  const guard = assertLocalhostOnly();
  if (!guard.ok) {
    const err = (guard as { ok: false; error: string }).error;
    console.error(JSON.stringify({ ok: false, error: err }));
    process.exitCode = 3;
    return;
  }

  let manifestRaw: unknown;
  try { manifestRaw = readManifest(manifestPath); }
  catch (err) {
    console.error(JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) }));
    process.exitCode = 2;
    return;
  }

  const validated = validateManifest(manifestRaw);
  if (!validated.ok) {
    const err = (validated as { ok: false; error: string }).error;
    console.error(JSON.stringify({ ok: false, error: err }));
    process.exitCode = 2;
    return;
  }
  const manifest: ReconciliationManifest = validated.manifest;

  // Lazy-import the real orchestrators so test runs that don't dispatch don't
  // pay the supabase-init cost.
  const { ingestOpenAiInvoice }    = await import('../backend/services/billing/reconciliation/openaiReconciler');
  const { ingestAnthropicInvoice } = await import('../backend/services/billing/reconciliation/anthropicReconciler');
  const { ingestGeminiInvoice }    = await import('../backend/services/billing/reconciliation/geminiReconciler');
  const { ingestAudioInvoice }     = await import('../backend/services/billing/reconciliation/audioReconciler');
  const { ingestImageInvoice }     = await import('../backend/services/billing/reconciliation/imageReconciler');
  const { ingestStripeInvoice }    = await import('../backend/services/billing/reconciliation/stripeReconciler');

  const orchestrators: DispatchOrchestrators = {
    openai:    ingestOpenAiInvoice,
    anthropic: ingestAnthropicInvoice,
    gemini:    ingestGeminiInvoice,
    audio:     ingestAudioInvoice,
    image:     ingestImageInvoice,
    stripe:    ingestStripeInvoice,
  };

  const outcome = await dispatchReconciliation(manifest, orchestrators);
  console.log(JSON.stringify(outcome, null, 2));
  process.exitCode = outcome.ok ? 0 : 1;
}

main().catch((err) => {
  console.error(JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) }));
  process.exitCode = 1;
});
