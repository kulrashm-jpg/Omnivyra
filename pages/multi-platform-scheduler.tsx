import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Dropdown } from '@/components/ui/dropdown';
import {
  Calendar,
  Clock,
  Send,
  AlertCircle,
  CheckCircle,
  Plus,
  Settings,
  Sparkles,
  Eye,
  Lightbulb,
  Zap,
  Rocket,
  Users, // LinkedIn
  Hash, // Twitter
  Image, // Instagram
  Video, // YouTube
  Facebook,
  Brain,
  ArrowRight,
  Save,
  Edit3,
  Trash2,
  Play,
  Pause,
  RotateCcw,
  ExternalLink
} from 'lucide-react';

interface ContentDraft {
  id: string;
  title: string;
  content: string;
  hashtags: string[];
  media: {
    type: 'image' | 'video' | 'audio';
    url: string;
    alt?: string;
  }[];
  topics: string[];
  created_at: string;
}

interface PlatformContent {
  platform: string;
  contentType: string;
  content: string;
  hashtags: string[];
  media: any[];
  scheduledFor: string;
  status: 'draft' | 'scheduled' | 'published';
}

interface SchedulingRule {
  platform: string;
  contentType: string;
  preferredTime: string;
  gapDays: number;
  enabled: boolean;
}

