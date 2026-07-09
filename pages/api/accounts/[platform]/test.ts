
/**
 * Test Platform Connection API
 * GET /api/accounts/[platform]/test
 * 
 * Tests the connection to a social media platform
 */

import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../../backend/db/supabaseClient';
import { getToken } from '../../../../backend/auth/tokenStore';
import { bearerAuthorization } from '../../../../lib/httpAuthHeaders';
import { getSupabaseUserFromRequest } from '../../../../backend/services/supabaseAuthService';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // BETA-011 (RULE 6): this endpoint was UNAUTHENTICATED — a caller could pass any
  // user_id and enumerate which platforms that user has connected (+ account names).
  // Require a session and restrict the test to the caller's OWN account.
  const { user, error: authError } = await getSupabaseUserFromRequest(req);
  if (authError || !user?.id) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { platform, user_id } = req.query;

  if (!platform || typeof platform !== 'string') {
    return res.status(400).json({ error: 'Platform is required' });
  }

  if (!user_id || typeof user_id !== 'string') {
    return res.status(400).json({ error: 'user_id is required' });
  }

  if (user_id !== user.id) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  try {
    // Get active account for platform
    const { data: account, error: accountError } = await supabase
      .from('social_accounts')
      .select('*')
      .eq('user_id', user_id)
      .eq('platform', platform)
      .eq('is_active', true)
      .single();

    if (accountError || !account) {
      return res.status(404).json({
        success: false,
        error: 'No active account found for this platform',
      });
    }

    // Try to get token
    const token = await getToken(account.id);
    if (!token) {
      return res.status(400).json({
        success: false,
        error: 'Token not found or invalid',
      });
    }

    // Test connection by making a simple API call
    // Platform-specific test endpoints
    const testEndpoints: Record<string, string> = {
      // LinkedIn: use OIDC userinfo — /v2/me is deprecated and returns 403 without special access
      linkedin: 'https://api.linkedin.com/v2/userinfo',
      twitter: 'https://api.twitter.com/2/users/me',
      instagram: 'https://graph.instagram.com/me',
      facebook: 'https://graph.facebook.com/me',
      youtube: 'https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true',
    };

    const endpoint = testEndpoints[platform.toLowerCase()];
    if (!endpoint) {
      // For platforms without test endpoint, just verify token exists
      return res.status(200).json({
        success: true,
        message: 'Connection verified (token exists)',
      });
    }

    // Make test API call
    // HARDEN-005A: `endpoint` is a user-supplied connection-test URL — SSRF-safe fetch.
    const { safeFetch } = await import('../../../../lib/security/safeFetch');
    const response = await safeFetch(endpoint, {
      headers: {
        Authorization: bearerAuthorization(token.access_token),
      },
    });

    if (response.ok) {
      res.status(200).json({
        success: true,
        message: 'Connection test passed',
        account: {
          id: account.id,
          account_name: account.account_name,
          username: account.username,
        },
      });
    } else {
      const errorData = await response.json().catch(() => ({ message: 'Unknown error' }));
      res.status(400).json({
        success: false,
        error: 'Connection test failed',
        details: errorData.message || 'API request failed',
      });
    }
  } catch (error: any) {
    console.error('Test connection error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to test connection',
      message: error.message,
    });
  }
}
