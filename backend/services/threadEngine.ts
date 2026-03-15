/**
 * Thread Engine
 * Converts community posts into multi-part threads (LinkedIn carousel, Twitter thread, etc.).
 * New layer after community_posts. Does not modify intelligence pipeline.
 */

import { supabase } from '../db/supabaseClient';

const THREAD_TYPES = ['reply_chain', 'carousel', 'discussion_prompt', 'comment_seed'] as const;

type PostRow = {
  id: string;
  post_content: string;
  platform: string | null;
};

/**
 * Split post content into thread parts (sentences/paragraphs).
 */
function splitIntoThreadParts(content: string, platform: string): string[] {
  const c = (content ?? '').trim();
  if (!c) return [];

  const sentences = c
    .split(/\n\n+/)
    .flatMap((p) => p.split(/[.!?]+/).map((s) => s.trim()).filter(Boolean))
    .filter((s) => s.length > 10);

  if (sentences.length === 0) return [c];

  const maxParts = platform === 'Twitter/X' ? 5 : 4;
  const parts: string[] = [];
  let acc = '';

  for (const s of sentences) {
    const candidate = acc ? `${acc} ${s}` : s;
    if (candidate.length > 200 && platform === 'Twitter/X') {
      if (acc) parts.push(acc);
      acc = s;
    } else {
      acc = candidate;
    }
    if (parts.length >= maxParts) break;
  }
  if (acc) parts.push(acc);

  return parts.length > 0 ? parts : [c];
}

/**
 * Format part with number prefix for thread style.
 */
function formatThreadPart(part: string, index: number): string {
  const num = index + 1;
  const emoji = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣'][num - 1] ?? `${num}.`;
  const firstLine = part.split('\n')[0] ?? part;
  const truncated = firstLine.length > 80 ? firstLine.slice(0, 77) + '...' : firstLine;
  return `${emoji} ${truncated}`;
}

/**
 * Load community posts that do not yet have threads.
 */
async function loadPostsWithoutThreads(): Promise<PostRow[]> {
  const { data: posts, error: pErr } = await supabase
    .from('community_posts')
    .select('id, post_content, platform')
    .order('created_at', { ascending: false })
    .limit(50);

  if (pErr) throw new Error(`Failed to load community_posts: ${pErr.message}`);
  const postList = (posts ?? []) as PostRow[];

  if (postList.length === 0) return [];

  const { data: existing } = await supabase
    .from('community_threads')
    .select('post_id')
    .in('post_id', postList.map((p) => p.id));

  const hasThread = new Set((existing ?? []).map((r: { post_id: string }) => r.post_id));
  return postList.filter((p) => !hasThread.has(p.id));
}

export type GenerateCommunityThreadsResult = {
  posts_processed: number;
  threads_created: number;
  threads_skipped: number;
};

/**
 * Generate community threads from community posts.
 */
export async function generateCommunityThreads(): Promise<GenerateCommunityThreadsResult> {
  const posts = await loadPostsWithoutThreads();
  let threadsCreated = 0;
  let threadsSkipped = 0;

  for (const post of posts) {
    const platform = post.platform || 'LinkedIn';
    const parts = splitIntoThreadParts(post.post_content, platform);

    const threadType =
      platform === 'Twitter/X' ? 'reply_chain' : platform === 'LinkedIn' ? 'carousel' : 'discussion_prompt';

    const threadContent = parts.map((p, i) => formatThreadPart(p, i)).join('\n\n');

    const { error } = await supabase.from('community_threads').insert({
      post_id: post.id,
      thread_type: threadType,
      thread_content: threadContent,
    });

    if (error) {
      if (error.code === '23503') threadsSkipped++;
      else throw new Error(`community_threads insert failed: ${error.message}`);
    } else {
      threadsCreated++;
    }
  }

  return {
    posts_processed: posts.length,
    threads_created: threadsCreated,
    threads_skipped: threadsSkipped,
  };
}
