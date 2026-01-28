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

  console.log('LinkedIn callback received:', { code: !!code, state, error, error_description });

  if (error) {
    console.error('LinkedIn OAuth error:', error, error_description);
    return res.redirect(`/creative-scheduler?error=${encodeURIComponent(error as string)}&description=${encodeURIComponent(error_description as string || '')}`);
  }

  if (!code) {
    console.error('No authorization code received');
    return res.redirect('/creative-scheduler?error=No authorization code received');
  }

  try {
    const platform = 'linkedin';
    
    // Exchange code for access token
    console.log('Exchanging code for token...');
    const tokenResponse = await fetch('https://www.linkedin.com/oauth/v2/accessToken', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: code as string,
        client_id: process.env.LINKEDIN_CLIENT_ID || '',
        client_secret: process.env.LINKEDIN_CLIENT_SECRET || '',
        redirect_uri: `${process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3001'}/api/auth/linkedin/callback`,
      })
    });

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      console.error('Token exchange failed:', tokenResponse.status, errorText);
      throw new Error(`Token exchange failed: ${tokenResponse.statusText}`);
    }

    const tokenData = await tokenResponse.json();
    console.log('Token received:', { access_token: !!tokenData.access_token, expires_in: tokenData.expires_in });
    
    // Get LinkedIn profile info
    console.log('Fetching LinkedIn profile...');
    const profileResponse = await fetch('https://api.linkedin.com/v2/people/~:(id,firstName,lastName,profilePicture(displayImage~:playableStreams))', {
      headers: {
        'Authorization': `Bearer ${tokenData.access_token}`,
        'X-Restli-Protocol-Version': '2.0.0'
      }
    });

    if (!profileResponse.ok) {
      const errorText = await profileResponse.text();
      console.error('Profile fetch failed:', profileResponse.status, errorText);
      throw new Error(`Profile fetch failed: ${profileResponse.statusText}`);
    }

    const profile = await profileResponse.json();
    console.log('Profile received:', { id: profile.id, firstName: profile.firstName });

    // Get user_id from state or session (for now, using a default - in production, get from authenticated session)
    // TODO: Get actual user_id from session/state
    const userId = (state as string)?.split('_')[0] || process.env.DEFAULT_USER_ID || '';
    
    if (!userId) {
      console.error('No user_id available - cannot save account');
      return res.redirect(`/creative-scheduler?error=${encodeURIComponent('User session required')}`);
    }

    const accountName = `${profile.firstName?.localized?.en_US || 'LinkedIn'} ${profile.lastName?.localized?.en_US || 'User'}`;
    const expiresIn = tokenData.expires_in || 5184000; // Default 60 days
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
      .eq('platform', 'linkedin')
      .eq('platform_user_id', profile.id)
      .single();

    let accountId: string;

    if (existingAccount) {
      // Update existing account
      accountId = existingAccount.id;
      const { error: updateError } = await supabase
        .from('social_accounts')
        .update({
          account_name: accountName,
          username: profile.firstName?.localized?.en_US || null,
          is_active: true,
          permissions: tokenData.scope?.split(' ') || [],
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
          platform: 'linkedin',
          platform_user_id: profile.id,
          account_name: accountName,
          username: profile.firstName?.localized?.en_US || null,
          is_active: true,
          permissions: tokenData.scope?.split(' ') || [],
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

    console.log('✅ LinkedIn account saved successfully:', { accountId, accountName });

    // Redirect back to creative scheduler with success
    return res.redirect(`/creative-scheduler?connected=linkedin&account=${encodeURIComponent(accountName)}&success=true&message=LinkedIn account connected successfully!`);

  } catch (error: any) {
    console.error('LinkedIn OAuth callback error:', error);
    return res.redirect(`/creative-scheduler?error=${encodeURIComponent(error.message)}`);
  }
}
