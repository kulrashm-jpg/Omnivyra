/**
 * BETA-022 — Shared Supabase service client + env loading for the beta scripts.
 *
 * Reads BETA_SUPABASE_URL / BETA_SUPABASE_ANON_KEY / BETA_SUPABASE_SERVICE_KEY from the
 * environment. These MUST point at a NON-PRODUCTION Supabase (the local `supabase start`
 * stack, or a throwaway cloud project) — never the production project. The seed refuses to
 * run against a URL containing the known production ref as a guard.
 */
import { createClient } from '@supabase/supabase-js';

const PROD_REF = 'klkiseupptzbecbxwrky'; // production project ref — hard block.

export function betaEnv() {
  const url = process.env.BETA_SUPABASE_URL;
  const anon = process.env.BETA_SUPABASE_ANON_KEY;
  const service = process.env.BETA_SUPABASE_SERVICE_KEY;
  if (!url || !service) {
    throw new Error(
      'Missing BETA_SUPABASE_URL / BETA_SUPABASE_SERVICE_KEY. ' +
        'Source your beta env first (see docs/beta-environment.md).'
    );
  }
  if (url.includes(PROD_REF)) {
    throw new Error(`REFUSING to run: BETA_SUPABASE_URL points at the PRODUCTION project (${PROD_REF}).`);
  }
  return { url, anon, service };
}

export function serviceClient() {
  const { url, service } = betaEnv();
  return createClient(url, service, { auth: { autoRefreshToken: false, persistSession: false } });
}

export const log = (...a) => console.log(...a);
export const ok = (m) => console.log('  ✓ ' + m);
export const warn = (m) => console.log('  ⚠ ' + m);
export const fail = (m) => console.log('  ✗ ' + m);
