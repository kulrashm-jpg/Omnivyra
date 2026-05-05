/**
 * Frozen-Schema Guard
 *
 * Scans all supabase/migrations/*.sql files newer than the schema-lock
 * migration (20260520) for any ALTER TABLE or DROP TABLE on the frozen
 * core tables. Exits non-zero if found.
 *
 * Frozen tables (see docs/VARIABLE-COST-TRACKING-ROADMAP.md):
 *   - unified_transactions
 *   - llm_model_pricing
 *   - action_pricing_config
 *   - pricing_intelligence
 *   - cost_anomalies
 *   - company_domains
 *   - user_company_roles
 *
 * An override is allowed: any migration that contains the exact marker
 *   -- APPROVED_SCHEMA_CHANGE: <reason>
 * is considered reviewed and bypasses the check.
 *
 * Usage:  npx ts-node scripts/check-frozen-schemas.ts
 */

import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative, sep } from 'path';

const ROOT = process.cwd();
const MIGRATIONS_DIR = join(ROOT, 'supabase', 'migrations');
const LOCK_MIGRATION_NAME = '20260520_lock_core_schemas.sql';

const FROZEN_TABLES = [
  'unified_transactions',
  'llm_model_pricing',
  'action_pricing_config',
  'pricing_intelligence',
  'cost_anomalies',
  'company_domains',
  'user_company_roles',
] as const;

const APPROVAL_MARKER = /--\s*APPROVED_SCHEMA_CHANGE:/i;

interface Finding {
  file: string;
  line: number;
  table: string;
  operation: string;
  snippet: string;
}

function toRelPosix(p: string): string {
  return relative(ROOT, p).split(sep).join('/');
}

function scanFile(absPath: string): Finding[] {
  let content: string;
  try {
    content = readFileSync(absPath, 'utf-8');
  } catch {
    return [];
  }

  // Migration-wide approval bypass
  if (APPROVAL_MARKER.test(content)) return [];

  const findings: Finding[] = [];
  const lines = content.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    // Skip SQL comments
    if (line.trim().startsWith('--')) continue;

    for (const table of FROZEN_TABLES) {
      const alterRe = new RegExp(`\\bALTER\\s+TABLE\\s+(?:IF\\s+EXISTS\\s+)?(?:public\\.)?${table}\\b`, 'i');
      const dropRe  = new RegExp(`\\bDROP\\s+TABLE\\s+(?:IF\\s+EXISTS\\s+)?(?:public\\.)?${table}\\b`,  'i');

      if (alterRe.test(line)) {
        findings.push({
          file:      toRelPosix(absPath),
          line:      i + 1,
          table,
          operation: 'ALTER TABLE',
          snippet:   line.trim().slice(0, 200),
        });
      }
      if (dropRe.test(line)) {
        findings.push({
          file:      toRelPosix(absPath),
          line:      i + 1,
          table,
          operation: 'DROP TABLE',
          snippet:   line.trim().slice(0, 200),
        });
      }
    }
  }
  return findings;
}

function main(): void {
  let files: string[];
  try {
    files = readdirSync(MIGRATIONS_DIR);
  } catch (err: any) {
    console.error(`[check-frozen-schemas] Cannot read ${MIGRATIONS_DIR}: ${err.message}`);
    process.exit(2);
  }

  // Only check migrations strictly newer than the lock migration.
  const newer = files
    .filter((f) => f.endsWith('.sql'))
    .filter((f) => f > LOCK_MIGRATION_NAME)
    .sort();

  if (newer.length === 0) {
    console.log('[check-frozen-schemas] OK — no migrations newer than the lock migration.');
    process.exit(0);
  }

  const findings: Finding[] = [];
  for (const f of newer) {
    const abs = join(MIGRATIONS_DIR, f);
    try {
      if (!statSync(abs).isFile()) continue;
    } catch {
      continue;
    }
    findings.push(...scanFile(abs));
  }

  if (findings.length === 0) {
    console.log(`[check-frozen-schemas] OK — scanned ${newer.length} migration(s); no frozen-table changes detected.`);
    process.exit(0);
  }

  console.error(`[check-frozen-schemas] FAIL — ${findings.length} frozen-table change(s) detected:\n`);
  for (const f of findings) {
    console.error(`  ${f.file}:${f.line}  ${f.operation} on ${f.table}`);
    console.error(`      ${f.snippet}`);
  }
  console.error(
    '\nFrozen tables require system review. Add an explicit marker to the ' +
    'migration header if the change has been reviewed:',
  );
  console.error('   -- APPROVED_SCHEMA_CHANGE: <one-line reason>');
  process.exit(1);
}

main();
