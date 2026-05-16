#!/usr/bin/env node
/**
 * Diagnose "Access denied to company" — reads the most recent BOLT run
 * and verifies every layer enforceCompanyAccess uses:
 *   1. companies.id exists + status (soft-delete check)
 *   2. user_company_roles row (active membership)
 *   3. organizations / org-membership for the canonical assertTenantAccess
 *      path (if those tables exist)
 *
 * Read-only. Prints a JSON object summarizing each layer's verdict so
 * we can see which one is denying.
 */
const path = require('path');
const { Client } = require('pg');
require('dotenv').config({ path: path.join(__dirname, '../.env.local') });

async function main() {
  const c = new Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  try {
    // Pick the most recent BOLT run's user+company pair.
    const { rows: runRows } = await c.query(`
      SELECT id, user_id, company_id, payload->>'userId' AS payload_user_id, created_at
      FROM bolt_execution_runs
      ORDER BY created_at DESC LIMIT 1;
    `);
    const run = runRows[0];
    if (!run) { console.log('no runs found'); return; }
    const userId = run.user_id ?? run.payload_user_id;
    const companyId = run.company_id;
    console.log(JSON.stringify({ run_id: run.id, user_id: userId, company_id: companyId }));

    // Layer 1: companies row + status
    const { rows: companyRows } = await c.query(`
      SELECT id, name, status, deleted_at, created_at
      FROM companies WHERE id = $1;
    `, [companyId]);
    console.log('company:', JSON.stringify(companyRows[0] ?? null));

    // Layer 2: user_company_roles (the legacy access check)
    const { rows: ucrRows } = await c.query(`
      SELECT user_id, company_id, role, status, created_at
      FROM user_company_roles WHERE company_id = $1
      ORDER BY created_at DESC LIMIT 5;
    `, [companyId]);
    console.log('user_company_roles for company:');
    for (const r of ucrRows) console.log(' ', JSON.stringify(r));

    // Specifically: is THIS user a member?
    const { rows: thisUserRows } = await c.query(`
      SELECT user_id, role, status
      FROM user_company_roles
      WHERE company_id = $1 AND user_id = $2;
    `, [companyId, userId]);
    console.log('user_company_roles for this user+company:', JSON.stringify(thisUserRows[0] ?? null));

    // Layer 3: organizations / org_users (canonical assertTenantAccess path)
    const { rows: orgCheck } = await c.query(`
      SELECT to_regclass('public.organizations') AS organizations, to_regclass('public.org_users') AS org_users;
    `);
    console.log('canonical tables present:', JSON.stringify(orgCheck[0]));

    if (orgCheck[0].organizations) {
      const { rows: orgRows } = await c.query(`SELECT id, status FROM organizations WHERE id = $1;`, [companyId]);
      console.log('organization:', JSON.stringify(orgRows[0] ?? null));
    }
    if (orgCheck[0].org_users) {
      const { rows: orgUserRows } = await c.query(`
        SELECT user_id, organization_id, role, status FROM org_users
        WHERE organization_id = $1 AND user_id = $2;
      `, [companyId, userId]);
      console.log('org_users for this user+org:', JSON.stringify(orgUserRows[0] ?? null));
    }

    // Recent ACCESS_DENIED-causing reasons via run rows
    const { rows: recentDenies } = await c.query(`
      SELECT id, status, raw_error_message, created_at
      FROM bolt_execution_runs
      WHERE error_message ILIKE '%access denied%'
         OR raw_error_message ILIKE '%access denied%'
      ORDER BY created_at DESC LIMIT 3;
    `);
    console.log('recent access-denied rows:', recentDenies.length);
    for (const r of recentDenies) console.log(' ', JSON.stringify(r));
  } finally {
    await c.end();
  }
}
main().catch((e) => { console.error(e.message); process.exit(1); });
