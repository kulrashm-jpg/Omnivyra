import React, { useState, useEffect } from 'react';
import { 
  Plus, 
  Edit3, 
  Save, 
  Trash2, 
  Eye, 
  Copy, 
  Sparkles,
  Brain,
  FileText,
  Image,
  Video,
  Mic,
  Hash,
  Clock,
  Target,
  CheckCircle,
  AlertCircle,
  Loader2,
  Upload,
  Link,
  Users,
  TrendingUp,
  Calendar,
  X
} from 'lucide-react';
import VoiceNotesComponent from './VoiceNotesComponent';

interface ContentItem {
  id: string;
  title: string;
  content: string;
  platform: string;
  contentType: string;
  hashtags: string[];
  mediaUrls: string[];
  scheduledTime?: string;
  status: 'draft' | 'scheduled' | 'published';
  aiGenerated: boolean;
  voiceNoteId?: string;
  createdAt: string;
  updatedAt: string;
}

interface ContentCreationPanelProps {
  context: 'campaign' | 'weekly' | 'daily';
  campaignId?: string;
  weekNumber?: number;
  dayNumber?: number;
  onContentSave?: (content: ContentItem[]) => void;
  initialContent?: ContentItem[];
}

export default function ContentCreationPanel({
  context,
  campaignId,
  weekNumber,
  dayNumber,
  onContentSave,
  initialContent = []
}: ContentCreationPanelProps) {
  const [contentItems, setContentItems] = useState<ContentItem[]>(initialContent);
  const [isCreating, setIsCreating] = useState(false);
  const [editingItem, setEditingItem] = useState<ContentItem | null>(null);
  const [showVoiceNotes, setShowVoiceNotes] = useState(false);
  const [isGeneratingAI, setIsGeneratingAI] = useState(false);
  const [selectedPlatform, setSelectedPlatform] = useState('linkedin');
  const [selectedContentType, setSelectedContentType] = useState('post');

  const platforms = [
    { id: 'linkedin', name: 'LinkedIn', icon: '💼' },
    { id: 'twitter', name: 'Twitter', icon: '🐦' },
    { id: 'instagram', name: 'Instagram', icon: '📸' },
    { id: 'facebook', name: 'Facebook', icon: '📘' },
    { id: 'youtube', name: 'YouTube', icon: '📺' },
    { id: 'tiktok', name: 'TikTok', icon: '🎵' }
  ];

  const contentTypes = [
    { id: 'post', name: 'Post', icon: FileText },
    { id: 'video', name: 'Video', icon: Video },
    { id: 'story', name: 'Story', icon: Image },
    { id: 'article', name: 'Article', icon: FileText },
    { id: 'poll', name: 'Poll', icon: Users },
    { id: 'live', name: 'Live', icon: Video }
  ];

  useEffect(() => {
    if (initialContent.length > 0) {
      setContentItems(initialContent);
    }
  }, [initialContent]);

  const createNewContent = () => {
    const newContent: ContentItem = {
      id: `content-${Date.now()}`,
      title: '',
      content: '',
      platform: selectedPlatform,
      contentType: selectedContentType,
      hashtags: [],
      mediaUrls: [],
      status: 'draft',
      aiGenerated: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    setEditingItem(newContent);
    setIsCreating(true);
  };

  const saveContentItem = (item: ContentItem) => {
    const updatedItem = {
      ...item,
      updatedAt: new Date().toISOString()
    };

    if (editingItem?.id === item.id) {
      // Update existing item
      setContentItems(prev => 
        prev.map(content => content.id === item.id ? updatedItem : content)
      );
    } else {
      // Add new item
      setContentItems(prev => [...prev, updatedItem]);
    }

    setIsCreating(false);
    setEditingItem(null);

    // Notify parent component
    if (onContentSave) {
      onContentSave([...contentItems.filter(c => c.id !== item.id), updatedItem]);
    }
  };

  const deleteContentItem = async (itemId: string) => {
    // Check if user is super admin
    try {
      const response = await fetch('/api/admin/check-super-admin');
      const result = await response.json();
      
      if (!result.isSuperAdmin) {
        alert('Access Denied: Only super admins can delete content. Please contact your administrator.');
        return;
      }
    } catch (error) {
      console.error('Error checking super admin status:', error);
      alert('Error verifying permissions. Please try again.');
      return;
    }

    if (confirm('Are you sure you want to delete this content item?')) {
      try {
        // Use the super admin delete API for content
        const deleteResponse = await fetch('/api/admin/delete-content', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contentId: itemId,
            reason: prompt('Please provide a reason for deleting this content:') || 'No reason provided',
            ipAddress: '127.0.0.1',
            userAgent: navigator.userAgent
          })
        });

        if (deleteResponse.ok) {
          const deleteResult = await deleteResponse.json();
          if (deleteResult.success) {
            setContentItems(prev => prev.filter(item => item.id !== itemId));
            if (onContentSave) {
              onContentSave(contentItems.filter(item => item.id !== itemId));
            }
            alert('Content deleted successfully');
          } else {
            alert(`Error: ${deleteResult.error}`);
          }
        } else {
          alert('Failed to delete content');
        }
      } catch (error) {
        console.error('Error deleting content:', error);
        alert('Failed to delete content. Please try again.');
      }
    }
  };

  const duplicateContentItem = (item: ContentItem) => {
    const duplicatedItem: ContentItem = {
      ...item,
      id: `content-${Date.now()}`,
      title: `${item.title} (Copy)`,
      status: 'draft',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    setContentItems(prev => [...prev, duplicatedItem]);
  };

  const generateAIContent = async () => {
    setIsGeneratingAI(true);
    
    try {
      const response = await fetch('/api/ai/generate-content', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          context,
          campaignId,
          weekNumber,
          dayNumber,
          platform: selectedPlatform,
          contentType: selectedContentType,
          requestType: 'content-generation'
        })
      });

      if (response.ok) {
        const result = await response.json();
        
        if (result.content) {
          const aiContent: ContentItem = {
            id: `content-${Date.now()}`,
            title: result.content.title || 'AI Generated Content',
            content: result.content.text || result.content.content || '',
            platform: selectedPlatform,
            contentType: selectedContentType,
            hashtags: result.content.hashtags || [],
            mediaUrls: result.content.mediaUrls || [],
            status: 'draft',
            aiGenerated: true,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          };

          setContentItems(prev => [...prev, aiContent]);
        }
      }
    } catch (error) {
      console.error('Error generating AI content:', error);
    } finally {
      setIsGeneratingAI(false);
    }
  };

  const handleVoiceTranscription = (transcription: any) => {
    if (transcription.text) {
      const voiceContent: ContentItem = {
        id: `content-${Date.now()}`,
        title: 'Voice Note Content',
        content: transcription.text,
        platform: selectedPlatform,
        contentType: selectedContentType,
        hashtags: transcription.keywords || [],
        mediaUrls: [],
        status: 'draft',
        aiGenerated: false,
        voiceNoteId: transcription.id,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      setContentItems(prev => [...prev, voiceContent]);
    }
  };

  const handleSuggestionApply = (suggestion: any) => {
    if (suggestion.action === 'add-content' && suggestion.content) {
      const suggestedContent: ContentItem = {
        id: `content-${Date.now()}`,
        title: suggestion.title || 'Suggested Content',
        content: suggestion.content,
        platform: selectedPlatform,
        contentType: selectedContentType,
        hashtags: suggestion.hashtags || [],
        mediaUrls: [],
        status: 'draft',
        aiGenerated: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      setContentItems(prev => [...prev, suggestedContent]);
    }
  };

  const getContextTitle = () => {
    switch (context) {
      case 'campaign': return 'Campaign Content';
      case 'weekly': return `Week ${weekNumber} Content`;
      case 'daily': return `Day ${dayNumber} Content`;
      default: return 'Content Creation';
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'draft': return 'bg-gray-100 text-gray-800';
      case 'scheduled': return 'bg-blue-100 text-blue-800';
      case 'published': return 'bg-green-100 text-green-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-gradient-to-r from-blue-500 to-cyan-600 rounded-lg">
            <Edit3 className="h-5 w-5 text-white" />
          </div>
          <div>
            <h3 className="font-semibold text-gray-900">{getContextTitle()}</h3>
            <p className="text-sm text-gray-600">Create and manage your content</p>
          </div>
        </div>
        
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowVoiceNotes(!showVoiceNotes)}
            className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
              showVoiceNotes
                ? 'bg-purple-100 text-purple-700'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            <Mic className="h-4 w-4 inline mr-1" />
            Voice Notes
          </button>
          
          <button
            onClick={generateAIContent}
            disabled={isGeneratingAI}
            className="bg-gradient-to-r from-purple-500 to-indigo-600 hover:from-purple-600 hover:to-indigo-700 disabled:opacity-50 text-white px-4 py-2 rounded-lg font-medium transition-all duration-200 flex items-center gap-2"
          >
            {isGeneratingAI ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Generating...
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4" />
                AI Generate
              </>
            )}
          </button>
          
          <button
            onClick={createNewContent}
            className="bg-gradient-to-r from-blue-500 to-cyan-600 hover:from-blue-600 hover:to-cyan-700 text-white px-4 py-2 rounded-lg font-medium transition-all duration-200 flex items-center gap-2"
          >
            <Plus className="h-4 w-4" />
            New Content
          </button>
        </div>
      </div>

      {/* Platform and Content Type Selection */}
      <div className="bg-gray-50 rounded-lg p-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Platform</label>
            <select
              value={selectedPlatform}
              onChange={(e) => setSelectedPlatform(e.target.value)}
              className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              {platforms.map(platform => (
                <option key={platform.id} value={platform.id}>
                  {platform.icon} {platform.name}
                </option>
              ))}
            </select>
          </div>
          
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Content Type</label>
            <select
              value={selectedContentType}
              onChange={(e) => setSelectedContentType(e.target.value)}
              className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              {contentTypes.map(type => (
                <option key={type.id} value={type.id}>
                  {type.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Voice Notes Panel */}
      {showVoiceNotes && (
        <VoiceNotesComponent
          context={context}
          campaignId={campaignId}
          weekNumber={weekNumber}
          dayNumber={dayNumber}
          onTranscriptionComplete={handleVoiceTranscription}
          onSuggestionApply={handleSuggestionApply}
        />
      )}

      {/* Content Items */}
      <div className="space-y-4">
        {contentItems.length === 0 ? (
          <div className="text-center py-12">
            <FileText className="h-16 w-16 text-gray-400 mx-auto mb-4" />
            <h4 className="text-lg font-medium text-gray-900 mb-2">No content yet</h4>
            <p className="text-gray-600 mb-6">Create your first piece of content or use AI to generate ideas</p>
            <div className="flex justify-center gap-3">
              <button
                onClick={createNewContent}
                className="bg-gradient-to-r from-blue-500 to-cyan-600 hover:from-blue-600 hover:to-cyan-700 text-white px-6 py-3 rounded-lg font-medium transition-all duration-200 flex items-center gap-2"
              >
                <Plus className="h-5 w-5" />
                Create Content
              </button>
              <button
                onClick={generateAIContent}
                disabled={isGeneratingAI}
                className="bg-gradient-to-r from-purple-500 to-indigo-600 hover:from-purple-600 hover:to-indigo-700 disabled:opacity-50 text-white px-6 py-3 rounded-lg font-medium transition-all duration-200 flex items-center gap-2"
              >
                <Sparkles className="h-5 w-5" />
                AI Generate
              </button>
            </div>
          </div>
        ) : (
          contentItems.map((item) => (
            <div key={item.id} className="bg-white rounded-lg border border-gray-200 p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-gray-700">{item.title || 'Untitled'}</span>
                    <span className={`text-xs px-2 py-1 rounded ${getStatusColor(item.status)}`}>
                      {item.status}
                    </span>
                  </div>
                        {item.aiGenerated && (
                          <div title="AI Generated">
                            <Sparkles className="h-4 w-4 text-purple-500" />
                          </div>
                        )}
                        {item.voiceNoteId && (
                          <div title="From Voice Note">
                            <Mic className="h-4 w-4 text-blue-500" />
                          </div>
                        )}
                </div>
                
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setEditingItem(item)}
                    className="p-1 hover:bg-blue-100 rounded text-blue-600"
                    title="Edit"
                  >
                    <Edit3 className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => duplicateContentItem(item)}
                    className="p-1 hover:bg-gray-100 rounded text-gray-600"
                    title="Duplicate"
                  >
                    <Copy className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => deleteContentItem(item.id)}
                    className="p-1 hover:bg-red-100 rounded text-red-600"
                    title="Delete"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
              
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-sm text-gray-600">
                  <span className="bg-gray-100 px-2 py-1 rounded">
                    {platforms.find(p => p.id === item.platform)?.icon} {item.platform}
                  </span>
                  <span className="bg-gray-100 px-2 py-1 rounded">
                    {item.contentType}
                  </span>
                  <span className="text-gray-500">
                    {new Date(item.createdAt).toLocaleDateString()}
                  </span>
                </div>
                
                <p className="text-gray-900 line-clamp-3">{item.content}</p>
                
                {item.hashtags.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {item.hashtags.map((hashtag, index) => (
                      <span key={index} className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded">
                        #{hashtag}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      {/* Content Editor Modal */}
      {isCreating && editingItem && (
        <ContentEditor
          content={editingItem}
          onSave={saveContentItem}
          onCancel={() => {
            setIsCreating(false);
            setEditingItem(null);
          }}
        />
      )}
    </div>
  );
}

// Content Editor Component
interface ContentEditorProps {
  content: ContentItem;
  onSave: (content: ContentItem) => void;
  onCancel: () => void;
}

function ContentEditor({ content, onSave, onCancel }: ContentEditorProps) {
  const [editedContent, setEditedContent] = useState<ContentItem>(content);
  const [isSaving, setIsSaving] = useState(false);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await onSave(editedContent);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-lg font-semibold text-gray-900">Edit Content</h3>
          <button
            onClick={onCancel}
            className="p-1 hover:bg-gray-100 rounded text-gray-600"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Title</label>
            <input
              type="text"
              value={editedContent.title}
              onChange={(e) => setEditedContent(prev => ({ ...prev, title: e.target.value }))}
              className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="Content title..."
            />
          </div>
          
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Content</label>
            <textarea
              value={editedContent.content}
              onChange={(e) => setEditedContent(prev => ({ ...prev, content: e.target.value }))}
              className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent h-32 resize-none"
              placeholder="Write your content..."
            />
          </div>
          
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Hashtags</label>
            <input
              type="text"
              value={editedContent.hashtags.join(' ')}
              onChange={(e) => setEditedContent(prev => ({ 
                ...prev, 
                hashtags: e.target.value.split(' ').filter(tag => tag.trim()) 
              }))}
              className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="Enter hashtags separated by spaces..."
            />
          </div>
        </div>
        
        <div className="flex justify-end gap-3 mt-6">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg font-medium transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="bg-gradient-to-r from-blue-500 to-cyan-600 hover:from-blue-600 hover:to-cyan-700 disabled:opacity-50 text-white px-6 py-2 rounded-lg font-medium transition-all duration-200 flex items-center gap-2"
          >
            {isSaving ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <Save className="h-4 w-4" />
                Save Content
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
