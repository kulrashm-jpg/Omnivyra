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
  Maximize2
} from 'lucide-react';

interface ChatMessage {
  id: number;
  type: 'user' | 'ai';
  message: string;
  timestamp: string;
  attachments?: string[];
}

interface AIChatProps {
  isOpen: boolean;
  onClose: () => void;
  onMinimize: () => void;
  context?: string;
}

export default function AIChat({ isOpen, onClose, onMinimize, context = "general" }: AIChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 1,
      type: 'ai',
      message: `Hello! I'm your AI assistant. I'm here to help you with ${context === 'general' ? 'your content management' : context}. What would you like to know?`,
      timestamp: new Date().toLocaleTimeString()
    }
  ]);
  const [newMessage, setNewMessage] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const [isTyping, setIsTyping] = useState(false);
  const [attachments, setAttachments] = useState<string[]>([]);
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

    // Simulate AI response
    setTimeout(() => {
      const aiResponse: ChatMessage = {
        id: Date.now() + 1,
        type: 'ai',
        message: generateAIResponse(newMessage, context),
        timestamp: new Date().toLocaleTimeString()
      };
      setMessages(prev => [...prev, aiResponse]);
      setIsTyping(false);
    }, 1500);
  };

  const generateAIResponse = (userMessage: string, context: string): string => {
    const responses = {
      'campaign-planning': [
        "Based on your campaign goals, I recommend focusing on high-engagement content types. Would you like me to suggest specific topics?",
        "For your timeframe, I suggest creating a content mix of 60% educational, 30% promotional, and 10% entertaining content.",
        "Let me analyze your target platforms and suggest optimal posting frequencies for each."
      ],
      'market-analysis': [
        "I'm analyzing current market trends. The data shows rising interest in AI content creation (+45% growth). Would you like me to dive deeper into competitor analysis?",
        "Based on trending topics, I recommend focusing on 'Sustainable Business' and 'Digital Marketing' themes for your campaign.",
        "Your competitor analysis reveals opportunities in video content and LinkedIn engagement. Should I create a detailed strategy?"
      ],
      'content-creation': [
        "I can help you create content for each day of your campaign. What type of content would you like to start with?",
        "Based on your campaign goals, I suggest creating 3 LinkedIn articles, 5 Twitter posts, and 2 Instagram stories for this week.",
        "I can generate content ideas, write copy, or help optimize existing content. What do you need?"
      ],
      'schedule-review': [
        "Let me review your campaign schedule. I notice some optimal posting times that could increase engagement by 25%.",
        "Your content distribution looks good, but I suggest adjusting the timing for Instagram posts to peak hours.",
        "I can optimize your schedule for maximum reach across all platforms. Would you like me to make adjustments?"
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
    // In a real implementation, this would start/stop voice recording
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl h-[80vh] flex flex-col">
        {/* Header */}
        <div className="bg-gradient-to-r from-indigo-500 to-purple-600 text-white p-4 rounded-t-2xl flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-white/20 rounded-lg">
              <Send className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-lg font-semibold">AI Assistant</h3>
              <p className="text-indigo-100 text-sm">Ready to help with {context}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
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
                <p className={`text-xs mt-2 ${
                  message.type === 'user' ? 'text-indigo-100' : 'text-gray-500'
                }`}>
                  {message.timestamp}
                </p>
              </div>
            </div>
          ))}
          
          {isTyping && (
            <div className="flex justify-start">
              <div className="bg-gray-100 text-gray-900 px-4 py-3 rounded-lg">
                <div className="flex items-center gap-2">
                  <div className="flex space-x-1">
                    <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"></div>
                    <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }}></div>
                    <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
                  </div>
                  <span className="text-sm text-gray-600">AI is typing...</span>
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
              placeholder="Ask me anything about your content..."
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
              disabled={!newMessage.trim() && attachments.length === 0}
              className="p-3 bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 disabled:opacity-50 text-white rounded-lg transition-all duration-200"
            >
              <Send className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
