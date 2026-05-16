/*
SCRIPT_CLASSIFICATION: OPERATOR
MUTATION_LEVEL: BILLING_MUTATION
SAFE_FOR_CI: NO
SAFE_FOR_PRODUCTION: CAUTION
REQUIRES_EXPLICIT_OPERATOR_INTENT: YES
*/
/**
 * Seed Non-Billable Registry — Final Activation Phase
 *
 * Walks STATIC_NON_BILLABLE_AI_SCOPE_RULES and inserts a registry row per
 * matching file. Use ONCE before flipping `BILLING_REQUIRE_AI_HANDLE=true`.
 *
 * Run:
 *   APPROVED_BY_USER_ID=<super-admin-uuid> npx tsx scripts/audit/seed-non-billable-registry.ts
 *
 * Idempotent: re-running upserts the same key with a fresh expiry, matching
 * the registry service's review-window semantics.
 *
 * Notes:
 *   - This script REGISTERS by file path, not by operation key. The aiGateway
 *     guard's allowlist lookup is by operation name, so this seed is the
 *     "pattern-based" complement. Operation-name allowlist entries are
 *     populated manually via super-admin UI or direct SQL.
 *   - Use VERBOSE=1 to print every action.
 */

import fs from 'fs';
import path from 'path';
import { STATIC_NON_BILLABLE_AI_SCOPE_RULES, registerNonBillable } from '../../../backend/services/billing/nonBillableRegistry';
import { enforceOperatorSafety } from '../../_core/operatorSafety';

const ROOT = path.resolve(__dirname, '..', '..', '..');
const SCAN_DIRS = ['backend', 'pages', 'lib'];
const VERBOSE = String(process.env.VERBOSE ?? '').toLowerCase() === '1';

function walk(dir: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|js|jsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

function rel(p: string): string {
  return path.relative(ROOT, p).split(path.sep).join('/');
}

async function main(): Promise<number> {
  const safety = enforceOperatorSafety({
    scriptName: 'scripts/operator/billing/seed-non-billable-registry.ts',
    mutationTarget: 'billing',
    intendedAction: 'register non-billable AI scope entries using the configured approval owner',
    example: 'npx tsx scripts/operator/billing/seed-non-billable-registry.ts --target-env=local --apply',
  });
  if (!safety.allowed) return 0;

  const approvedBy = process.env.APPROVED_BY_USER_ID;
  if (!approvedBy) {
    console.error('FAIL — set APPROVED_BY_USER_ID to the super-admin uuid that owns the seed.');
    return 1;
  }

  const allFiles = SCAN_DIRS.flatMap(d => walk(path.join(ROOT, d)));
  let registered = 0;
  let skipped = 0;
  let failed = 0;

  for (const file of allFiles) {
    const r = rel(file);
    const rule = STATIC_NON_BILLABLE_AI_SCOPE_RULES.find(rr => r === rr.filePattern || r.startsWith(rr.filePattern));
    if (!rule) { skipped++; continue; }

    // Use the file path as the action_key — distinct from operation-name
    // allowlist entries which the aiGateway guard consults.
    const result = await registerNonBillable({
      actionKey:   r,
      reason:      rule.reason,
      approvedBy,
      category:    rule.category,
      ownerUserId: rule.ownerUserId,
    });

    if (result.ok) {
      registered++;
      if (VERBOSE) console.log(`  OK  ${r} → ${rule.category}`);
    } else {
      failed++;
      console.error(`  FAIL ${r}: ${result.error}`);
    }
  }

  console.log(`\nNon-billable registry seed complete.`);
  console.log(`  scanned:    ${allFiles.length}`);
  console.log(`  registered: ${registered}`);
  console.log(`  skipped (no rule match): ${skipped}`);
  console.log(`  failed:     ${failed}`);

  return failed === 0 ? 0 : 1;
}

if (require.main === module) {
  main().then(c => process.exit(c)).catch(err => {
    console.error('FATAL', err);
    process.exit(1);
  });
}
