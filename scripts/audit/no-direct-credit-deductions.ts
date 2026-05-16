/**
 * CI Guard — no direct credit deductions outside the orchestrator
 *
 * Run from CI:
 *   npx ts-node scripts/audit/no-direct-credit-deductions.ts
 *
 * Fails the PR with exit code 1 if any of these patterns appear outside
 * the approved files:
 *
 *   1. `supabase.rpc('apply_credit_reservation'`
 *   2. `supabase.rpc('apply_credit_partial_confirm'`
 *   3. `.from('credit_transactions').insert(`
 *   4. `.from('credit_transactions').update(`
 *   5. `.from('credit_transactions').delete(`
 *   6. `.from('organization_credits').update(`  (wallet mutations)
 *
 * Approved files (the only legal mutators):
 *   - backend/repositories/creditExecutionRepository.ts
 *   - backend/services/creditExecutionService.ts
 *   - backend/services/creditExpiryService.ts            (expire phase only)
 *   - backend/services/creditOrphanHoldReaper.ts         (release phase only)
 *   - supabase/migrations/*                              (schema changes)
 *
 * Plus a soft rule:
 *   - `aiGateway.runCompletionWithOperation(` is allowed outside the orchestrator
 *     only when the caller is also in the `credit_untracked_actions` allowlist
 *     OR uses `runBilledAiCompletion` instead. The guard reports these as
 *     warnings (not failures) so the C-2 shadow-mode rollout can proceed.
 *
 * The guard scans backend/, pages/, lib/.
 */

import fs from 'fs';
import path from 'path';
import { STATIC_NON_BILLABLE_AI_SCOPE_RULES } from '../../backend/services/billing/nonBillableRegistry';

const ROOT = path.resolve(__dirname, '..', '..');
const SCAN_DIRS = ['backend', 'pages', 'lib'];
const ALLOWED_FILES = new Set<string>([
  'backend/repositories/creditExecutionRepository.ts',
  'backend/services/creditExecutionService.ts',
  'backend/services/creditExpiryService.ts',
  'backend/services/creditOrphanHoldReaper.ts',
]);

