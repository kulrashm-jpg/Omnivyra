import fs from 'fs';

const requiredEnv = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'CREDENTIAL_ENCRYPTION_KEY',
  'PUBLISHING_WORKER_SECRET',
];

const checks = [
  ...requiredEnv.map((key) => ({
    name: `env:${key}`,
    ok: Boolean(process.env[key]),
    severity: key === 'PUBLISHING_WORKER_SECRET' ? 'warning' : 'critical',
    message: process.env[key] ? 'present' : 'missing',
  })),
  {
    name: 'phase_migrations_present',
    ok: [
      'supabase/migrations/20260677_website_intelligence_foundation_phase1.sql',
      'supabase/migrations/20260678_website_intelligence_operational_phase2.sql',
      'supabase/migrations/20260679_website_intelligence_productization_phase3.sql',
      'supabase/migrations/20260680_website_intelligence_phase4_plugin_hardening.sql',
      'supabase/migrations/20260681_website_intelligence_phase5_validation_stabilization.sql',
    ].every((file) => fs.existsSync(file)),
    severity: 'critical',
    message: 'all Website Intelligence migrations must exist before deploy',
  },
  {
    name: 'plugin_package_present',
    ok: fs.existsSync('wordpress-plugin/omnivera-website-intelligence/omnivera-website-intelligence.php'),
    severity: 'critical',
    message: 'WordPress plugin source package is present',
  },
  {
    name: 'tracker_present',
    ok: fs.existsSync('public/omnivera-tracker.js'),
    severity: 'critical',
    message: 'tracking loader is present',
  },
];

const failed = checks.filter((check) => !check.ok && check.severity === 'critical');
console.log(JSON.stringify({
  ok: failed.length === 0,
  checks,
  smokeTestChecklist: [
    'Apply migrations in timestamp order.',
    'Run npm run wi:migrations:validate.',
    'Create setup token in staging and connect WordPress plugin.',
    'Verify tracking event ingestion from staging WordPress.',
    'Run publishing worker and reconciliation worker once.',
    'Open /website-intelligence with staging company_id.',
  ],
  rollbackChecklist: [
    'Disable plugin token setup endpoint if onboarding fails.',
    'Pause publishing and reconciliation workers.',
    'Keep additive migrations in place unless instructed by DBA; mark feature disabled at app level.',
    'Revoke compromised plugin registrations and rotate setup tokens.',
  ],
}, null, 2));
if (failed.length) process.exitCode = 1;