export default function MultiPlatformScheduler() {
  const router = useRouter();
  const [selectedDraft, setSelectedDraft] = useState<ContentDraft | null>(null);
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>([]);
  const [platformContents, setPlatformContents] = useState<Record<string, PlatformContent>>({});
  const [schedulingRules, setSchedulingRules] = useState<SchedulingRule[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [showPreview, setShowPreview] = useState<string | null>(null);

  // Mock content drafts
  const contentDrafts: ContentDraft[] = [
    {
      id: '1',
      title: 'DrishiQ - AI for Healthcare',
      content: 'Revolutionizing healthcare with AI-powered solutions that improve patient outcomes and streamline medical processes.',
      hashtags: ['AI', 'Healthcare', 'Innovation', 'Technology'],
      media: [
        {
          type: 'image',
          url: 'https://images.unsplash.com/photo-1559757148-5c350d0d3c56?w=500',
          alt: 'AI in Healthcare'
        }
      ],
      topics: ['AI', 'Healthcare', 'Innovation'],
      created_at: '2024-01-15T10:00:00Z'
    },
    {
      id: '2',
      title: 'Machine Learning in Medical Diagnosis',
      content: 'How machine learning algorithms are transforming medical diagnosis and improving accuracy in healthcare.',
      hashtags: ['MachineLearning', 'MedicalDiagnosis', 'Healthcare', 'AI'],
      media: [
        {
          type: 'image',
          url: 'https://images.unsplash.com/photo-1576091160399-112ba8d25d1f?w=500',
          alt: 'Medical Diagnosis AI'
        }
      ],
      topics: ['Machine Learning', 'Medical', 'AI'],
      created_at: '2024-01-14T15:30:00Z'
    }
  ];

  const platforms = [
    { key: 'linkedin', name: 'LinkedIn', icon: <Users className="h-5 w-5" />, color: 'blue' },
    { key: 'twitter', name: 'Twitter', icon: <Hash className="h-5 w-5" />, color: 'sky' },
    { key: 'instagram', name: 'Instagram', icon: <Image className="h-5 w-5" />, color: 'pink' },
    { key: 'youtube', name: 'YouTube', icon: <Video className="h-5 w-5" />, color: 'red' },
    { key: 'facebook', name: 'Facebook', icon: <Facebook className="h-5 w-5" />, color: 'indigo' }
  ];

  const contentTypes = {
    linkedin: ['post', 'article', 'video', 'audio_event'],
    twitter: ['tweet', 'thread', 'video'],
    instagram: ['feed_post', 'story', 'reel', 'igtv'],
    youtube: ['video', 'short', 'live'],
    facebook: ['post', 'story', 'video', 'event']
  };

  const platformLimits = {
    linkedin: { content: 3000, hashtags: 5, media: 9 },
    twitter: { content: 280, hashtags: 2, media: 4 },
    instagram: { content: 2200, hashtags: 30, media: 10 },
    youtube: { content: 5000, hashtags: 15, media: 1 },
    facebook: { content: 63206, hashtags: 30, media: 12 }
  };

  useEffect(() => {
    // Initialize scheduling rules
    const defaultRules: SchedulingRule[] = platforms.map(platform => ({
      platform: platform.key,
      contentType: contentTypes[platform.key as keyof typeof contentTypes][0],
      preferredTime: '09:00',
      gapDays: 1,
      enabled: true
    }));
    setSchedulingRules(defaultRules);
  }, []);

  const handleDraftSelect = (draft: ContentDraft) => {
    setSelectedDraft(draft);
    // Auto-adapt content for selected platforms
    adaptContentForPlatforms(draft, selectedPlatforms);
  };

  const handlePlatformToggle = (platform: string) => {
    const newSelectedPlatforms = selectedPlatforms.includes(platform)
      ? selectedPlatforms.filter(p => p !== platform)
      : [...selectedPlatforms, platform];
    
    setSelectedPlatforms(newSelectedPlatforms);
    
    if (selectedDraft) {
      adaptContentForPlatforms(selectedDraft, newSelectedPlatforms);
    }
  };

  const adaptContentForPlatforms = (draft: ContentDraft, platforms: string[]) => {
    const adapted: Record<string, PlatformContent> = {};
    
    platforms.forEach(platform => {
      const limits = platformLimits[platform as keyof typeof platformLimits];
      const contentType = contentTypes[platform as keyof typeof contentTypes][0];
      
      // Adapt content length
      let adaptedContent = draft.content;
      if (adaptedContent.length > limits.content) {
        adaptedContent = adaptedContent.substring(0, limits.content - 3) + '...';
      }
      
      // Adapt hashtags
      const adaptedHashtags = draft.hashtags.slice(0, limits.hashtags);
      
      // Adapt media
      const adaptedMedia = draft.media.slice(0, limits.media);
      
      adapted[platform] = {
        platform,
        contentType,
        content: adaptedContent,
        hashtags: adaptedHashtags,
        media: adaptedMedia,
        scheduledFor: new Date().toISOString(),
        status: 'draft'
      };
    });
    
    setPlatformContents(adapted);
  };

  const handleContentChange = (platform: string, field: string, value: any) => {
    setPlatformContents(prev => ({
      ...prev,
      [platform]: {
        ...prev[platform],
        [field]: value
      }
    }));
  };

  const generateAIContent = async (platform: string) => {
    setIsGenerating(true);
    // Mock AI content generation
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    const limits = platformLimits[platform as keyof typeof platformLimits];
    const aiContent = `AI-generated content for ${platform}: ${selectedDraft?.content.substring(0, 100)}...`;
    
    handleContentChange(platform, 'content', aiContent);
    setIsGenerating(false);
  };

  const schedulePosts = async () => {
    // Mock scheduling
    console.log('Scheduling posts:', platformContents);
    alert('Posts scheduled successfully!');
  };

  const getPlatformIcon = (platform: string) => {
    const platformData = platforms.find(p => p.key === platform);
    return platformData?.icon || <Sparkles className="h-4 w-4" />;
  };

  const getPlatformColor = (platform: string) => {
    const platformData = platforms.find(p => p.key === platform);
    return platformData?.color || 'gray';
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 text-white p-8">
      <Card className="bg-gradient-to-br from-gray-800/50 to-black/50 border-white/10 shadow-lg backdrop-blur-xl mb-8">
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="p-3 bg-gradient-to-br from-purple-500 to-pink-500 rounded-xl">
                <Rocket className="h-6 w-6 text-white" />
              </div>
              <div>
                <div className="text-2xl font-bold">Multi-Platform Scheduler</div>
                <div className="text-sm opacity-90">Schedule content across all platforms with intelligent adaptation</div>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Button
                onClick={() => router.push('/ai-content-generator')}
                className="bg-white/20 border-white/20 text-white hover:bg-white/30"
              >
                <Brain className="h-4 w-4 mr-2" />
                AI Generate
              </Button>
              <Button
                onClick={() => router.push('/calendar-view')}
                className="bg-white/20 border-white/20 text-white hover:bg-white/30"
              >
                <Calendar className="h-4 w-4 mr-2" />
                Calendar View
              </Button>
            </div>
          </CardTitle>
        </CardHeader>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Left Side - Content Selection & Platform Selection */}
        <div className="space-y-6">
          {/* Content Draft Selection */}
          <Card className="bg-gradient-to-br from-gray-800/50 to-black/50 border-white/10 shadow-lg backdrop-blur-xl">
            <CardHeader>
              <CardTitle className="text-xl">Select Content to Schedule</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {contentDrafts.map(draft => (
                  <div
                    key={draft.id}
                    className={`p-4 rounded-lg border cursor-pointer transition-all duration-300 ${
                      selectedDraft?.id === draft.id
                        ? 'bg-purple-500/20 border-purple-500/50'
                        : 'bg-white/5 border-white/10 hover:bg-white/10'
                    }`}
                    onClick={() => handleDraftSelect(draft)}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <h3 className="font-semibold mb-2">{draft.title}</h3>
                        <p className="text-sm text-gray-400 mb-2 line-clamp-2">{draft.content}</p>
                        <div className="flex flex-wrap gap-1">
                          {draft.hashtags.map(hashtag => (
                            <Badge key={hashtag} variant="outline" className="text-xs">
                              #{hashtag}
                            </Badge>
                          ))}
                        </div>
                      </div>
                      {selectedDraft?.id === draft.id && (
                        <CheckCircle className="h-5 w-5 text-purple-400 ml-2" />
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Platform Selection */}
          <Card className="bg-gradient-to-br from-gray-800/50 to-black/50 border-white/10 shadow-lg backdrop-blur-xl">
            <CardHeader>
              <CardTitle className="text-xl">Select Platforms</CardTitle>
              <p className="text-sm text-gray-400">Choose which platforms to schedule content on</p>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-3">
                {platforms.map(platform => (
                  <div
                    key={platform.key}
                    className={`p-3 rounded-lg border cursor-pointer transition-all duration-300 ${
                      selectedPlatforms.includes(platform.key)
                        ? `bg-${platform.color}-500/20 border-${platform.color}-500/50`
                        : 'bg-white/5 border-white/10 hover:bg-white/10'
                    }`}
                    onClick={() => handlePlatformToggle(platform.key)}
                  >
                    <div className="flex items-center gap-3">
                      {platform.icon}
                      <span className="font-medium">{platform.name}</span>
                      {selectedPlatforms.includes(platform.key) && (
                        <CheckCircle className="h-4 w-4 text-green-400 ml-auto" />
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Right Side - Platform-Specific Forms */}
        <div className="space-y-6">
          {selectedDraft && selectedPlatforms.length > 0 ? (
            <div className="space-y-4">
              {selectedPlatforms.map(platform => (
                <Card key={platform} className="bg-gradient-to-br from-gray-800/50 to-black/50 border-white/10 shadow-lg backdrop-blur-xl">
                  <CardHeader>
                    <CardTitle className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        {getPlatformIcon(platform)}
                        <span className="text-lg">{platforms.find(p => p.key === platform)?.name}</span>
                        <Badge variant="secondary" className="bg-purple-500/20 text-purple-300">
                          {platformContents[platform]?.contentType || 'post'}
                        </Badge>
                      </div>
                      <div className="flex gap-2">
                        <Button
                          onClick={() => generateAIContent(platform)}
                          disabled={isGenerating}
                          size="sm"
                          className="bg-white/10 border-white/20 text-white hover:bg-white/20"
                        >
                          {isGenerating ? (
                            <RotateCcw className="h-4 w-4 animate-spin" />
                          ) : (
                            <Brain className="h-4 w-4" />
                          )}
                        </Button>
                        <Button
                          onClick={() => setShowPreview(showPreview === platform ? null : platform)}
                          size="sm"
                          className="bg-white/10 border-white/20 text-white hover:bg-white/20"
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                      </div>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {/* Content Type Selection */}
                    <div>
                      <label className="block text-sm font-medium text-gray-300 mb-2">Content Type</label>
                      <select
                        value={platformContents[platform]?.contentType || ''}
                        onChange={(e) => handleContentChange(platform, 'contentType', e.target.value)}
                        className="w-full p-2 bg-white/5 border border-white/10 rounded-lg text-white"
                      >
                        {contentTypes[platform as keyof typeof contentTypes].map(type => (
                          <option key={type} value={type}>{type.replace('_', ' ').toUpperCase()}</option>
                        ))}
                      </select>
                    </div>

                    {/* Content */}
                    <div>
                      <label className="block text-sm font-medium text-gray-300 mb-2">
                        Content ({platformContents[platform]?.content?.length || 0}/{platformLimits[platform as keyof typeof platformLimits].content})
                      </label>
                      <Textarea
                        value={platformContents[platform]?.content || ''}
                        onChange={(e) => handleContentChange(platform, 'content', e.target.value)}
                        className="w-full p-3 bg-white/5 border border-white/10 rounded-lg text-white"
                        rows={4}
                      />
                    </div>

                    {/* Hashtags */}
                    <div>
                      <label className="block text-sm font-medium text-gray-300 mb-2">
                        Hashtags ({platformContents[platform]?.hashtags?.length || 0}/{platformLimits[platform as keyof typeof platformLimits].hashtags})
                      </label>
                      <Input
                        value={platformContents[platform]?.hashtags?.join(' ') || ''}
                        onChange={(e) => handleContentChange(platform, 'hashtags', e.target.value.split(' ').filter(Boolean))}
                        className="w-full p-3 bg-white/5 border border-white/10 rounded-lg text-white"
                        placeholder="Enter hashtags separated by spaces"
                      />
                    </div>

                    {/* Scheduling */}
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-300 mb-2">Date</label>
                        <Input
                          type="date"
                          value={platformContents[platform]?.scheduledFor ? new Date(platformContents[platform].scheduledFor).toISOString().split('T')[0] : ''}
                          onChange={(e) => handleContentChange(platform, 'scheduledFor', new Date(e.target.value).toISOString())}
                          className="w-full p-2 bg-white/5 border border-white/10 rounded-lg text-white"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-300 mb-2">Time</label>
                        <Input
                          type="time"
                          value={platformContents[platform]?.scheduledFor ? new Date(platformContents[platform].scheduledFor).toTimeString().slice(0, 5) : ''}
                          onChange={(e) => {
                            const date = new Date(platformContents[platform]?.scheduledFor || new Date());
                            const [hours, minutes] = e.target.value.split(':');
                            date.setHours(parseInt(hours), parseInt(minutes));
                            handleContentChange(platform, 'scheduledFor', date.toISOString());
                          }}
                          className="w-full p-2 bg-white/5 border border-white/10 rounded-lg text-white"
                        />
                      </div>
                    </div>

                    {/* Preview */}
                    {showPreview === platform && (
                      <div className="mt-4 p-4 bg-white/5 rounded-lg border border-white/10">
                        <h4 className="font-medium mb-2">Preview</h4>
                        <div className="text-sm text-gray-300">
                          <p>{platformContents[platform]?.content}</p>
                          {platformContents[platform]?.hashtags && (
                            <div className="mt-2">
                              {platformContents[platform].hashtags.map(hashtag => (
                                <span key={hashtag} className="text-blue-400">#{hashtag} </span>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}

              {/* Schedule Button */}
              <Card className="bg-gradient-to-br from-gray-800/50 to-black/50 border-white/10 shadow-lg backdrop-blur-xl">
                <CardContent className="p-6">
                  <Button
                    onClick={schedulePosts}
                    className="w-full bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 text-lg py-3"
                  >
                    <Calendar className="h-5 w-5 mr-2" />
                    Schedule All Posts
                  </Button>
                </CardContent>
              </Card>
            </div>
          ) : (
            <Card className="bg-gradient-to-br from-gray-800/50 to-black/50 border-white/10 shadow-lg backdrop-blur-xl">
              <CardContent className="p-8 text-center">
                <Rocket className="h-12 w-12 mx-auto mb-4 text-gray-400" />
                <h3 className="text-lg font-semibold mb-2">Select Content and Platforms</h3>
                <p className="text-gray-400">Choose content from the left and select platforms to see scheduling options</p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}