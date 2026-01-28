// Facebook-Specific Post Creation Form
import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  CalendarDays,
  Send,
  X,
  Globe,
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
  MapPin,
  Heart,
  MessageCircle,
  Share,
  Image,
  Video,
  FileText,
  Building,
} from 'lucide-react';

interface FacebookFormData {
  contentType: 'post' | 'story' | 'video' | 'event' | 'page_post' | 'album';
  content: string;
  hashtags: string[];
  mediaUrls: string[];
  scheduledFor: string;
  // Facebook-specific fields
  location?: string;
  taggedUsers?: string[];
  feeling?: string;
  activity?: string;
  eventName?: string;
  eventDescription?: string;
  eventDate?: string;
  eventLocation?: string;
  albumTitle?: string;
  albumDescription?: string;
  albumPhotos?: string[];
  pageId?: string;
  audience?: 'public' | 'friends' | 'custom';
  allowComments?: boolean;
  allowShares?: boolean;
}

export default function FacebookPostForm({ onClose, onSave }: { onClose: () => void; onSave: (post: any) => void }) {
  const [formData, setFormData] = useState<FacebookFormData>({
    contentType: 'post',
    content: '',
    hashtags: [],
    mediaUrls: [],
    scheduledFor: new Date(Date.now() + 60 * 60 * 1000).toISOString().slice(0, 16),
    taggedUsers: [],
    albumPhotos: [],
    audience: 'public',
    allowComments: true,
    allowShares: true,
  });

  const [hashtagInput, setHashtagInput] = useState('');
  const [isValidating, setIsValidating] = useState(false);
  const [validation, setValidation] = useState<any>(null);

  const contentTypes = [
    { id: 'post', label: 'Post', icon: <FileText className="h-4 w-4" />, maxChars: 63206, description: 'Text, image, or video post' },
    { id: 'story', label: 'Story', icon: <Users className="h-4 w-4" />, maxChars: 2200, description: '24-hour disappearing content' },
    { id: 'video', label: 'Video', icon: <Video className="h-4 w-4" />, maxChars: 63206, description: 'Video content with description' },
    { id: 'event', label: 'Event', icon: <CalendarDays className="h-4 w-4" />, maxChars: 63206, description: 'Create or promote events' },
    { id: 'page_post', label: 'Page Post', icon: <Building className="h-4 w-4" />, maxChars: 63206, description: 'Post to Facebook page' },
    { id: 'album', label: 'Photo Album', icon: <Image className="h-4 w-4" />, maxChars: 63206, description: 'Multiple photos in album' },
  ];

  const feelings = [
    'Happy', 'Sad', 'Excited', 'Grateful', 'Blessed', 'Thankful', 'Proud', 'Loved',
    'Motivated', 'Inspired', 'Hopeful', 'Peaceful', 'Confident', 'Strong', 'Creative'
  ];

  const activities = [
    'Watching', 'Reading', 'Listening to', 'Playing', 'Eating', 'Drinking', 'Traveling',
    'Working', 'Studying', 'Exercising', 'Shopping', 'Cooking', 'Sleeping', 'Thinking'
  ];

  const selectedContentType = contentTypes.find(ct => ct.id === formData.contentType);

  const handleContentTypeChange = (contentType: FacebookFormData['contentType']) => {
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

  const handleAlbumPhotoAdd = () => {
    if (formData.albumPhotos && formData.albumPhotos.length < 12) {
      setFormData(prev => ({
        ...prev,
        albumPhotos: [...(prev.albumPhotos || []), ''],
      }));
    }
  };

  const handleAlbumPhotoRemove = (index: number) => {
    if (formData.albumPhotos && formData.albumPhotos.length > 1) {
      const newPhotos = formData.albumPhotos.filter((_, i) => i !== index);
      setFormData(prev => ({ ...prev, albumPhotos: newPhotos }));
    }
  };

  const validateContent = async () => {
    setIsValidating(true);
    try {
      const response = await fetch('/api/validate/content', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          platform: 'facebook',
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
          platform: 'facebook',
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
  const characterLimit = selectedContentType?.maxChars || 63206;
  const isOverLimit = characterCount > characterLimit;

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <Card className="w-full max-w-4xl max-h-[90vh] overflow-y-auto bg-gradient-to-br from-indigo-800/50 to-blue-900/50 border-indigo-500/20 shadow-lg backdrop-blur-xl">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-indigo-500 rounded-lg">
                <Globe className="h-6 w-6 text-white" />
              </div>
              <div>
                <CardTitle className="text-2xl font-bold text-white">Facebook Post Creator</CardTitle>
                <p className="text-indigo-200 text-sm">Social networking and community building</p>
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
            <label className="block text-sm font-medium text-indigo-200">Content Type</label>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {contentTypes.map((type) => (
                <button
                  key={type.id}
                  onClick={() => handleContentTypeChange(type.id as FacebookFormData['contentType'])}
                  className={`p-4 rounded-xl border transition-all duration-300 text-left ${
                    formData.contentType === type.id
                      ? 'bg-indigo-500/20 border-indigo-400 shadow-lg shadow-indigo-500/25'
                      : 'bg-white/5 border-white/10 hover:bg-white/10'
                  }`}
                >
                  <div className="flex items-center gap-3 mb-2">
                    {type.icon}
                    <span className="font-semibold text-white">{type.label}</span>
                    {formData.contentType === type.id && <CheckCircle className="h-4 w-4 text-indigo-400 ml-auto" />}
                  </div>
                  <p className="text-xs text-gray-400">{type.description}</p>
                  <div className="mt-2 text-xs text-indigo-300">
                    Max: {type.maxChars.toLocaleString()} characters
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Content Input */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="block text-sm font-medium text-indigo-200">Content</label>
              <div className="flex items-center gap-2">
                <span className={`text-sm ${isOverLimit ? 'text-red-400' : 'text-indigo-300'}`}>
                  {characterCount}/{characterLimit.toLocaleString()}
                </span>
                <Button
                  onClick={validateContent}
                  disabled={isValidating}
                  size="sm"
                  variant="outline"
                  className="border-indigo-400/50 text-indigo-300 hover:bg-indigo-500/20"
                >
                  {isValidating ? (
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-indigo-400"></div>
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
              placeholder="What's on your mind?"
              className="w-full h-32 bg-white/5 border-white/10 text-white placeholder-gray-500 focus:ring-indigo-500 focus:border-indigo-500 rounded-lg p-3 resize-none"
            />

            {formData.contentType === 'album' && (
              <div className="space-y-3">
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  {(formData.albumPhotos || []).map((photo, index) => (
                    <div key={index} className="relative">
                      <div className="aspect-square bg-white/5 border border-white/10 rounded-lg flex items-center justify-center">
                        <Image className="h-8 w-8 text-gray-400" />
                      </div>
                      <Button
                        onClick={() => handleAlbumPhotoRemove(index)}
                        size="sm"
                        variant="outline"
                        className="absolute -top-2 -right-2 border-red-400/50 text-red-300 hover:bg-red-500/20"
                      >
                        <X className="h-3 w-3" />
                      </Button>
                    </div>
                  ))}
                  {formData.albumPhotos && formData.albumPhotos.length < 12 && (
                    <button
                      onClick={handleAlbumPhotoAdd}
                      className="aspect-square bg-white/5 border border-white/10 rounded-lg flex items-center justify-center hover:bg-white/10 transition-colors"
                    >
                      <Plus className="h-8 w-8 text-gray-400" />
                    </button>
                  )}
                </div>
                <p className="text-xs text-indigo-300">1-12 photos, 1080x1080px recommended</p>
              </div>
            )}

            {formData.contentType === 'event' && (
              <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-sm text-indigo-200">Event Name</label>
                    <input
                      type="text"
                      placeholder="Event name..."
                      value={formData.eventName || ''}
                      onChange={(e) => setFormData(prev => ({ ...prev, eventName: e.target.value }))}
                      className="w-full bg-white/5 border-white/10 text-white placeholder-gray-500 focus:ring-indigo-500 focus:border-indigo-500 rounded-lg px-3 py-2"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm text-indigo-200">Event Date</label>
                    <input
                      type="datetime-local"
                      value={formData.eventDate || ''}
                      onChange={(e) => setFormData(prev => ({ ...prev, eventDate: e.target.value }))}
                      className="w-full bg-white/5 border-white/10 text-white focus:ring-indigo-500 focus:border-indigo-500 rounded-lg px-3 py-2"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="text-sm text-indigo-200">Event Location</label>
                  <input
                    type="text"
                    placeholder="Event location..."
                    value={formData.eventLocation || ''}
                    onChange={(e) => setFormData(prev => ({ ...prev, eventLocation: e.target.value }))}
                    className="w-full bg-white/5 border-white/10 text-white placeholder-gray-500 focus:ring-indigo-500 focus:border-indigo-500 rounded-lg px-3 py-2"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm text-indigo-200">Event Description</label>
                  <textarea
                    placeholder="Describe your event..."
                    value={formData.eventDescription || ''}
                    onChange={(e) => setFormData(prev => ({ ...prev, eventDescription: e.target.value }))}
                    className="w-full h-20 bg-white/5 border-white/10 text-white placeholder-gray-500 focus:ring-indigo-500 focus:border-indigo-500 rounded-lg p-3 resize-none"
                  />
                </div>
              </div>
            )}

            {formData.contentType === 'video' && (
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <Button className="bg-indigo-500 hover:bg-indigo-600 text-white">
                    <Upload className="h-4 w-4 mr-2" />
                    Upload Video
                  </Button>
                  <span className="text-xs text-indigo-300">MP4, up to 4GB, 240min max</span>
                </div>
              </div>
            )}

            {formData.contentType === 'post' && (
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <Button className="bg-indigo-500 hover:bg-indigo-600 text-white">
                    <Image className="h-4 w-4 mr-2" />
                    Add Photo
                  </Button>
                  <Button className="bg-indigo-500 hover:bg-indigo-600 text-white">
                    <Video className="h-4 w-4 mr-2" />
                    Add Video
                  </Button>
                  <Button className="bg-indigo-500 hover:bg-indigo-600 text-white">
                    <Link className="h-4 w-4 mr-2" />
                    Add Link
                  </Button>
                </div>
              </div>
            )}

            {isOverLimit && (
              <p className="text-red-400 text-sm">
                Content exceeds character limit by {characterCount - characterLimit} characters
              </p>
            )}
          </div>

          {/* Feeling and Activity */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm text-indigo-200">Feeling</label>
              <select
                value={formData.feeling || ''}
                onChange={(e) => setFormData(prev => ({ ...prev, feeling: e.target.value }))}
                className="w-full bg-white/5 border-white/10 text-white focus:ring-indigo-500 focus:border-indigo-500 rounded-lg px-3 py-2"
              >
                <option value="">Select feeling...</option>
                {feelings.map((feeling) => (
                  <option key={feeling} value={feeling}>{feeling}</option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-sm text-indigo-200">Activity</label>
              <select
                value={formData.activity || ''}
                onChange={(e) => setFormData(prev => ({ ...prev, activity: e.target.value }))}
                className="w-full bg-white/5 border-white/10 text-white focus:ring-indigo-500 focus:border-indigo-500 rounded-lg px-3 py-2"
              >
                <option value="">Select activity...</option>
                {activities.map((activity) => (
                  <option key={activity} value={activity}>{activity}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Location and Audience */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm text-indigo-200">Location</label>
              <input
                type="text"
                placeholder="Add location..."
                value={formData.location || ''}
                onChange={(e) => setFormData(prev => ({ ...prev, location: e.target.value }))}
                className="w-full bg-white/5 border-white/10 text-white placeholder-gray-500 focus:ring-indigo-500 focus:border-indigo-500 rounded-lg px-3 py-2"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm text-indigo-200">Audience</label>
              <select
                value={formData.audience}
                onChange={(e) => setFormData(prev => ({ ...prev, audience: e.target.value as 'public' | 'friends' | 'custom' }))}
                className="w-full bg-white/5 border-white/10 text-white focus:ring-indigo-500 focus:border-indigo-500 rounded-lg px-3 py-2"
              >
                <option value="public">Public</option>
                <option value="friends">Friends</option>
                <option value="custom">Custom</option>
              </select>
            </div>
          </div>

          {/* Hashtags */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="block text-sm font-medium text-indigo-200">
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
                className="flex-1 bg-white/5 border-white/10 text-white placeholder-gray-500 focus:ring-indigo-500 focus:border-indigo-500 rounded-lg px-3 py-2"
              />
              <Button
                onClick={handleHashtagAdd}
                disabled={!hashtagInput.trim() || formData.hashtags.length >= 30}
                size="sm"
                className="bg-indigo-500 hover:bg-indigo-600 text-white"
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
                    className="bg-indigo-500/20 text-indigo-300 hover:bg-indigo-500/30 cursor-pointer"
                    onClick={() => handleHashtagRemove(hashtag)}
                  >
                    {hashtag} ×
                  </Badge>
                ))}
              </div>
            )}
          </div>

          {/* Privacy Settings */}
          <div className="space-y-3">
            <label className="block text-sm font-medium text-indigo-200">Privacy Settings</label>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-indigo-200">Allow Comments</span>
                <input
                  type="checkbox"
                  checked={formData.allowComments}
                  onChange={(e) => setFormData(prev => ({ ...prev, allowComments: e.target.checked }))}
                  className="rounded border-white/20 bg-white/5 text-indigo-500 focus:ring-indigo-500"
                />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-indigo-200">Allow Shares</span>
                <input
                  type="checkbox"
                  checked={formData.allowShares}
                  onChange={(e) => setFormData(prev => ({ ...prev, allowShares: e.target.checked }))}
                  className="rounded border-white/20 bg-white/5 text-indigo-500 focus:ring-indigo-500"
                />
              </div>
            </div>
          </div>

          {/* Scheduling */}
          <div className="space-y-3">
            <label className="block text-sm font-medium text-indigo-200">Schedule For</label>
            <div className="flex items-center gap-3">
              <CalendarDays className="h-5 w-5 text-indigo-400" />
              <input
                type="datetime-local"
                value={formData.scheduledFor}
                onChange={(e) => setFormData(prev => ({ ...prev, scheduledFor: e.target.value }))}
                className="bg-white/5 border-white/10 text-white focus:ring-indigo-500 focus:border-indigo-500 rounded-lg px-3 py-2"
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
              className="bg-gradient-to-r from-indigo-500 to-blue-600 hover:from-indigo-600 hover:to-blue-700 text-white border-0 shadow-lg shadow-indigo-500/25"
            >
              <Send className="h-4 w-4 mr-2" />
              Schedule Facebook Post
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
