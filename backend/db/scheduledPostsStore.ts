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
}): Promise<void> {
  const payload: Record<string, any> = {
    status: input.status,
    updated_at: new Date().toISOString(),
  };

  if (input.external_post_id) {
    payload.platform_post_id = input.external_post_id;
  }
  if (input.last_error) {
    payload.error_message = input.last_error;
  }
  if (input.status === 'PUBLISHED') {
    payload.published_at = new Date().toISOString();
  }

  const { error } = await supabase
    .from('scheduled_posts')
    .update(payload)
    .eq('id', input.post_id);

  if (error) {
    throw new Error(`Failed to update scheduled post: ${error.message}`);
  }
}
