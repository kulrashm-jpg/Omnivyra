/**
 * Platform Configuration Page
 * 
 * UI for users to:
 * - Connect OAuth accounts for each platform
 * - Configure API keys and credentials
 * - Manage connected social accounts
 * - Test connections
 * - View account status
 */

import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';

interface SocialAccount {
  id: string;
  platform: string;
  account_name: string;
  username?: string;
  is_active: boolean;
  follower_count: number;
  last_sync_at?: string;
}

interface PlatformConfig {
  platform: string;
  name: string;
  icon: string;
  status: 'connected' | 'not_connected' | 'error';
  account?: SocialAccount;
  authUrl: string;
  requiredScopes: string[];
}

const PLATFORMS: PlatformConfig[] = [
  {
    platform: 'linkedin',
    name: 'LinkedIn',
    icon: '💼',
    status: 'not_connected',
    authUrl: '/api/auth/linkedin',
    requiredScopes: ['w_member_social', 'r_basicprofile'],
  },
  {
    platform: 'twitter',
    name: 'Twitter / X',
    icon: '🐦',
    status: 'not_connected',
    authUrl: '/api/auth/twitter',
    requiredScopes: ['tweet.read', 'tweet.write', 'users.read'],
  },
  {
    platform: 'instagram',
    name: 'Instagram',
    icon: '📸',
    status: 'not_connected',
    authUrl: '/api/auth/instagram',
    requiredScopes: ['instagram_basic', 'instagram_content_publish'],
  },
  {
    platform: 'facebook',
    name: 'Facebook',
    icon: '👥',
    status: 'not_connected',
    authUrl: '/api/auth/facebook',
    requiredScopes: ['pages_manage_posts', 'pages_read_engagement'],
  },
  {
    platform: 'youtube',
    name: 'YouTube',
    icon: '📺',
    status: 'not_connected',
    authUrl: '/api/auth/youtube',
    requiredScopes: ['youtube.upload', 'youtube.readonly'],
  },
  {
    platform: 'tiktok',
    name: 'TikTok',
    icon: '🎵',
    status: 'not_connected',
    authUrl: '/api/auth/tiktok',
    requiredScopes: ['video.upload', 'user.info.basic'],
  },
  {
    platform: 'spotify',
    name: 'Spotify',
    icon: '🎵',
    status: 'not_connected',
    authUrl: '/api/auth/spotify',
    requiredScopes: ['ugc-image-upload', 'user-read-playback-state'],
  },
  {
    platform: 'pinterest',
    name: 'Pinterest',
    icon: '📌',
    status: 'not_connected',
    authUrl: '/api/auth/pinterest',
    requiredScopes: ['pins:read', 'pins:write'],
  },
];

