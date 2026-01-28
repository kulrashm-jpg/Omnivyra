/**
 * Content Adapter Configuration Page
 * 
 * UI for users to configure how content is adapted for each platform:
 * - Character limits
 * - Hashtag rules
 * - Media requirements
 * - Content type settings
 * - Formatting preferences
 */

import { useState, useEffect } from 'react';

interface PlatformGuidelines {
  platform: string;
  name: string;
  icon: string;
  characterLimits: {
    min: number;
    max: number;
    recommended: number;
  };
  hashtagLimits: {
    min: number;
    max: number;
    recommended: number;
  };
  contentTypes: {
    type: string;
    characterLimit: number;
    hashtagLimit: number;
    mediaRequired: boolean;
    description: string;
  }[];
  mediaRequirements?: {
    image?: { maxSize: number; formats: string[] };
    video?: { maxSize: number; maxDuration: number; formats: string[] };
    audio?: { maxSize: number; maxDuration: number; formats: string[] };
  };
}

interface AdapterConfig {
  platform: string;
  autoTruncate: boolean;
  autoFormatHashtags: boolean;
  preserveLinks: boolean;
  customRules: Record<string, any>;
}

const PLATFORM_DATA: PlatformGuidelines[] = [
  {
    platform: 'linkedin',
    name: 'LinkedIn',
    icon: '💼',
    characterLimits: { min: 3, max: 3000, recommended: 1300 },
    hashtagLimits: { min: 0, max: 5, recommended: 3 },
    contentTypes: [
      { type: 'post', characterLimit: 3000, hashtagLimit: 5, mediaRequired: false, description: 'Standard LinkedIn post' },
      { type: 'article', characterLimit: 125000, hashtagLimit: 5, mediaRequired: false, description: 'LinkedIn article' },
    ],
    mediaRequirements: {
      image: { maxSize: 5 * 1024 * 1024, formats: ['jpg', 'png'] },
      video: { maxSize: 200 * 1024 * 1024, maxDuration: 600, formats: ['mp4'] },
    },
  },
  {
    platform: 'twitter',
    name: 'Twitter / X',
    icon: '🐦',
    characterLimits: { min: 1, max: 280, recommended: 240 },
    hashtagLimits: { min: 0, max: 10, recommended: 2 },
    contentTypes: [
      { type: 'tweet', characterLimit: 280, hashtagLimit: 10, mediaRequired: false, description: 'Standard tweet' },
      { type: 'thread', characterLimit: 280, hashtagLimit: 10, mediaRequired: false, description: 'Tweet thread' },
    ],
    mediaRequirements: {
      image: { maxSize: 5 * 1024 * 1024, formats: ['jpg', 'png', 'gif', 'webp'] },
      video: { maxSize: 512 * 1024 * 1024, maxDuration: 140, formats: ['mp4'] },
    },
  },
  {
    platform: 'instagram',
    name: 'Instagram',
    icon: '📸',
    characterLimits: { min: 1, max: 2200, recommended: 125 },
    hashtagLimits: { min: 0, max: 30, recommended: 5 },
    contentTypes: [
      { type: 'post', characterLimit: 2200, hashtagLimit: 30, mediaRequired: true, description: 'Instagram post (requires image/video)' },
      { type: 'story', characterLimit: 250, hashtagLimit: 10, mediaRequired: true, description: 'Instagram story' },
      { type: 'reel', characterLimit: 2200, hashtagLimit: 30, mediaRequired: true, description: 'Instagram reel (video required)' },
    ],
    mediaRequirements: {
      image: { maxSize: 8 * 1024 * 1024, formats: ['jpg'] },
      video: { maxSize: 100 * 1024 * 1024, maxDuration: 60, formats: ['mp4'] },
    },
  },
  {
    platform: 'facebook',
    name: 'Facebook',
    icon: '👥',
    characterLimits: { min: 1, max: 63206, recommended: 250 },
    hashtagLimits: { min: 0, max: 30, recommended: 3 },
    contentTypes: [
      { type: 'post', characterLimit: 63206, hashtagLimit: 30, mediaRequired: false, description: 'Facebook post' },
      { type: 'story', characterLimit: 250, hashtagLimit: 10, mediaRequired: true, description: 'Facebook story' },
    ],
    mediaRequirements: {
      image: { maxSize: 4 * 1024 * 1024, formats: ['jpg', 'png'] },
      video: { maxSize: 1024 * 1024 * 1024, maxDuration: 240, formats: ['mp4', 'mov'] },
    },
  },
  {
    platform: 'youtube',
    name: 'YouTube',
    icon: '📺',
    characterLimits: { min: 1, max: 5000, recommended: 500 },
    hashtagLimits: { min: 0, max: 15, recommended: 5 },
    contentTypes: [
      { type: 'video', characterLimit: 5000, hashtagLimit: 15, mediaRequired: true, description: 'YouTube video (description)' },
    ],
    mediaRequirements: {
      video: { maxSize: 128 * 1024 * 1024 * 1024, maxDuration: 7200, formats: ['mp4', 'mov'] },
    },
  },
  {
    platform: 'tiktok',
    name: 'TikTok',
    icon: '🎵',
    characterLimits: { min: 0, max: 2200, recommended: 150 },
    hashtagLimits: { min: 0, max: 100, recommended: 5 },
    contentTypes: [
      { type: 'video', characterLimit: 2200, hashtagLimit: 100, mediaRequired: true, description: 'TikTok video (caption)' },
    ],
    mediaRequirements: {
      video: { maxSize: 287 * 1024 * 1024, maxDuration: 600, formats: ['mp4'] },
    },
  },
];

