import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { 
  FileText, 
  Image, 
  Video, 
  Mic, 
  Hash, 
  Clock, 
  TrendingUp, 
  Target, 
  CheckCircle, 
  AlertCircle,
  Lightbulb,
  BarChart3,
  Calendar,
  Upload,
  Link,
  Users,
  Eye,
  Heart,
  MessageCircle,
  Share
} from 'lucide-react';
import { getPlatformGuidelines, type PlatformContentGuidelines } from '@/lib/platform-guidelines';

type PlatformRulesResponse = {
  platform: { canonical_key: string; name: string };
  content_rules: Array<{
    content_type: string;
    max_characters: number | null;
    max_words: number | null;
    media_format: string | null;
    supports_hashtags: boolean;
    supports_mentions: boolean;
    supports_links: boolean;
    formatting_rules: any;
  }>;
};

type ValidationResult = {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  score: number;
};

interface PlatformContentFormProps {
  platform: string;
  onContentChange: (content: any) => void;
  initialContent?: any;
}

export default function PlatformContentForm({ 
  platform, 
  onContentChange, 
  initialContent 
}: PlatformContentFormProps) {
  const [selectedContentType, setSelectedContentType] = useState<string>('');
  const [content, setContent] = useState<string>('');
  const [hashtags, setHashtags] = useState<string[]>([]);
  const [newHashtag, setNewHashtag] = useState<string>('');
  const [mediaType, setMediaType] = useState<'none' | 'image' | 'video' | 'audio'>('none');
  const [mediaFile, setMediaFile] = useState<File | null>(null);
  const [scheduledTime, setScheduledTime] = useState<string>('');
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [showGuidelines, setShowGuidelines] = useState<boolean>(false);
  const [platformRules, setPlatformRules] = useState<PlatformRulesResponse | null>(null);

  const fallbackPlatformKey = platform === 'x' ? 'twitter' : platform;
  const fallbackGuidelines: PlatformContentGuidelines = getPlatformGuidelines(fallbackPlatformKey);

  const guidelines: PlatformContentGuidelines = React.useMemo(() => {
    if (!platformRules?.content_rules?.length) return fallbackGuidelines;
    const contentTypes = platformRules.content_rules
      .map((rule) => {
        const type = String(rule.content_type || '').trim();
        if (!type) return null;
        const maxChars = typeof rule.max_characters === 'number' ? rule.max_characters : 280;
        const hashtagLimit =
          typeof rule.formatting_rules?.hashtag_limit === 'number'
            ? rule.formatting_rules.hashtag_limit
            : rule.supports_hashtags
              ? 10
              : 0;
        const mediaRequired = rule.media_format && rule.media_format !== 'text';
        return {
          type,
          name: type.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase()),
          description: 'Database-driven content type rule',
          characterLimit: maxChars,
          hashtagLimit,
          mediaRequired,
          marketingTips: [],
        };
      })
      .filter(Boolean) as any[];

    const suggestedTimes = Array.from(
      new Set(
        platformRules.content_rules
          .flatMap((r) => (Array.isArray(r?.formatting_rules?.suggested_times) ? r.formatting_rules.suggested_times : []))
          .map((t) => String(t || '').trim())
          .filter(Boolean)
      )
    );

    return {
      platform,
      contentTypes: contentTypes.length > 0 ? contentTypes : fallbackGuidelines.contentTypes,
      hashtagLimits: fallbackGuidelines.hashtagLimits,
      characterLimits: fallbackGuidelines.characterLimits,
      mediaRequirements: fallbackGuidelines.mediaRequirements,
      postingTimes: suggestedTimes.length > 0 ? suggestedTimes.map((t) => `Suggested: ${t}`) : fallbackGuidelines.postingTimes,
      engagementTips: fallbackGuidelines.engagementTips,
      algorithmPreferences: fallbackGuidelines.algorithmPreferences,
    };
  }, [platformRules, fallbackGuidelines, platform]);

  const contentTypeGuidelines = React.useMemo(() => {
    return guidelines.contentTypes.find((t) => t.type === selectedContentType) || null;
  }, [guidelines, selectedContentType]);

  useEffect(() => {
    let cancelled = false;
    const loadRules = async () => {
      try {
        const response = await fetch(`/api/platform-intelligence/rules?platformKey=${encodeURIComponent(platform)}`);
        if (!response.ok) {
          if (!cancelled) setPlatformRules(null);
          return;
        }
        const data = (await response.json().catch(() => null)) as PlatformRulesResponse | null;
        if (!cancelled) setPlatformRules(data);
      } catch {
        if (!cancelled) setPlatformRules(null);
      }
    };
    loadRules();
    return () => {
      cancelled = true;
    };
  }, [platform]);

  // Initialize with default content type
  useEffect(() => {
    if (guidelines.contentTypes.length > 0 && !selectedContentType) {
      setSelectedContentType(guidelines.contentTypes[0].type);
    }
  }, [guidelines, selectedContentType]);

  // Validate content whenever it changes
  useEffect(() => {
    if (selectedContentType && content) {
      const errors: string[] = [];
      const warnings: string[] = [];

      if (contentTypeGuidelines?.characterLimit && content.length > contentTypeGuidelines.characterLimit) {
        errors.push(`Content exceeds character limit of ${contentTypeGuidelines.characterLimit}`);
      } else if (contentTypeGuidelines?.characterLimit && content.length < contentTypeGuidelines.characterLimit * 0.1) {
        warnings.push('Content is very short - consider adding more detail');
      }

      if (typeof contentTypeGuidelines?.hashtagLimit === 'number' && hashtags.length > contentTypeGuidelines.hashtagLimit) {
        errors.push(`Too many hashtags. Maximum allowed: ${contentTypeGuidelines.hashtagLimit}`);
      }

      const score = Math.min(
        100,
        Math.max(
          0,
          (contentTypeGuidelines?.characterLimit
            ? Math.min(content.length / (contentTypeGuidelines.characterLimit * 0.3), 1) * 60
            : 30) +
            (contentTypeGuidelines?.hashtagLimit
              ? Math.min(hashtags.length / Math.max(contentTypeGuidelines.hashtagLimit, 1), 1) * 40
              : 0)
        )
      );

      setValidation({ isValid: errors.length === 0, errors, warnings, score });
    }
  }, [platform, selectedContentType, content, hashtags, contentTypeGuidelines]);

  // Notify parent component of content changes
  useEffect(() => {
    onContentChange({
      platform,
      contentType: selectedContentType,
      content,
      hashtags,
      mediaType,
      mediaFile,
      scheduledTime,
      validation
    });
  }, [platform, selectedContentType, content, hashtags, mediaType, mediaFile, scheduledTime, validation, onContentChange]);

  const handleHashtagAdd = () => {
    if (newHashtag.trim() && !hashtags.includes(newHashtag.trim())) {
      const hashtag = newHashtag.trim().startsWith('#') ? 
        newHashtag.trim() : `#${newHashtag.trim()}`;
      
      if (hashtags.length < (contentTypeGuidelines?.hashtagLimit || 30)) {
        setHashtags([...hashtags, hashtag]);
        setNewHashtag('');
      }
    }
  };

  const handleHashtagRemove = (hashtagToRemove: string) => {
    setHashtags(hashtags.filter(tag => tag !== hashtagToRemove));
  };

  const handleMediaUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      setMediaFile(file);
    }
  };

  const getCharacterCountColor = () => {
    if (!contentTypeGuidelines) return 'text-gray-500';
    
    const ratio = content.length / contentTypeGuidelines.characterLimit;
    if (ratio > 0.9) return 'text-red-500';
    if (ratio > 0.7) return 'text-yellow-500';
    return 'text-green-500';
  };

  const getScoreColor = (score: number) => {
    if (score >= 80) return 'text-green-500';
    if (score >= 60) return 'text-yellow-500';
    return 'text-red-500';
  };

  const getScoreIcon = (score: number) => {
    if (score >= 80) return <CheckCircle className="h-4 w-4" />;
    if (score >= 60) return <AlertCircle className="h-4 w-4" />;
    return <AlertCircle className="h-4 w-4" />;
  };

  return (
    <div className="space-y-6">
      {/* Platform Header */}
      <Card className="bg-gradient-to-r from-blue-500 to-purple-600 text-white">
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-white/20 rounded-lg">
                {platform === 'linkedin' && <Users className="h-6 w-6" />}
                {(platform === 'twitter' || platform === 'x') && <MessageCircle className="h-6 w-6" />}
                {platform === 'instagram' && <Image className="h-6 w-6" />}
                {platform === 'youtube' && <Video className="h-6 w-6" />}
                {platform === 'facebook' && <Users className="h-6 w-6" />}
              </div>
              <div>
                <div className="text-xl font-bold capitalize">{platform}</div>
                <div className="text-sm opacity-90">Content Creation & Marketing</div>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowGuidelines(!showGuidelines)}
              className="bg-white/10 border-white/20 text-white hover:bg-white/20"
            >
              <Lightbulb className="h-4 w-4 mr-2" />
              Guidelines
            </Button>
          </CardTitle>
        </CardHeader>
      </Card>

      {/* Content Type Selection */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Content Type
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {guidelines.contentTypes.map((type) => (
              <div
                key={type.type}
                className={`p-4 border rounded-lg cursor-pointer transition-all ${
                  selectedContentType === type.type
                    ? 'border-blue-500 bg-blue-50'
                    : 'border-gray-200 hover:border-gray-300'
                }`}
                onClick={() => setSelectedContentType(type.type)}
              >
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-semibold capitalize">{type.name}</h3>
                  <Badge variant={selectedContentType === type.type ? 'default' : 'outline'}>
                    {type.characterLimit.toLocaleString()} chars
                  </Badge>
                </div>
                <p className="text-sm text-gray-600 mb-3">{type.description}</p>
                <div className="flex items-center gap-2 text-xs text-gray-500">
                  <Hash className="h-3 w-3" />
                  {type.hashtagLimit} hashtags
                  {type.mediaRequired && (
                    <>
                      <span className="mx-1">•</span>
                      <Upload className="h-3 w-3" />
                      Media required
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Content Creation */}
      {selectedContentType && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FileText className="h-5 w-5" />
                Content
              </div>
              <div className="flex items-center gap-2">
                <span className={`text-sm font-medium ${getCharacterCountColor()}`}>
                  {content.length}/{contentTypeGuidelines?.characterLimit.toLocaleString()}
                </span>
                {validation && (
                  <div className={`flex items-center gap-1 ${getScoreColor(validation.score)}`}>
                    {getScoreIcon(validation.score)}
                    <span className="text-sm font-medium">{validation.score}/100</span>
                  </div>
                )}
              </div>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder={`Write your ${contentTypeGuidelines?.name.toLowerCase()}...`}
              className="w-full h-32 p-3 border border-gray-300 rounded-lg resize-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
            
            {/* Marketing Tips */}
            {contentTypeGuidelines && (
              <div className="bg-blue-50 p-4 rounded-lg">
                <h4 className="font-semibold text-blue-900 mb-2 flex items-center gap-2">
                  <Target className="h-4 w-4" />
                  Marketing Tips
                </h4>
                <ul className="text-sm text-blue-800 space-y-1">
                  {contentTypeGuidelines.marketingTips.map((tip, index) => (
                    <li key={index} className="flex items-start gap-2">
                      <span className="text-blue-500 mt-0.5">•</span>
                      {tip}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Validation Messages */}
            {validation && (
              <div className="space-y-2">
                {validation.errors.length > 0 && (
                  <div className="bg-red-50 p-3 rounded-lg">
                    <h4 className="font-semibold text-red-900 mb-2 flex items-center gap-2">
                      <AlertCircle className="h-4 w-4" />
                      Errors
                    </h4>
                    <ul className="text-sm text-red-800 space-y-1">
                      {validation.errors.map((error, index) => (
                        <li key={index} className="flex items-start gap-2">
                          <span className="text-red-500 mt-0.5">•</span>
                          {error}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                
                {validation.warnings.length > 0 && (
                  <div className="bg-yellow-50 p-3 rounded-lg">
                    <h4 className="font-semibold text-yellow-900 mb-2 flex items-center gap-2">
                      <AlertCircle className="h-4 w-4" />
                      Suggestions
                    </h4>
                    <ul className="text-sm text-yellow-800 space-y-1">
                      {validation.warnings.map((warning, index) => (
                        <li key={index} className="flex items-start gap-2">
                          <span className="text-yellow-500 mt-0.5">•</span>
                          {warning}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Hashtags */}
      {selectedContentType && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Hash className="h-5 w-5" />
                Hashtags
              </div>
              <Badge variant="outline">
                {hashtags.length}/{contentTypeGuidelines?.hashtagLimit}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex gap-2">
              <input
                type="text"
                value={newHashtag}
                onChange={(e) => setNewHashtag(e.target.value)}
                placeholder="Add hashtag..."
                className="flex-1 p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                onKeyPress={(e) => e.key === 'Enter' && handleHashtagAdd()}
              />
              <Button onClick={handleHashtagAdd} disabled={!newHashtag.trim()}>
                Add
              </Button>
            </div>
            
            {hashtags.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {hashtags.map((hashtag, index) => (
                  <Badge
                    key={index}
                    variant="secondary"
                    className="cursor-pointer hover:bg-red-100"
                    onClick={() => handleHashtagRemove(hashtag)}
                  >
                    {hashtag} ×
                  </Badge>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Media Upload */}
      {selectedContentType && contentTypeGuidelines?.mediaRequired && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Upload className="h-5 w-5" />
              Media Upload
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center">
              <input
                type="file"
                accept="image/*,video/*,audio/*"
                onChange={handleMediaUpload}
                className="hidden"
                id="media-upload"
              />
              <label htmlFor="media-upload" className="cursor-pointer">
                <Upload className="h-8 w-8 mx-auto mb-2 text-gray-400" />
                <p className="text-sm text-gray-600">
                  Click to upload or drag and drop
                </p>
                <p className="text-xs text-gray-500 mt-1">
                  {contentTypeGuidelines.mediaRequired ? 'Media required' : 'Media optional'}
                </p>
              </label>
            </div>
            
            {mediaFile && (
              <div className="bg-gray-50 p-3 rounded-lg">
                <p className="text-sm font-medium">{mediaFile.name}</p>
                <p className="text-xs text-gray-500">
                  {(mediaFile.size / 1024 / 1024).toFixed(2)} MB
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Scheduling */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calendar className="h-5 w-5" />
            Schedule Post
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-2">Schedule Time</label>
              <input
                type="datetime-local"
                value={scheduledTime}
                onChange={(e) => setScheduledTime(e.target.value)}
                className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-2">Optimal Times</label>
              <div className="text-sm text-gray-600 space-y-1">
                {guidelines.postingTimes.map((time, index) => (
                  <div key={index} className="flex items-center gap-2">
                    <Clock className="h-3 w-3" />
                    {time}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Platform Guidelines */}
      {showGuidelines && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BarChart3 className="h-5 w-5" />
              {platform.charAt(0).toUpperCase() + platform.slice(1)} Guidelines
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <h4 className="font-semibold mb-2 flex items-center gap-2">
                  <TrendingUp className="h-4 w-4" />
                  Algorithm Preferences
                </h4>
                <ul className="text-sm space-y-1">
                  {guidelines.algorithmPreferences.map((pref, index) => (
                    <li key={index} className="flex items-start gap-2">
                      <span className="text-blue-500 mt-0.5">•</span>
                      {pref}
                    </li>
                  ))}
                </ul>
              </div>
              
              <div>
                <h4 className="font-semibold mb-2 flex items-center gap-2">
                  <Eye className="h-4 w-4" />
                  Engagement Tips
                </h4>
                <ul className="text-sm space-y-1">
                  {guidelines.engagementTips.map((tip, index) => (
                    <li key={index} className="flex items-start gap-2">
                      <span className="text-green-500 mt-0.5">•</span>
                      {tip}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}























