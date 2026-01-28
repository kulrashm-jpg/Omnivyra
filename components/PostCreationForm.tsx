// Platform-Aware Post Creation Form Component
import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Calendar,
  Clock,
  Send,
  AlertCircle,
  CheckCircle,
  X,
  Users,
  Hash,
  Image,
  Video,
  Globe,
  Zap,
  FileText,
  Hash as HashIcon,
  Image as ImageIcon,
  Video as VideoIcon,
  Globe as GlobeIcon,
  Users as UsersIcon,
  ArrowRight,
} from 'lucide-react';

// Import platform-specific forms
import LinkedInPostForm from './platforms/LinkedInPostForm';
import TwitterPostForm from './platforms/TwitterPostForm';
import InstagramPostForm from './platforms/InstagramPostForm';
import YouTubePostForm from './platforms/YouTubePostForm';
import FacebookPostForm from './platforms/FacebookPostForm';

const platformConfigs = {
  linkedin: {
    name: 'LinkedIn',
    icon: <UsersIcon className="h-5 w-5" />,
    color: 'blue',
    maxChars: 3000,
    maxHashtags: 5,
    maxMedia: 9,
    contentTypes: ['post', 'article', 'video', 'document', 'poll'],
  },
  twitter: {
    name: 'Twitter',
    icon: <HashIcon className="h-5 w-5" />,
    color: 'sky',
    maxChars: 280,
    maxHashtags: 2,
    maxMedia: 4,
    contentTypes: ['tweet', 'thread', 'video', 'poll'],
  },
  instagram: {
    name: 'Instagram',
    icon: <ImageIcon className="h-5 w-5" />,
    color: 'pink',
    maxChars: 2200,
    maxHashtags: 30,
    maxMedia: 10,
    contentTypes: ['feed_post', 'story', 'reel', 'igtv', 'carousel'],
  },
  youtube: {
    name: 'YouTube',
    icon: <VideoIcon className="h-5 w-5" />,
    color: 'red',
    maxChars: 5000,
    maxHashtags: 15,
    maxMedia: 1,
    contentTypes: ['video', 'short', 'live'],
  },
  facebook: {
    name: 'Facebook',
    icon: <GlobeIcon className="h-5 w-5" />,
    color: 'indigo',
    maxChars: 63206,
    maxHashtags: 30,
    maxMedia: 12,
    contentTypes: ['post', 'story', 'video', 'event'],
  },
};

