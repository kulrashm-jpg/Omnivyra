import { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import { setToken, TokenObject } from '../../../../backend/auth/tokenStore';

// Initialize Supabase client for database operations
const supabase = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { code, state, error, error_description } = req.query;

  console.log('TikTok callback received:', { code: !!code, state, error, error_description });

  if (error) {
    console.error('TikTok OAuth error:', error, error_description);
    return res.redirect(`/creative-scheduler?error=${encodeURIComponent(error as string)}&description=${encodeURIComponent(error_description as string || '')}`);
  }

  if (!code) {
    console.error('No authorization code received');
    return res.redirect('/creative-scheduler?error=No authorization code received');
  }

  try {
    const platform = 'tiktok';
    
    // Exchange code for access token
    console.log('Exchanging code for token...');
    const tokenResponse = await fetch('https://open.tiktokapis.com/v2/oauth/token/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_key: process.env.TIKTOK_CLIENT_ID || '',
        client_secret: process.env.TIKTOK_CLIENT_SECRET || '',
        grant_type: 'authorization_code',
        code: code as string,
        redirect_uri: `${process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3001'}/api/auth/tiktok/callback`,
      })
    });

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      console.error('Token exchange failed:', tokenResponse.status, errorText);
      throw new Error(`Token exchange failed: ${tokenResponse.statusText}`);
    }

    const tokenData = await tokenResponse.json();
    console.log('Token received:', { access_token: !!tokenData.data?.access_token, expires_in: tokenData.data?.expires_in });
    
    // Get TikTok user info
    console.log('Fetching TikTok user info...');
    const userResponse = await fetch('https://open.tiktokapis.com/v2/user/info/', {
      headers: {
        'Authorization': `Bearer ${tokenData.data.access_token}`,
        'Content-Type': 'application/json',
      },
      method: 'POST',
      body: JSON.stringify({
        fields: ['open_id', 'union_id', 'avatar_url', 'display_name', 'username'],
      }),
    });

    if (!userResponse.ok) {
      const errorText = await userResponse.text();
      console.error('User info fetch failed:', userResponse.status, errorText);
      throw new Error(`User info fetch failed: ${userResponse.statusText}`);
    }

    const userData = await userResponse.json();
    const userInfo = userData.data?.user || {};
    console.log('User info received:', { open_id: userInfo.open_id, username: userInfo.username });

    // Get user_id from state or session
    const userId = (state as string)?.split('_')[0] || process.env.DEFAULT_USER_ID || '';
    
    if (!userId) {
      console.error('No user_id available - cannot save account');
      return res.redirect(`/creative-scheduler?error=${encodeURIComponent('User session required')}`);
    }

    const accountName = userInfo.display_name || userInfo.username || 'TikTok User';
    const expiresIn = tokenData.data?.expires_in || 7200; // Default 2 hours
    const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

    // Prepare token object for encrypted storage
    const tokenObj: TokenObject = {
      access_token: tokenData.data.access_token,
      refresh_token: tokenData.data.refresh_token || undefined,
      expires_at: expiresAt,
      token_type: tokenData.data.token_type || 'Bearer',
    };

    // Create or update social account in database
    const { data: existingAccount, error: fetchError } = await supabase
      .from('social_accounts')
      .select('id')
      .eq('user_id', userId)
      .eq('platform', 'tiktok')
      .eq('platform_user_id', userInfo.open_id || userInfo.union_id)
      .single();

    let accountId: string;

    if (existingAccount) {
      // Update existing account
      accountId = existingAccount.id;
      const { error: updateError } = await supabase
        .from('social_accounts')
        .update({
          account_name: accountName,
          username: userInfo.username || null,
          profile_picture_url: userInfo.avatar_url || null,
          is_active: true,
          permissions: tokenData.data.scope?.split(',') || ['video.upload', 'user.info.basic'],
          token_expires_at: expiresAt,
          last_sync_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', accountId);

      if (updateError) {
        console.error('Failed to update account:', updateError);
        throw new Error('Failed to update account');
      }
    } else {
      // Create new account
      const { data: newAccount, error: insertError } = await supabase
        .from('social_accounts')
        .insert({
          user_id: userId,
          platform: 'tiktok',
          platform_user_id: userInfo.open_id || userInfo.union_id,
          account_name: accountName,
          username: userInfo.username || null,
          profile_picture_url: userInfo.avatar_url || null,
          is_active: true,
          permissions: tokenData.data.scope?.split(',') || ['video.upload', 'user.info.basic'],
          token_expires_at: expiresAt,
          last_sync_at: new Date().toISOString(),
        })
        .select('id')
        .single();

      if (insertError || !newAccount) {
        console.error('Failed to create account:', insertError);
        throw new Error('Failed to create account');
      }

      accountId = newAccount.id;
    }

    // Save encrypted tokens using tokenStore
    await setToken(accountId, tokenObj);

    console.log('✅ TikTok account saved successfully:', { accountId, accountName });

    // Redirect back to creative scheduler with success
    return res.redirect(`/creative-scheduler?connected=tiktok&account=${encodeURIComponent(accountName)}&success=true&message=TikTok account connected successfully!`);

  } catch (error: any) {
    console.error('TikTok OAuth callback error:', error);
    return res.redirect(`/creative-scheduler?error=${encodeURIComponent(error.message)}`);
  }
}





