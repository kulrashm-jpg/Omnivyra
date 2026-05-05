import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';

const ROOT = process.cwd();
const ACTIVE_DIR = join(ROOT, 'supabase', 'migrations');
const QUARANTINE_DIR = join(ACTIVE_DIR, '_quarantine', 'legacy_untracked');

const DOMAIN_SEQUENCE = [
  '20260609_company_domains_canonical_foundation.sql',
  '20260610_company_domains_deprecate_legacy_domain.sql',
  '20260611_company_domains_final_domain_unique_and_not_null.sql',
  '20260612_company_domains_drop_legacy_domain_and_add_check.sql',
  '20260613_company_domains_verification_proof_columns.sql',
  '20260614_company_domains_verification_method_dns_http.sql',
  '20260615_domain_events_table.sql',
  '20260616_domain_reminders_table.sql',
  '20260617_domain_reminders_pg_cron_schedule.sql',
];

const fail = (message: string): never => {
  console.error(`[check-domain-migration-sequence] FAIL - ${message}`);
  process.exit(1);
};

if (!existsSync(QUARANTINE_DIR)) {
  fail('quarantine migration directory is missing');
}

const quarantineFiles = new Set(readdirSync(QUARANTINE_DIR));
for (const file of DOMAIN_SEQUENCE) {
  if (!quarantineFiles.has(file)) {
    fail(`expected quarantined migration missing: ${file}`);
  }
}

const activeFiles = readdirSync(ACTIVE_DIR)
  .filter((file) => file.endsWith('.sql'))
  .filter((file) => /^202606(09|10|11|12|13|14|15|16|17)/.test(file));

if (activeFiles.length > 0) {
  fail(`20260609-20260617 domain sequence must stay quarantined, found active: ${activeFiles.join(', ')}`);
}

const ordered = DOMAIN_SEQUENCE.map((file) => readFileSync(join(QUARANTINE_DIR, file), 'utf8'));
const joined = ordered.join('\n');

if (!/UNIQUE\s*\(\s*final_domain\s*\)/i.test(joined)) {
  fail('domain sequence does not enforce UNIQUE(final_domain)');
}

if (/DROP\s+CONSTRAINT\s+unique_final_domain/i.test(joined)) {
  fail('domain sequence drops unique_final_domain');
}

if (/ALTER\s+TABLE\s+[^;]*company_domains[^;]*DROP\s+COLUMN\s+final_domain/i.test(joined)) {
  fail('domain sequence drops canonical final_domain');
}

console.log('[check-domain-migration-sequence] OK - quarantined domain sequence has no obvious ordering conflicts.');
