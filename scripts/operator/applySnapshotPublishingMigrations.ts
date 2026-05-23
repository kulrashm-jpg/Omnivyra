/*
SCRIPT_CLASSIFICATION: OPERATOR
MUTATION_LEVEL: SCHEMA_MUTATION
SAFE_FOR_CI: NO
SAFE_FOR_PRODUCTION: CAUTION
REQUIRES_EXPLICIT_OPERATOR_INTENT: YES
*/
/**
 * Targeted Snapshot Publishing Migration Apply
 *
 * Applies ONLY the two snapshot-publishing migrations (20260723, 20260724),
 * in order, one transaction per file. The migration files are self-contained
 * (BEGIN/COMMIT, IF NOT EXISTS, idempotent), so this is safe to re-run and
 * safe under a partially reconciled migration ledger.
 *
 * It does NOT run a blanket db:push, NOT replay history, and refuses any file
 * containing destructive DDL.
 *
 * Run:
 *   npx tsx scripts/operator/applySnapshotPublishingMigrations.ts --dry-run
 *   SUPABASE_DB_URL=postgres://... npx tsx scripts/operator/applySnapshotPublishingMigrations.ts --target-env=local --apply
 */

import fs from 'fs';
import path from 'path';
import { Client } from 'pg';
import { enforceOperatorSafety } from '../_core/operatorSafety';
import {
  selectTargetMigrations,
  hasDestructiveDdl,
} from './snapshotPublishingOperatorCore';

const MIGRATIONS_DIR = path.resolve(__dirname, '..', '..', 'supabase', 'migrations');

function resolveDbUrl(): string | null {
  return process.env.SUPABASE_DB_URL || process.env.DATABASE_URL || null;
}

export interface MigrationApplyResult {
  applied: readonly string[];
  skipped: readonly string[];
  ok: boolean;
  reasons: readonly string[];
}

export async function applySnapshotPublishingMigrations(
  options: { apply: boolean } = { apply: false },
): Promise<MigrationApplyResult> {
  const reasons: string[] = [];
  const files = fs.existsSync(MIGRATIONS_DIR) ? fs.readdirSync(MIGRATIONS_DIR) : [];
  const selection = selectTargetMigrations(files);
  if (!selection.valid) {
    return { applied: [], skipped: selection.selected, ok: false, reasons: selection.reasons };
  }

  for (const file of selection.selected) {
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    const destructive = hasDestructiveDdl(sql);
    if (destructive) {
      return {
        applied: [],
        skipped: selection.selected,
        ok: false,
        reasons: [`refusing to apply ${file}: contains destructive DDL (${destructive})`],
      };
    }
  }

  if (!options.apply) {
    return {
      applied: [],
      skipped: selection.selected,
      ok: true,
      reasons: ['dry-run: migrations validated and ordered; re-run with --apply to execute'],
    };
  }

  const dbUrl = resolveDbUrl();
  if (!dbUrl) {
    return {
      applied: [],
      skipped: selection.selected,
      ok: false,
      reasons: ['SUPABASE_DB_URL / DATABASE_URL not set — cannot execute DDL; aborting without changes'],
    };
  }

  const client = new Client({ connectionString: dbUrl });
  const applied: string[] = [];
  try {
    await client.connect();
    for (const file of selection.selected) {
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
      // Each migration file carries its own BEGIN/COMMIT and is idempotent.
      await client.query(sql);
      applied.push(file);
    }
  } catch (error) {
    reasons.push(`apply failed: ${error instanceof Error ? error.message : 'unknown error'}`);
    return { applied, skipped: selection.selected.filter((f) => !applied.includes(f)), ok: false, reasons };
  } finally {
    await client.end().catch(() => undefined);
  }

  return {
    applied,
    skipped: [],
    ok: true,
    reasons: ['migrations applied; run verifySnapshotPublishingRuntime.ts to confirm objects'],
  };
}

async function main(): Promise<number> {
  const safety = enforceOperatorSafety({
    scriptName: 'scripts/operator/applySnapshotPublishingMigrations.ts',
    mutationTarget: 'db/schema',
    intendedAction: 'apply ONLY the snapshot-publishing migrations 20260723 and 20260724',
    example: 'npx tsx scripts/operator/applySnapshotPublishingMigrations.ts --target-env=local --apply',
  });
  if (!safety.allowed) return 0;

  const apply = process.argv.slice(2).includes('--apply');
  const result = await applySnapshotPublishingMigrations({ apply });
  console.log(JSON.stringify({ scope: 'apply-snapshot-publishing-migrations', apply, ...result }, null, 2));
  return result.ok ? 0 : 1;
}

if (require.main === module) {
  main().then((code) => process.exit(code)).catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
