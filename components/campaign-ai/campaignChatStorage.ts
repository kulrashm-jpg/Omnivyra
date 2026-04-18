import type { ChatMessage } from './types';

export function getCampaignChatStorageKey(context: string | undefined, campaignId: string): string {
  return context?.toLowerCase().includes('campaign-recommendations')
    ? `campaign_chat_draft_${campaignId}_recommendations`
    : `campaign_chat_draft_${campaignId}`;
}

export function getPlanningFormStorageKey(campaignId: string): string {
  return `campaign_planning_form_${campaignId}`;
}

export async function loadCampaignMessages(context: string | undefined, campaignId: string): Promise<ChatMessage[]> {
  const storageKey = getCampaignChatStorageKey(context, campaignId);
  if (typeof window !== 'undefined') {
    try {
      const stored = window.sessionStorage.getItem(storageKey);
      if (stored) {
        const parsed = JSON.parse(stored) as { messages?: ChatMessage[] };
        if (Array.isArray(parsed.messages) && parsed.messages.length > 0) return parsed.messages;
      }
    } catch (e) {
      console.warn('Could not load saved chat draft', e);
    }
  }
  if (context?.toLowerCase().includes('campaign-recommendations')) return [];
  try {
    const response = await fetch(`/api/ai/campaign-messages?campaignId=${campaignId}`);
    if (response.ok) {
      const data = await response.json();
      return data.messages || [];
    }
  } catch (error) {
    console.error('Error loading campaign messages:', error);
  }
  return [];
}

export async function saveCampaignMessage(campaignId: string | undefined, message: ChatMessage) {
  try {
    await fetch('/api/ai/campaign-messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, campaignId }),
    });
  } catch (error) {
    console.error('Error saving campaign message:', error);
  }
}

export async function loadCampaignLearnings(setCampaignLearnings: (learnings: any[]) => void) {
  try {
    const response = await fetch('/api/ai/campaign-learnings');
    if (response.ok) {
      const data = await response.json();
      setCampaignLearnings(data.learnings || []);
    }
  } catch (error) {
    console.error('Error loading campaign learnings:', error);
  }
}
