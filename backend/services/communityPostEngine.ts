/**
 * Community Post Engine
 * Converts campaign narratives into platform-ready posts.
 * New layer after campaign_narratives. Does not modify intelligence pipeline.
 */

import { supabase } from '../db/supabaseClient';

type NarrativeRow = {
  id: string;
  narrative_angle: string;
  narrative_summary: string;
  platform: string | null;
  opportunity_id: string;
};

type OpportunityRow = {
  id: string;
  company_id: string | null;
};

/**
 * Generate post content from narrative angle and summary.
 */
function generatePostContent(angle: string, summary: string): string {
  const a = (angle ?? '').trim();
  const s = (summary ?? '').trim();
  if (!a && !s) return '';

  const lines: string[] = [];
  if (a) {
    lines.push(a.replace(/^What Most Companies Get Wrong About /i, '').replace(/ Is Entering Its Next Era$/i, ''));
  }
  if (s) {
    const first = s.split('.')[0]?.trim();
    if (first) lines.push(first + '.');
  }
  if (lines.length < 2 && a) {
    lines.push('The companies winning today are embedding intelligence into every interaction.');
  }
  if (lines.length < 3) {
    lines.push("We're entering the era of adaptive, intelligent systems.");
  }
  return lines.filter(Boolean).join('\n\n');
}

export type GenerateCommunityPostsResult = {
  narratives_processed: number;
  posts_created: number;
  posts_skipped: number;
};

/**
 * Load campaign narratives that do not yet have community_posts.
 */
async function loadNarrativesWithoutPosts(): Promise<Array<NarrativeRow & { company_id: string | null }>> {
  const { data: narratives, error: nErr } = await supabase
    .from('campaign_narratives')
    .select('id, narrative_angle, narrative_summary, platform, opportunity_id')
    .order('created_at', { ascending: false })
    .limit(100);

  if (nErr) throw new Error(`Failed to load campaign_narratives: ${nErr.message}`);
  const narrs = (narratives ?? []) as NarrativeRow[];

  if (narrs.length === 0) return [];

  const { data: existing } = await supabase
    .from('community_posts')
    .select('narrative_id')
    .in('narrative_id', narrs.map((n) => n.id));

  const hasPost = new Set((existing ?? []).map((r: { narrative_id: string }) => r.narrative_id));
  const withoutPosts = narrs.filter((n) => !hasPost.has(n.id));

  if (withoutPosts.length === 0) return [];

  const oppIds = [...new Set(withoutPosts.map((n) => n.opportunity_id))];
  const { data: opps } = await supabase
    .from('content_opportunities')
    .select('id, company_id')
    .in('id', oppIds);

  const oppById = new Map<string, OpportunityRow>();
  (opps ?? []).forEach((o: OpportunityRow) => oppById.set(o.id, o));

  return withoutPosts.map((n) => ({
    ...n,
    company_id: oppById.get(n.opportunity_id)?.company_id ?? null,
  }));
}

/**
 * Generate community posts from campaign narratives.
 */
export async function generateCommunityPosts(): Promise<GenerateCommunityPostsResult> {
  const narratives = await loadNarrativesWithoutPosts();
  let postsCreated = 0;
  let postsSkipped = 0;

  for (const n of narratives) {
    const companyId = n.company_id;
    if (!companyId) {
      postsSkipped++;
      continue;
    }

    const postContent = generatePostContent(n.narrative_angle, n.narrative_summary);
    if (!postContent) {
      postsSkipped++;
      continue;
    }

    const platform = n.platform ?? 'LinkedIn';
    const { error } = await supabase.from('community_posts').insert({
      narrative_id: n.id,
      company_id: companyId,
      platform,
      post_content: postContent,
      post_type: 'thought_leadership',
      scheduled_at: null,
      published_at: null,
    });

    if (error) {
      if (error.code === '23503') postsSkipped++;
      else throw new Error(`community_posts insert failed: ${error.message}`);
    } else {
      postsCreated++;
    }
  }

  return {
    narratives_processed: narratives.length,
    posts_created: postsCreated,
    posts_skipped: postsSkipped,
  };
}
