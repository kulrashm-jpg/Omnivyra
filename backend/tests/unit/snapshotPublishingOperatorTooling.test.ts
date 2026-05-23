import {
  selectTargetMigrations,
  hasDestructiveDdl,
  validateRedisTlsUrl,
  aggregateRuntimeReadiness,
  SNAPSHOT_PUBLISHING_MIGRATION_PREFIXES,
} from '../../../scripts/operator/snapshotPublishingOperatorCore';
import { buildShadowSoakReport } from '../../../backend/services/workerSnapshotShadowSoakRunner';

const T1 = '20260723_content_publish_snapshots.sql';
const T2 = '20260724_worker_snapshot_shadow_telemetry.sql';
const UNRELATED = ['20260719_settlement_lifecycle_foundation.sql', '20260722_settlement_metrics_prune.sql'];

describe('selectTargetMigrations', () => {
  it('selects ONLY the two snapshot-publishing migrations, in order', () => {
    const selection = selectTargetMigrations([...UNRELATED, T2, T1]);
    expect(selection.valid).toBe(true);
    expect(selection.selected).toEqual([T1, T2]);
    expect(selection.ordered).toBe(true);
  });

  it('is deterministic', () => {
    const files = [...UNRELATED, T1, T2];
    expect(JSON.stringify(selectTargetMigrations(files))).toBe(JSON.stringify(selectTargetMigrations(files)));
  });

  it('reports a missing target migration as invalid', () => {
    const selection = selectTargetMigrations([T1, ...UNRELATED]);
    expect(selection.valid).toBe(false);
    expect(selection.missing).toContain('20260724');
  });

  it('reports a duplicated target migration as invalid', () => {
    const selection = selectTargetMigrations([T1, T2, '20260724_worker_snapshot_shadow_telemetry_v2.sql']);
    expect(selection.valid).toBe(false);
    expect(selection.duplicates).toContain('20260724');
  });

  it('never selects unrelated historical migrations', () => {
    const selection = selectTargetMigrations([...UNRELATED, T1, T2]);
    for (const file of selection.selected) {
      expect(SNAPSHOT_PUBLISHING_MIGRATION_PREFIXES.some((prefix) => file.startsWith(prefix))).toBe(true);
    }
  });
});

describe('hasDestructiveDdl', () => {
  it('flags destructive DDL statements', () => {
    expect(hasDestructiveDdl('DROP TABLE public.x;')).toBe('DROP TABLE');
    expect(hasDestructiveDdl('TRUNCATE public.x;')).toBe('TRUNCATE');
    expect(hasDestructiveDdl('DELETE FROM public.x;')).toBe('DELETE FROM');
    expect(hasDestructiveDdl('ALTER TABLE x DROP COLUMN y;')).toBe('DROP COLUMN');
  });

  it('allows additive DDL including DROP TRIGGER IF EXISTS', () => {
    const additive = `BEGIN;
      CREATE TABLE IF NOT EXISTS public.x (id uuid primary key);
      CREATE INDEX IF NOT EXISTS idx_x ON public.x(id);
      DROP TRIGGER IF EXISTS t ON public.x;
      CREATE TRIGGER t BEFORE UPDATE ON public.x FOR EACH ROW EXECUTE FUNCTION f();
      COMMIT;`;
    expect(hasDestructiveDdl(additive)).toBeNull();
  });
});

describe('validateRedisTlsUrl', () => {
  it('accepts a rediss:// TLS url', () => {
    const validation = validateRedisTlsUrl('rediss://default:token@host.upstash.io:6379');
    expect(validation.valid).toBe(true);
    expect(validation.isTls).toBe(true);
    expect(validation.scheme).toBe('rediss');
  });

  it('rejects plain redis:// with a clear reason', () => {
    const validation = validateRedisTlsUrl('redis://localhost:6379');
    expect(validation.valid).toBe(false);
    expect(validation.reasons.join(' ')).toContain('rediss://');
  });

  it('rejects an empty or schemeless url', () => {
    expect(validateRedisTlsUrl(undefined).valid).toBe(false);
    expect(validateRedisTlsUrl('').valid).toBe(false);
    expect(validateRedisTlsUrl('host:6379').valid).toBe(false);
  });
});

describe('aggregateRuntimeReadiness', () => {
  const cleanInput = {
    migrationsApplied: true,
    triggersPresent: true,
    indexesPresent: true,
    telemetryTableAccessible: true,
    redisTls: true,
    soakStatus: 'shadow_soak_clean' as const,
    persistenceStatus: 'persistence_clean' as const,
    crossCompanyOwnershipDriftCount: 0,
  };

  it('returns READY when every prerequisite is verified clean', () => {
    expect(aggregateRuntimeReadiness(cleanInput).readiness).toBe('READY');
  });

  it('returns NOT_READY on a hard blocker', () => {
    expect(aggregateRuntimeReadiness({ ...cleanInput, migrationsApplied: false }).readiness).toBe('NOT_READY');
    expect(aggregateRuntimeReadiness({ ...cleanInput, redisTls: false }).readiness).toBe('NOT_READY');
    expect(aggregateRuntimeReadiness({ ...cleanInput, crossCompanyOwnershipDriftCount: 1 }).readiness).toBe('NOT_READY');
    expect(aggregateRuntimeReadiness({ ...cleanInput, soakStatus: 'shadow_soak_invalid' }).readiness).toBe('NOT_READY');
  });

  it('returns CONDITIONAL when soak or persistence is unverified or degraded', () => {
    expect(aggregateRuntimeReadiness({ ...cleanInput, soakStatus: null }).readiness).toBe('CONDITIONAL');
    expect(aggregateRuntimeReadiness({ ...cleanInput, persistenceStatus: 'persistence_warning' }).readiness).toBe('CONDITIONAL');
    expect(aggregateRuntimeReadiness({ ...cleanInput, indexesPresent: false }).readiness).toBe('CONDITIONAL');
  });

  it('is deterministic', () => {
    expect(JSON.stringify(aggregateRuntimeReadiness(cleanInput)))
      .toBe(JSON.stringify(aggregateRuntimeReadiness(cleanInput)));
  });
});

describe('soak summary determinism', () => {
  it('builds a deterministic soak report for an empty telemetry set', () => {
    const first = buildShadowSoakReport('soak-cli', []);
    const second = buildShadowSoakReport('soak-cli', []);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(first.shadowSoakStatus).toBe('shadow_soak_clean');
    expect(first.telemetryCount).toBe(0);
  });
});