export default function PlatformConfiguration() {
  const router = useRouter();
  const [platforms, setPlatforms] = useState<PlatformConfig[]>(PLATFORMS);
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    // Get current user ID (from auth context or API)
    // For now, using a placeholder - integrate with your auth system
    const fetchUserId = async () => {
      try {
        // Replace with your auth check
        const response = await fetch('/api/auth/me');
        if (response.ok) {
          const data = await response.json();
          setUserId(data.user_id);
        }
      } catch (error) {
        console.error('Failed to get user ID:', error);
      }
      setLoading(false);
    };

    fetchUserId();
    loadConnectedAccounts();
  }, []);

  const loadConnectedAccounts = async () => {
    try {
      const response = await fetch('/api/accounts');
      if (response.ok) {
        const accounts: SocialAccount[] = await response.json();
        
        setPlatforms((prev) =>
          prev.map((p) => {
            const account = accounts.find((a) => a.platform === p.platform);
            return {
              ...p,
              status: account?.is_active ? 'connected' : 'not_connected',
              account: account,
            };
          })
        );
      }
    } catch (error) {
      console.error('Failed to load accounts:', error);
    }
  };

  const handleConnect = (platform: string, authUrl: string) => {
    // Redirect to OAuth flow
    window.location.href = authUrl;
  };

  const handleDisconnect = async (platform: string, accountId: string) => {
    if (!confirm(`Are you sure you want to disconnect ${platform}?`)) {
      return;
    }

    try {
      const response = await fetch(`/api/accounts/${accountId}`, {
        method: 'DELETE',
      });

      if (response.ok) {
        await loadConnectedAccounts();
      } else {
        alert('Failed to disconnect account');
      }
    } catch (error) {
      console.error('Disconnect error:', error);
      alert('Failed to disconnect account');
    }
  };

  const handleTestConnection = async (platform: string) => {
    try {
      const response = await fetch(`/api/accounts/${platform}/test`);
      if (response.ok) {
        const result = await response.json();
        alert(result.success ? 'Connection test passed!' : `Test failed: ${result.error}`);
      }
    } catch (error) {
      alert('Connection test failed');
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-lg">Loading...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-6xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">
            Platform Configuration
          </h1>
          <p className="text-gray-600">
            Connect your social media accounts and configure API settings
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {platforms.map((platform) => (
            <div
              key={platform.platform}
              className="bg-white rounded-lg shadow-md p-6 border-2 border-gray-200 hover:border-blue-500 transition-colors"
            >
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center space-x-3">
                  <span className="text-3xl">{platform.icon}</span>
                  <div>
                    <h3 className="font-semibold text-lg text-gray-900">
                      {platform.name}
                    </h3>
                    <p className="text-sm text-gray-500 capitalize">
                      {platform.platform}
                    </p>
                  </div>
                </div>
                <div
                  className={`px-3 py-1 rounded-full text-xs font-medium ${
                    platform.status === 'connected'
                      ? 'bg-green-100 text-green-800'
                      : platform.status === 'error'
                      ? 'bg-red-100 text-red-800'
                      : 'bg-gray-100 text-gray-800'
                  }`}
                >
                  {platform.status === 'connected'
                    ? 'Connected'
                    : platform.status === 'error'
                    ? 'Error'
                    : 'Not Connected'}
                </div>
              </div>

              {platform.account && platform.status === 'connected' ? (
                <div className="space-y-3">
                  <div className="bg-gray-50 rounded p-3">
                    <p className="text-sm font-medium text-gray-700">
                      {platform.account.account_name}
                    </p>
                    {platform.account.username && (
                      <p className="text-xs text-gray-500">
                        @{platform.account.username}
                      </p>
                    )}
                    {platform.account.follower_count > 0 && (
                      <p className="text-xs text-gray-500 mt-1">
                        {platform.account.follower_count.toLocaleString()} followers
                      </p>
                    )}
                    {platform.account.last_sync_at && (
                      <p className="text-xs text-gray-400 mt-1">
                        Last sync: {new Date(platform.account.last_sync_at).toLocaleDateString()}
                      </p>
                    )}
                  </div>

                  <div className="flex space-x-2">
                    <button
                      onClick={() => handleTestConnection(platform.platform)}
                      className="flex-1 px-4 py-2 bg-blue-50 text-blue-700 rounded hover:bg-blue-100 text-sm font-medium"
                    >
                      Test Connection
                    </button>
                    <button
                      onClick={() =>
                        handleDisconnect(platform.platform, platform.account!.id)
                      }
                      className="flex-1 px-4 py-2 bg-red-50 text-red-700 rounded hover:bg-red-100 text-sm font-medium"
                    >
                      Disconnect
                    </button>
                  </div>
                </div>
              ) : (
                <div>
                  <div className="mb-3">
                    <p className="text-xs text-gray-500 mb-2">
                      Required Scopes:
                    </p>
                    <div className="flex flex-wrap gap-1">
                      {platform.requiredScopes.map((scope) => (
                        <span
                          key={scope}
                          className="px-2 py-1 bg-gray-100 text-gray-600 rounded text-xs"
                        >
                          {scope}
                        </span>
                      ))}
                    </div>
                  </div>
                  <button
                    onClick={() => handleConnect(platform.platform, platform.authUrl)}
                    className="w-full px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 font-medium"
                  >
                    Connect {platform.name}
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="mt-8 bg-blue-50 border border-blue-200 rounded-lg p-4">
          <h3 className="font-semibold text-blue-900 mb-2">💡 Tips</h3>
          <ul className="text-sm text-blue-800 space-y-1 list-disc list-inside">
            <li>Connect accounts to enable automatic posting</li>
            <li>Each platform requires specific OAuth permissions (scopes)</li>
            <li>Test connections to verify API access</li>
            <li>Tokens are encrypted and stored securely</li>
          </ul>
        </div>
      </div>
    </div>
  );
}

