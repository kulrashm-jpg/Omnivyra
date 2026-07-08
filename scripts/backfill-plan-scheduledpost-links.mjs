#!/usr/bin/env node
/**
 * Backfill daily_content_plans.scheduled_post_id for rows that were scheduled via
 * the BOLT block processor BEFORE it started writing the back-link (commit
 * 11f3df8a). Without the link, the calendar can't surface asset_type (the
 * user-selected format) for text formats, so polls/short-stories render as
 * "post"/"tweet".
 *
 * Match strategy (conservative — only links when UNAMBIGUOUS):
 *   plan row (unlinked)  →  scheduled_post
 *   same campaign_id, same platform (twitter≡x), and the scheduled_post's content
 *   starts with the same normalized prefix as the plan's generated_content.
 *   If exactly ONE scheduled_post matches → link it. 0 or >1 → skip and report.
 *
 * DRY-RUN by default (no writes). Pass --apply to write the links.
 * Read-only until --apply. Safe to re-run (idempotent: only touches unlinked rows).
 *
 * Usage:
 *   node scripts/backfill-plan-scheduledpost-links.mjs            # dry-run
 *   node scripts/backfill-plan-scheduledpost-links.mjs --apply    # write links
 */
import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';

// ── env ────────────────────────────────────────────────────────────────────
function loadEnv() {
  if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) return;
  const envPath = path.join(process.cwd(), '.env.local');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!m) continue;
    if (!process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
}
loadEnv();

const APPLY = process.argv.includes('--apply');
const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}
const sb = createClient(url, key, { auth: { persistSession: false } });

// ── helpers ──────────────────────────────────────────────────────────────────
const canonPlatform = (p) => {
  const l = String(p || '').toLowerCase().trim();
  return l === 'twitter' ? 'x' : l;
};
const prefixOf = (text) => String(text || '').replace(/\s+/g, ' ').trim().toLowerCase().slice(0, 80);
function generatedContentOf(planContent) {
  try {
    const j = typeof planContent === 'string' ? JSON.parse(planContent) : planContent;
    return (j && typeof j === 'object' && (j.generated_content || j.master_content)) || '';
  } catch {
    return typeof planContent === 'string' ? planContent : '';
  }
}

// ── run ───────────────────────────────────────────────────────────────────────
console.log(`\n[backfill] mode: ${APPLY ? 'APPLY (writing links)' : 'DRY-RUN (no writes)'}\n`);

const { data: plans, error: pe } = await sb
  .from('daily_content_plans')
  .select('id, campaign_id, platform, content_type, content, scheduled_post_id')
  .is('scheduled_post_id', null)
  .limit(10000);
if (pe) { console.error('plan fetch error:', pe.message); process.exit(1); }
console.log(`[backfill] unlinked plan rows: ${plans.length}`);

// Cache scheduled_posts per campaign.
const postsByCampaign = new Map();
async function postsFor(campaignId) {
  if (postsByCampaign.has(campaignId)) return postsByCampaign.get(campaignId);
  const { data } = await sb
    .from('scheduled_posts')
    .select('id, platform, content, content_type')
    .eq('campaign_id', campaignId)
    .limit(5000);
  const rows = data || [];
  postsByCampaign.set(campaignId, rows);
  return rows;
}

let linked = 0, ambiguous = 0, nomatch = 0, noContent = 0;
const byType = {};
for (const plan of plans) {
  if (!plan.campaign_id) { nomatch++; continue; }
  const prefix = prefixOf(generatedContentOf(plan.content));
  if (!prefix) { noContent++; continue; }
  const posts = await postsFor(plan.campaign_id);
  const matches = posts.filter(
    (p) => canonPlatform(p.platform) === canonPlatform(plan.platform) && prefixOf(p.content) === prefix,
  );
  if (matches.length === 1) {
    byType[plan.content_type] = (byType[plan.content_type] || 0) + 1;
    if (APPLY) {
      const { error } = await sb
        .from('daily_content_plans')
        .update({ scheduled_post_id: matches[0].id })
        .eq('id', plan.id);
      if (error) { console.warn('  link failed:', plan.id, error.message); continue; }
    }
    linked++;
  } else if (matches.length > 1) {
    ambiguous++;
  } else {
    nomatch++;
  }
}

console.log('\n[backfill] result:');
console.log(`  ${APPLY ? 'linked' : 'linkable'}: ${linked}`);
console.log(`  by content_type: ${JSON.stringify(byType)}`);
console.log(`  ambiguous (>1 candidate, skipped): ${ambiguous}`);
console.log(`  no scheduled_post match (likely not-yet-scheduled): ${nomatch}`);
console.log(`  no content prefix: ${noContent}`);
console.log(`\n[backfill] ${APPLY ? 'DONE — links written.' : 'DRY-RUN complete. Re-run with --apply to write.'}\n`);
