/**
 * Normalized community message shape.
 * Community adapters return this from fetchComments for direct engagement_messages sync.
 */
export type CommunityMessage = {
  thread_id: string;
  message_id: string;
  author: string;
  text: string;
  created_at: string;
  platform: string;
};
