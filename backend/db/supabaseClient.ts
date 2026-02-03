/**
 * Supabase Client Configuration
 * 
 * Initializes Supabase client for database access.
 * Uses service role key for backend operations (bypasses RLS).
 * 
 * Environment Variables:
 * - SUPABASE_URL (required)
 * - SUPABASE_SERVICE_ROLE_KEY (required - DO NOT use anon key in backend)
 * 
 * Security Note:
 * - Service role key has full database access
 * - Never expose this key to frontend
 * - Store in environment variables or secrets manager
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const isTest = process.env.NODE_ENV === 'test';

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  if (!isTest) {
    throw new Error(
      'Missing required environment variables: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY'
    );
  }
}

/**
 * Supabase client with service role key
 * This bypasses Row Level Security (RLS) for backend operations
 */
export const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

/**
 * Get Supabase client (alternative export for user examples compatibility)
 */
export function getSupabase() {
  return supabase;
}

console.log('✅ Supabase client initialized');

