// Dynamic Topic Management System
import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Plus,
  Edit,
  Trash2,
  Save,
  X,
  TrendingUp,
  Users,
  Hash,
  Image as ImageIcon,
  Video,
  Globe,
  Brain,
  RefreshCw,
} from 'lucide-react';

interface TopicSuggestion {
  id: string;
  title: string;
  description: string;
  trending: boolean;
  platforms: string[];
  suggestedContent: string;
  category: string;
  tags: string[];
  createdAt: Date;
  updatedAt: Date;
}

export default function TopicManagement() {
  const [topics, setTopics] = useState<TopicSuggestion[]>([]);
  const [isEditing, setIsEditing] = useState(false);
  const [editingTopic, setEditingTopic] = useState<TopicSuggestion | null>(null);
  const [newTopic, setNewTopic] = useState<Partial<TopicSuggestion>>({
    title: '',
    description: '',
    trending: false,
    platforms: [],
    suggestedContent: '',
    category: '',
    tags: []
  });

  const platforms = [
    { id: 'linkedin', name: 'LinkedIn', icon: <Users className="h-4 w-4" /> },
    { id: 'twitter', name: 'Twitter', icon: <Hash className="h-4 w-4" /> },
    { id: 'instagram', name: 'Instagram', icon: <ImageIcon className="h-4 w-4" /> },
    { id: 'youtube', name: 'YouTube', icon: <Video className="h-4 w-4" /> },
    { id: 'facebook', name: 'Facebook', icon: <Globe className="h-4 w-4" /> },
  ];

  const categories = [
    'Technology', 'Business', 'Marketing', 'Personal Development', 
    'Health & Wellness', 'Education', 'Entertainment', 'Lifestyle'
  ];

  // Load topics from API
  useEffect(() => {
    loadTopics();
  }, []);

  const loadTopics = async () => {
    try {
      const response = await fetch('/api/ai/topic-suggestions');
      const data = await response.json();
      if (data.success) {
        setTopics(data.suggestions);
      }
    } catch (error) {
      console.error('Error loading topics:', error);
    }
  };

  const saveTopics = async (updatedTopics: TopicSuggestion[]) => {
    try {
      const response = await fetch('/api/ai/topic-suggestions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ suggestions: updatedTopics }),
      });
      
      if (response.ok) {
        setTopics(updatedTopics);
        setIsEditing(false);
        setEditingTopic(null);
      }
    } catch (error) {
      console.error('Error saving topics:', error);
    }
  };

  const addTopic = () => {
    const topic: TopicSuggestion = {
      id: `topic-${Date.now()}`,
      title: newTopic.title || '',
      description: newTopic.description || '',
      trending: newTopic.trending || false,
      platforms: newTopic.platforms || [],
      suggestedContent: newTopic.suggestedContent || '',
      category: newTopic.category || '',
      tags: newTopic.tags || [],
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const updatedTopics = [...topics, topic];
    saveTopics(updatedTopics);
    setNewTopic({
      title: '',
      description: '',
      trending: false,
      platforms: [],
      suggestedContent: '',
      category: '',
      tags: []
    });
  };

  const editTopic = (topic: TopicSuggestion) => {
    setEditingTopic(topic);
    setIsEditing(true);
  };

  const updateTopic = () => {
    if (!editingTopic) return;

    const updatedTopics = topics.map(topic => 
      topic.id === editingTopic.id ? { ...editingTopic, updatedAt: new Date() } : topic
    );
    saveTopics(updatedTopics);
  };

  const deleteTopic = (topicId: string) => {
    const updatedTopics = topics.filter(topic => topic.id !== topicId);
    saveTopics(updatedTopics);
  };

  const togglePlatform = (platform: string) => {
    if (editingTopic) {
      const platforms = editingTopic.platforms.includes(platform)
        ? editingTopic.platforms.filter(p => p !== platform)
        : [...editingTopic.platforms, platform];
      setEditingTopic({ ...editingTopic, platforms });
    } else {
      const platforms = newTopic.platforms?.includes(platform)
        ? newTopic.platforms.filter(p => p !== platform)
        : [...(newTopic.platforms || []), platform];
      setNewTopic({ ...newTopic, platforms });
    }
  };

  const generateAITopics = async () => {
    try {
      const response = await fetch('/api/ai/topic-suggestions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          count: 5,
          category: 'Technology',
          platforms: ['LinkedIn', 'Twitter', 'YouTube']
        }),
      });
      
      const data = await response.json();
      if (data.success) {
        const aiTopics = data.topics.map((topic: any, index: number) => ({
          ...topic,
          id: `ai-topic-${Date.now()}-${index}`,
          createdAt: new Date(),
          updatedAt: new Date(),
        }));
        
        const updatedTopics = [...topics, ...aiTopics];
        saveTopics(updatedTopics);
      }
    } catch (error) {
      console.error('Error generating AI topics:', error);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 text-white p-8">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-4xl font-bold bg-gradient-to-r from-purple-400 to-pink-400 bg-clip-text text-transparent">
                Topic Management
              </h1>
              <p className="text-gray-400 mt-2">
                Manage and customize AI topic suggestions
              </p>
            </div>
            <div className="flex items-center gap-4">
              <Button
                onClick={generateAITopics}
                className="bg-gradient-to-r from-purple-500 to-indigo-600 hover:from-purple-600 hover:to-indigo-700 text-white"
              >
                <Brain className="h-4 w-4 mr-2" />
                Generate AI Topics
              </Button>
              <Button
                onClick={() => setIsEditing(!isEditing)}
                className="bg-gradient-to-r from-green-500 to-teal-600 hover:from-green-600 hover:to-teal-700 text-white"
              >
                <Edit className="h-4 w-4 mr-2" />
                {isEditing ? 'Cancel Edit' : 'Edit Topics'}
              </Button>
            </div>
          </div>
        </div>

        {/* Add New Topic Form */}
        <Card className="mb-8 bg-gradient-to-br from-gray-800/50 to-black/50 border-white/10 shadow-lg backdrop-blur-xl">
          <CardHeader>
            <CardTitle className="text-white flex items-center gap-2">
              <Plus className="h-5 w-5 text-green-400" />
              Add New Topic
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">Title</label>
                <input
                  type="text"
                  value={newTopic.title || ''}
                  onChange={(e) => setNewTopic({ ...newTopic, title: e.target.value })}
                  placeholder="Enter topic title..."
                  className="w-full bg-white/5 border-white/10 text-white placeholder-gray-500 focus:ring-purple-500 focus:border-purple-500 rounded-lg px-3 py-2"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">Category</label>
                <select
                  value={newTopic.category || ''}
                  onChange={(e) => setNewTopic({ ...newTopic, category: e.target.value })}
                  className="w-full bg-white/5 border-white/10 text-white focus:ring-purple-500 focus:border-purple-500 rounded-lg px-3 py-2"
                >
                  <option value="">Select Category</option>
                  {categories.map(category => (
                    <option key={category} value={category}>{category}</option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">Description</label>
              <textarea
                value={newTopic.description || ''}
                onChange={(e) => setNewTopic({ ...newTopic, description: e.target.value })}
                placeholder="Describe the topic..."
                className="w-full h-24 bg-white/5 border-white/10 text-white placeholder-gray-500 focus:ring-purple-500 focus:border-purple-500 rounded-lg p-3 resize-none"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">Platforms</label>
              <div className="flex flex-wrap gap-2">
                {platforms.map(platform => (
                  <button
                    key={platform.id}
                    onClick={() => togglePlatform(platform.name)}
                    className={`px-3 py-2 rounded-lg border transition-all duration-300 flex items-center gap-2 ${
                      newTopic.platforms?.includes(platform.name)
                        ? 'bg-purple-500/20 border-purple-400 text-purple-300'
                        : 'bg-white/5 border-white/10 text-gray-400 hover:bg-white/10'
                    }`}
                  >
                    {platform.icon}
                    {platform.name}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">Suggested Content</label>
              <textarea
                value={newTopic.suggestedContent || ''}
                onChange={(e) => setNewTopic({ ...newTopic, suggestedContent: e.target.value })}
                placeholder="Suggested content approach..."
                className="w-full h-20 bg-white/5 border-white/10 text-white placeholder-gray-500 focus:ring-purple-500 focus:border-purple-500 rounded-lg p-3 resize-none"
              />
            </div>

            <div className="flex items-center gap-4">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={newTopic.trending || false}
                  onChange={(e) => setNewTopic({ ...newTopic, trending: e.target.checked })}
                  className="rounded border-white/20 bg-white/5 text-purple-500 focus:ring-purple-500"
                />
                <span className="text-sm text-gray-300">Trending Topic</span>
              </label>
            </div>

            <Button
              onClick={addTopic}
              disabled={!newTopic.title || !newTopic.description}
              className="bg-gradient-to-r from-green-500 to-teal-600 hover:from-green-600 hover:to-teal-700 text-white"
            >
              <Plus className="h-4 w-4 mr-2" />
              Add Topic
            </Button>
          </CardContent>
        </Card>

        {/* Topics List */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {topics.map((topic) => (
            <Card key={topic.id} className="bg-gradient-to-br from-gray-800/50 to-black/50 border-white/10 shadow-lg backdrop-blur-xl">
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <CardTitle className="text-white text-lg mb-2">{topic.title}</CardTitle>
                    {topic.trending && (
                      <Badge className="bg-green-500/20 text-green-400 border-green-500/30 mb-2">
                        <TrendingUp className="h-3 w-3 mr-1" />
                        Trending
                      </Badge>
                    )}
                    <Badge variant="secondary" className="bg-purple-500/20 text-purple-300">
                      {topic.category}
                    </Badge>
                  </div>
                  {isEditing && (
                    <div className="flex gap-2">
                      <Button
                        onClick={() => editTopic(topic)}
                        size="sm"
                        variant="outline"
                        className="border-blue-400/50 text-blue-300 hover:bg-blue-500/20"
                      >
                        <Edit className="h-3 w-3" />
                      </Button>
                      <Button
                        onClick={() => deleteTopic(topic.id)}
                        size="sm"
                        variant="outline"
                        className="border-red-400/50 text-red-300 hover:bg-red-500/20"
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  )}
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-gray-300 text-sm">{topic.description}</p>
                
                <div>
                  <p className="text-xs text-gray-400 mb-2">Platforms:</p>
                  <div className="flex flex-wrap gap-1">
                    {topic.platforms.map(platform => (
                      <Badge key={platform} variant="secondary" className="text-xs bg-white/10 text-gray-300">
                        {platform}
                      </Badge>
                    ))}
                  </div>
                </div>

                <div className="text-xs text-gray-500">
                  Created: {new Date(topic.createdAt).toLocaleDateString()}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Edit Topic Modal */}
        {editingTopic && (
          <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
            <Card className="w-full max-w-2xl bg-gradient-to-br from-gray-800/50 to-black/50 border-white/10 shadow-lg backdrop-blur-xl">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-white">Edit Topic</CardTitle>
                  <Button
                    onClick={() => setEditingTopic(null)}
                    variant="outline"
                    size="sm"
                    className="border-white/20 text-white hover:bg-white/10"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">Title</label>
                    <input
                      type="text"
                      value={editingTopic.title}
                      onChange={(e) => setEditingTopic({ ...editingTopic, title: e.target.value })}
                      className="w-full bg-white/5 border-white/10 text-white focus:ring-purple-500 focus:border-purple-500 rounded-lg px-3 py-2"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">Category</label>
                    <select
                      value={editingTopic.category}
                      onChange={(e) => setEditingTopic({ ...editingTopic, category: e.target.value })}
                      className="w-full bg-white/5 border-white/10 text-white focus:ring-purple-500 focus:border-purple-500 rounded-lg px-3 py-2"
                    >
                      {categories.map(category => (
                        <option key={category} value={category}>{category}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">Description</label>
                  <textarea
                    value={editingTopic.description}
                    onChange={(e) => setEditingTopic({ ...editingTopic, description: e.target.value })}
                    className="w-full h-24 bg-white/5 border-white/10 text-white focus:ring-purple-500 focus:border-purple-500 rounded-lg p-3 resize-none"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">Platforms</label>
                  <div className="flex flex-wrap gap-2">
                    {platforms.map(platform => (
                      <button
                        key={platform.id}
                        onClick={() => togglePlatform(platform.name)}
                        className={`px-3 py-2 rounded-lg border transition-all duration-300 flex items-center gap-2 ${
                          editingTopic.platforms.includes(platform.name)
                            ? 'bg-purple-500/20 border-purple-400 text-purple-300'
                            : 'bg-white/5 border-white/10 text-gray-400 hover:bg-white/10'
                        }`}
                      >
                        {platform.icon}
                        {platform.name}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex items-center gap-4">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={editingTopic.trending}
                      onChange={(e) => setEditingTopic({ ...editingTopic, trending: e.target.checked })}
                      className="rounded border-white/20 bg-white/5 text-purple-500 focus:ring-purple-500"
                    />
                    <span className="text-sm text-gray-300">Trending Topic</span>
                  </label>
                </div>

                <div className="flex justify-end gap-3">
                  <Button
                    onClick={() => setEditingTopic(null)}
                    variant="outline"
                    className="border-white/20 text-white hover:bg-white/10"
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={updateTopic}
                    className="bg-gradient-to-r from-purple-500 to-indigo-600 hover:from-purple-600 hover:to-indigo-700 text-white"
                  >
                    <Save className="h-4 w-4 mr-2" />
                    Save Changes
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}
