import type { NextApiRequest, NextApiResponse } from 'next';
import fs from 'fs';
import path from 'path';

/**
 * GET /api/social/linkedin/callback
 *
 * LinkedIn OAuth callback. Exchanges the authorization code for an access token
 * and writes LINKEDIN_ACCESS_TOKEN to .env.local (or .env).
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const code = typeof req.query.code === 'string' ? req.query.code : null;

  if (!code) {
    return res.status(400).json({
      success: false,
      error: 'No authorization code received',
      platform: 'linkedin',
    });
  }

  const clientId = process.env.LINKEDIN_CLIENT_ID;
  const clientSecret = process.env.LINKEDIN_CLIENT_SECRET;
  const redirectUri =
    process.env.LINKEDIN_REDIRECT_URI || 'http://localhost:3000/api/social/linkedin/callback';

  if (!clientId || !clientSecret) {
    return res.status(500).json({
      success: false,
      error: 'LinkedIn credentials not configured. Set LINKEDIN_CLIENT_ID and LINKEDIN_CLIENT_SECRET.',
      platform: 'linkedin',
    });
  }

  try {
    const tokenResponse = await fetch('https://www.linkedin.com/oauth/v2/accessToken', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        client_id: clientId,
        client_secret: clientSecret,
      }),
    });

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      console.error('[linkedin/callback] Token exchange failed:', tokenResponse.status, errorText);
      return res.status(400).json({
        success: false,
        error: `Token exchange failed: ${tokenResponse.statusText}`,
        platform: 'linkedin',
      });
    }

    const tokenData = (await tokenResponse.json()) as {
      access_token?: string;
      expires_in?: number;
      error?: string;
      error_description?: string;
    };

    if (tokenData.error) {
      return res.status(400).json({
        success: false,
        error: tokenData.error_description || tokenData.error,
        platform: 'linkedin',
      });
    }

    const accessToken = tokenData.access_token;
    if (!accessToken) {
      return res.status(400).json({
        success: false,
        error: 'No access_token in response',
        platform: 'linkedin',
      });
    }

    // Write to env file: prefer .env.local (Next.js convention), fallback to .env
    const cwd = process.cwd();
    const envLocalPath = path.join(cwd, '.env.local');
    const envPath = path.join(cwd, '.env');
    const targetPath = fs.existsSync(envLocalPath) ? envLocalPath : envPath;

    let envContent: string;
    try {
      envContent = fs.readFileSync(targetPath, 'utf8');
    } catch (readErr) {
      console.error('[linkedin/callback] Failed to read env file:', readErr);
      return res.status(500).json({
        success: false,
        error: `Could not read env file at ${targetPath}`,
        platform: 'linkedin',
      });
    }

    const newLine = `LINKEDIN_ACCESS_TOKEN=${accessToken}`;
    if (/LINKEDIN_ACCESS_TOKEN\s*=/.test(envContent)) {
      envContent = envContent.replace(/LINKEDIN_ACCESS_TOKEN\s*=.*/g, newLine);
    } else {
      envContent = envContent.trimEnd() + (envContent.endsWith('\n') ? '' : '\n') + newLine + '\n';
    }

    try {
      fs.writeFileSync(targetPath, envContent, 'utf8');
    } catch (writeErr) {
      console.error('[linkedin/callback] Failed to write env file:', writeErr);
      return res.status(500).json({
        success: false,
        error: `Could not write env file at ${targetPath}`,
        platform: 'linkedin',
      });
    }

    return res.status(200).json({
      success: true,
      platform: 'linkedin',
      connected: true,
      expires_in: tokenData.expires_in,
    });
  } catch (err) {
    console.error('[linkedin/callback] Error:', err);
    return res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : 'Internal server error',
      platform: 'linkedin',
    });
  }
}
