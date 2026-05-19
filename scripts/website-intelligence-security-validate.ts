import fs from 'fs';

const checks = [
  {
    name: 'setup_token_hashing',
    ok: fs.readFileSync('backend/services/wordpressPluginSetupService.ts', 'utf8').includes('setup_token_hash'),
    remediation: 'Setup tokens must be hashed before persistence.',
  },
  {
    name: 'plugin_token_hashing',
    ok: fs.readFileSync('backend/services/wordpressPluginService.ts', 'utf8').includes('access_token_hash'),
    remediation: 'Plugin access tokens must not be stored plaintext server-side.',
  },
  {
    name: 'replay_expiry',
    ok: fs.readFileSync('backend/services/wordpressPluginService.ts', 'utf8').includes('validateReplay'),
    remediation: 'Plugin sync requests must enforce timestamp expiry.',
  },
  {
    name: 'admin_alerts_rbac',
    ok: fs.readFileSync('pages/api/admin/website-intelligence/alerts.ts', 'utf8').includes('enforceRole'),
    remediation: 'Admin diagnostics and alerts must be role protected.',
  },
  {
    name: 'tracking_origin_enforcement',
    ok: fs.readFileSync('pages/api/website-events/track.ts', 'utf8').includes('checkWebsiteOrigin'),
    remediation: 'Tracking ingestion must enforce website origin policy.',
  },
  {
    name: 'credential_encryption_path',
    ok: fs.readFileSync('backend/services/integrationCredentialService.ts', 'utf8').includes('encryptCredential'),
    remediation: 'Credential persistence must go through integrationCredentialService.',
  },
  {
    name: 'wordpress_capability_checks',
    ok: fs.readFileSync('wordpress-plugin/omnivera-website-intelligence/includes/class-omnivera-admin.php', 'utf8').includes('current_user_can'),
    remediation: 'WordPress admin actions must require manage_options.',
  },
  {
    name: 'wordpress_nonce_checks',
    ok: fs.readFileSync('wordpress-plugin/omnivera-website-intelligence/includes/class-omnivera-admin.php', 'utf8').includes('check_admin_referer'),
    remediation: 'WordPress admin actions must validate nonces.',
  },
];

const failed = checks.filter((check) => !check.ok);
console.log(JSON.stringify({ ok: failed.length === 0, checks }, null, 2));
if (failed.length) process.exitCode = 1;
