// Standalone operator diagnostics run outside the app/browser runtime and use
// the public anon client for read-only schema checks.
const { createClient } = require('@supabase/supabase-js');

function createDbUtilsClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
}

module.exports = { createDbUtilsClient };
