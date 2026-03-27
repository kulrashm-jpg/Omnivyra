#!/usr/bin/env node
/**
 * send-magic-link.js
 *
 * Generates and logs a Supabase magic link for a given email.
 * Use this to re-invite a user or trigger the first-login flow
 * without going through the super-admin UI.
 *
 * Usage:
 *   node scripts/send-magic-link.js kuldeep@omnivyra.com
 */

const path = require('path');
const fs   = require('fs');
const { createClient } = require('@supabase/supabase-js');

const envLocalPath = path.join(__dirname, '../.env.local');
if (fs.existsSync(envLocalPath)) {
  require('dotenv').config({ path: envLocalPath });
} else {
  require('dotenv').config();
}

async function main() {
  const email = process.argv[2];
  if (!email) {
    console.error('Usage: node scripts/send-magic-link.js <email>');
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
