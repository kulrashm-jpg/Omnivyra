#!/usr/bin/env node
/*
SCRIPT_CLASSIFICATION: OPERATOR
MUTATION_LEVEL: AUTH_MUTATION
SAFE_FOR_CI: NO
SAFE_FOR_PRODUCTION: CAUTION
REQUIRES_EXPLICIT_OPERATOR_INTENT: YES
*/
/**
 * send-magic-link.js
 *
 * Generates and logs a Supabase magic link for a given email.
 * Use this to re-invite a user or trigger the first-login flow
 * without going through the super-admin UI.
 *
 * Usage:
 *   node scripts/operator/auth/send-magic-link.js kuldeep@omnivyra.com
 */

const path = require('path');
const fs   = require('fs');
const { createClient } = require('@supabase/supabase-js');
process.env.TS_NODE_COMPILER_OPTIONS = '{"module":"commonjs"}';
require('ts-node/register/transpile-only');
const { enforceOperatorSafety, getOperatorArgs } = require('../../_core/operatorSafety');

const envLocalPath = path.join(__dirname, '../../../.env.local');
if (fs.existsSync(envLocalPath)) {
  require('dotenv').config({ path: envLocalPath });
} else {
  require('dotenv').config();
}

async function main() {
  const safety = enforceOperatorSafety({
    scriptName: 'scripts/operator/auth/send-magic-link.js',
    mutationTarget: 'auth',
    intendedAction: 'generate a Supabase Auth magic link for a specific email address',
    example: 'node scripts/operator/auth/send-magic-link.js kuldeep@omnivyra.com --target-env=local --execute',
  });
  if (!safety.allowed) return;

  const email = getOperatorArgs()[0];
  if (!email) {
    console.error('Usage: node scripts/operator/auth/send-magic-link.js <email>');
    process.exit(1);
  }

  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || 'http://localhost:3000').replace(/\/$/, '');

  if (!url || !key) {
    console.error('ERROR: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env.local');
    process.exit(1);
  }

  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  console.log(`\nGenerating magic link for: ${email}`);
  console.log(`App URL: ${appUrl}\n`);

  const { data, error } = await supabase.auth.admin.generateLink({
    type: 'magiclink',
    email,
    options: { redirectTo: `${appUrl}/auth/callback` },
  });

  if (error) {
    console.error('ERROR generating magic link:', error.message);
    process.exit(1);
  }

  const link = data?.properties?.action_link;
  if (!link) {
    console.error('ERROR: No action_link in response:', JSON.stringify(data, null, 2));
    process.exit(1);
  }

  console.log('Magic link (send this to the user or open in browser):\n');
  console.log(link);
  console.log('');
}

main().catch(err => { console.error('Unexpected error:', err); process.exit(1); });
