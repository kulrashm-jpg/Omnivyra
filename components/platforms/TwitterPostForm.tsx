// Twitter-Specific Post Creation Form
import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Calendar,
  Send,
  X,
  Hash,
  FileText,
  Video,
  Image,
  AlertCircle,
  CheckCircle,
  Upload,
  Link,
  BarChart3,
  Target,
  Clock,
  Plus,
  Trash2,
} from 'lucide-react';

interface TwitterFormData {
  contentType: 'tweet' | 'thread' | 'video' | 'poll';
  content: string;
  threadTweets?: string[]; // For thread
  hashtags: string[];
  mediaUrls: string[];
  scheduledFor: string;
  // Twitter-specific fields
  pollQuestion?: string;
  pollOptions?: string[];
  pollDuration?: number; // minutes
  replyTo?: string;
  quoteTweet?: string;
}

export default function TwitterPostForm({ onClose, onSave }: { onClose: () => void; onSave: (post: any) => void }) {
  const [formData, setFormData] = useState<TwitterFormData>({
    contentType: 'tweet',
    content: '',
    hashtags: [],
    mediaUrls: [],
    scheduledFor: new Date(Date.now() + 60 * 60 * 1000).toISOString().slice(0, 16),
    threadTweets: [''],
    pollOptions: ['', ''],
    pollDuration: 1440, // 24 hours
  });

  const [hashtagInput, setHashtagInput] = useState('');
  const [isValidating, setIsValidating] = useState(false);
  const [validation, setValidation] = useState<any>(null);

  const contentTypes = [
    { id: 'tweet', label: 'Tweet', icon: <FileText className="h-4 w-4" />, maxChars: 280, description: 'Single tweet with text and media' },
    { id: 'thread', label: 'Thread', icon: <FileText className="h-4 w-4" />, maxChars: 280, description: 'Connected series of tweets' },
    { id: 'video', label: 'Video Tweet', icon: <Video className="h-4 w-4" />, maxChars: 280, description: 'Tweet with video content' },
    { id: 'poll', label: 'Poll', icon: <BarChart3 className="h-4 w-4" />, maxChars: 280, description: 'Interactive poll tweet' },
  ];

  const selectedContentType = contentTypes.find(ct => ct.id === formData.contentType);

  const handleContentTypeChange = (contentType: TwitterFormData['contentType']) => {
    setFormData(prev => ({ ...prev, contentType }));
  };

  const handleContentChange = (content: string) => {
    setFormData(prev => ({ ...prev, content }));
  };

  const handleThreadTweetChange = (index: number, content: string) => {
    const newThreadTweets = [...(formData.threadTweets || [])];
    newThreadTweets[index] = content;
    setFormData(prev => ({ ...prev, threadTweets: newThreadTweets }));
  };

  const addThreadTweet = () => {
    setFormData(prev => ({
      ...prev,
      threadTweets: [...(prev.threadTweets || []), ''],
    }));
  };

  const removeThreadTweet = (index: number) => {
    if (formData.threadTweets && formData.threadTweets.length > 1) {
      const newThreadTweets = formData.threadTweets.filter((_, i) => i !== index);
      setFormData(prev => ({ ...prev, threadTweets: newThreadTweets }));
    }
  };

  const handleHashtagAdd = () => {
    if (hashtagInput.trim() && formData.hashtags.length < 2) {
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
          platform: 'twitter',
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
          platform: 'twitter',
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
  const characterLimit = 280;
  const isOverLimit = characterCount > characterLimit;

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <Card className="w-full max-w-4xl max-h-[90vh] overflow-y-auto bg-gradient-to-br from-sky-800/50 to-blue-900/50 border-sky-500/20 shadow-lg backdrop-blur-xl">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-sky-500 rounded-lg">
                <Hash className="h-6 w-6 text-white" />
              </div>
              <div>
                <CardTitle className="text-2xl font-bold text-white">Twitter Post Creator</CardTitle>
                <p className="text-sky-200 text-sm">Quick thoughts and conversations</p>
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
            <label className="block text-sm font-medium text-sky-200">Content Type</label>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {contentTypes.map((type) => (
                <button
                  key={type.id}
                  onClick={() => handleContentTypeChange(type.id as TwitterFormData['contentType'])}
                  className={`p-4 rounded-xl border transition-all duration-300 text-left ${
                    formData.contentType === type.id
                      ? 'bg-sky-500/20 border-sky-400 shadow-lg shadow-sky-500/25'
                      : 'bg-white/5 border-white/10 hover:bg-white/10'
                  }`}
                >
                  <div className="flex items-center gap-3 mb-2">
                    {type.icon}
                    <span className="font-semibold text-white">{type.label}</span>
                    {formData.contentType === type.id && <CheckCircle className="h-4 w-4 text-sky-400 ml-auto" />}
                  </div>
                  <p className="text-xs text-gray-400">{type.description}</p>
                  <div className="mt-2 text-xs text-sky-300">
                    Max: {type.maxChars} characters
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Content Input */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="block text-sm font-medium text-sky-200">Content</label>
              <div className="flex items-center gap-2">
                <span className={`text-sm ${isOverLimit ? 'text-red-400' : 'text-sky-300'}`}>
                  {characterCount}/{characterLimit}
                </span>
                <Button
                  onClick={validateContent}
                  disabled={isValidating}
                  size="sm"
                  variant="outline"
                  className="border-sky-400/50 text-sky-300 hover:bg-sky-500/20"
                >
                  {isValidating ? (
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-sky-400"></div>
                  ) : (
                    <CheckCircle className="h-4 w-4" />
                  )}
                  Validate
                </Button>
              </div>
            </div>
            
            {formData.contentType === 'thread' && (
              <div className="space-y-4">
                <div className="space-y-3">
                  <label className="text-sm text-sky-200">Thread Tweets</label>
                  {(formData.threadTweets || []).map((tweet, index) => (
                    <div key={index} className="space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-sky-300">Tweet {index + 1}</span>
                        {formData.threadTweets && formData.threadTweets.length > 1 && (
                          <Button
                            onClick={() => removeThreadTweet(index)}
                            size="sm"
                            variant="outline"
                            className="border-red-400/50 text-red-300 hover:bg-red-500/20"
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        )}
                      </div>
                      <textarea
                        value={tweet}
                        onChange={(e) => handleThreadTweetChange(index, e.target.value)}
                        placeholder={`Tweet ${index + 1}...`}
                        className="w-full h-20 bg-white/5 border-white/10 text-white placeholder-gray-500 focus:ring-sky-500 focus:border-sky-500 rounded-lg p-3 resize-none"
                      />
                      <div className="text-xs text-sky-300">
                        {tweet.length}/{characterLimit} characters
                      </div>
                    </div>
                  ))}
                  <Button
                    onClick={addThreadTweet}
                    size="sm"
                    variant="outline"
                    className="border-sky-400/50 text-sky-300 hover:bg-sky-500/20"
                  >
                    <Plus className="h-4 w-4 mr-2" />
                    Add Tweet
                  </Button>
                </div>
              </div>
            )}

            {formData.contentType === 'video' && (
              <div className="space-y-3">
                <textarea
                  value={formData.content}
                  onChange={(e) => handleContentChange(e.target.value)}
                  placeholder="What's happening?"
                  className="w-full h-32 bg-white/5 border-white/10 text-white placeholder-gray-500 focus:ring-sky-500 focus:border-sky-500 rounded-lg p-3 resize-none"
                />
                <div className="flex items-center gap-3">
                  <Button className="bg-sky-500 hover:bg-sky-600 text-white">
                    <Upload className="h-4 w-4 mr-2" />
                    Upload Video
                  </Button>
                  <span className="text-xs text-sky-300">MP4, up to 512MB, 2min 20s max</span>
                </div>
              </div>
            )}

            {formData.contentType === 'poll' && (
              <div className="space-y-4">
                <textarea
                  value={formData.content}
                  onChange={(e) => handleContentChange(e.target.value)}
                  placeholder="What's happening?"
                  className="w-full h-20 bg-white/5 border-white/10 text-white placeholder-gray-500 focus:ring-sky-500 focus:border-sky-500 rounded-lg p-3 resize-none"
                />
                <div className="space-y-2">
                  <label className="text-sm text-sky-200">Poll Options</label>
                  {formData.pollOptions?.map((option, index) => (
                    <div key={index} className="flex items-center gap-2">
                      <input
                        type="text"
                        placeholder={`Option ${index + 1}`}
                        value={option}
                        onChange={(e) => handlePollOptionChange(index, e.target.value)}
                        maxLength={25}
                        className="flex-1 bg-white/5 border-white/10 text-white placeholder-gray-500 focus:ring-sky-500 focus:border-sky-500 rounded-lg px-3 py-2"
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
                      className="border-sky-400/50 text-sky-300 hover:bg-sky-500/20"
                    >
                      <Plus className="h-4 w-4 mr-2" />
                      Add Option
                    </Button>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <label className="text-sm text-sky-200">Duration:</label>
                  <select
                    value={formData.pollDuration}
                    onChange={(e) => setFormData(prev => ({ ...prev, pollDuration: parseInt(e.target.value) }))}
                    className="bg-white/5 border-white/10 text-white rounded-lg px-3 py-2"
                  >
                    <option value={300}>5 minutes</option>
                    <option value={1800}>30 minutes</option>
                    <option value={3600}>1 hour</option>
                    <option value={1440}>1 day</option>
                    <option value={10080}>1 week</option>
                  </select>
                </div>
              </div>
            )}

            {formData.contentType === 'tweet' && (
              <div className="space-y-3">
                <textarea
                  value={formData.content}
                  onChange={(e) => handleContentChange(e.target.value)}
                  placeholder="What's happening?"
                  className="w-full h-32 bg-white/5 border-white/10 text-white placeholder-gray-500 focus:ring-sky-500 focus:border-sky-500 rounded-lg p-3 resize-none"
                />
                <div className="flex items-center gap-3">
                  <Button className="bg-sky-500 hover:bg-sky-600 text-white">
                    <Image className="h-4 w-4 mr-2" />
                    Add Image
                  </Button>
                  <Button className="bg-sky-500 hover:bg-sky-600 text-white">
                    <Video className="h-4 w-4 mr-2" />
                    Add Video
                  </Button>
                  <Button className="bg-sky-500 hover:bg-sky-600 text-white">
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

          {/* Hashtags */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="block text-sm font-medium text-sky-200">
                Hashtags ({formData.hashtags.length}/2)
              </label>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={hashtagInput}
                onChange={(e) => setHashtagInput(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && (e.preventDefault(), handleHashtagAdd())}
                placeholder="Add hashtag..."
                className="flex-1 bg-white/5 border-white/10 text-white placeholder-gray-500 focus:ring-sky-500 focus:border-sky-500 rounded-lg px-3 py-2"
              />
              <Button
                onClick={handleHashtagAdd}
                disabled={!hashtagInput.trim() || formData.hashtags.length >= 2}
                size="sm"
                className="bg-sky-500 hover:bg-sky-600 text-white"
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
                    className="bg-sky-500/20 text-sky-300 hover:bg-sky-500/30 cursor-pointer"
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
            <label className="block text-sm font-medium text-sky-200">Schedule For</label>
            <div className="flex items-center gap-3">
              <Calendar className="h-5 w-5 text-sky-400" />
              <input
                type="datetime-local"
                value={formData.scheduledFor}
                onChange={(e) => setFormData(prev => ({ ...prev, scheduledFor: e.target.value }))}
                className="bg-white/5 border-white/10 text-white focus:ring-sky-500 focus:border-sky-500 rounded-lg px-3 py-2"
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
              className="bg-gradient-to-r from-sky-500 to-blue-600 hover:from-sky-600 hover:to-blue-700 text-white border-0 shadow-lg shadow-sky-500/25"
            >
              <Send className="h-4 w-4 mr-2" />
              Schedule Tweet
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
