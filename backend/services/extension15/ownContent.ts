/**
 * The own-content rule for 1.5 comment collection (EXTENSION-1.5.0-CONTRACT.md §5.1, E-3):
 * an item is kept only when its post was authored by the bound member and, if the
 * command named posts, the post is one of them. Kept items are mapped to the 1.4
 * ingestion shape so the canonical-store write logic is shared, not duplicated.
 */
export const MAX_ITEMS_PER_RESULT = 200;
const URN = /^urn:li:[A-Za-z]+:\S{1,200}$/;
const str = (v: unknown, max: number): string | null =>
  typeof v === 'string' && v.trim() !== '' && v.length <= max ? v : null;

export type OwnContentMapped =
  | { ok: true; posts: Array<Record<string, unknown>>; comments: Array<Record<string, unknown>>; rejectedNotOwn: number; rejectedInvalid: number }
  | { ok: false; status: number; code: string };

export function mapOwnPostComments(items: unknown, actingMemberUrn: string, params: Record<string, unknown>): OwnContentMapped {
  if (!Array.isArray(items)) return { ok: false, status: 400, code: 'ITEMS_REQUIRED' };
  if (items.length > MAX_ITEMS_PER_RESULT) return { ok: false, status: 413, code: 'TOO_MANY_ITEMS' };
  const allowedPosts = Array.isArray(params.post_urns) ? new Set(params.post_urns as string[]) : null;
  const posts = new Map<string, Record<string, unknown>>();
  const comments: Array<Record<string, unknown>> = [];
  let rejectedNotOwn = 0;
  let rejectedInvalid = 0;
  for (const raw of items) {
    const it = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    const postUrn = str(it.post_urn, 200);
    const postAuthor = str(it.post_author_urn, 200);
    const commentUrn = str(it.comment_urn, 300);
    const authorUrn = str(it.author_urn, 200);
    const text = str(it.text, 20000);
    if (!postUrn || !URN.test(postUrn) || !postAuthor || !commentUrn || !authorUrn || !text) {
      rejectedInvalid += 1;
      continue;
    }
    if (postAuthor !== actingMemberUrn || (allowedPosts && !allowedPosts.has(postUrn))) {
      rejectedNotOwn += 1;
      continue;
    }
    if (!posts.has(postUrn)) posts.set(postUrn, { post_urn: postUrn, post_author_urn: postAuthor, ingested_via: 'extension_v15' });
    comments.push({
      post_urn: postUrn,
      comment_urn: commentUrn,
      parent_comment_urn: str(it.parent_comment_urn, 300),
      author_name: str(it.author_name, 300),
      actor_id: authorUrn,
      author_self: authorUrn === actingMemberUrn,
      content: text,
      created_at: str(it.created_at, 64),
      source: 'extension_v15',
    });
  }
  return { ok: true, posts: [...posts.values()], comments, rejectedNotOwn, rejectedInvalid };
}
