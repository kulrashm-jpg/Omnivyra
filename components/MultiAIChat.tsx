import React, { useState, useRef, useEffect } from 'react';
import { 
  Send, 
  Mic, 
  MicOff, 
  Upload, 
  FileText, 
  Image, 
  Video, 
  Link,
  X,
  Minimize2,
  Maximize2,
  Settings,
  Key,
  Zap,
  AlertCircle,
  CheckCircle,
  Loader2,
  Brain,
  Sparkles
} from 'lucide-react';

interface ChatMessage {
  id: number;
  type: 'user' | 'ai';
  message: string;
  timestamp: string;
  attachments?: string[];
  provider?: string;
}

interface AIChatProps {
  isOpen: boolean;
  onClose: () => void;
  onMinimize: () => void;
  context?: string;
}

type AIProvider = 'gpt' | 'claude' | 'demo';

export default function AIChat({ isOpen, onClose, onMinimize, context = "general" }: AIChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 1,
      type: 'ai',
      message: `Hello! I'm your AI assistant. I can help you with ${context === 'general' ? 'your content management' : context}. Choose your AI provider and let's get started!`,
      timestamp: new Date().toLocaleTimeString(),
      provider: 'AI Assistant'
    }
  ]);
  const [newMessage, setNewMessage] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const [isTyping, setIsTyping] = useState(false);
  const [attachments, setAttachments] = useState<string[]>([]);
  const [showSettings, setShowSettings] = useState(false);
  const [apiKeys, setApiKeys] = useState({
    openai: '',
    anthropic: ''
  });
  const [selectedProvider, setSelectedProvider] = useState<AIProvider>('demo');
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const sendMessage = async () => {
    if (!newMessage.trim() && attachments.length === 0) return;

    const userMessage: ChatMessage = {
      id: Date.now(),
      type: 'user',
      message: newMessage,
      timestamp: new Date().toLocaleTimeString(),
      attachments: attachments.length > 0 ? [...attachments] : undefined
    };

    setMessages(prev => [...prev, userMessage]);
    setNewMessage('');
    setAttachments([]);
    setIsTyping(true);
    setIsLoading(true);

    try {
      let response: string = '';
      let provider: string;

      // Create AI response message placeholder for streaming
      const aiResponseId = Date.now() + 1;
      const aiResponse: ChatMessage = {
        id: aiResponseId,
        type: 'ai',
        message: '',
        timestamp: new Date().toLocaleTimeString(),
        provider: ''
      };

      if (selectedProvider === 'demo') {
        // Demo mode - simulate AI response
        await new Promise(resolve => setTimeout(resolve, 1500));
        response = generateDemoResponse(newMessage, context);
        provider = 'Demo AI';
        aiResponse.message = response;
        aiResponse.provider = provider;
        setMessages(prev => [...prev, aiResponse]);
      } else if (selectedProvider === 'gpt') {
        provider = 'GPT-4';
        aiResponse.provider = provider;
        setMessages(prev => [...prev, aiResponse]);
        
        // Stream response
        response = await callGPTAPI(
          newMessage, 
          context,
          (chunk: string) => {
            // Update message as chunks arrive
            setMessages(prev => prev.map(msg => 
              msg.id === aiResponseId 
                ? { ...msg, message: msg.message + chunk }
                : msg
            ));
          }
        );
        
        // Final update
        setMessages(prev => prev.map(msg => 
          msg.id === aiResponseId 
            ? { ...msg, message: response }
            : msg
        ));
      } else if (selectedProvider === 'claude') {
        provider = 'Claude 3.5 Sonnet';
        aiResponse.provider = provider;
        setMessages(prev => [...prev, aiResponse]);
        
        // Stream response
        response = await callClaudeAPI(
          newMessage, 
          context,
          (chunk: string) => {
            // Update message as chunks arrive
            setMessages(prev => prev.map(msg => 
              msg.id === aiResponseId 
                ? { ...msg, message: msg.message + chunk }
                : msg
            ));
          }
        );
        
        // Final update
        setMessages(prev => prev.map(msg => 
          msg.id === aiResponseId 
            ? { ...msg, message: response }
            : msg
        ));
      } else {
        throw new Error('Invalid provider');
      }

      setIsTyping(false);
      setIsLoading(false);
    } catch (error) {
      console.error('Error calling AI API:', error);
      const errorResponse: ChatMessage = {
        id: Date.now() + 1,
        type: 'ai',
        message: `Sorry, I encountered an error with ${selectedProvider.toUpperCase()}. Please check your API key and try again.`,
        timestamp: new Date().toLocaleTimeString(),
        provider: 'Error'
      };
      setMessages(prev => [...prev, errorResponse]);
      setIsTyping(false);
      setIsLoading(false);
    }
  };

  const callGPTAPI = async (
    message: string, 
    context: string,
    onChunk?: (chunk: string) => void
  ): Promise<string> => {
    const response = await fetch('/api/ai/gpt-chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message,
        context,
        apiKey: apiKeys.openai,
        stream: true
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: 'OpenAI API error' }));
      throw new Error(errorData.error || 'OpenAI API error');
    }

    // Handle streaming response
    if (response.body) {
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let fullResponse = '';
      let buffer = '';

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = line.slice(6);
              if (data.trim() === '' || data === '[DONE]') continue;

              try {
                const parsed = JSON.parse(data);
                if (parsed.error) {
                  throw new Error(parsed.error);
                }
                if (parsed.content) {
                  fullResponse += parsed.content;
                  if (onChunk) {
                    onChunk(parsed.content);
                  }
                }
                if (parsed.done) {
                  return fullResponse;
                }
              } catch (e) {
                // Skip invalid JSON
              }
            }
          }
        }
        return fullResponse;
      } finally {
        reader.releaseLock();
      }
    }

    // Fallback to non-streaming
    const data = await response.json();
    return data.response || '';
  };

  const callClaudeAPI = async (
    message: string, 
    context: string,
    onChunk?: (chunk: string) => void
  ): Promise<string> => {
    const response = await fetch('/api/ai/claude-chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message,
        context,
        apiKey: apiKeys.anthropic,
        stream: true
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: 'Anthropic API error' }));
      throw new Error(errorData.error || 'Anthropic API error');
    }

    // Handle streaming response
    if (response.body) {
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let fullResponse = '';
      let buffer = '';

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = line.slice(6);
              if (data.trim() === '' || data === '[DONE]') continue;

              try {
                const parsed = JSON.parse(data);
                if (parsed.error) {
                  throw new Error(parsed.error);
                }
                if (parsed.content) {
                  fullResponse += parsed.content;
                  if (onChunk) {
                    onChunk(parsed.content);
                  }
                }
                if (parsed.done) {
                  return fullResponse;
                }
              } catch (e) {
                // Skip invalid JSON
              }
            }
          }
        }
        return fullResponse;
      } finally {
        reader.releaseLock();
      }
    }

    // Fallback to non-streaming
    const data = await response.json();
    return data.response || '';
  };

  const generateDemoResponse = (userMessage: string, context: string): string => {
    const responses = {
      'campaign-planning': [
        "Based on your campaign goals, I recommend focusing on high-engagement content types. For your timeframe, I suggest creating a content mix of 60% educational, 30% promotional, and 10% entertaining content. Would you like me to suggest specific topics?",
        "For your campaign planning, I can help you create a content calendar that maximizes engagement across all platforms. Let me analyze your target audience and suggest optimal posting frequencies.",
        "I can help you define your campaign objectives and create a strategic content plan. What specific goals do you want to achieve with this campaign?"
      ],
      'market-analysis': [
        "I'm analyzing current market trends. The data shows rising interest in AI content creation (+45% growth). Based on trending topics, I recommend focusing on 'Sustainable Business' and 'Digital Marketing' themes for your campaign.",
        "I can help you identify competitor opportunities and audience insights. Your competitor analysis reveals opportunities in video content and LinkedIn engagement.",
        "I can analyze market trends and provide insights on what content is performing well in your industry. What specific market data would you like me to research?"
      ],
      'content-creation': [
        "I can help you create content for each day of your campaign. Based on your campaign goals, I suggest creating 3 LinkedIn articles, 5 Twitter posts, and 2 Instagram stories for this week.",
        "I can write posts, articles, captions, or scripts tailored to your brand voice. What type of content would you like me to create?",
        "I can generate content ideas, write copy, or help optimize existing content. I'll adapt everything to match your brand tone and platform requirements."
      ],
      'schedule-review': [
        "Let me review your campaign schedule. I notice some optimal posting times that could increase engagement by 25%. I suggest adjusting Instagram posts to peak hours.",
        "I can optimize your schedule for maximum reach across all platforms. I can analyze the best times to post based on your audience's activity patterns.",
        "I can help you create the perfect posting schedule that maximizes engagement and reach across all your platforms."
      ],
      'general': [
        "I'm here to help with your content management workflow. What specific area would you like assistance with?",
        "I can help with campaign planning, market analysis, content creation, or scheduling optimization.",
        "Let me know what you'd like to work on, and I'll provide detailed guidance and suggestions."
      ]
    };

    const contextResponses = responses[context as keyof typeof responses] || responses.general;
    return contextResponses[Math.floor(Math.random() * contextResponses.length)];
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files) {
      const fileNames = Array.from(files).map(file => file.name);
      setAttachments(prev => [...prev, ...fileNames]);
    }
  };

  const removeAttachment = (index: number) => {
    setAttachments(prev => prev.filter((_, i) => i !== index));
  };

  const toggleRecording = () => {
    setIsRecording(!isRecording);
  };

  const getProviderIcon = (provider: AIProvider) => {
    switch (provider) {
      case 'gpt': return <Zap className="h-4 w-4" />;
      case 'claude': return <Brain className="h-4 w-4" />;
      case 'demo': return <Sparkles className="h-4 w-4" />;
      default: return <Zap className="h-4 w-4" />;
    }
  };

  const getProviderColor = (provider: AIProvider) => {
    switch (provider) {
      case 'gpt': return 'from-green-500 to-emerald-600';
      case 'claude': return 'from-orange-500 to-red-600';
      case 'demo': return 'from-purple-500 to-violet-600';
      default: return 'from-gray-500 to-slate-600';
    }
  };

  const getProviderName = (provider: AIProvider) => {
    switch (provider) {
      case 'gpt': return 'GPT-4';
      case 'claude': return 'Claude 3.5 Sonnet';
      case 'demo': return 'Demo AI';
      default: return 'AI Assistant';
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl h-[80vh] flex flex-col">
        {/* Header */}
        <div className="bg-gradient-to-r from-indigo-500 to-purple-600 text-white p-4 rounded-t-2xl flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-white/20 rounded-lg">
              {getProviderIcon(selectedProvider)}
            </div>
            <div>
              <h3 className="text-lg font-semibold">AI Assistant</h3>
              <p className="text-indigo-100 text-sm">
                {getProviderName(selectedProvider)} • {context.replace('-', ' ')}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowSettings(!showSettings)}
              className="p-2 hover:bg-white/20 rounded-lg transition-colors"
            >
              <Settings className="h-4 w-4" />
            </button>
            <button
              onClick={onMinimize}
              className="p-2 hover:bg-white/20 rounded-lg transition-colors"
            >
              <Minimize2 className="h-4 w-4" />
            </button>
            <button
              onClick={onClose}
              className="p-2 hover:bg-white/20 rounded-lg transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Settings Panel */}
        {showSettings && (
          <div className="bg-gray-50 border-b border-gray-200 p-4">
            <div className="space-y-4">
              {/* Provider Selection */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">AI Provider</label>
                <div className="flex gap-2">
                  {[
                    { id: 'demo', name: 'Demo AI', icon: Sparkles, color: 'from-purple-500 to-violet-600' },
                    { id: 'gpt', name: 'GPT-4', icon: Zap, color: 'from-green-500 to-emerald-600' },
                    { id: 'claude', name: 'Claude 3.5', icon: Brain, color: 'from-orange-500 to-red-600' }
                  ].map((provider) => {
                    const Icon = provider.icon;
                    return (
                      <button
                        key={provider.id}
                        onClick={() => setSelectedProvider(provider.id as AIProvider)}
                        className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-200 ${
                          selectedProvider === provider.id
                            ? `bg-gradient-to-r ${provider.color} text-white shadow-lg`
                            : 'bg-white border border-gray-300 text-gray-700 hover:bg-gray-50'
                        }`}
                      >
                        <Icon className="h-4 w-4" />
                        {provider.name}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* API Keys */}
              {selectedProvider !== 'demo' && (
                <div className="space-y-3">
                  {selectedProvider === 'gpt' && (
                    <div className="flex items-center gap-2">
                      <Key className="h-4 w-4 text-gray-500" />
                      <input
                        type="password"
                        placeholder="Enter your OpenAI API Key"
                        value={apiKeys.openai}
                        onChange={(e) => setApiKeys(prev => ({ ...prev, openai: e.target.value }))}
                        className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm"
                      />
                    </div>
                  )}
                  {selectedProvider === 'claude' && (
                    <div className="flex items-center gap-2">
                      <Key className="h-4 w-4 text-gray-500" />
                      <input
                        type="password"
                        placeholder="Enter your Anthropic API Key"
                        value={apiKeys.anthropic}
                        onChange={(e) => setApiKeys(prev => ({ ...prev, anthropic: e.target.value }))}
                        className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm"
                      />
                    </div>
                  )}
                </div>
              )}

              {/* Status */}
              <div className="text-xs text-gray-600">
                {selectedProvider === 'demo' ? (
                  <span className="flex items-center gap-1">
                    <CheckCircle className="h-3 w-3 text-green-500" />
                    Demo mode provides simulated AI responses for testing
                  </span>
                ) : (
                  <span className="flex items-center gap-1">
                    <AlertCircle className="h-3 w-3 text-orange-500" />
                    {selectedProvider === 'gpt' ? 'OpenAI' : 'Anthropic'} API requires a valid API key
                  </span>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {messages.map((message) => (
            <div key={message.id} className={`flex ${message.type === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-xs lg:max-w-md px-4 py-3 rounded-lg ${
                message.type === 'user' 
                  ? 'bg-gradient-to-r from-indigo-500 to-purple-600 text-white' 
                  : 'bg-gray-100 text-gray-900'
              }`}>
                <p className="text-sm">{message.message}</p>
                {message.attachments && message.attachments.length > 0 && (
                  <div className="mt-2 space-y-1">
                    {message.attachments.map((attachment, index) => (
                      <div key={index} className="text-xs opacity-75 flex items-center gap-1">
                        <FileText className="h-3 w-3" />
                        {attachment}
                      </div>
                    ))}
                  </div>
                )}
                <div className={`text-xs mt-2 flex items-center gap-1 ${
                  message.type === 'user' ? 'text-indigo-100' : 'text-gray-500'
                }`}>
                  <span>{message.timestamp}</span>
                  {message.provider && (
                    <>
                      <span>•</span>
                      <span className="font-medium">{message.provider}</span>
                    </>
                  )}
                </div>
              </div>
            </div>
          ))}
          
          {isTyping && (
            <div className="flex justify-start">
              <div className="bg-gray-100 text-gray-900 px-4 py-3 rounded-lg">
                <div className="flex items-center gap-2">
                  {isLoading ? (
                    <Loader2 className="h-4 w-4 animate-spin text-indigo-500" />
                  ) : (
                    <div className="flex space-x-1">
                      <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"></div>
                      <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }}></div>
                      <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
                    </div>
                  )}
                  <span className="text-sm text-gray-600">
                    {selectedProvider === 'demo' ? 'Demo AI is thinking...' : 
                     selectedProvider === 'gpt' ? 'GPT-4 is analyzing...' : 
                     'Claude is reasoning...'}
                  </span>
                </div>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Attachments */}
        {attachments.length > 0 && (
          <div className="px-4 py-2 border-t border-gray-200">
            <div className="flex flex-wrap gap-2">
              {attachments.map((attachment, index) => (
                <div key={index} className="flex items-center gap-2 bg-gray-100 px-3 py-1 rounded-lg text-sm">
                  <FileText className="h-3 w-3 text-gray-600" />
                  <span className="text-gray-700">{attachment}</span>
                  <button
                    onClick={() => removeAttachment(index)}
                    className="text-gray-500 hover:text-gray-700"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Input */}
        <div className="p-4 border-t border-gray-200">
          <div className="flex items-center gap-2 mb-2">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              onChange={handleFileUpload}
              className="hidden"
              accept="image/*,video/*,.pdf,.doc,.docx,.txt"
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
            >
              <Upload className="h-4 w-4 text-gray-600" />
            </button>
            <button className="p-2 hover:bg-gray-100 rounded-lg transition-colors">
              <Image className="h-4 w-4 text-gray-600" />
            </button>
            <button className="p-2 hover:bg-gray-100 rounded-lg transition-colors">
              <Video className="h-4 w-4 text-gray-600" />
            </button>
            <button className="p-2 hover:bg-gray-100 rounded-lg transition-colors">
              <Link className="h-4 w-4 text-gray-600" />
            </button>
          </div>
          
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={newMessage}
              onChange={(e) => setNewMessage(e.target.value)}
              onKeyPress={handleKeyPress}
              placeholder={`Ask ${getProviderName(selectedProvider)} anything...`}
              className="flex-1 px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all duration-200"
            />
            <button
              onClick={toggleRecording}
              className={`p-3 rounded-lg transition-colors ${
                isRecording ? 'bg-red-100 text-red-600' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {isRecording ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
            </button>
            <button
              onClick={sendMessage}
              disabled={(!newMessage.trim() && attachments.length === 0) || isLoading}
              className="p-3 bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 disabled:opacity-50 text-white rounded-lg transition-all duration-200"
            >
              {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
