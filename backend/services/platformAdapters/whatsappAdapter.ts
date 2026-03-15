/**
 * WhatsApp Business Platform Adapter
 *
 * Implements IPlatformAdapter for WhatsApp Business API.
 * Uses Facebook Graph API: https://graph.facebook.com/v18.0
 */

import type {
  IPlatformAdapter,
  PublishContentPayload,
  FetchCommentsParams,
  PlatformCredentials,
  PublishResult,
  ConnectionTestResult,
} from './baseAdapter';
import { withRateLimit, enforcePublishPolicy, fetchJsonWithBearer } from './baseAdapter';

const WHATSAPP_API = 'https://graph.facebook.com/v18.0';

export const whatsappAdapter: IPlatformAdapter = {
  platformKey: 'whatsapp',

  async publishContent(
    payload: PublishContentPayload,
    credentials: PlatformCredentials
  ): Promise<PublishResult> {
    return withRateLimit('whatsapp', async () => {
      enforcePublishPolicy('whatsapp', payload);
      if (process.env.USE_MOCK_PLATFORMS === 'true') {
        return {
          success: true,
          platform_post_id: `mock_wa_${Date.now()}`,
          post_url: undefined,
        };
      }
      const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
      if (!phoneNumberId) {
        return { success: false, error: 'WHATSAPP_PHONE_NUMBER_ID not configured' };
      }
      try {
        const body: any = {
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: payload.platform_post_id ?? process.env.WHATSAPP_RECIPIENT_PHONE,
          type: 'text',
          text: { body: payload.content.slice(0, 4096) },
        };
        if (payload.template_name) {
          body.type = 'template';
          body.template = { name: payload.template_name, language: { code: 'en' } };
          delete body.text;
        }
        const res = await fetchJsonWithBearer(
          `${WHATSAPP_API}/${phoneNumberId}/messages`,
          credentials.access_token,
          { init: { method: 'POST', body: JSON.stringify(body) } }
        );
        const id = res?.messages?.[0]?.id;
        return { success: true, platform_post_id: id, post_url: undefined };
      } catch (e: any) {
        return { success: false, error: e?.message || 'WhatsApp send failed' };
      }
    });
  },

  async replyToComment(
    threadId: string,
    message: string,
    credentials: PlatformCredentials
  ): Promise<{ success: boolean; error?: string }> {
    return withRateLimit('whatsapp', async () => {
      const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
      if (!phoneNumberId) return { success: false, error: 'WHATSAPP_PHONE_NUMBER_ID not configured' };
      try {
        await fetchJsonWithBearer(
          `${WHATSAPP_API}/${phoneNumberId}/messages`,
          credentials.access_token,
          { init: { method: 'POST', body: JSON.stringify({
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to: threadId.replace(/\D/g, '').slice(-15),
            type: 'text',
            text: { body: message.slice(0, 4096) },
          }) } }
        );
        return { success: true };
      } catch (e: any) {
        return { success: false, error: e?.message || 'WhatsApp reply failed' };
      }
    });
  },

  async likeComment(
    _messageId: string,
    _credentials: PlatformCredentials
  ): Promise<{ success: boolean; error?: string }> {
    return { success: false, error: 'WhatsApp does not support like/reaction via this API' };
  },

  async fetchComments(params: FetchCommentsParams): Promise<unknown> {
    return withRateLimit('whatsapp', async () => {
      const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
      if (!phoneNumberId) {
        return { data: [], messaging_product: 'whatsapp' };
      }
      try {
        const url = `${WHATSAPP_API}/${phoneNumberId}/messages?limit=100`;
        const response = await fetch(url, {
          headers: {
            Authorization: `Bearer ${params.accessToken}`,
            Accept: 'application/json',
          },
        });
        if (!response.ok) return { data: [], messaging_product: 'whatsapp' };
        return response.json();
      } catch {
        return { data: [], messaging_product: 'whatsapp' };
      }
    });
  },

  async testConnection(credentials: PlatformCredentials): Promise<ConnectionTestResult> {
    return withRateLimit('whatsapp', async () => {
      try {
        const me = await fetchJsonWithBearer(`${WHATSAPP_API}/me`, credentials.access_token);
        if (me?.id) {
          return { success: true, message: 'Connection test passed (token valid)' };
        }
        return { success: false, error: 'Token validation failed' };
      } catch (e: any) {
        return { success: false, error: e?.message || 'Connection test failed' };
      }
    });
  },
};