export default function PostCreationForm({ onClose, onSave }: { onClose: () => void; onSave: (post: any) => void }) {
  const [selectedPlatform, setSelectedPlatform] = useState<string>('');

  const handlePlatformSelect = (platform: string) => {
    setSelectedPlatform(platform);
  };

  const handleBackToSelection = () => {
    setSelectedPlatform('');
  };

  // If a platform is selected, show the platform-specific form
  if (selectedPlatform) {
    switch (selectedPlatform) {
      case 'linkedin':
        return <LinkedInPostForm onClose={onClose} onSave={onSave} />;
      case 'twitter':
        return <TwitterPostForm onClose={onClose} onSave={onSave} />;
      case 'instagram':
        return <InstagramPostForm onClose={onClose} onSave={onSave} />;
      case 'youtube':
        return <YouTubePostForm onClose={onClose} onSave={onSave} />;
      case 'facebook':
        return <FacebookPostForm onClose={onClose} onSave={onSave} />;
      default:
        return <LinkedInPostForm onClose={onClose} onSave={onSave} />;
    }
  }

  // Platform selection interface

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <Card className="w-full max-w-4xl max-h-[90vh] overflow-y-auto bg-gradient-to-br from-gray-800/50 to-black/50 border-white/10 shadow-lg backdrop-blur-xl">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-2xl font-bold text-white">Create Platform-Specific Post</CardTitle>
            <Button
              onClick={onClose}
              variant="outline"
              size="sm"
              className="border-white/20 text-white hover:bg-white/10"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Platform Selection */}
          <div className="space-y-4">
            <div className="text-center mb-6">
              <h3 className="text-lg font-semibold text-white mb-2">Choose Your Platform</h3>
              <p className="text-gray-400">Each platform has unique content formats and requirements</p>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {Object.entries(platformConfigs).map(([key, config]) => (
                <button
                  key={key}
                  onClick={() => handlePlatformSelect(key)}
                  className={`group p-6 rounded-2xl border transition-all duration-300 text-left hover:scale-105 ${
                    `bg-gradient-to-br from-${config.color}-500/10 to-${config.color}-600/10 border-${config.color}-500/20 hover:border-${config.color}-400/40`
                  }`}
                >
                  <div className="flex items-center gap-4 mb-4">
                    <div className={`p-3 rounded-xl bg-gradient-to-br from-${config.color}-500 to-${config.color}-600`}>
                    {config.icon}
                  </div>
                    <div className="flex-1">
                      <h4 className="font-bold text-white text-lg">{config.name}</h4>
                      <p className="text-gray-400 text-sm">
                        {config.maxChars.toLocaleString()} chars • {config.maxHashtags} hashtags
                      </p>
            </div>
                    <ArrowRight className="h-5 w-5 text-gray-400 group-hover:text-white transition-colors" />
          </div>

                  <div className="space-y-2">
                    <p className="text-sm text-gray-300 font-medium">Content Types:</p>
                    <div className="flex flex-wrap gap-1">
                      {config.contentTypes.map((type) => (
                        <Badge
                  key={type}
                          variant="secondary"
                          className="text-xs bg-white/10 text-gray-300"
                >
                          {type.replace('_', ' ')}
                        </Badge>
              ))}
            </div>
          </div>

                  <div className="mt-4 text-xs text-gray-400">
                    Click to open {config.name}-specific form
              </div>
                </button>
                ))}
              </div>
          </div>

          {/* Platform Features Comparison */}
          <div className="mt-8 p-6 bg-white/5 rounded-xl border border-white/10">
            <h4 className="text-lg font-semibold text-white mb-4">Platform-Specific Features</h4>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 text-sm">
              <div className="space-y-2">
                <h5 className="font-semibold text-blue-400">LinkedIn</h5>
                <ul className="text-gray-300 space-y-1">
                  <li>• Articles & Documents</li>
                  <li>• Professional Polls</li>
                  <li>• Video with descriptions</li>
                  <li>• Company page integration</li>
                </ul>
            </div>
              <div className="space-y-2">
                <h5 className="font-semibold text-sky-400">Twitter</h5>
                <ul className="text-gray-300 space-y-1">
                  <li>• Threads & Replies</li>
                  <li>• Quick Polls</li>
                  <li>• Quote Tweets</li>
                  <li>• Trending hashtags</li>
                </ul>
          </div>
              <div className="space-y-2">
                <h5 className="font-semibold text-pink-400">Instagram</h5>
                <ul className="text-gray-300 space-y-1">
                  <li>• Stories & Reels</li>
                  <li>• Carousel posts</li>
                  <li>• IGTV long-form</li>
                  <li>• Visual-first content</li>
                </ul>
                </div>
              <div className="space-y-2">
                <h5 className="font-semibold text-red-400">YouTube</h5>
                <ul className="text-gray-300 space-y-1">
                  <li>• Videos & Shorts</li>
                  <li>• Live streaming</li>
                  <li>• Premieres</li>
                  <li>• Categories & tags</li>
                  </ul>
              </div>
              <div className="space-y-2">
                <h5 className="font-semibold text-indigo-400">Facebook</h5>
                <ul className="text-gray-300 space-y-1">
                  <li>• Events & Pages</li>
                  <li>• Photo albums</li>
                  <li>• Feelings & activities</li>
                  <li>• Privacy controls</li>
                  </ul>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
