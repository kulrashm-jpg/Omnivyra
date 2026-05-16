#!/usr/bin/env node
/*
SCRIPT_CLASSIFICATION: OPERATOR
MUTATION_LEVEL: AUTH_MUTATION
SAFE_FOR_CI: NO
SAFE_FOR_PRODUCTION: CAUTION
REQUIRES_EXPLICIT_OPERATOR_INTENT: YES
*/
/**
 * Diagnose or repair a local development login account.
 *
 * Default mode is read-only. Password changes require --reset-password and an
 * explicit DEV_LOGIN_PASSWORD so this script cannot silently rotate credentials.
 */

const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
process.env.TS_NODE_COMPILER_OPTIONS = '{"module":"commonjs"}';
require('ts-node/register/transpile-only');
const { enforceOperatorSafety, getOperatorArgs } = require('../../_core/operatorSafety');

function loadEnv() {
  const envPath = path.join(process.cwd(), '.env.local');
  if (fs.existsSync(envPath)) {
    require('dotenv').config({ path: envPath });
  }
  require('dotenv').config();
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value || !String(value).trim()) {
    throw new Error(`${name} is required`);
  }
  return String(value).trim();
}

function mask(value) {
  if (!value) return '<empty>';
  if (value.length <= 10) return `${value.slice(0, 2)}...`;
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

async function findAuthUserByEmail(admin, email) {
  let page = 1;
  const perPage = 1000;
  while (page <= 20) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) throw error;
    const found = data.users.find((user) => String(user.email ?? '').toLowerCase() === email);
    if (found) return found;
    if (data.users.length < perPage) return null;
    page += 1;
  }
  throw new Error('Could not scan auth users; too many users for local repair script');
}

async function main() {
  loadEnv();
  const safety = enforceOperatorSafety({
    scriptName: 'scripts/operator/auth/repair-local-login.js',
    mutationTarget: 'auth',
    intendedAction: 'repair or create Supabase Auth/public user login state for the configured local login account',
    example: 'node scripts/operator/auth/repair-local-login.js --target-env=local --apply',
  });
  if (!safety.allowed) return;

  const args = new Set(getOperatorArgs());
  const resetPassword = args.has('--reset-password');

  const email = String(
    process.env.DEV_LOGIN_EMAIL
    || process.env.SUPER_ADMIN_EMAIL
    || 'kuldeep@omnivyra.com',
  ).trim().toLowerCase();

  const password = String(process.env.DEV_LOGIN_PASSWORD || '');

  if (!email.includes('@')) throw new Error('DEV_LOGIN_EMAIL must be a valid email address');
  if (resetPassword && password.length < 8) {
    throw new Error('--reset-password requires DEV_LOGIN_PASSWORD with at least 8 characters');
  }

  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY');
  const anonKey = requireEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY');
  if (!url) throw new Error('SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL is required');

  const admin = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const anon = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  console.log(`[auth:repair-login] target=${email} project=${mask(url)}`);

  let authUser = await findAuthUserByEmail(admin, email);
  if (!authUser) {
    if (!resetPassword) {
      throw new Error('Supabase Auth user is missing. Re-run with --reset-password and DEV_LOGIN_PASSWORD only if you intentionally want to create it.');
    }
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { email, email_verified: true },
    });
    if (error) throw error;
    authUser = data.user;
    console.log('[auth:repair-login] created Supabase Auth user');
  } else if (resetPassword) {
    const { data, error } = await admin.auth.admin.updateUserById(authUser.id, {
      email_confirm: true,
      password,
      user_metadata: {
        ...(authUser.user_metadata || {}),
        email,
        email_verified: true,
      },
    });
    if (error) throw error;
    authUser = data.user;
    console.log('[auth:repair-login] reset Supabase Auth password and confirmed email');
  } else {
    const { data, error } = await admin.auth.admin.updateUserById(authUser.id, {
      email_confirm: true,
      user_metadata: {
        ...(authUser.user_metadata || {}),
        email,
        email_verified: true,
      },
    });
    if (error) throw error;
    authUser = data.user;
    console.log('[auth:repair-login] confirmed Supabase Auth email without changing password');
  }

  const now = new Date().toISOString();
  const { data: publicUser, error: publicUserError } = await admin
    .from('users')
    .select('id, email, supabase_uid, active_company_id, has_password, is_deleted, onboarding_state')
    .eq('email', email)
    .maybeSingle();
  if (publicUserError) throw publicUserError;

  let publicUserId = publicUser?.id ?? null;
  if (publicUser) {
    if (publicUser.is_deleted) {
      throw new Error(`public.users row ${publicUser.id} is soft-deleted; refusing to reactivate automatically`);
    }
    const { error } = await admin
      .from('users')
      .update({
        supabase_uid: authUser.id,
        is_email_verified: true,
        has_password: true,
        last_sign_in_at: now,
      })
      .eq('id', publicUser.id);
    if (error) throw error;
    console.log(`[auth:repair-login] repaired public.users row ${publicUser.id}`);
  } else {
    const { data, error } = await admin
      .from('users')
      .insert({
        email,
        supabase_uid: authUser.id,
        is_email_verified: true,
        has_password: true,
        last_sign_in_at: now,
        onboarding_state: 'active',
      })
      .select('id')
      .maybeSingle();
    if (error) throw error;
    publicUserId = data?.id ?? null;
    console.log(`[auth:repair-login] created public.users row ${publicUserId}`);
  }

  if (!publicUserId) throw new Error('Could not resolve repaired public.users id');

  const { data: activeRole, error: roleError } = await admin
    .from('user_company_roles')
    .select('id, role, company_id')
    .eq('user_id', publicUserId)
    .eq('status', 'active')
    .limit(1)
    .maybeSingle();
  if (roleError) throw roleError;

  if (!activeRole) {
    console.warn('[auth:repair-login] warning: no active user_company_roles row found; login will route to onboarding/company');
  } else if (!publicUser?.active_company_id) {
    const { error } = await admin
      .from('users')
      .update({ active_company_id: activeRole.company_id })
      .eq('id', publicUserId);
    if (error) throw error;
    console.log(`[auth:repair-login] restored active_company_id from role ${activeRole.id}`);
  }

  if (password) {
    const { data: signInData, error: signInError } = await anon.auth.signInWithPassword({
      email,
      password,
    });
    if (signInError) throw signInError;
    await anon.auth.signOut();
    console.log(`[auth:repair-login] verified password login for Supabase uid ${signInData.user.id}`);
  } else {
    console.log('[auth:repair-login] skipped password verification because DEV_LOGIN_PASSWORD is not set');
  }
  console.log('[auth:repair-login] done');
}

main().catch((error) => {
  console.error(`[auth:repair-login] failed: ${error.message}`);
  process.exit(1);
});
