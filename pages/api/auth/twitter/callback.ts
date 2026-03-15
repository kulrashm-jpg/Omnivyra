import { NextApiRequest, NextApiResponse } from 'next';
import axios from 'axios';
import { supabase } from '../../../../backend/db/supabaseClient';
import { setToken, TokenObject } from '../../../../backend/auth/tokenStore';
import { getSupabaseUserFromRequest } from '../../../../backend/services/supabaseAuthService';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { code, state, error } = req.query;
  const [_stateBaseEarly, returnToEarly] = String(state || '').split('|');
  const errDest = (returnToEarly && returnToEarly.startsWith('/')) ? returnToEarly : '/social-platforms';

  if (error) {
    return res.redirect(`${errDest}?error=${encodeURIComponent(error as string)}`);
  }

  if (!code) {
    return res.redirect(`${errDest}?error=${encodeURIComponent('No authorization code received')}`);
  }

  try {
    const platform = 'twitter';
    
    // Exchange code for access token (Twitter OAuth 2.0)
    const credentials = Buffer.from(
      `${process.env.TWITTER_CLIENT_ID || process.env.X_CLIENT_ID || ''}:${process.env.TWITTER_CLIENT_SECRET || process.env.X_CLIENT_SECRET || ''}`
    ).toString('base64');

    const tokenResponse = await axios.post(
      'https://api.twitter.com/2/oauth2/token',
      new URLSearchParams({
        code: code as string,
        grant_type: 'authorization_code',
        redirect_uri: `${process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'}/api/auth/twitter/callback`,
        code_verifier: '', // Add if using PKCE
      }),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: `Basic ${credentials}`,
        },
      }
    );

    const tokenData = tokenResponse.data;
    
    // Get user profile
    const profileResponse = await axios.get('https://api.twitter.com/2/users/me', {
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`,
      },
      params: {
        'user.fields': 'username,profile_image_url',
      },
    });

    const userProfile = { data: profileResponse.data.data };

    // Extract returnTo from state (format: "twitter_{ts}|/returnPath")
    const [_stateBase, returnTo] = String(state || '').split('|');

    // Get authenticated user from the request session
    const { user: sessionUser } = await getSupabaseUserFromRequest(req);
    const userId = sessionUser?.id || process.env.DEFAULT_USER_ID || '';

    if (!userId) {
      console.error('No user_id available - cannot save account');
      return res.redirect(`${errDest}?error=${encodeURIComponent('Login session required — please log in and try again')}`);
    }

    if (!userProfile.data?.id) {
      throw new Error('Failed to get user profile');
    }

    const accountName = `@${userProfile.data?.username || userProfile.data?.id}`;
    const expiresIn = tokenData.expires_in || 7200; // Default 2 hours
    const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

    // Prepare token object
    const tokenObj: TokenObject = {
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token || undefined,
      expires_at: expiresAt,
      token_type: 'Bearer',
    };

    // Create or update social account
    const { data: existingAccount } = await supabase
      .from('social_accounts')
      .select('id')
      .eq('user_id', userId)
      .eq('platform', 'twitter')
      .eq('platform_user_id', userProfile.data.id)
      .single();

    let accountId: string;

    if (existingAccount) {
      accountId = existingAccount.id;
      await supabase
        .from('social_accounts')
        .update({
          account_name: accountName,
          username: userProfile.data.username || null,
          is_active: true,
          permissions: tokenData.scope?.split(' ') || [],
          token_expires_at: expiresAt,
          last_sync_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', accountId);
    } else {
      const { data: newAccount, error: insertError } = await supabase
        .from('social_accounts')
        .insert({
          user_id: userId,
          platform: 'twitter',
          platform_user_id: userProfile.data.id,
          account_name: accountName,
          username: userProfile.data.username || null,
          is_active: true,
          permissions: tokenData.scope?.split(' ') || [],
          token_expires_at: expiresAt,
          last_sync_at: new Date().toISOString(),
        })
        .select('id')
        .single();

      if (insertError || !newAccount) {
        throw new Error('Failed to create account');
      }

      accountId = newAccount.id;
    }

    // Save encrypted tokens
    await setToken(accountId, tokenObj);

    console.log('✅ Twitter account saved successfully:', { accountId, accountName });

    const successDest = (returnTo && returnTo.startsWith('/')) ? returnTo : '/social-platforms';
    const sep = successDest.includes('?') ? '&' : '?';
    return res.redirect(`${successDest}${sep}connected=${platform}&account=${encodeURIComponent(accountName)}&success=true`);

  } catch (error: any) {
    console.error('Twitter OAuth callback error:', error);
    return res.redirect(`${errDest}?error=${encodeURIComponent(error.message || 'Connection failed')}`);
  }
}



















