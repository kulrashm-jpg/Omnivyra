import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import AIGenerationProgress from '../components/AIGenerationProgress';
import {
  Brain,
  Calendar,
  CheckCircle,
  XCircle,
  Edit3,
  Image,
  Video,
  Music,
  FileText,
  Sparkles,
  Clock,
  Users,
  Hash,
  Instagram,
  Youtube,
  Facebook,
  ArrowRight,
  Plus,
  Trash2,
  Eye,
  Save,
  Play,
  Pause,
  RotateCcw
} from 'lucide-react';

interface Topic {
  id: string;
  title: string;
  description: string;
  keywords: string[];
  approved: boolean;
  contentCount: number;
}

interface ContentAsset {
  id: string;
  type: 'text' | 'image' | 'video' | 'audio';
  content: string;
  url?: string;
  platform: string;
  approved: boolean;
  aiGenerated: boolean;
}

interface GeneratedContent {
  id: string;
  topicId: string;
  title: string;
  content: string;
  hashtags: string[];
  assets: ContentAsset[];
  platforms: string[];
  scheduledFor: string;
  status: 'draft' | 'approved' | 'scheduled' | 'published';
}

export default function AIContentGenerator() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState('topics');
  const [mainTopic, setMainTopic] = useState('');
  const [topics, setTopics] = useState<Topic[]>([]);
  const [generatedContent, setGeneratedContent] = useState<GeneratedContent[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [selectedTopic, setSelectedTopic] = useState<string | null>(null);
  const [selectedContent, setSelectedContent] = useState<GeneratedContent | null>(null);

  // Generate topics based on main topic
  const generateTopics = async () => {
    if (!mainTopic.trim()) return;
    
    setIsGenerating(true);
    // Mock AI topic generation
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    const mockTopics: Topic[] = [
      {
        id: '1',
        title: `${mainTopic} - Industry Insights`,
        description: 'Share industry trends and insights related to your topic',
        keywords: ['industry', 'trends', 'insights', 'analysis'],
        approved: false,
        contentCount: 0
      },
      {
        id: '2',
        title: `${mainTopic} - Success Stories`,
        description: 'Share success stories and case studies',
        keywords: ['success', 'stories', 'case studies', 'results'],
        approved: false,
        contentCount: 0
      },
      {
        id: '3',
        title: `${mainTopic} - Educational Content`,
        description: 'Educational posts and tutorials',
        keywords: ['education', 'tutorial', 'how-to', 'learning'],
        approved: false,
        contentCount: 0
      },
      {
        id: '4',
        title: `${mainTopic} - Behind the Scenes`,
        description: 'Behind the scenes content and company culture',
        keywords: ['behind the scenes', 'culture', 'team', 'process'],
        approved: false,
        contentCount: 0
      },
      {
        id: '5',
        title: `${mainTopic} - Thought Leadership`,
        description: 'Thought leadership and expert opinions',
        keywords: ['thought leadership', 'expert', 'opinion', 'vision'],
        approved: false,
        contentCount: 0
      }
    ];
    
    setTopics(mockTopics);
    setIsGenerating(false);
  };

  // Generate content for selected topics
  const generateContent = async () => {
    const approvedTopics = topics.filter(t => t.approved);
    if (approvedTopics.length === 0) return;
    
    setIsGenerating(true);
    // Mock AI content generation
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    const newContent: GeneratedContent[] = [];
    approvedTopics.forEach(topic => {
      // Generate 8-12 posts per topic for 3-4 months
      for (let i = 0; i < 10; i++) {
        newContent.push({
          id: `${topic.id}-${i}`,
          topicId: topic.id,
          title: `${topic.title} - Post ${i + 1}`,
          content: `This is AI-generated content for ${topic.title}. It includes engaging and emotional text that resonates with your audience. The content is optimized for social media engagement and includes relevant hashtags and media suggestions.`,
          hashtags: topic.keywords.slice(0, 3),
          assets: [
            {
              id: `${topic.id}-${i}-text`,
              type: 'text',
              content: `AI-generated text content for ${topic.title}`,
              platform: 'all',
              approved: false,
              aiGenerated: true
            },
            {
              id: `${topic.id}-${i}-image`,
              type: 'image',
              content: 'Relevant image suggestion',
              url: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=500',
              platform: 'all',
              approved: false,
              aiGenerated: true
            }
          ],
          platforms: ['linkedin', 'twitter', 'instagram', 'facebook'],
          scheduledFor: new Date(Date.now() + i * 3 * 24 * 60 * 60 * 1000).toISOString(),
          status: 'draft'
        });
      }
    });
    
    setGeneratedContent(newContent);
    setIsGenerating(false);
  };

  const toggleTopicApproval = (topicId: string) => {
    setTopics(prev => prev.map(topic => 
      topic.id === topicId ? { ...topic, approved: !topic.approved } : topic
    ));
  };

  const toggleContentApproval = (contentId: string) => {
    setGeneratedContent(prev => prev.map(content => 
      content.id === contentId ? { ...content, status: content.status === 'approved' ? 'draft' : 'approved' } : content
    ));
  };

  const editContent = (content: GeneratedContent) => {
    setSelectedContent(content);
    router.push(`/creative-scheduler?edit=${content.id}`);
  };

  const getPlatformIcon = (platform: string) => {
    switch (platform) {
      case 'linkedin': return <Users className="h-4 w-4" />;
      case 'twitter': return <Hash className="h-4 w-4" />;
      case 'instagram': return <Instagram className="h-4 w-4" />;
      case 'youtube': return <Youtube className="h-4 w-4" />;
      case 'facebook': return <Facebook className="h-4 w-4" />;
      default: return <Sparkles className="h-4 w-4" />;
    }
  };

  const getAssetIcon = (type: string) => {
    switch (type) {
      case 'text': return <FileText className="h-4 w-4" />;
      case 'image': return <Image className="h-4 w-4" />;
      case 'video': return <Video className="h-4 w-4" />;
      case 'audio': return <Music className="h-4 w-4" />;
      default: return <FileText className="h-4 w-4" />;
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 text-white p-8">
      <Card className="bg-gradient-to-br from-gray-800/50 to-black/50 border-white/10 shadow-lg backdrop-blur-xl mb-8">
        <CardHeader>
          <CardTitle className="flex items-center gap-4 text-2xl">
            <div className="p-3 bg-gradient-to-br from-purple-500 to-pink-500 rounded-xl">
              <Brain className="h-8 w-8 text-white" />
            </div>
            <div>
              <div className="text-3xl font-bold">AI Content Generator</div>
              <div className="text-sm opacity-90">Generate 3-4 months of engaging content automatically</div>
            </div>
          </CardTitle>
        </CardHeader>
      </Card>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
        <TabsList className="grid w-full grid-cols-4 bg-gray-800/50 border-white/10">
          <TabsTrigger value="topics" className="data-[state=active]:bg-purple-600">1. Topics</TabsTrigger>
          <TabsTrigger value="content" className="data-[state=active]:bg-purple-600">2. Content</TabsTrigger>
          <TabsTrigger value="schedule" className="data-[state=active]:bg-purple-600">3. Schedule</TabsTrigger>
          <TabsTrigger value="review" className="data-[state=active]:bg-purple-600">4. Review</TabsTrigger>
        </TabsList>

        <TabsContent value="topics" className="space-y-6">
          <Card className="bg-gradient-to-br from-gray-800/50 to-black/50 border-white/10 shadow-lg backdrop-blur-xl">
            <CardHeader>
              <CardTitle className="text-xl">Step 1: Define Your Main Topic</CardTitle>
              <p className="text-gray-400">Enter your main topic and AI will generate related subtopics for 3-4 months of content</p>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex gap-4">
                <Input
                  value={mainTopic}
                  onChange={(e) => setMainTopic(e.target.value)}
                  placeholder="Enter your main topic (e.g., DrishiQ - AI for Healthcare)"
                  className="bg-white/5 border-white/10 text-white placeholder-gray-500"
                />
                <Button
                  onClick={generateTopics}
                  disabled={!mainTopic.trim() || isGenerating}
                  className="bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600"
                >
                  {isGenerating ? (
                    <>
                      <RotateCcw className="h-4 w-4 mr-2 animate-spin" />
                      Generating...
                    </>
                  ) : (
                    <>
                      <Sparkles className="h-4 w-4 mr-2" />
                      Generate Topics
                    </>
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>

          {isGenerating && (
            <div className="mt-4">
              <AIGenerationProgress
                isActive={true}
                message="Generating…"
                expectedSeconds={35}
              />
            </div>
          )}

          {topics.length > 0 && (
            <Card className="bg-gradient-to-br from-gray-800/50 to-black/50 border-white/10 shadow-lg backdrop-blur-xl">
              <CardHeader>
                <CardTitle className="text-xl">Generated Topics</CardTitle>
                <p className="text-gray-400">Review and approve topics for content generation</p>
              </CardHeader>
              <CardContent>
                <div className="grid gap-4">
                  {topics.map(topic => (
                    <div
                      key={topic.id}
                      className={`p-4 rounded-lg border transition-all duration-300 ${
                        topic.approved
                          ? 'bg-green-500/20 border-green-500/50'
                          : 'bg-white/5 border-white/10 hover:bg-white/10'
                      }`}
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <h3 className="text-lg font-semibold mb-2">{topic.title}</h3>
                          <p className="text-gray-400 mb-3">{topic.description}</p>
                          <div className="flex flex-wrap gap-2">
                            {topic.keywords.map(keyword => (
                              <Badge key={keyword} variant="secondary" className="bg-purple-500/20 text-purple-300">
                                {keyword}
                              </Badge>
                            ))}
                          </div>
                        </div>
                        <Button
                          onClick={() => toggleTopicApproval(topic.id)}
                          className={`ml-4 ${
                            topic.approved
                              ? 'bg-green-500 hover:bg-green-600'
                              : 'bg-white/20 hover:bg-white/30'
                          }`}
                        >
                          {topic.approved ? (
                            <CheckCircle className="h-4 w-4" />
                          ) : (
                            <Plus className="h-4 w-4" />
                          )}
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
                
                <div className="mt-6 flex justify-between items-center">
                  <div className="text-sm text-gray-400">
                    {topics.filter(t => t.approved).length} of {topics.length} topics selected
                  </div>
                  <Button
                    onClick={generateContent}
                    disabled={topics.filter(t => t.approved).length === 0 || isGenerating}
                    className="bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600"
                  >
                    {isGenerating ? (
                      <>
                        <RotateCcw className="h-4 w-4 mr-2 animate-spin" />
                        Generating Content...
                      </>
                    ) : (
                      <>
                        <ArrowRight className="h-4 w-4 mr-2" />
                        Generate Content
                      </>
                    )}
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="content" className="space-y-6">
          <Card className="bg-gradient-to-br from-gray-800/50 to-black/50 border-white/10 shadow-lg backdrop-blur-xl">
            <CardHeader>
              <CardTitle className="text-xl">Generated Content</CardTitle>
              <p className="text-gray-400">Review and approve AI-generated content for each topic</p>
            </CardHeader>
            <CardContent>
              {generatedContent.length === 0 ? (
                <div className="text-center py-8 text-gray-400">
                  <Brain className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p>No content generated yet. Go to Topics tab to generate content.</p>
                </div>
              ) : (
                <div className="grid gap-4">
                  {generatedContent.map(content => (
                    <div
                      key={content.id}
                      className={`p-4 rounded-lg border transition-all duration-300 ${
                        content.status === 'approved'
                          ? 'bg-green-500/20 border-green-500/50'
                          : 'bg-white/5 border-white/10 hover:bg-white/10'
                      }`}
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-2">
                            <h3 className="text-lg font-semibold">{content.title}</h3>
                            <Badge variant="secondary" className="bg-purple-500/20 text-purple-300">
                              {topics.find(t => t.id === content.topicId)?.title}
                            </Badge>
                          </div>
                          <p className="text-gray-400 mb-3 line-clamp-2">{content.content}</p>
                          
                          <div className="flex items-center gap-4 mb-3">
                            <div className="flex items-center gap-2">
                              <span className="text-sm text-gray-400">Platforms:</span>
                              <div className="flex gap-1">
                                {content.platforms.map(platform => (
                                  <div key={platform} className="p-1 bg-white/10 rounded">
                                    {getPlatformIcon(platform)}
                                  </div>
                                ))}
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-sm text-gray-400">Assets:</span>
                              <div className="flex gap-1">
                                {content.assets.map(asset => (
                                  <div key={asset.id} className="p-1 bg-white/10 rounded">
                                    {getAssetIcon(asset.type)}
                                  </div>
                                ))}
                              </div>
                            </div>
                          </div>
                          
                          <div className="flex flex-wrap gap-2">
                            {content.hashtags.map(hashtag => (
                              <Badge key={hashtag} variant="outline" className="text-xs">
                                #{hashtag}
                              </Badge>
                            ))}
                          </div>
                        </div>
                        
                        <div className="flex gap-2 ml-4">
                          <Button
                            onClick={() => editContent(content)}
                            variant="outline"
                            size="sm"
                            className="bg-white/10 border-white/20 text-white hover:bg-white/20"
                          >
                            <Edit3 className="h-4 w-4 mr-1" />
                            Edit
                          </Button>
                          <Button
                            onClick={() => toggleContentApproval(content.id)}
                            size="sm"
                            className={
                              content.status === 'approved'
                                ? 'bg-green-500 hover:bg-green-600'
                                : 'bg-white/20 hover:bg-white/30'
                            }
                          >
                            {content.status === 'approved' ? (
                              <CheckCircle className="h-4 w-4" />
                            ) : (
                              <Plus className="h-4 w-4" />
                            )}
                          </Button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="schedule" className="space-y-6">
          <Card className="bg-gradient-to-br from-gray-800/50 to-black/50 border-white/10 shadow-lg backdrop-blur-xl">
            <CardHeader>
              <CardTitle className="text-xl">Scheduling Configuration</CardTitle>
              <p className="text-gray-400">Configure scheduling preferences for each platform</p>
            </CardHeader>
            <CardContent>
              <div className="text-center py-8 text-gray-400">
                <Calendar className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>Scheduling configuration will be available after content generation.</p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="review" className="space-y-6">
          <Card className="bg-gradient-to-br from-gray-800/50 to-black/50 border-white/10 shadow-lg backdrop-blur-xl">
            <CardHeader>
              <CardTitle className="text-xl">Final Review & Approval</CardTitle>
              <p className="text-gray-400">Review all generated content and approve for scheduling</p>
            </CardHeader>
            <CardContent>
              <div className="text-center py-8 text-gray-400">
                <Eye className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>Final review will be available after content generation.</p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}