export default function ContentAdapterConfig() {
  const [configs, setConfigs] = useState<Record<string, AdapterConfig>>({});
  const [selectedPlatform, setSelectedPlatform] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadConfigurations();
  }, []);

  const loadConfigurations = async () => {
    try {
      const response = await fetch('/api/content-adapter/config');
      if (response.ok) {
        const data = await response.json();
        setConfigs(data.configs || {});
      }
    } catch (error) {
      console.error('Failed to load configurations:', error);
    }
  };

  const saveConfiguration = async (platform: string, config: AdapterConfig) => {
    setSaving(true);
    try {
      const response = await fetch('/api/content-adapter/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform, config }),
      });

      if (response.ok) {
        await loadConfigurations();
        alert('Configuration saved successfully!');
      } else {
        alert('Failed to save configuration');
      }
    } catch (error) {
      console.error('Save error:', error);
      alert('Failed to save configuration');
    } finally {
      setSaving(false);
    }
  };

  const getConfig = (platform: string): AdapterConfig => {
    return (
      configs[platform] || {
        platform,
        autoTruncate: true,
        autoFormatHashtags: true,
        preserveLinks: true,
        customRules: {},
      }
    );
  };

  const updateConfig = (platform: string, updates: Partial<AdapterConfig>) => {
    const current = getConfig(platform);
    setConfigs({
      ...configs,
      [platform]: { ...current, ...updates },
    });
  };

  const selectedPlatformData = PLATFORM_DATA.find((p) => p.platform === selectedPlatform);

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-7xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">
            Content Adapter Configuration
          </h1>
          <p className="text-gray-600">
            Configure how content is automatically adapted for each social media platform
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Platform List */}
          <div className="lg:col-span-1">
            <div className="bg-white rounded-lg shadow-md p-4">
              <h2 className="font-semibold text-lg mb-4">Platforms</h2>
              <div className="space-y-2">
                {PLATFORM_DATA.map((platform) => {
                  const config = getConfig(platform.platform);
                  return (
                    <button
                      key={platform.platform}
                      onClick={() => setSelectedPlatform(platform.platform)}
                      className={`w-full text-left p-3 rounded-lg border-2 transition-colors ${
                        selectedPlatform === platform.platform
                          ? 'border-blue-500 bg-blue-50'
                          : 'border-gray-200 hover:border-gray-300'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-2">
                          <span className="text-2xl">{platform.icon}</span>
                          <span className="font-medium">{platform.name}</span>
                        </div>
                        {config.autoTruncate && (
                          <span className="text-xs bg-green-100 text-green-800 px-2 py-1 rounded">
                            Auto
                          </span>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Configuration Panel */}
          <div className="lg:col-span-2">
            {selectedPlatformData ? (
              <div className="bg-white rounded-lg shadow-md p-6">
                <div className="flex items-center justify-between mb-6">
                  <div className="flex items-center space-x-3">
                    <span className="text-3xl">{selectedPlatformData.icon}</span>
                    <div>
                      <h2 className="text-2xl font-bold text-gray-900">
                        {selectedPlatformData.name}
                      </h2>
                      <p className="text-sm text-gray-500">
                        Content adaptation settings
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => saveConfiguration(selectedPlatformData.platform, getConfig(selectedPlatformData.platform))}
                    disabled={saving}
                    className="px-6 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 font-medium disabled:opacity-50"
                  >
                    {saving ? 'Saving...' : 'Save Configuration'}
                  </button>
                </div>

                {/* Platform Guidelines */}
                <div className="mb-6 p-4 bg-gray-50 rounded-lg">
                  <h3 className="font-semibold mb-3">Platform Limits</h3>
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <span className="text-gray-600">Characters:</span>
                      <span className="ml-2 font-medium">
                        {selectedPlatformData.characterLimits.max} max
                      </span>
                    </div>
                    <div>
                      <span className="text-gray-600">Hashtags:</span>
                      <span className="ml-2 font-medium">
                        {selectedPlatformData.hashtagLimits.max} max
                      </span>
                    </div>
                  </div>
                </div>

                {/* Auto-Formatting Options */}
                <div className="space-y-4 mb-6">
                  <h3 className="font-semibold text-lg">Auto-Formatting Options</h3>

                  <label className="flex items-center justify-between p-4 border rounded-lg hover:bg-gray-50 cursor-pointer">
                    <div>
                      <div className="font-medium">Auto Truncate Content</div>
                      <div className="text-sm text-gray-500">
                        Automatically truncate content that exceeds platform limits
                      </div>
                    </div>
                    <input
                      type="checkbox"
                      checked={getConfig(selectedPlatformData.platform).autoTruncate}
                      onChange={(e) =>
                        updateConfig(selectedPlatformData.platform, {
                          autoTruncate: e.target.checked,
                        })
                      }
                      className="w-5 h-5 text-blue-600 rounded"
                    />
                  </label>

                  <label className="flex items-center justify-between p-4 border rounded-lg hover:bg-gray-50 cursor-pointer">
                    <div>
                      <div className="font-medium">Auto Format Hashtags</div>
                      <div className="text-sm text-gray-500">
                        Ensure hashtags meet platform requirements (count, formatting)
                      </div>
                    </div>
                    <input
                      type="checkbox"
                      checked={getConfig(selectedPlatformData.platform).autoFormatHashtags}
                      onChange={(e) =>
                        updateConfig(selectedPlatformData.platform, {
                          autoFormatHashtags: e.target.checked,
                        })
                      }
                      className="w-5 h-5 text-blue-600 rounded"
                    />
                  </label>

                  <label className="flex items-center justify-between p-4 border rounded-lg hover:bg-gray-50 cursor-pointer">
                    <div>
                      <div className="font-medium">Preserve Links</div>
                      <div className="text-sm text-gray-500">
                        Keep URLs intact when truncating content
                      </div>
                    </div>
                    <input
                      type="checkbox"
                      checked={getConfig(selectedPlatformData.platform).preserveLinks}
                      onChange={(e) =>
                        updateConfig(selectedPlatformData.platform, {
                          preserveLinks: e.target.checked,
                        })
                      }
                      className="w-5 h-5 text-blue-600 rounded"
                    />
                  </label>
                </div>

                {/* Content Types */}
                <div className="mb-6">
                  <h3 className="font-semibold text-lg mb-3">Content Types</h3>
                  <div className="space-y-2">
                    {selectedPlatformData.contentTypes.map((contentType) => (
                      <div
                        key={contentType.type}
                        className="p-4 border rounded-lg bg-gray-50"
                      >
                        <div className="flex items-center justify-between mb-2">
                          <span className="font-medium capitalize">
                            {contentType.type}
                          </span>
                          {contentType.mediaRequired && (
                            <span className="text-xs bg-yellow-100 text-yellow-800 px-2 py-1 rounded">
                              Media Required
                            </span>
                          )}
                        </div>
                        <p className="text-sm text-gray-600 mb-2">
                          {contentType.description}
                        </p>
                        <div className="grid grid-cols-2 gap-2 text-xs">
                          <div>
                            <span className="text-gray-500">Char Limit:</span>
                            <span className="ml-2 font-medium">
                              {contentType.characterLimit}
                            </span>
                          </div>
                          <div>
                            <span className="text-gray-500">Hashtag Limit:</span>
                            <span className="ml-2 font-medium">
                              {contentType.hashtagLimit}
                            </span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Media Requirements */}
                {selectedPlatformData.mediaRequirements && (
                  <div>
                    <h3 className="font-semibold text-lg mb-3">Media Requirements</h3>
                    <div className="space-y-3">
                      {selectedPlatformData.mediaRequirements.image && (
                        <div className="p-4 border rounded-lg">
                          <div className="font-medium mb-2">Images</div>
                          <div className="text-sm text-gray-600 space-y-1">
                            <div>
                              Max Size: {(selectedPlatformData.mediaRequirements.image.maxSize / 1024 / 1024).toFixed(0)}MB
                            </div>
                            <div>
                              Formats: {selectedPlatformData.mediaRequirements.image.formats.join(', ').toUpperCase()}
                            </div>
                          </div>
                        </div>
                      )}
                      {selectedPlatformData.mediaRequirements.video && (
                        <div className="p-4 border rounded-lg">
                          <div className="font-medium mb-2">Videos</div>
                          <div className="text-sm text-gray-600 space-y-1">
                            <div>
                              Max Size: {(selectedPlatformData.mediaRequirements.video.maxSize / 1024 / 1024).toFixed(0)}MB
                            </div>
                            <div>
                              Max Duration: {selectedPlatformData.mediaRequirements.video.maxDuration}s
                            </div>
                            <div>
                              Formats: {selectedPlatformData.mediaRequirements.video.formats.join(', ').toUpperCase()}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="bg-white rounded-lg shadow-md p-12 text-center">
                <p className="text-gray-500">Select a platform to configure</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

