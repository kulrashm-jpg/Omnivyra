// LinkedIn-Specific Post Creation Form
import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Calendar,
  Send,
  X,
  Users,
  FileText,
  Video,
  Image,
  Hash,
  AlertCircle,
  CheckCircle,
  Upload,
  Link,
  BarChart3,
  Target,
  Clock,
} from 'lucide-react';

interface LinkedInFormData {
  contentType: 'post' | 'article' | 'video' | 'document' | 'poll';
  content: string;
  title?: string; // For articles
  description?: string; // For videos
  hashtags: string[];
  mediaUrls: string[];
  scheduledFor: string;
  // LinkedIn-specific fields
  pollQuestion?: string;
  pollOptions?: string[];
  pollDuration?: number; // days
  articleImage?: string;
  videoThumbnail?: string;
  documentTitle?: string;
  documentDescription?: string;
}

export default function LinkedInPostForm({ onClose, onSave }: { onClose: () => void; onSave: (post: any) => void }) {
  const [formData, setFormData] = useState<LinkedInFormData>({
    contentType: 'post',
    content: '',
    hashtags: [],
    mediaUrls: [],
    scheduledFor: new Date(Date.now() + 60 * 60 * 1000).toISOString().slice(0, 16),
    pollOptions: ['', ''],
    pollDuration: 7,
  });

  const [hashtagInput, setHashtagInput] = useState('');
  const [isValidating, setIsValidating] = useState(false);
  const [validation, setValidation] = useState<any>(null);

  const contentTypes = [
    { id: 'post', label: 'Text Post', icon: <FileText className="h-4 w-4" />, maxChars: 3000, description: 'Share thoughts, updates, or insights' },
    { id: 'article', label: 'Article', icon: <FileText className="h-4 w-4" />, maxChars: 125000, description: 'Long-form content with rich formatting' },
    { id: 'video', label: 'Video', icon: <Video className="h-4 w-4" />, maxChars: 3000, description: 'Upload video content (3s - 10min)' },
    { id: 'document', label: 'Document', icon: <FileText className="h-4 w-4" />, maxChars: 3000, description: 'PDF, PPT, DOC files (up to 100MB)' },
    { id: 'poll', label: 'Poll', icon: <BarChart3 className="h-4 w-4" />, maxChars: 140, description: 'Engage audience with questions' },
  ];

  const selectedContentType = contentTypes.find(ct => ct.id === formData.contentType);

  const handleContentTypeChange = (contentType: LinkedInFormData['contentType']) => {
    setFormData(prev => ({ ...prev, contentType }));
  };

  const handleContentChange = (content: string) => {
    setFormData(prev => ({ ...prev, content }));
  };

  const handleHashtagAdd = () => {
    if (hashtagInput.trim() && formData.hashtags.length < 5) {
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

  const handlePollOptionChange = (index: number, value: string) => {
    const newOptions = [...(formData.pollOptions || [])];
    newOptions[index] = value;
    setFormData(prev => ({ ...prev, pollOptions: newOptions }));
  };

  const addPollOption = () => {
    if (formData.pollOptions && formData.pollOptions.length < 4) {
      setFormData(prev => ({
        ...prev,
        pollOptions: [...(prev.pollOptions || []), ''],
      }));
    }
  };

  const removePollOption = (index: number) => {
    if (formData.pollOptions && formData.pollOptions.length > 2) {
      const newOptions = formData.pollOptions.filter((_, i) => i !== index);
      setFormData(prev => ({ ...prev, pollOptions: newOptions }));
    }
  };

  const validateContent = async () => {
    setIsValidating(true);
    try {
      const response = await fetch('/api/validate/content', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          platform: 'linkedin',
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
          platform: 'linkedin',
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
  const characterLimit = selectedContentType?.maxChars || 3000;
  const isOverLimit = characterCount > characterLimit;

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <Card className="w-full max-w-4xl max-h-[90vh] overflow-y-auto bg-gradient-to-br from-blue-800/50 to-blue-900/50 border-blue-500/20 shadow-lg backdrop-blur-xl">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-500 rounded-lg">
                <Users className="h-6 w-6 text-white" />
              </div>
              <div>
                <CardTitle className="text-2xl font-bold text-white">LinkedIn Post Creator</CardTitle>
                <p className="text-blue-200 text-sm">Professional content for LinkedIn</p>
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
            <label className="block text-sm font-medium text-blue-200">Content Type</label>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {contentTypes.map((type) => (
                <button
                  key={type.id}
                  onClick={() => handleContentTypeChange(type.id as LinkedInFormData['contentType'])}
                  className={`p-4 rounded-xl border transition-all duration-300 text-left ${
                    formData.contentType === type.id
                      ? 'bg-blue-500/20 border-blue-400 shadow-lg shadow-blue-500/25'
                      : 'bg-white/5 border-white/10 hover:bg-white/10'
                  }`}
                >
                  <div className="flex items-center gap-3 mb-2">
                    {type.icon}
                    <span className="font-semibold text-white">{type.label}</span>
                    {formData.contentType === type.id && <CheckCircle className="h-4 w-4 text-blue-400 ml-auto" />}
                  </div>
                  <p className="text-xs text-gray-400">{type.description}</p>
                  <div className="mt-2 text-xs text-blue-300">
                    Max: {type.maxChars.toLocaleString()} characters
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Content Input */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="block text-sm font-medium text-blue-200">Content</label>
              <div className="flex items-center gap-2">
                <span className={`text-sm ${isOverLimit ? 'text-red-400' : 'text-blue-300'}`}>
                  {characterCount}/{characterLimit.toLocaleString()}
                </span>
                <Button
                  onClick={validateContent}
                  disabled={isValidating}
                  size="sm"
                  variant="outline"
                  className="border-blue-400/50 text-blue-300 hover:bg-blue-500/20"
                >
                  {isValidating ? (
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-400"></div>
                  ) : (
                    <CheckCircle className="h-4 w-4" />
                  )}
                  Validate
                </Button>
              </div>
            </div>
            
            {formData.contentType === 'article' && (
              <div className="space-y-3">
                <input
                  type="text"
                  placeholder="Article Title"
                  value={formData.title || ''}
                  onChange={(e) => setFormData(prev => ({ ...prev, title: e.target.value }))}
                  className="w-full bg-white/5 border-white/10 text-white placeholder-gray-500 focus:ring-blue-500 focus:border-blue-500 rounded-lg px-3 py-2"
                />
                <textarea
                  value={formData.content}
                  onChange={(e) => handleContentChange(e.target.value)}
                  placeholder="Write your LinkedIn article..."
                  className="w-full h-40 bg-white/5 border-white/10 text-white placeholder-gray-500 focus:ring-blue-500 focus:border-blue-500 rounded-lg p-3 resize-none"
                />
              </div>
            )}

            {formData.contentType === 'video' && (
              <div className="space-y-3">
                <textarea
                  value={formData.content}
                  onChange={(e) => handleContentChange(e.target.value)}
                  placeholder="Video description..."
                  className="w-full h-32 bg-white/5 border-white/10 text-white placeholder-gray-500 focus:ring-blue-500 focus:border-blue-500 rounded-lg p-3 resize-none"
                />
                <div className="flex items-center gap-3">
                  <Button className="bg-blue-500 hover:bg-blue-600 text-white">
                    <Upload className="h-4 w-4 mr-2" />
                    Upload Video
                  </Button>
                  <span className="text-xs text-blue-300">MP4, up to 5GB, 3s-10min</span>
                </div>
              </div>
            )}

            {formData.contentType === 'poll' && (
              <div className="space-y-4">
                <input
                  type="text"
                  placeholder="Poll question (max 140 characters)"
                  value={formData.pollQuestion || ''}
                  onChange={(e) => setFormData(prev => ({ ...prev, pollQuestion: e.target.value }))}
                  maxLength={140}
                  className="w-full bg-white/5 border-white/10 text-white placeholder-gray-500 focus:ring-blue-500 focus:border-blue-500 rounded-lg px-3 py-2"
                />
                <div className="space-y-2">
                  <label className="text-sm text-blue-200">Poll Options</label>
                  {formData.pollOptions?.map((option, index) => (
                    <div key={index} className="flex items-center gap-2">
                      <input
                        type="text"
                        placeholder={`Option ${index + 1}`}
                        value={option}
                        onChange={(e) => handlePollOptionChange(index, e.target.value)}
                        className="flex-1 bg-white/5 border-white/10 text-white placeholder-gray-500 focus:ring-blue-500 focus:border-blue-500 rounded-lg px-3 py-2"
                      />
                      {formData.pollOptions && formData.pollOptions.length > 2 && (
                        <Button
                          onClick={() => removePollOption(index)}
                          size="sm"
                          variant="outline"
                          className="border-red-400/50 text-red-300 hover:bg-red-500/20"
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  ))}
                  {formData.pollOptions && formData.pollOptions.length < 4 && (
                    <Button
                      onClick={addPollOption}
                      size="sm"
                      variant="outline"
                      className="border-blue-400/50 text-blue-300 hover:bg-blue-500/20"
                    >
                      <Hash className="h-4 w-4 mr-2" />
                      Add Option
                    </Button>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <label className="text-sm text-blue-200">Duration:</label>
                  <select
                    value={formData.pollDuration}
                    onChange={(e) => setFormData(prev => ({ ...prev, pollDuration: parseInt(e.target.value) }))}
                    className="bg-white/5 border-white/10 text-white rounded-lg px-3 py-2"
                  >
                    <option value={1}>1 day</option>
                    <option value={3}>3 days</option>
                    <option value={7}>1 week</option>
                  </select>
                </div>
              </div>
            )}

            {formData.contentType === 'post' && (
              <textarea
                value={formData.content}
                onChange={(e) => handleContentChange(e.target.value)}
                placeholder="Share your professional thoughts..."
                className="w-full h-32 bg-white/5 border-white/10 text-white placeholder-gray-500 focus:ring-blue-500 focus:border-blue-500 rounded-lg p-3 resize-none"
              />
            )}

            {formData.contentType === 'document' && (
              <div className="space-y-3">
                <textarea
                  value={formData.content}
                  onChange={(e) => handleContentChange(e.target.value)}
                  placeholder="Document description..."
                  className="w-full h-32 bg-white/5 border-white/10 text-white placeholder-gray-500 focus:ring-blue-500 focus:border-blue-500 rounded-lg p-3 resize-none"
                />
                <div className="flex items-center gap-3">
                  <Button className="bg-blue-500 hover:bg-blue-600 text-white">
                    <Upload className="h-4 w-4 mr-2" />
                    Upload Document
                  </Button>
                  <span className="text-xs text-blue-300">PDF, DOC, PPT up to 100MB</span>
                </div>
              </div>
            )}

            {isOverLimit && (
              <p className="text-red-400 text-sm">
                Content exceeds character limit by {characterCount - characterLimit} characters
              </p>
            )}
          </div>

          {/* Hashtags */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="block text-sm font-medium text-blue-200">
                Hashtags ({formData.hashtags.length}/5)
              </label>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={hashtagInput}
                onChange={(e) => setHashtagInput(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && (e.preventDefault(), handleHashtagAdd())}
                placeholder="Add hashtag..."
                className="flex-1 bg-white/5 border-white/10 text-white placeholder-gray-500 focus:ring-blue-500 focus:border-blue-500 rounded-lg px-3 py-2"
              />
              <Button
                onClick={handleHashtagAdd}
                disabled={!hashtagInput.trim() || formData.hashtags.length >= 5}
                size="sm"
                className="bg-blue-500 hover:bg-blue-600 text-white"
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
                    className="bg-blue-500/20 text-blue-300 hover:bg-blue-500/30 cursor-pointer"
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
            <label className="block text-sm font-medium text-blue-200">Schedule For</label>
            <div className="flex items-center gap-3">
              <Calendar className="h-5 w-5 text-blue-400" />
              <input
                type="datetime-local"
                value={formData.scheduledFor}
                onChange={(e) => setFormData(prev => ({ ...prev, scheduledFor: e.target.value }))}
                className="bg-white/5 border-white/10 text-white focus:ring-blue-500 focus:border-blue-500 rounded-lg px-3 py-2"
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
              className="bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 text-white border-0 shadow-lg shadow-blue-500/25"
            >
              <Send className="h-4 w-4 mr-2" />
              Schedule LinkedIn Post
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
