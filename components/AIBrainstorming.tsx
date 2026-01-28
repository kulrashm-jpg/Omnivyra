// AI Brainstorming Interface for Topic Development
import React, { useState, useRef, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Brain,
  Send,
  X,
  MessageCircle,
  Lightbulb,
  Image as ImageIcon,
  Hash,
  Users,
  Video,
  Globe,
  Sparkles,
  RefreshCw,
  CheckCircle,
  ArrowRight,
  Target,
  Palette,
  FileText,
  Camera,
  Wand2,
} from 'lucide-react';

interface BrainstormSession {
  id: string;
  platform: string;
  initialTopic: string;
  messages: BrainstormMessage[];
  finalTopic: string;
  theme: string;
  contentDirection: string;
  imageIdeas: string[];
  status: 'active' | 'completed' | 'draft';
}

interface BrainstormMessage {
  id: string;
  type: 'user' | 'ai';
  content: string;
  timestamp: Date;
  suggestions?: string[];
  imageIdeas?: string[];
}

interface AIBrainstormingProps {
  platform: string;
  initialTopic: string;
  onComplete: (result: BrainstormSession) => void;
  onClose: () => void;
}

export default function AIBrainstorming({ platform, initialTopic, onComplete, onClose }: AIBrainstormingProps) {
  const [session, setSession] = useState<BrainstormSession>({
    id: `session-${Date.now()}`,
    platform,
    initialTopic,
    messages: [
      {
        id: '1',
        type: 'ai',
        content: `Great! Let's brainstorm about "${initialTopic}" for ${platform}. I can help you refine this topic, explore different angles, and plan the visual content. What specific aspect of this topic interests you most?`,
        timestamp: new Date(),
        suggestions: [
          'Personal experience angle',
          'Industry insights perspective',
          'How-to tutorial approach',
          'Trending news connection',
          'Problem-solving focus'
        ]
      }
    ],
    finalTopic: initialTopic,
    theme: '',
    contentDirection: '',
    imageIdeas: [],
    status: 'active'
  });

  const [currentMessage, setCurrentMessage] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [activeTab, setActiveTab] = useState('conversation');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const platformIcons = {
    linkedin: <Users className="h-4 w-4" />,
    twitter: <Hash className="h-4 w-4" />,
    instagram: <ImageIcon className="h-4 w-4" />,
    youtube: <Video className="h-4 w-4" />,
    facebook: <Globe className="h-4 w-4" />,
  };

  const platformColors = {
    linkedin: 'blue',
    twitter: 'sky',
    instagram: 'pink',
    youtube: 'red',
    facebook: 'indigo',
  };

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [session.messages]);

  const sendMessage = async () => {
    if (!currentMessage.trim()) return;

    const userMessage: BrainstormMessage = {
      id: `msg-${Date.now()}`,
      type: 'user',
      content: currentMessage,
      timestamp: new Date(),
    };

    setSession(prev => ({
      ...prev,
      messages: [...prev.messages, userMessage]
    }));

    setCurrentMessage('');
    setIsTyping(true);

    // Simulate AI response
    setTimeout(() => {
      const aiResponse = generateAIResponse(currentMessage, session);
      const aiMessage: BrainstormMessage = {
        id: `msg-${Date.now() + 1}`,
        type: 'ai',
        content: aiResponse.content,
        timestamp: new Date(),
        suggestions: aiResponse.suggestions,
        imageIdeas: aiResponse.imageIdeas,
      };

      setSession(prev => ({
        ...prev,
        messages: [...prev.messages, aiMessage],
        finalTopic: aiResponse.refinedTopic || prev.finalTopic,
        theme: aiResponse.theme || prev.theme,
        contentDirection: aiResponse.direction || prev.contentDirection,
        imageIdeas: [...prev.imageIdeas, ...(aiResponse.imageIdeas || [])]
      }));

      setIsTyping(false);
    }, 1500);
  };

  const generateAIResponse = (userInput: string, currentSession: BrainstormSession) => {
    // Simulate AI brainstorming responses based on user input
    const responses = [
      {
        content: `That's an excellent angle! For ${currentSession.platform}, this approach could work really well. Let me suggest some refinements:`,
        suggestions: ['Add personal anecdotes', 'Include industry statistics', 'Create actionable takeaways', 'Connect to current trends'],
        imageIdeas: ['Professional headshot', 'Data visualization', 'Behind-the-scenes photo', 'Infographic'],
        refinedTopic: `${currentSession.initialTopic}: A Personal Perspective`,
        theme: 'Personal Growth',
        direction: 'Storytelling with actionable insights'
      },
      {
        content: `I love this direction! This could really resonate with your ${currentSession.platform} audience. Here are some ways to make it even more engaging:`,
        suggestions: ['Add case studies', 'Include expert quotes', 'Create step-by-step guide', 'Share success stories'],
        imageIdeas: ['Process diagram', 'Before/after comparison', 'Team collaboration photo', 'Results chart'],
        refinedTopic: `${currentSession.initialTopic}: The Complete Guide`,
        theme: 'Educational',
        direction: 'Comprehensive how-to with visual aids'
      },
      {
        content: `Perfect! This angle will definitely stand out on ${currentSession.platform}. Let's think about the visual storytelling:`,
        suggestions: ['Use storytelling framework', 'Include real examples', 'Add interactive elements', 'Create series content'],
        imageIdeas: ['Story sequence', 'Interactive infographic', 'Video thumbnail', 'Carousel slides'],
        refinedTopic: `${currentSession.initialTopic}: The Story Behind Success`,
        theme: 'Inspirational',
        direction: 'Narrative-driven with visual storytelling'
      }
    ];

    return responses[Math.floor(Math.random() * responses.length)];
  };

  const handleSuggestionClick = (suggestion: string) => {
    setCurrentMessage(suggestion);
  };

  const handleImageIdeaClick = (imageIdea: string) => {
    setSession(prev => ({
      ...prev,
      imageIdeas: [...prev.imageIdeas, imageIdea]
    }));
  };

  const finalizeSession = () => {
    setSession(prev => ({
      ...prev,
      status: 'completed'
    }));
    onComplete(session);
  };

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <Card className="w-full max-w-6xl max-h-[90vh] overflow-hidden bg-gradient-to-br from-purple-800/50 to-indigo-900/50 border-purple-500/20 shadow-lg backdrop-blur-xl">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className={`p-2 rounded-lg bg-${platformColors[platform as keyof typeof platformColors]}-500/20`}>
                {platformIcons[platform as keyof typeof platformIcons]}
              </div>
              <div>
                <CardTitle className="text-2xl font-bold text-white">AI Brainstorming Session</CardTitle>
                <p className="text-purple-200 text-sm">
                  Refining "{initialTopic}" for {platform.charAt(0).toUpperCase() + platform.slice(1)}
                </p>
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
        <CardContent className="p-0">
          <div className="flex h-[70vh]">
            {/* Left Side - Conversation */}
            <div className="flex-1 flex flex-col">
              {/* Tab Navigation */}
              <div className="flex border-b border-white/10">
                <button
                  onClick={() => setActiveTab('conversation')}
                  className={`px-4 py-3 text-sm font-medium transition-colors ${
                    activeTab === 'conversation'
                      ? 'text-purple-400 border-b-2 border-purple-400'
                      : 'text-gray-400 hover:text-white'
                  }`}
                >
                  <MessageCircle className="h-4 w-4 mr-2 inline" />
                  Conversation
                </button>
                <button
                  onClick={() => setActiveTab('summary')}
                  className={`px-4 py-3 text-sm font-medium transition-colors ${
                    activeTab === 'summary'
                      ? 'text-purple-400 border-b-2 border-purple-400'
                      : 'text-gray-400 hover:text-white'
                  }`}
                >
                  <FileText className="h-4 w-4 mr-2 inline" />
                  Summary
                </button>
              </div>

              {/* Messages */}
              <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {session.messages.map((message) => (
                  <div
                    key={message.id}
                    className={`flex ${message.type === 'user' ? 'justify-end' : 'justify-start'}`}
                  >
                    <div
                      className={`max-w-[80%] p-4 rounded-lg ${
                        message.type === 'user'
                          ? 'bg-purple-500/20 text-white'
                          : 'bg-white/5 text-white'
                      }`}
                    >
                      <p className="mb-2">{message.content}</p>
                      
                      {message.suggestions && (
                        <div className="mt-3">
                          <p className="text-sm text-gray-400 mb-2">Suggestions:</p>
                          <div className="flex flex-wrap gap-2">
                            {message.suggestions.map((suggestion, index) => (
                              <button
                                key={index}
                                onClick={() => handleSuggestionClick(suggestion)}
                                className="px-3 py-1 bg-white/10 hover:bg-white/20 rounded-full text-sm text-gray-300 hover:text-white transition-colors"
                              >
                                {suggestion}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}

                      {message.imageIdeas && (
                        <div className="mt-3">
                          <p className="text-sm text-gray-400 mb-2">Image Ideas:</p>
                          <div className="flex flex-wrap gap-2">
                            {message.imageIdeas.map((idea, index) => (
                              <button
                                key={index}
                                onClick={() => handleImageIdeaClick(idea)}
                                className="px-3 py-1 bg-blue-500/20 hover:bg-blue-500/30 rounded-full text-sm text-blue-300 hover:text-blue-200 transition-colors flex items-center gap-1"
                              >
                                <Camera className="h-3 w-3" />
                                {idea}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                ))}

                {isTyping && (
                  <div className="flex justify-start">
                    <div className="bg-white/5 text-white p-4 rounded-lg">
                      <div className="flex items-center gap-2">
                        <Brain className="h-4 w-4 animate-pulse" />
                        <span>AI is thinking...</span>
                      </div>
                    </div>
                  </div>
                )}

                <div ref={messagesEndRef} />
              </div>

              {/* Input */}
              <div className="p-4 border-t border-white/10">
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={currentMessage}
                    onChange={(e) => setCurrentMessage(e.target.value)}
                    onKeyPress={(e) => e.key === 'Enter' && sendMessage()}
                    placeholder="Share your thoughts, ask questions, or explore ideas..."
                    className="flex-1 bg-white/5 border-white/10 text-white placeholder-gray-500 focus:ring-purple-500 focus:border-purple-500 rounded-lg px-3 py-2"
                  />
                  <Button
                    onClick={sendMessage}
                    disabled={!currentMessage.trim() || isTyping}
                    className="bg-purple-500 hover:bg-purple-600 text-white"
                  >
                    <Send className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </div>

            {/* Right Side - Summary & Planning */}
            <div className="w-80 border-l border-white/10 bg-white/5 p-4">
              <div className="space-y-4">
                {/* Current Topic */}
                <div>
                  <h4 className="text-sm font-semibold text-purple-300 mb-2">Current Topic</h4>
                  <div className="bg-white/5 border border-white/10 rounded-lg p-3">
                    <p className="text-white text-sm">{session.finalTopic}</p>
                  </div>
                </div>

                {/* Theme */}
                <div>
                  <h4 className="text-sm font-semibold text-purple-300 mb-2">Theme</h4>
                  <div className="bg-white/5 border border-white/10 rounded-lg p-3">
                    <p className="text-white text-sm">{session.theme || 'Developing theme...'}</p>
                  </div>
                </div>

                {/* Content Direction */}
                <div>
                  <h4 className="text-sm font-semibold text-purple-300 mb-2">Content Direction</h4>
                  <div className="bg-white/5 border border-white/10 rounded-lg p-3">
                    <p className="text-white text-sm">{session.contentDirection || 'Exploring direction...'}</p>
                  </div>
                </div>

                {/* Image Ideas */}
                <div>
                  <h4 className="text-sm font-semibold text-purple-300 mb-2">Image Ideas</h4>
                  <div className="space-y-2">
                    {session.imageIdeas.map((idea, index) => (
                      <div key={index} className="bg-white/5 border border-white/10 rounded-lg p-2 flex items-center gap-2">
                        <ImageIcon className="h-3 w-3 text-blue-400" />
                        <span className="text-white text-sm">{idea}</span>
                      </div>
                    ))}
                    {session.imageIdeas.length === 0 && (
                      <p className="text-gray-400 text-sm">No image ideas yet...</p>
                    )}
                  </div>
                </div>

                {/* Actions */}
                <div className="pt-4 border-t border-white/10">
                  <Button
                    onClick={finalizeSession}
                    className="w-full bg-gradient-to-r from-purple-500 to-indigo-600 hover:from-purple-600 hover:to-indigo-700 text-white"
                  >
                    <CheckCircle className="h-4 w-4 mr-2" />
                    Finalize Topic & Theme
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
