/**
 * PHASE 1 — Thread Data Validation
 * Uses Supabase REST API (same as the app) — no direct Postgres connection.
 *
 * Root causes being tested:
 * 1. organization_id not being populated
 * 2. ingestion pipeline not creating threads
 * 3. post_comments existing but sync layer failing
 * 4. scheduled_posts never triggering ingestion
 *
 * Run: node backend/scripts/engagementPhase1Validation.js
 * Requires: SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL), SUPABASE_SERVICE_ROLE_KEY in .env.local
 */

const path = require('path');
const dotenv = require('dotenv');
const { createClient } = require('@supabase/supabase-js');

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
dotenv.config();

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function count(table, filter = null) {
  let q = supabase.from(table).select('*', { count: 'exact', head: true });
  if (filter) {
    for (const [col, op, val] of filter) {
      if (op === 'is') q = q.is(col, val);
      else if (op === 'eq') q = q.eq(col, val);
    }
  }
  const { count: c, error } = await q;
  if (error) throw new Error(`${table}: ${error.message}`);
  return c ?? 0;
}

async function run() {
  console.log('=== PHASE 1 — Thread Data Validation ===\n');
  console.log('Using Supabase REST API:', SUPABASE_URL.replace(/\/\/.*@/, '//***@'), '\n');

  let pc, et, nullOrg, messagesCount, publishedPosts;

  try {
    // 1. engagement_threads count by organization (fetch and aggregate)
    console.log('1. engagement_threads by organization_id:');
    const { data: threads, error: e1 } = await supabase
      .from('engagement_threads')
      .select('organization_id')
      .not('organization_id', 'is', null)
      .limit(1000);

    if (e1) {
      console.log('   Error:', e1.message, '(table may not exist)');
      et = 0;
    } else {
      const byOrg = (threads || []).reduce((acc, t) => {
        acc[t.organization_id] = (acc[t.organization_id] || 0) + 1;
        return acc;
      }, {});
      if (Object.keys(byOrg).length === 0) {
        console.log('   (no rows with non-null organization_id)');
      } else {
        const rows = Object.entries(byOrg)
          .map(([org, n]) => ({ organization_id: org, thread_count: n }))
          .sort((a, b) => b.thread_count - a.thread_count)
          .slice(0, 20);
        console.table(rows);
      }
      et = (threads || []).length;
    }

    // 2. engagement_messages total
    try {
      messagesCount = await count('engagement_messages');
      console.log('\n2. engagement_messages total:', messagesCount);
    } catch (e) {
      console.log('\n2. engagement_messages: Error -', e.message);
      messagesCount = 0;
    }

    // 3. post_comments total
    try {
      pc = await count('post_comments');
      console.log('3. post_comments total:', pc);
    } catch (e) {
      console.log('3. post_comments: Error -', e.message);
      pc = 0;
    }

    // engagement_threads total (if not from step 1)
    if (e1) {
      try {
        et = await count('engagement_threads');
      } catch (_) {
        et = 0;
      }
    } else {
      const { count: etCount } = await supabase.from('engagement_threads').select('*', { count: 'exact', head: true });
      et = etCount ?? 0;
    }

    // 4. Sync health
    console.log('\n4. Sync health:');
    console.log('   post_comments:', pc, '| engagement_threads:', et);
    if (pc > 0 && et === 0) {
      console.log('   ⚠️  SYNC BROKEN: post_comments has data but engagement_threads is empty');
    }

    // 5. engagement_threads columns (infer from one row)
    console.log('\n5. engagement_threads columns:');
    const { data: sample, error: e5 } = await supabase
      .from('engagement_threads')
      .select('*')
      .limit(1);
    if (e5) {
      console.log('   Error:', e5.message);
    } else {
      const cols = sample?.[0] ? Object.keys(sample[0]) : [];
      const required = ['organization_id', 'platform', 'ignored', 'priority_score', 'unread_count'];
      const missing = required.filter((c) => !cols.includes(c));
      if (missing.length) {
        console.log('   ⚠️  Missing columns:', missing.join(', '));
      } else {
        console.log('   OK: required columns present');
      }
    }

    // 6. Threads with NULL organization_id
    try {
      nullOrg = await count('engagement_threads', [['organization_id', 'is', null]]);
      console.log('\n6. Threads with NULL organization_id:', nullOrg);
      if (nullOrg > 0) {
        console.log('   ⚠️  ORGANIZATION_ID NOT POPULATED: ingestion mapping may be broken');
      }
    } catch (e) {
      console.log('\n6. Threads with NULL organization_id: Error -', e.message);
      nullOrg = 0;
    }

    // 7. scheduled_posts (published with platform_post_id)
    try {
      const { count: pp } = await supabase
        .from('scheduled_posts')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'published')
        .not('platform_post_id', 'is', null);
      publishedPosts = pp ?? 0;
      console.log('\n7. scheduled_posts (published + platform_post_id):', publishedPosts);
      if (publishedPosts === 0 && et === 0) {
        console.log('   ⚠️  No published posts — ingestion trigger missing');
      }
    } catch (e) {
      console.log('\n7. scheduled_posts: Error -', e.message);
      publishedPosts = 0;
    }

    // Root cause summary
    console.log('\n=== ROOT CAUSE ASSESSMENT ===');
    if (pc > 0 && et === 0) {
      console.log('PRIMARY: Sync layer failing — post_comments has data but engagement_threads is empty');
    } else if (nullOrg > 0 && et > 0) {
      console.log('PRIMARY: organization_id not populated for many threads — ingestion mapping broken');
    } else if (pc === 0 && et === 0) {
      console.log('PRIMARY: No raw data — ingestion pipeline not creating post_comments (scheduled_posts/cron?)');
    } else if (et > 0) {
      console.log('Data present. If inbox still empty, check selected company_id matches organization_id in threads.');
    }

    console.log('\n=== Phase 1 complete ===');
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}

run();
