import { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import { setToken, TokenObject } from '../../../../backend/auth/tokenStore';

// Initialize Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { code, state, error } = req.query;

  if (error) {
    return res.redirect(`/creative-scheduler?error=${encodeURIComponent(error as string)}`);
  }

  if (!code) {
    return res.redirect('/creative-scheduler?error=No authorization code received');
  }

  try {
    const platform = 'instagram';
    
    // Exchange code for access token (Instagram uses Facebook Graph API)
    const tokenResponse = await fetch('https://graph.facebook.com/v18.0/oauth/access_token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: process.env.INSTAGRAM_CLIENT_ID || '',
        client_secret: process.env.INSTAGRAM_CLIENT_SECRET || '',
        redirect_uri: `${process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'}/api/auth/instagram/callback`,
        code: code as string,
      })
    });

    if (!tokenResponse.ok) {
      throw new Error('Token exchange failed');
    }

    const tokenData = await tokenResponse.json();
    
    // Get Instagram account info (Instagram uses Facebook Graph API)
    const profileResponse = await fetch(`https://graph.facebook.com/v18.0/me?fields=id,name&access_token=${tokenData.access_token}`);
    const profile = await profileResponse.json();

    // Get user_id from state
    const userId = (state as string)?.split('_')[0] || process.env.DEFAULT_USER_ID || '';
    
    if (!userId) {
      console.error('No user_id available - cannot save account');
      return res.redirect(`/creative-scheduler?error=${encodeURIComponent('User session required')}`);
    }

    const accountName = profile.name || 'Instagram Account';
    const expiresIn = tokenData.expires_in || 5184000; // Default 60 days
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
      .eq('platform', 'instagram')
      .eq('platform_user_id', profile.id)
      .single();

    let accountId: string;

    if (existingAccount) {
      accountId = existingAccount.id;
      await supabase
        .from('social_accounts')
        .update({
          account_name: accountName,
          is_active: true,
          permissions: tokenData.scope?.split(',') || [],
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
          platform: 'instagram',
          platform_user_id: profile.id,
          account_name: accountName,
          is_active: true,
          permissions: tokenData.scope?.split(',') || [],
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

    console.log('✅ Instagram account saved successfully:', { accountId, accountName });

    return res.redirect(`/creative-scheduler?connected=${platform}&account=${encodeURIComponent(accountName)}`);

  } catch (error: any) {
    console.error('Instagram OAuth callback error:', error);
    return res.redirect(`/creative-scheduler?error=${encodeURIComponent(error.message)}`);
  }
}



