const HARD_PATTERNS: Array<{ pattern: RegExp; description: string }> = [
  { pattern: /supabase\.rpc\(['"]apply_credit_reservation['"]/, description: 'direct apply_credit_reservation RPC call' },
  { pattern: /supabase\.rpc\(['"]apply_credit_partial_confirm['"]/, description: 'direct apply_credit_partial_confirm RPC call' },
  { pattern: /\.from\(['"]credit_transactions['"]\)\.insert\(/, description: 'direct insert into credit_transactions' },
  { pattern: /\.from\(['"]credit_transactions['"]\)\.update\(/, description: 'direct update on credit_transactions (immutable ledger)' },
  { pattern: /\.from\(['"]credit_transactions['"]\)\.delete\(/, description: 'direct delete on credit_transactions (immutable ledger)' },
  { pattern: /\.from\(['"]organization_credits['"]\)\.update\(/, description: 'direct update on organization_credits (wallet)' },
];

const SOFT_PATTERNS: Array<{ pattern: RegExp; description: string }> = [
  { pattern: /runCompletionWithOperation\(/, description: 'aiGateway call (should migrate to runBilledAiCompletion or allowlist via credit_untracked_actions)' },
];

const SOFT_EXEMPT_FILES = new Set<string>([
  // These are the legitimate aiGateway implementation/wrapper files.
  'backend/services/aiGateway.ts',
  'backend/services/billing/runBilledAiCompletion.ts',
  // The guard itself references the runtime symbol in docstrings — exempt.
  'backend/services/billing/aiGatewayBillingGuard.ts',
  // Approved tests
  'backend/tests/unit/aiGatewayBillingGuard.test.ts',
]);

interface Finding {
  file:       string;
  line:       number;
  text:       string;
  description: string;
  severity:   'error' | 'warning';
}

interface ClassifiedFinding extends Finding {
  classification?: string;
  justification?: string;
}

function walk(dir: string, found: string[] = []): string[] {
  if (!fs.existsSync(dir)) return found;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    if (entry.name === '__mocks__' || entry.name === 'tests') {
      // We still want to scan test files for the HARD patterns (mocks should
      // not call the real RPCs), but we lower SOFT-pattern noise.
    }
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, found);
    } else if (/\.(ts|tsx|js|jsx)$/.test(entry.name)) {
      found.push(full);
    }
  }
  return found;
}

function relPath(p: string): string {
  return path.relative(ROOT, p).split(path.sep).join('/');
}

function scanFile(filePath: string): Finding[] {
  const rel = relPath(filePath);
  if (ALLOWED_FILES.has(rel)) return [];
  if (rel.startsWith('supabase/migrations/')) return [];
  if (rel.includes('/audit/no-direct-credit-deductions')) return [];

  const text = fs.readFileSync(filePath, 'utf8');
  const lines = text.split(/\r?\n/);
  const findings: Finding[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Hard rules
    for (const { pattern, description } of HARD_PATTERNS) {
      if (pattern.test(line)) {
        findings.push({
          file: rel, line: i + 1, text: line.trim(), description, severity: 'error',
        });
      }
    }
    // Soft rules
    if (!SOFT_EXEMPT_FILES.has(rel)) {
      for (const { pattern, description } of SOFT_PATTERNS) {
        if (pattern.test(line)) {
          findings.push({
            file: rel, line: i + 1, text: line.trim(), description, severity: 'warning',
          });
        }
      }
    }
  }
  return findings;
}

function classifySoftFinding(finding: Finding): ClassifiedFinding {
  if (finding.severity !== 'warning') return finding;
  const rule = STATIC_NON_BILLABLE_AI_SCOPE_RULES.find((r) => finding.file.startsWith(r.filePattern));
  if (!rule) return finding;
  return {
    ...finding,
    classification: rule.category,
    justification: rule.reason,
  };
}

function main(): number {
  const allFiles: string[] = [];
  for (const dir of SCAN_DIRS) walk(path.join(ROOT, dir), allFiles);

  const findings: Finding[] = [];
  for (const file of allFiles) {
    findings.push(...scanFile(file));
  }

  const errors = findings.filter(f => f.severity === 'error');
  const warningsRaw = findings.filter(f => f.severity === 'warning');
  const warnings = warningsRaw.map(classifySoftFinding);

  const classified   = warnings.filter(w => !!w.classification);
  const unclassified = warnings.filter(w => !w.classification);

  console.log(`Scanned ${allFiles.length} files`);
  console.log(`Errors:        ${errors.length}`);
  console.log(`Warnings:      ${warnings.length}`);
  console.log(`  classified:  ${classified.length}`);
  console.log(`  unowned:     ${unclassified.length}`);

  // Tally by category
  const byCategory: Record<string, number> = {};
  for (const w of classified) {
    const k = w.classification!;
    byCategory[k] = (byCategory[k] ?? 0) + 1;
  }
  if (Object.keys(byCategory).length > 0) {
    console.log('  by category:');
    for (const [cat, n] of Object.entries(byCategory)) {
      console.log(`    ${cat.padEnd(28)} ${n}`);
    }
  }

  if (errors.length > 0) {
    console.log('\n=== HARD VIOLATIONS (CI failure) ===');
    for (const f of errors) {
      console.log(`  ${f.file}:${f.line}  ${f.description}`);
      console.log(`    | ${f.text}`);
    }
  }

  if (unclassified.length > 0) {
    console.log('\n=== UNOWNED ADVISORY WARNINGS ===');
    console.log('These files match no STATIC_NON_BILLABLE_AI_SCOPE_RULES entry.');
    console.log('Either add a rule (preferred) or migrate the caller to runBilledAiCompletion.\n');
    for (const f of unclassified) {
      console.log(`  ${f.file}:${f.line}  ${f.description}`);
    }
  } else if (warnings.length > 0) {
    console.log(`\nAll ${warnings.length} advisory warnings are owned by static rules.`);
  }

  if (process.env.VERBOSE_BILLING_AUDIT === 'true' && classified.length > 0) {
    console.log('\n=== CLASSIFIED WARNINGS ===');
    for (const f of classified) {
      console.log(`  ${f.file}:${f.line}  [${f.classification}]`);
    }
  } else if (classified.length > 0) {
    console.log(`(${classified.length} classified warnings — set VERBOSE_BILLING_AUDIT=true to list.)`);
  }

  // CI policy: fail on hard violations. Unowned warnings emit a non-zero
  // exit code if STRICT_BILLING_AUDIT=true, otherwise they are advisory.
  if (errors.length > 0) {
    console.log('\nFAIL — direct ledger / RPC mutations detected outside the orchestrator.');
    return 1;
  }
  if (unclassified.length > 0 && String(process.env.STRICT_BILLING_AUDIT ?? '').toLowerCase() === 'true') {
    console.log('\nFAIL — STRICT_BILLING_AUDIT is on and there are unowned advisory warnings.');
    return 1;
  }
  console.log('\nOK — no direct credit deductions outside the orchestrator.');
  return 0;
}

if (require.main === module) {
  process.exit(main());
}

export { scanFile, walk };
