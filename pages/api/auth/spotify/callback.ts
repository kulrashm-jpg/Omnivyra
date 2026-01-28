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

  console.log('Spotify callback received:', { code: !!code, state, error, error_description });

  if (error) {
    console.error('Spotify OAuth error:', error, error_description);
    return res.redirect(`/creative-scheduler?error=${encodeURIComponent(error as string)}&description=${encodeURIComponent(error_description as string || '')}`);
  }

  if (!code) {
    console.error('No authorization code received');
    return res.redirect('/creative-scheduler?error=No authorization code received');
  }

  try {
    const platform = 'spotify';
    
    // Exchange code for access token
    console.log('Exchanging code for token...');
    const credentials = Buffer.from(
      `${process.env.SPOTIFY_CLIENT_ID || ''}:${process.env.SPOTIFY_CLIENT_SECRET || ''}`
    ).toString('base64');

    const tokenResponse = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${credentials}`,
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: code as string,
        redirect_uri: `${process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3001'}/api/auth/spotify/callback`,
      })
    });

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      console.error('Token exchange failed:', tokenResponse.status, errorText);
      throw new Error(`Token exchange failed: ${tokenResponse.statusText}`);
    }

    const tokenData = await tokenResponse.json();
    console.log('Token received:', { access_token: !!tokenData.access_token, expires_in: tokenData.expires_in });
    
    // Get Spotify user info
    console.log('Fetching Spotify user info...');
    const userResponse = await fetch('https://api.spotify.com/v1/me', {
      headers: {
        'Authorization': `Bearer ${tokenData.access_token}`,
      }
    });

    if (!userResponse.ok) {
      const errorText = await userResponse.text();
      console.error('User info fetch failed:', userResponse.status, errorText);
      throw new Error(`User info fetch failed: ${userResponse.statusText}`);
    }

    const userInfo = await userResponse.json();
    console.log('User info received:', { id: userInfo.id, display_name: userInfo.display_name });

    // Get user_id from state or session
    const userId = (state as string)?.split('_')[0] || process.env.DEFAULT_USER_ID || '';
    
    if (!userId) {
      console.error('No user_id available - cannot save account');
      return res.redirect(`/creative-scheduler?error=${encodeURIComponent('User session required')}`);
    }

    const accountName = userInfo.display_name || userInfo.id || 'Spotify User';
    const expiresIn = tokenData.expires_in || 3600; // Default 1 hour
    const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

    // Prepare token object for encrypted storage
    const tokenObj: TokenObject = {
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token || undefined,
      expires_at: expiresAt,
      token_type: tokenData.token_type || 'Bearer',
    };

    // Create or update social account in database
    const { data: existingAccount, error: fetchError } = await supabase
      .from('social_accounts')
      .select('id')
      .eq('user_id', userId)
      .eq('platform', 'spotify')
      .eq('platform_user_id', userInfo.id)
      .single();

    let accountId: string;

    if (existingAccount) {
      // Update existing account
      accountId = existingAccount.id;
      const { error: updateError } = await supabase
        .from('social_accounts')
        .update({
          account_name: accountName,
          username: userInfo.id || null,
          profile_picture_url: userInfo.images?.[0]?.url || null,
          is_active: true,
          permissions: tokenData.scope?.split(' ') || ['playlist-modify-public', 'playlist-modify-private'],
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
          platform: 'spotify',
          platform_user_id: userInfo.id,
          account_name: accountName,
          username: userInfo.id || null,
          profile_picture_url: userInfo.images?.[0]?.url || null,
          is_active: true,
          permissions: tokenData.scope?.split(' ') || ['playlist-modify-public', 'playlist-modify-private'],
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

    console.log('✅ Spotify account saved successfully:', { accountId, accountName });

    // Redirect back to creative scheduler with success
    return res.redirect(`/creative-scheduler?connected=spotify&account=${encodeURIComponent(accountName)}&success=true&message=Spotify account connected successfully!`);

  } catch (error: any) {
    console.error('Spotify OAuth callback error:', error);
    return res.redirect(`/creative-scheduler?error=${encodeURIComponent(error.message)}`);
  }
}





