/*
SCRIPT_CLASSIFICATION: OPERATOR_SUPPORT
MUTATION_LEVEL: NONE
SAFE_FOR_CI: NO
SAFE_FOR_PRODUCTION: YES
REQUIRES_EXPLICIT_OPERATOR_INTENT: NO
*/
/**
 * Snapshot Publishing Runtime Verification
 *
 * Read-only verification that the snapshot-publishing schema is present and
 * its immutability / append-only guarantees are enforced. Immutability tests
 * run inside a transaction that is ALWAYS rolled back — production data is
 * never mutated.
 *
 * Run:
 *   SUPABASE_DB_URL=postgres://... npx tsx scripts/operator/verifySnapshotPublishingRuntime.ts
 */

import { Client } from 'pg';

export interface SnapshotRuntimeVerification {
  ok: boolean;
  contentPublishSnapshotsTable: boolean;
  workerShadowTelemetryTable: boolean;
  immutabilityTriggerPresent: boolean;
  appendOnlyTriggerPresent: boolean;
  indexesPresent: boolean;
  telemetryInsertWorks: boolean;
  telemetryImmutabilityEnforced: boolean;
  snapshotImmutabilityEnforced: boolean;
  reasons: readonly string[];
}

const EXPECTED_INDEXES = [
  'idx_content_publish_snapshots_company',
  'idx_wsst_soak_cycle',
];

function resolveDbUrl(): string | null {
  return process.env.SUPABASE_DB_URL || process.env.DATABASE_URL || null;
}

async function tableExists(client: Client, table: string): Promise<boolean> {
  const { rows } = await client.query('SELECT 1 FROM pg_tables WHERE schemaname = $1 AND tablename = $2', ['public', table]);
  return rows.length > 0;
}

async function triggerExists(client: Client, trigger: string): Promise<boolean> {
  const { rows } = await client.query('SELECT 1 FROM pg_trigger WHERE tgname = $1 AND NOT tgisinternal', [trigger]);
  return rows.length > 0;
}

export async function verifySnapshotPublishingRuntime(): Promise<SnapshotRuntimeVerification> {
  const reasons: string[] = [];
  const result: SnapshotRuntimeVerification = {
    ok: false,
    contentPublishSnapshotsTable: false,
    workerShadowTelemetryTable: false,
    immutabilityTriggerPresent: false,
    appendOnlyTriggerPresent: false,
    indexesPresent: false,
    telemetryInsertWorks: false,
    telemetryImmutabilityEnforced: false,
    snapshotImmutabilityEnforced: false,
    reasons,
  };

  const dbUrl = resolveDbUrl();
  if (!dbUrl) {
    reasons.push('SUPABASE_DB_URL / DATABASE_URL not set — verification cannot run');
    return result;
  }

  const client = new Client({ connectionString: dbUrl });
  try {
    await client.connect();

    result.contentPublishSnapshotsTable = await tableExists(client, 'content_publish_snapshots');
    result.workerShadowTelemetryTable = await tableExists(client, 'worker_snapshot_shadow_telemetry');
    result.immutabilityTriggerPresent = await triggerExists(client, 'content_publish_snapshots_guard_immutable');
    result.appendOnlyTriggerPresent = await triggerExists(client, 'worker_snapshot_shadow_telemetry_append_only');

    const { rows: indexRows } = await client.query(
      'SELECT indexname FROM pg_indexes WHERE schemaname = $1 AND indexname = ANY($2)',
      ['public', EXPECTED_INDEXES],
    );
    result.indexesPresent = indexRows.length === EXPECTED_INDEXES.length;
    if (!result.indexesPresent) reasons.push(`expected ${EXPECTED_INDEXES.length} indexes, found ${indexRows.length}`);

    // Append-only enforcement test for worker_snapshot_shadow_telemetry —
    // entirely inside a rolled-back transaction (zero production mutation).
    if (result.workerShadowTelemetryTable) {
      try {
        await client.query('BEGIN');
        await client.query(
          `INSERT INTO public.worker_snapshot_shadow_telemetry
             (soak_cycle_id, record_kind, payload, telemetry_fingerprint)
           VALUES ('verify-probe', 'runtime_telemetry', '{}'::jsonb, 'verify-probe-fingerprint')`,
        );
        result.telemetryInsertWorks = true;
        let updateBlocked = false;
        try {
          await client.query("UPDATE public.worker_snapshot_shadow_telemetry SET runtime_status = 'x' WHERE soak_cycle_id = 'verify-probe'");
        } catch {
          updateBlocked = true;
        }
        let deleteBlocked = false;
        try {
          await client.query("DELETE FROM public.worker_snapshot_shadow_telemetry WHERE soak_cycle_id = 'verify-probe'");
        } catch {
          deleteBlocked = true;
        }
        result.telemetryImmutabilityEnforced = updateBlocked && deleteBlocked;
        if (!result.telemetryImmutabilityEnforced) reasons.push('append-only enforcement on shadow telemetry is NOT active');
      } finally {
        await client.query('ROLLBACK').catch(() => undefined);
      }
    }

    // Immutability enforcement test for content_publish_snapshots — also fully
    // rolled back. Skipped gracefully if no company row exists to satisfy FK.
    if (result.contentPublishSnapshotsTable) {
      try {
        await client.query('BEGIN');
        const { rows: companyRows } = await client.query('SELECT id FROM public.companies LIMIT 1');
        if (companyRows.length === 0) {
          reasons.push('snapshot immutability test skipped: no companies row available for the FK probe');
        } else {
          await client.query(
            `INSERT INTO public.content_publish_snapshots
               (snapshot_id, publish_contract_id, publish_version_hash, company_id, content_type,
                publish_target_type, publish_mode, publish_intent, snapshot_payload, contract_payload, idempotency_key)
             VALUES ('verify-probe','verify-probe','verify-probe',$1,'blog',
                'wordpress','schedule','schedule','{}'::jsonb,'{}'::jsonb,'verify-probe')`,
            [companyRows[0].id],
          );
          let blocked = false;
          try {
            await client.query("UPDATE public.content_publish_snapshots SET snapshot_payload = '{\"x\":1}'::jsonb WHERE snapshot_id = 'verify-probe'");
          } catch {
            blocked = true;
          }
          result.snapshotImmutabilityEnforced = blocked;
          if (!blocked) reasons.push('immutability enforcement on content_publish_snapshots is NOT active');
        }
      } finally {
        await client.query('ROLLBACK').catch(() => undefined);
      }
    }
  } catch (error) {
    reasons.push(`verification error: ${error instanceof Error ? error.message : 'unknown error'}`);
    return result;
  } finally {
    await client.end().catch(() => undefined);
  }

  result.ok = result.contentPublishSnapshotsTable
    && result.workerShadowTelemetryTable
    && result.immutabilityTriggerPresent
    && result.appendOnlyTriggerPresent
    && result.indexesPresent
    && result.telemetryImmutabilityEnforced;
  return result;
}

async function main(): Promise<number> {
  const result = await verifySnapshotPublishingRuntime();
  console.log(JSON.stringify({ scope: 'verify-snapshot-publishing-runtime', ...result }, null, 2));
  return result.ok ? 0 : 1;
}

if (require.main === module) {
  main().then((code) => process.exit(code)).catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
