import { createServiceRoleMigrationProxy } from '../../db/supabaseClient';
const supabase = createServiceRoleMigrationProxy('AUTO_MIGRATION_REQUIRED');

export async function resolveAssistContext(snapshot: Record<string, unknown> | null | undefined) {
  let assistBlogContext = (snapshot?.blog_context ?? null) as {
    blogs: { title: string; summary: string; key_insights: string[]; tags: string[]; headings: string[] }[];
  } | null;
  const assistInsightContext = (snapshot?.insight_context ?? null) as { insights: string[] } | null;
  const assistTopicContext = (snapshot?.topic_context ?? null) as { topics: string[] } | null;
  const assistAi = typeof snapshot?.ai_assist === 'boolean' ? snapshot.ai_assist : null;

  if (!assistBlogContext) {
    const sourceBlog = snapshot?.source_blog as { id: string; type: 'company' | 'public' } | null | undefined;
    if (sourceBlog?.id) {
      try {
        const table = sourceBlog.type === 'company' ? 'blogs' : 'public_blogs';
        const { data: blogRow } = await supabase
          .from(table)
          .select('title, content_blocks, tags, status')
          .eq('id', sourceBlog.id)
          .eq('status', 'published')
          .maybeSingle();
        if (blogRow) {
          const { extractBlogContext } = await import('../../../lib/blog/blockExtractor');
          const extracted = extractBlogContext(blogRow.content_blocks);
          assistBlogContext = {
            blogs: [{
              title: blogRow.title ?? '',
              summary: extracted.summary,
              key_insights: extracted.key_insights,
              headings: extracted.h2_headings,
              tags: Array.isArray(blogRow.tags) ? blogRow.tags : [],
            }],
          };
        }
      } catch (err) {
        console.warn('[orchestrator] source_blog resolution failed:', (err as Error)?.message);
      }
    }
  }

  return {
    assistBlogContext,
    assistInsightContext,
    assistTopicContext,
    assistAi,
  };
}
