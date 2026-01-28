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
    const platform = 'youtube';
    
    // Exchange code for access token (YouTube uses Google OAuth)
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: process.env.YOUTUBE_CLIENT_ID || '',
        client_secret: process.env.YOUTUBE_CLIENT_SECRET || '',
        redirect_uri: `${process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3001'}/api/auth/youtube/callback`,
        grant_type: 'authorization_code',
        code: code as string,
      })
    });

    if (!tokenResponse.ok) {
      throw new Error('Token exchange failed');
    }

    const tokenData = await tokenResponse.json();
    
    // Get YouTube channel info
    const channelResponse = await fetch('https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true', {
      headers: {
        'Authorization': `Bearer ${tokenData.access_token}`,
      }
    });

    if (!channelResponse.ok) {
      throw new Error('Channel info fetch failed');
    }

    const channelData = await channelResponse.json();
    const channel = channelData.items?.[0];

    if (!channel?.id) {
      throw new Error('Failed to get YouTube channel info');
    }

    // Get user_id from state
    const userId = (state as string)?.split('_')[0] || process.env.DEFAULT_USER_ID || '';
    
    if (!userId) {
      console.error('No user_id available - cannot save account');
      return res.redirect(`/creative-scheduler?error=${encodeURIComponent('User session required')}`);
    }

    const accountName = channel.snippet?.title || 'YouTube Channel';
    const expiresIn = tokenData.expires_in || 3600; // Default 1 hour
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
      .eq('platform', 'youtube')
      .eq('platform_user_id', channel.id)
      .single();

    let accountId: string;

    if (existingAccount) {
      accountId = existingAccount.id;
      await supabase
        .from('social_accounts')
        .update({
          account_name: accountName,
          username: channel.snippet?.customUrl || null,
          profile_picture_url: channel.snippet?.thumbnails?.default?.url || null,
          is_active: true,
          permissions: ['youtube', 'youtube.upload'],
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
          platform: 'youtube',
          platform_user_id: channel.id,
          account_name: accountName,
          username: channel.snippet?.customUrl || null,
          profile_picture_url: channel.snippet?.thumbnails?.default?.url || null,
          is_active: true,
          permissions: ['youtube', 'youtube.upload'],
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

    console.log('✅ YouTube account saved successfully:', { accountId, accountName });

    return res.redirect(`/creative-scheduler?connected=${platform}&account=${encodeURIComponent(accountName)}`);

  } catch (error: any) {
    console.error('YouTube OAuth callback error:', error);
    return res.redirect(`/creative-scheduler?error=${encodeURIComponent(error.message)}`);
  }
}



















