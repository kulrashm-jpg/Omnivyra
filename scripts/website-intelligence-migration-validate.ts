import fs from 'fs';
import path from 'path';

type Check = { name: string; ok: boolean; detail?: string };

const migrationDir = path.join(process.cwd(), 'supabase', 'migrations');
const phaseFiles = [
  '20260677_website_intelligence_foundation_phase1.sql',
  '20260678_website_intelligence_operational_phase2.sql',
  '20260679_website_intelligence_productization_phase3.sql',
  '20260680_website_intelligence_phase4_plugin_hardening.sql',
  '20260681_website_intelligence_phase5_validation_stabilization.sql',
];

const destructivePatterns = [
  /\bdrop\s+table\b/i,
  /\btruncate\s+table\b/i,
  /\bdelete\s+from\s+public\.(websites|leads|forms|blogs|tracking_events)\b/i,
  /\balter\s+table\b[\s\S]{0,120}\bdrop\s+column\b/i,
];

function main() {
  const checks: Check[] = [];
  for (const file of phaseFiles) {
    const full = path.join(migrationDir, file);
    const sql = fs.existsSync(full) ? fs.readFileSync(full, 'utf8') : '';
    checks.push({ name: `exists:${file}`, ok: Boolean(sql), detail: full });
    if (!sql) continue;
    checks.push({ name: `transaction:${file}`, ok: /\bbegin\s*;/i.test(sql) && /\bcommit\s*;/i.test(sql) });
    checks.push({ name: `idempotent:${file}`, ok: /if\s+not\s+exists/i.test(sql) || /add\s+column\s+if\s+not\s+exists/i.test(sql) });
    checks.push({ name: `rls:${file}`, ok: /enable\s+row\s+level\s+security/i.test(sql) || file.includes('phase1') });
    const destructive = destructivePatterns.find((pattern) => pattern.test(sql));
    checks.push({ name: `non_destructive:${file}`, ok: !destructive, detail: destructive ? String(destructive) : undefined });
  }

  const combined = phaseFiles.map((file) => fs.existsSync(path.join(migrationDir, file)) ? fs.readFileSync(path.join(migrationDir, file), 'utf8') : '').join('\n');
  for (const table of [
    'websites',
    'website_connections',
    'publishing_jobs',
    'tracking_events',
    'wordpress_plugin_setup_sessions',
    'worker_health',
    'website_intelligence_alerts',
  ]) {
    checks.push({ name: `table_covered:${table}`, ok: combined.includes(`public.${table}`) || combined.includes(`'${table}'`) });
  }

  print(checks);
}

function print(checks: Check[]) {
  const failed = checks.filter((check) => !check.ok);
  console.log(JSON.stringify({ ok: failed.length === 0, checks }, null, 2));
  if (failed.length) process.exitCode = 1;
}

main();
