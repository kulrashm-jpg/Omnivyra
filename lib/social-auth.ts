// Social Media OAuth Configuration and API Integration
export interface SocialAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  scope: string[];
}

export interface SocialAccount {
  id: string;
  platform: string;
  accountName: string;
  accountId: string;
  accessToken: string;
  refreshToken?: string;
  expiresAt?: Date;
  isActive: boolean;
  permissions: string[];
}

// Platform-specific OAuth configurations
export const SOCIAL_AUTH_CONFIGS = {
  linkedin: {
    authUrl: 'https://www.linkedin.com/oauth/v2/authorization',
    tokenUrl: 'https://www.linkedin.com/oauth/v2/accessToken',
    scope: ['r_liteprofile', 'r_emailaddress', 'w_member_social'],
    requiredPermissions: ['r_liteprofile', 'w_member_social']
  },
  twitter: {
    authUrl: 'https://twitter.com/i/oauth2/authorize',
    tokenUrl: 'https://api.twitter.com/2/oauth2/token',
    scope: ['tweet.read', 'tweet.write', 'users.read', 'offline.access'],
    requiredPermissions: ['tweet.write', 'users.read']
  },
  facebook: {
    authUrl: 'https://www.facebook.com/v18.0/dialog/oauth',
    tokenUrl: 'https://graph.facebook.com/v18.0/oauth/access_token',
    scope: ['pages_manage_posts', 'pages_read_engagement', 'pages_show_list'],
    requiredPermissions: ['pages_manage_posts', 'pages_read_engagement']
  },
  instagram: {
    authUrl: 'https://www.facebook.com/v18.0/dialog/oauth',
    tokenUrl: 'https://graph.facebook.com/v18.0/oauth/access_token',
    scope: ['instagram_basic', 'instagram_content_publish', 'pages_show_list'],
    requiredPermissions: ['instagram_content_publish']
  }
};

// Generate OAuth URLs for each platform
export const generateOAuthUrl = (platform: string, state?: string): string => {
  const config = SOCIAL_AUTH_CONFIGS[platform];
  if (!config) throw new Error(`Unsupported platform: ${platform}`);

  const params = new URLSearchParams({
    client_id: process.env[`${platform.toUpperCase()}_CLIENT_ID`] || '',
    redirect_uri: `${process.env.NEXT_PUBLIC_BASE_URL}/api/auth/${platform}/callback`,
    scope: config.scope.join(' '),
    response_type: 'code',
    ...(state && { state })
  });

  return `${config.authUrl}?${params.toString()}`;
};

// Exchange authorization code for access token
export const exchangeCodeForToken = async (platform: string, code: string): Promise<any> => {
  const config = SOCIAL_AUTH_CONFIGS[platform];
  if (!config) throw new Error(`Unsupported platform: ${platform}`);

  const tokenData = {
    client_id: process.env[`${platform.toUpperCase()}_CLIENT_ID`],
    client_secret: process.env[`${platform.toUpperCase()}_CLIENT_SECRET`],
    code,
    grant_type: 'authorization_code',
    redirect_uri: `${process.env.NEXT_PUBLIC_BASE_URL}/api/auth/${platform}/callback`
  };

  const response = await fetch(config.tokenUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(tokenData)
  });

  if (!response.ok) {
    throw new Error(`Token exchange failed: ${response.statusText}`);
  }

  return response.json();
};

// Get user profile information
export const getUserProfile = async (platform: string, accessToken: string): Promise<any> => {
  const profileUrls = {
    linkedin: 'https://api.linkedin.com/v2/people/~',
    twitter: 'https://api.twitter.com/2/users/me',
    facebook: 'https://graph.facebook.com/v18.0/me',
    instagram: 'https://graph.facebook.com/v18.0/me'
  };

  const url = profileUrls[platform];
  if (!url) throw new Error(`Unsupported platform: ${platform}`);

  const response = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Accept': 'application/json'
    }
  });

  if (!response.ok) {
    throw new Error(`Profile fetch failed: ${response.statusText}`);
  }

  return response.json();
};























