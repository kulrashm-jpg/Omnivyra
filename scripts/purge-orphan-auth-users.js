#!/usr/bin/env node
/**
 * purge-orphan-auth-users.js
 *
 * Deletes Supabase Auth users that have no corresponding row in public.users.
 * These are accounts that were created in auth.users (e.g. during testing) but
 * never completed sign-up, so they have no app identity and can never log in
 * usefully.
 *
 * Safe: only deletes auth accounts whose email does NOT appear in public.users.
 * Dry-run by default — pass --execute to actually delete.
 *
 * Usage:
 *   node scripts/purge-orphan-auth-users.js           # dry-run
 *   node scripts/purge-orphan-auth-users.js --execute # actually delete
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

const EXECUTE = process.argv.includes('--execute');

async function main() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    console.error('ERROR: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env.local');
    process.exit(1);
  }

  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  console.log(`\nMode: ${EXECUTE ? 'EXECUTE (will delete)' : 'DRY-RUN (no changes)'}\n`);

  // 1. List all Supabase auth users (paginated, max 1000 per page)
  const authUsers = [];
  let page = 1;
  while (true) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) { console.error('ERROR listing auth users:', error.message); process.exit(1); }
    authUsers.push(...(data.users || []));
    if ((data.users || []).length < 1000) break;
    page++;
  }
  console.log(`Auth users found: ${authUsers.length}`);

  if (authUsers.length === 0) {
    console.log('Nothing to do.');
    return;
  }

  // 2. Get all emails that exist in public.users
  const { data: appUsers, error: appErr } = await supabase
    .from('users')
    .select('email, supabase_uid');
  if (appErr) { console.error('ERROR reading public.users:', appErr.message); process.exit(1); }

  const appEmails     = new Set((appUsers || []).map(u => (u.email || '').toLowerCase()));
  const appSupabaseIds = new Set((appUsers || []).map(u => u.supabase_uid).filter(Boolean));

  // 3. Find orphans: auth users whose email and UID are absent from public.users
  const orphans = authUsers.filter(au => {
    const emailMatch = appEmails.has((au.email || '').toLowerCase());
    const uidMatch   = appSupabaseIds.has(au.id);
    return !emailMatch && !uidMatch;
  });

  if (orphans.length === 0) {
    console.log('No orphan auth accounts found. Nothing to delete.');
    return;
  }

  console.log(`\nOrphan auth accounts (${orphans.length}):`);
  for (const u of orphans) {
    console.log(`  ${u.id}  ${u.email || '(no email)'}  created: ${u.created_at}`);
  }

  if (!EXECUTE) {
    console.log('\nDry-run complete. Re-run with --execute to delete these accounts.');
    return;
  }

  // 4. Delete each orphan from Supabase Auth
  console.log('\nDeleting...');
  let deleted = 0;
  let failed  = 0;
  for (const u of orphans) {
    const { error } = await supabase.auth.admin.deleteUser(u.id);
    if (error) {
      console.error(`  FAILED  ${u.id} ${u.email}: ${error.message}`);
      failed++;
    } else {
      console.log(`  DELETED ${u.id} ${u.email}`);
      deleted++;
    }
  }

  console.log(`\nDone. Deleted: ${deleted}  Failed: ${failed}`);
}

main().catch(err => { console.error('Unexpected error:', err); process.exit(1); });
