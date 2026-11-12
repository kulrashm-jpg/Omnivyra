import { supabase } from './supabaseClient';

export type ScheduledPostRecord = {
  id: string;
  platform: string;
  content: string;
  hashtags?: string[] | null;
  scheduled_for?: string | null;
  campaign_id?: string | null;
};

export async function getScheduledPostById(postId: string): Promise<ScheduledPostRecord | null> {
  const { data, error } = await supabase
    .from('scheduled_posts')
    .select('*')
    .eq('id', postId)
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      return null;
    }
    throw new Error(`Failed to get scheduled post: ${error.message}`);
  }

  return data;
}

export async function updatePostPublishStatus(input: {
  post_id: string;
  status: string;
  external_post_id?: string;
  last_error?: string;
  /**
   * CLASS-2 D8: write only if the post is still in this status (compare-and-set, row count
   * checked). A caller that read the post earlier must pass it: between that read and this write
   * another execution may have claimed the post (`publishing`), and a blind status write flipped
   * that live claim. Without it the write is blind, as before. Returns whether a row moved.
   */
  expectedFromStatus?: string;
}): Promise<boolean> {
  // Normalise to lowercase — DB chk_status constraint requires lowercase values
  const dbStatus = input.status.toLowerCase();

  const payload: Record<string, any> = {
    status: dbStatus,
    updated_at: new Date().toISOString(),
  };

  if (input.external_post_id) {
    payload.platform_post_id = input.external_post_id;
  }
  if (input.last_error) {
    payload.error_message = input.last_error;
  }
  if (dbStatus === 'published') {
    payload.published_at = new Date().toISOString();
  }

  const write = supabase
    .from('scheduled_posts')
    .update(payload)
    .eq('id', input.post_id);
  const { data, error } = await (input.expectedFromStatus === undefined ? write : write.eq('status', input.expectedFromStatus))
    .select('id');

  if (error) {
    throw new Error(`Failed to update scheduled post: ${error.message}`);
  }
  return Array.isArray(data) && data.length > 0;
}
