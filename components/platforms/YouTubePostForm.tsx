// YouTube-Specific Post Creation Form
import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Calendar,
  Send,
  X,
  Video,
  Hash,
  AlertCircle,
  CheckCircle,
  Upload,
  Link,
  BarChart3,
  Target,
  Clock,
  Plus,
  Trash2,
  Play,
  Users,
  Eye,
  ThumbsUp,
  MessageCircle,
  Settings,
  Tag,
  Globe,
} from 'lucide-react';

interface YouTubeFormData {
  contentType: 'video' | 'short' | 'live' | 'premiere';
  title: string;
  description: string;
  hashtags: string[];
  mediaUrls: string[];
  scheduledFor: string;
  // YouTube-specific fields
  thumbnail?: string;
  category?: string;
  tags?: string[];
  visibility?: 'public' | 'unlisted' | 'private';
  ageRestriction?: boolean;
  commentsEnabled?: boolean;
  liveStreamTitle?: string;
  liveStreamDescription?: string;
  premiereDate?: string;
  videoDuration?: number; // minutes
  shortDuration?: number; // seconds
}

export default function YouTubePostForm({ onClose, onSave }: { onClose: () => void; onSave: (post: any) => void }) {
  const [formData, setFormData] = useState<YouTubeFormData>({
    contentType: 'video',
    title: '',
    description: '',
    hashtags: [],
    mediaUrls: [],
    scheduledFor: new Date(Date.now() + 60 * 60 * 1000).toISOString().slice(0, 16),
    tags: [],
    visibility: 'public',
    ageRestriction: false,
    commentsEnabled: true,
  });

  const [hashtagInput, setHashtagInput] = useState('');
  const [tagInput, setTagInput] = useState('');
  const [isValidating, setIsValidating] = useState(false);
  const [validation, setValidation] = useState<any>(null);

  const contentTypes = [
    { id: 'video', label: 'Video', icon: <Video className="h-4 w-4" />, maxChars: 100, description: 'Regular YouTube video content' },
    { id: 'short', label: 'Short', icon: <Play className="h-4 w-4" />, maxChars: 100, description: 'Vertical short-form content (60s max)' },
    { id: 'live', label: 'Live Stream', icon: <Users className="h-4 w-4" />, maxChars: 100, description: 'Live streaming content' },
    { id: 'premiere', label: 'Premiere', icon: <Clock className="h-4 w-4" />, maxChars: 100, description: 'Scheduled video premiere' },
  ];

  const categories = [
    'Film & Animation', 'Autos & Vehicles', 'Music', 'Pets & Animals',
    'Sports', 'Travel & Events', 'Gaming', 'People & Blogs',
    'Comedy', 'Entertainment', 'News & Politics', 'Howto & Style',
    'Education', 'Science & Technology', 'Nonprofits & Activism'
  ];

  const selectedContentType = contentTypes.find(ct => ct.id === formData.contentType);

  const handleContentTypeChange = (contentType: YouTubeFormData['contentType']) => {
    setFormData(prev => ({ ...prev, contentType }));
  };

  const handleTitleChange = (title: string) => {
    setFormData(prev => ({ ...prev, title }));
  };

  const handleDescriptionChange = (description: string) => {
    setFormData(prev => ({ ...prev, description }));
  };

  const handleHashtagAdd = () => {
    if (hashtagInput.trim() && formData.hashtags.length < 15) {
      const hashtag = hashtagInput.trim().startsWith('#') ? hashtagInput.trim() : `#${hashtagInput.trim()}`;
      if (!formData.hashtags.includes(hashtag)) {
        setFormData(prev => ({
          ...prev,
          hashtags: [...prev.hashtags, hashtag],
        }));
        setHashtagInput('');
      }
    }
  };

  const handleHashtagRemove = (hashtag: string) => {
    setFormData(prev => ({
      ...prev,
      hashtags: prev.hashtags.filter(h => h !== hashtag),
    }));
  };

  const handleTagAdd = () => {
    if (tagInput.trim() && formData.tags && formData.tags.length < 15) {
      const tag = tagInput.trim();
      if (!formData.tags.includes(tag)) {
        setFormData(prev => ({
          ...prev,
          tags: [...(prev.tags || []), tag],
        }));
        setTagInput('');
      }
    }
  };

  const handleTagRemove = (tag: string) => {
    setFormData(prev => ({
      ...prev,
      tags: prev.tags?.filter(t => t !== tag) || [],
    }));
  };

  const validateContent = async () => {
    setIsValidating(true);
    try {
      const response = await fetch('/api/validate/content', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          platform: 'youtube',
          contentType: formData.contentType,
          title: formData.title,
          description: formData.description,
          hashtags: formData.hashtags,
          mediaUrls: formData.mediaUrls,
          ...formData,
        }),
      });
      const data = await response.json();
      setValidation(data.data);
    } catch (error) {
      console.error('Validation error:', error);
    } finally {
      setIsValidating(false);
    }
  };

  const handleSave = async () => {
    if (!validation || !validation.valid) {
      await validateContent();
      return;
    }

    try {
      const response = await fetch('/api/schedule/posts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          platform: 'youtube',
          contentType: formData.contentType,
          title: formData.title,
          description: formData.description,
          hashtags: formData.hashtags,
          mediaUrls: formData.mediaUrls,
          scheduledFor: formData.scheduledFor,
          ...formData,
        }),
      });
      const data = await response.json();
      
      if (data.success) {
        onSave(data.data);
        onClose();
      } else {
        alert(`Failed to schedule post: ${data.error}`);
      }
    } catch (error) {
      console.error('Error scheduling post:', error);
      alert('Failed to schedule post');
    }
  };

  const titleCount = formData.title.length;
  const titleLimit = 100;
  const isTitleOverLimit = titleCount > titleLimit;

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <Card className="w-full max-w-4xl max-h-[90vh] overflow-y-auto bg-gradient-to-br from-red-800/50 to-red-900/50 border-red-500/20 shadow-lg backdrop-blur-xl">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-red-500 rounded-lg">
                <Video className="h-6 w-6 text-white" />
              </div>
              <div>
                <CardTitle className="text-2xl font-bold text-white">YouTube Video Creator</CardTitle>
                <p className="text-red-200 text-sm">Video content and live streaming</p>
              </div>
            </div>
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
          {/* Content Type Selection */}
          <div className="space-y-3">
            <label className="block text-sm font-medium text-red-200">Content Type</label>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {contentTypes.map((type) => (
                <button
                  key={type.id}
                  onClick={() => handleContentTypeChange(type.id as YouTubeFormData['contentType'])}
                  className={`p-4 rounded-xl border transition-all duration-300 text-left ${
                    formData.contentType === type.id
                      ? 'bg-red-500/20 border-red-400 shadow-lg shadow-red-500/25'
                      : 'bg-white/5 border-white/10 hover:bg-white/10'
                  }`}
                >
                  <div className="flex items-center gap-3 mb-2">
                    {type.icon}
                    <span className="font-semibold text-white">{type.label}</span>
                    {formData.contentType === type.id && <CheckCircle className="h-4 w-4 text-red-400 ml-auto" />}
                  </div>
                  <p className="text-xs text-gray-400">{type.description}</p>
                  <div className="mt-2 text-xs text-red-300">
                    Max: {type.maxChars} characters
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Video Upload */}
          <div className="space-y-3">
            <label className="block text-sm font-medium text-red-200">Video Upload</label>
            <div className="flex items-center gap-3">
              <Button className="bg-red-500 hover:bg-red-600 text-white">
                <Upload className="h-4 w-4 mr-2" />
                Upload Video
              </Button>
              <span className="text-xs text-red-300">
                {formData.contentType === 'short' 
                  ? 'MP4, up to 1GB, 60s max, 1080x1920px' 
                  : formData.contentType === 'live'
                  ? 'Live streaming setup required'
                  : 'MP4, up to 256GB, 12h max, 1080p+ recommended'
                }
              </span>
            </div>
          </div>

          {/* Title */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="block text-sm font-medium text-red-200">Title</label>
              <span className={`text-sm ${isTitleOverLimit ? 'text-red-400' : 'text-red-300'}`}>
                {titleCount}/{titleLimit}
              </span>
            </div>
            <input
              type="text"
              value={formData.title}
              onChange={(e) => handleTitleChange(e.target.value)}
              placeholder="Enter video title..."
              className="w-full bg-white/5 border-white/10 text-white placeholder-gray-500 focus:ring-red-500 focus:border-red-500 rounded-lg px-3 py-2"
            />
            {isTitleOverLimit && (
              <p className="text-red-400 text-sm">
                Title exceeds character limit by {titleCount - titleLimit} characters
              </p>
            )}
          </div>

          {/* Description */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="block text-sm font-medium text-red-200">Description</label>
              <div className="flex items-center gap-2">
                <span className="text-sm text-red-300">
                  {formData.description.length}/5,000
                </span>
                <Button
                  onClick={validateContent}
                  disabled={isValidating}
                  size="sm"
                  variant="outline"
                  className="border-red-400/50 text-red-300 hover:bg-red-500/20"
                >
                  {isValidating ? (
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-red-400"></div>
                  ) : (
                    <CheckCircle className="h-4 w-4" />
                  )}
                  Validate
                </Button>
              </div>
            </div>
            <textarea
              value={formData.description}
              onChange={(e) => handleDescriptionChange(e.target.value)}
              placeholder="Describe your video..."
              className="w-full h-32 bg-white/5 border-white/10 text-white placeholder-gray-500 focus:ring-red-500 focus:border-red-500 rounded-lg p-3 resize-none"
            />
          </div>

          {/* Category and Settings */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-3">
              <label className="block text-sm font-medium text-red-200">Category</label>
              <select
                value={formData.category || ''}
                onChange={(e) => setFormData(prev => ({ ...prev, category: e.target.value }))}
                className="w-full bg-white/5 border-white/10 text-white focus:ring-red-500 focus:border-red-500 rounded-lg px-3 py-2"
              >
                <option value="">Select Category</option>
                {categories.map((category) => (
                  <option key={category} value={category}>{category}</option>
                ))}
              </select>
            </div>
            <div className="space-y-3">
              <label className="block text-sm font-medium text-red-200">Visibility</label>
              <select
                value={formData.visibility}
                onChange={(e) => setFormData(prev => ({ ...prev, visibility: e.target.value as 'public' | 'unlisted' | 'private' }))}
                className="w-full bg-white/5 border-white/10 text-white focus:ring-red-500 focus:border-red-500 rounded-lg px-3 py-2"
              >
                <option value="public">Public</option>
                <option value="unlisted">Unlisted</option>
                <option value="private">Private</option>
              </select>
            </div>
          </div>

          {/* Tags */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="block text-sm font-medium text-red-200">
                Tags ({formData.tags?.length || 0}/15)
              </label>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && (e.preventDefault(), handleTagAdd())}
                placeholder="Add tag..."
                className="flex-1 bg-white/5 border-white/10 text-white placeholder-gray-500 focus:ring-red-500 focus:border-red-500 rounded-lg px-3 py-2"
              />
              <Button
                onClick={handleTagAdd}
                disabled={!tagInput.trim() || (formData.tags?.length || 0) >= 15}
                size="sm"
                className="bg-red-500 hover:bg-red-600 text-white"
              >
                Add
              </Button>
            </div>
            {formData.tags && formData.tags.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {formData.tags.map((tag) => (
                  <Badge
                    key={tag}
                    variant="secondary"
                    className="bg-red-500/20 text-red-300 hover:bg-red-500/30 cursor-pointer"
                    onClick={() => handleTagRemove(tag)}
                  >
                    {tag} ×
                  </Badge>
                ))}
              </div>
            )}
          </div>

          {/* Hashtags */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="block text-sm font-medium text-red-200">
                Hashtags ({formData.hashtags.length}/15)
              </label>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={hashtagInput}
                onChange={(e) => setHashtagInput(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && (e.preventDefault(), handleHashtagAdd())}
                placeholder="Add hashtag..."
                className="flex-1 bg-white/5 border-white/10 text-white placeholder-gray-500 focus:ring-red-500 focus:border-red-500 rounded-lg px-3 py-2"
              />
              <Button
                onClick={handleHashtagAdd}
                disabled={!hashtagInput.trim() || formData.hashtags.length >= 15}
                size="sm"
                className="bg-red-500 hover:bg-red-600 text-white"
              >
                Add
              </Button>
            </div>
            {formData.hashtags.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {formData.hashtags.map((hashtag) => (
                  <Badge
                    key={hashtag}
                    variant="secondary"
                    className="bg-red-500/20 text-red-300 hover:bg-red-500/30 cursor-pointer"
                    onClick={() => handleHashtagRemove(hashtag)}
                  >
                    {hashtag} ×
                  </Badge>
                ))}
              </div>
            )}
          </div>

          {/* Additional Settings */}
          <div className="space-y-3">
            <label className="block text-sm font-medium text-red-200">Additional Settings</label>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-red-200">Age Restriction</span>
                <input
                  type="checkbox"
                  checked={formData.ageRestriction}
                  onChange={(e) => setFormData(prev => ({ ...prev, ageRestriction: e.target.checked }))}
                  className="rounded border-white/20 bg-white/5 text-red-500 focus:ring-red-500"
                />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-red-200">Enable Comments</span>
                <input
                  type="checkbox"
                  checked={formData.commentsEnabled}
                  onChange={(e) => setFormData(prev => ({ ...prev, commentsEnabled: e.target.checked }))}
                  className="rounded border-white/20 bg-white/5 text-red-500 focus:ring-red-500"
                />
              </div>
            </div>
          </div>

          {/* Scheduling */}
          <div className="space-y-3">
            <label className="block text-sm font-medium text-red-200">Schedule For</label>
            <div className="flex items-center gap-3">
              <Calendar className="h-5 w-5 text-red-400" />
              <input
                type="datetime-local"
                value={formData.scheduledFor}
                onChange={(e) => setFormData(prev => ({ ...prev, scheduledFor: e.target.value }))}
                className="bg-white/5 border-white/10 text-white focus:ring-red-500 focus:border-red-500 rounded-lg px-3 py-2"
              />
            </div>
          </div>

          {/* Validation Results */}
          {validation && (
            <div className="space-y-3">
              <div className={`p-4 rounded-lg border ${
                validation.valid ? 'bg-green-500/20 border-green-500/30' : 'bg-red-500/20 border-red-500/30'
              }`}>
                <div className="flex items-center gap-2 mb-2">
                  {validation.valid ? (
                    <CheckCircle className="h-5 w-5 text-green-400" />
                  ) : (
                    <AlertCircle className="h-5 w-5 text-red-400" />
                  )}
                  <span className={`font-semibold ${validation.valid ? 'text-green-400' : 'text-red-400'}`}>
                    {validation.valid ? 'Content is valid' : 'Content has issues'}
                  </span>
                </div>
                {validation.errors.length > 0 && (
                  <ul className="text-sm text-red-300 space-y-1">
                    {validation.errors.map((error: string, index: number) => (
                      <li key={index}>• {error}</li>
                    ))}
                  </ul>
                )}
                {validation.warnings.length > 0 && (
                  <ul className="text-sm text-yellow-300 space-y-1">
                    {validation.warnings.map((warning: string, index: number) => (
                      <li key={index}>• {warning}</li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center justify-end gap-3 pt-4 border-t border-white/10">
            <Button
              onClick={onClose}
              variant="outline"
              className="border-white/20 text-white hover:bg-white/10"
            >
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={!formData.title.trim() || isTitleOverLimit}
              className="bg-gradient-to-r from-red-500 to-red-600 hover:from-red-600 hover:to-red-700 text-white border-0 shadow-lg shadow-red-500/25"
            >
              <Send className="h-4 w-4 mr-2" />
              Schedule YouTube Video
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
