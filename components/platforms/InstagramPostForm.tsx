// Instagram-Specific Post Creation Form
import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Calendar,
  Send,
  X,
  Image,
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
  Users,
  Heart,
  MessageCircle,
} from 'lucide-react';

interface InstagramFormData {
  contentType: 'feed_post' | 'story' | 'reel' | 'igtv' | 'carousel';
  content: string;
  hashtags: string[];
  mediaUrls: string[];
  scheduledFor: string;
  // Instagram-specific fields
  location?: string;
  taggedUsers?: string[];
  altText?: string;
  storyDuration?: number; // hours
  reelMusic?: string;
  reelDuration?: number; // seconds
  carouselImages?: string[];
}

export default function InstagramPostForm({ onClose, onSave }: { onClose: () => void; onSave: (post: any) => void }) {
  const [formData, setFormData] = useState<InstagramFormData>({
    contentType: 'feed_post',
    content: '',
    hashtags: [],
    mediaUrls: [],
    scheduledFor: new Date(Date.now() + 60 * 60 * 1000).toISOString().slice(0, 16),
    taggedUsers: [],
    carouselImages: [],
  });

  const [hashtagInput, setHashtagInput] = useState('');
  const [isValidating, setIsValidating] = useState(false);
  const [validation, setValidation] = useState<any>(null);

  const contentTypes = [
    { id: 'feed_post', label: 'Feed Post', icon: <Image className="h-4 w-4" />, maxChars: 2200, description: 'Single image or video post' },
    { id: 'carousel', label: 'Carousel', icon: <Image className="h-4 w-4" />, maxChars: 2200, description: 'Multiple images/videos (2-10)' },
    { id: 'story', label: 'Story', icon: <Users className="h-4 w-4" />, maxChars: 2200, description: '24-hour disappearing content' },
    { id: 'reel', label: 'Reel', icon: <Video className="h-4 w-4" />, maxChars: 2200, description: 'Short-form video content' },
    { id: 'igtv', label: 'IGTV', icon: <Video className="h-4 w-4" />, maxChars: 2200, description: 'Long-form video content' },
  ];

  const selectedContentType = contentTypes.find(ct => ct.id === formData.contentType);

  const handleContentTypeChange = (contentType: InstagramFormData['contentType']) => {
    setFormData(prev => ({ ...prev, contentType }));
  };

  const handleContentChange = (content: string) => {
    setFormData(prev => ({ ...prev, content }));
  };

  const handleHashtagAdd = () => {
    if (hashtagInput.trim() && formData.hashtags.length < 30) {
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

  const handleCarouselImageAdd = () => {
    if (formData.carouselImages && formData.carouselImages.length < 10) {
      setFormData(prev => ({
        ...prev,
        carouselImages: [...(prev.carouselImages || []), ''],
      }));
    }
  };

  const handleCarouselImageRemove = (index: number) => {
    if (formData.carouselImages && formData.carouselImages.length > 2) {
      const newImages = formData.carouselImages.filter((_, i) => i !== index);
      setFormData(prev => ({ ...prev, carouselImages: newImages }));
    }
  };

  const validateContent = async () => {
    setIsValidating(true);
    try {
      const response = await fetch('/api/validate/content', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          platform: 'instagram',
          contentType: formData.contentType,
          content: formData.content,
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
          platform: 'instagram',
          contentType: formData.contentType,
          content: formData.content,
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

  const characterCount = formData.content.length;
  const characterLimit = selectedContentType?.maxChars || 2200;
  const isOverLimit = characterCount > characterLimit;

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <Card className="w-full max-w-4xl max-h-[90vh] overflow-y-auto bg-gradient-to-br from-pink-800/50 to-purple-900/50 border-pink-500/20 shadow-lg backdrop-blur-xl">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-gradient-to-br from-pink-500 to-purple-600 rounded-lg">
                <Image className="h-6 w-6 text-white" />
              </div>
              <div>
                <CardTitle className="text-2xl font-bold text-white">Instagram Post Creator</CardTitle>
                <p className="text-pink-200 text-sm">Visual storytelling platform</p>
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
            <label className="block text-sm font-medium text-pink-200">Content Type</label>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {contentTypes.map((type) => (
                <button
                  key={type.id}
                  onClick={() => handleContentTypeChange(type.id as InstagramFormData['contentType'])}
                  className={`p-4 rounded-xl border transition-all duration-300 text-left ${
                    formData.contentType === type.id
                      ? 'bg-pink-500/20 border-pink-400 shadow-lg shadow-pink-500/25'
                      : 'bg-white/5 border-white/10 hover:bg-white/10'
                  }`}
                >
                  <div className="flex items-center gap-3 mb-2">
                    {type.icon}
                    <span className="font-semibold text-white">{type.label}</span>
                    {formData.contentType === type.id && <CheckCircle className="h-4 w-4 text-pink-400 ml-auto" />}
                  </div>
                  <p className="text-xs text-gray-400">{type.description}</p>
                  <div className="mt-2 text-xs text-pink-300">
                    Max: {type.maxChars.toLocaleString()} characters
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Content Input */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="block text-sm font-medium text-pink-200">Caption</label>
              <div className="flex items-center gap-2">
                <span className={`text-sm ${isOverLimit ? 'text-red-400' : 'text-pink-300'}`}>
                  {characterCount}/{characterLimit.toLocaleString()}
                </span>
                <Button
                  onClick={validateContent}
                  disabled={isValidating}
                  size="sm"
                  variant="outline"
                  className="border-pink-400/50 text-pink-300 hover:bg-pink-500/20"
                >
                  {isValidating ? (
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-pink-400"></div>
                  ) : (
                    <CheckCircle className="h-4 w-4" />
                  )}
                  Validate
                </Button>
              </div>
            </div>
            
            <textarea
              value={formData.content}
              onChange={(e) => handleContentChange(e.target.value)}
              placeholder="Write a caption..."
              className="w-full h-32 bg-white/5 border-white/10 text-white placeholder-gray-500 focus:ring-pink-500 focus:border-pink-500 rounded-lg p-3 resize-none"
            />

            {formData.contentType === 'carousel' && (
              <div className="space-y-3">
                <label className="text-sm text-pink-200">Carousel Images/Videos</label>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  {(formData.carouselImages || []).map((image, index) => (
                    <div key={index} className="relative">
                      <div className="aspect-square bg-white/5 border border-white/10 rounded-lg flex items-center justify-center">
                        <Image className="h-8 w-8 text-gray-400" />
                      </div>
                      <Button
                        onClick={() => handleCarouselImageRemove(index)}
                        size="sm"
                        variant="outline"
                        className="absolute -top-2 -right-2 border-red-400/50 text-red-300 hover:bg-red-500/20"
                      >
                        <X className="h-3 w-3" />
                      </Button>
                    </div>
                  ))}
                  {formData.carouselImages && formData.carouselImages.length < 10 && (
                    <button
                      onClick={handleCarouselImageAdd}
                      className="aspect-square bg-white/5 border border-white/10 rounded-lg flex items-center justify-center hover:bg-white/10 transition-colors"
                    >
                      <Plus className="h-8 w-8 text-gray-400" />
                    </button>
                  )}
                </div>
                <p className="text-xs text-pink-300">2-10 images/videos, 1080x1080px recommended</p>
              </div>
            )}

            {formData.contentType === 'story' && (
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <Button className="bg-pink-500 hover:bg-pink-600 text-white">
                    <Upload className="h-4 w-4 mr-2" />
                    Upload Story
                  </Button>
                  <span className="text-xs text-pink-300">1080x1920px, 15s max</span>
                </div>
                <div className="flex items-center gap-3">
                  <label className="text-sm text-pink-200">Story Duration:</label>
                  <select
                    value={formData.storyDuration || 24}
                    onChange={(e) => setFormData(prev => ({ ...prev, storyDuration: parseInt(e.target.value) }))}
                    className="bg-white/5 border-white/10 text-white rounded-lg px-3 py-2"
                  >
                    <option value={24}>24 hours</option>
                    <option value={48}>48 hours</option>
                    <option value={72}>72 hours</option>
                  </select>
                </div>
              </div>
            )}

            {formData.contentType === 'reel' && (
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <Button className="bg-pink-500 hover:bg-pink-600 text-white">
                    <Upload className="h-4 w-4 mr-2" />
                    Upload Reel
                  </Button>
                  <span className="text-xs text-pink-300">1080x1920px, 15-90s</span>
                </div>
                <div className="space-y-2">
                  <input
                    type="text"
                    placeholder="Add music or audio..."
                    value={formData.reelMusic || ''}
                    onChange={(e) => setFormData(prev => ({ ...prev, reelMusic: e.target.value }))}
                    className="w-full bg-white/5 border-white/10 text-white placeholder-gray-500 focus:ring-pink-500 focus:border-pink-500 rounded-lg px-3 py-2"
                  />
                  <div className="flex items-center gap-3">
                    <label className="text-sm text-pink-200">Duration:</label>
                    <select
                      value={formData.reelDuration || 30}
                      onChange={(e) => setFormData(prev => ({ ...prev, reelDuration: parseInt(e.target.value) }))}
                      className="bg-white/5 border-white/10 text-white rounded-lg px-3 py-2"
                    >
                      <option value={15}>15 seconds</option>
                      <option value={30}>30 seconds</option>
                      <option value={60}>1 minute</option>
                      <option value={90}>90 seconds</option>
                    </select>
                  </div>
                </div>
              </div>
            )}

            {formData.contentType === 'igtv' && (
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <Button className="bg-pink-500 hover:bg-pink-600 text-white">
                    <Upload className="h-4 w-4 mr-2" />
                    Upload IGTV
                  </Button>
                  <span className="text-xs text-pink-300">1080x1920px, 15min-60min</span>
                </div>
                <input
                  type="text"
                  placeholder="IGTV Title"
                  className="w-full bg-white/5 border-white/10 text-white placeholder-gray-500 focus:ring-pink-500 focus:border-pink-500 rounded-lg px-3 py-2"
                />
              </div>
            )}

            {formData.contentType === 'feed_post' && (
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <Button className="bg-pink-500 hover:bg-pink-600 text-white">
                    <Upload className="h-4 w-4 mr-2" />
                    Upload Image
                  </Button>
                  <Button className="bg-pink-500 hover:bg-pink-600 text-white">
                    <Video className="h-4 w-4 mr-2" />
                    Upload Video
                  </Button>
                  <span className="text-xs text-pink-300">1080x1080px recommended</span>
                </div>
              </div>
            )}

            {isOverLimit && (
              <p className="text-red-400 text-sm">
                Content exceeds character limit by {characterCount - characterLimit} characters
              </p>
            )}
          </div>

          {/* Additional Options */}
          <div className="space-y-3">
            <label className="block text-sm font-medium text-pink-200">Additional Options</label>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm text-pink-200">Location</label>
                <input
                  type="text"
                  placeholder="Add location..."
                  value={formData.location || ''}
                  onChange={(e) => setFormData(prev => ({ ...prev, location: e.target.value }))}
                  className="w-full bg-white/5 border-white/10 text-white placeholder-gray-500 focus:ring-pink-500 focus:border-pink-500 rounded-lg px-3 py-2"
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm text-pink-200">Alt Text (Accessibility)</label>
                <input
                  type="text"
                  placeholder="Describe your image..."
                  value={formData.altText || ''}
                  onChange={(e) => setFormData(prev => ({ ...prev, altText: e.target.value }))}
                  className="w-full bg-white/5 border-white/10 text-white placeholder-gray-500 focus:ring-pink-500 focus:border-pink-500 rounded-lg px-3 py-2"
                />
              </div>
            </div>
          </div>

          {/* Hashtags */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="block text-sm font-medium text-pink-200">
                Hashtags ({formData.hashtags.length}/30)
              </label>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={hashtagInput}
                onChange={(e) => setHashtagInput(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && (e.preventDefault(), handleHashtagAdd())}
                placeholder="Add hashtag..."
                className="flex-1 bg-white/5 border-white/10 text-white placeholder-gray-500 focus:ring-pink-500 focus:border-pink-500 rounded-lg px-3 py-2"
              />
              <Button
                onClick={handleHashtagAdd}
                disabled={!hashtagInput.trim() || formData.hashtags.length >= 30}
                size="sm"
                className="bg-pink-500 hover:bg-pink-600 text-white"
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
                    className="bg-pink-500/20 text-pink-300 hover:bg-pink-500/30 cursor-pointer"
                    onClick={() => handleHashtagRemove(hashtag)}
                  >
                    {hashtag} ×
                  </Badge>
                ))}
              </div>
            )}
          </div>

          {/* Scheduling */}
          <div className="space-y-3">
            <label className="block text-sm font-medium text-pink-200">Schedule For</label>
            <div className="flex items-center gap-3">
              <Calendar className="h-5 w-5 text-pink-400" />
              <input
                type="datetime-local"
                value={formData.scheduledFor}
                onChange={(e) => setFormData(prev => ({ ...prev, scheduledFor: e.target.value }))}
                className="bg-white/5 border-white/10 text-white focus:ring-pink-500 focus:border-pink-500 rounded-lg px-3 py-2"
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
              disabled={!formData.content.trim() || isOverLimit}
              className="bg-gradient-to-r from-pink-500 to-purple-600 hover:from-pink-600 hover:to-purple-700 text-white border-0 shadow-lg shadow-pink-500/25"
            >
              <Send className="h-4 w-4 mr-2" />
              Schedule Instagram Post
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
