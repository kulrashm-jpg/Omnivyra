import React, { useState, useEffect } from 'react';
import { 
  Sparkles, 
  CheckCircle, 
  Edit3, 
  Plus, 
  Calendar,
  ArrowRight,
  RefreshCw,
  Save,
  Eye
} from 'lucide-react';

interface AIContentIntegrationProps {
  campaignId: string;
  aiContent: any; // Content from Campaign AI Assistant
  onContentIntegrated: (weekNumber: number, content: any) => void;
  durationWeeks?: number; // From blueprint.duration_weeks when available
}

export default function AIContentIntegration({ campaignId, aiContent, onContentIntegrated, durationWeeks }: AIContentIntegrationProps) {
  const weeks = durationWeeks ?? 12;
  React.useEffect(() => {
    if (!durationWeeks) {
      console.warn('Campaign duration not explicitly set; inferring from weeks array.');
    }
  }, [durationWeeks]);
  const [selectedWeek, setSelectedWeek] = useState<number>(1);
  const [processedContent, setProcessedContent] = useState<any>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  useEffect(() => {
    if (aiContent) {
      processAIContent();
    }
  }, [aiContent]);

  const processAIContent = () => {
    // Parse AI content from Campaign AI Assistant
    const content = {
      // General content types
      general: [
        "Behind-the-scenes content",
        "User-generated content reposts", 
        "Story highlights for different topics"
      ],
      
      // Platform-specific content
      platforms: {
        linkedin: {
          frequency: "3-4 posts/week",
          contentTypes: [
            "Professional articles and thought leadership",
            "Industry insights and trends", 
            "Company updates and achievements"
          ]
        },
        instagram: {
          frequency: "Daily posts + 3-4 Stories/day",
          contentTypes: [
            "Visual product demonstrations",
            "Behind-the-scenes content",
            "User-generated content reposts",
            "Story highlights for different topics"
          ]
        },
        facebook: {
          frequency: "4-5 posts/week", 
          contentTypes: [
            "Community-focused content",
            "Longer-form educational posts",
            "Event announcements",
            "Customer testimonials"
          ]
        },
        twitter: {
          frequency: "1-2 posts/day",
          contentTypes: [
            "Quick tips and insights",
            "Industry news commentary", 
            "Engagement with industry conversations",
            "Thread series on complex topics"
          ]
        },
        youtube: {
          frequency: "2 videos/week",
          contentTypes: [
            "Tutorial and how-to videos",
            "Product demonstration videos", 
            "Customer success stories",
            "Industry explainer videos"
          ]
        }
      }
    };

    setProcessedContent(content);
  };

  const generateWeeklyContent = async (weekNumber: number) => {
    setIsProcessing(true);
    
    try {
      // Generate content for the selected week
      const weeklyContent = {
        weekNumber,
        theme: `Week ${weekNumber} Theme`,
        focusArea: `Focus area for week ${weekNumber}`,
        contentItems: []
      };

      // Distribute content across platforms for the week
      Object.entries(processedContent.platforms).forEach(([platform, data]: [string, any]) => {
        const platformContent = data.contentTypes.map((contentType: string, index: number) => ({
          id: `${weekNumber}-${platform}-${index}`,
          platform,
          contentType: contentType.toLowerCase().replace(/\s+/g, '_'),
          topic: contentType,
          description: `${contentType} for ${platform}`,
          day: getDayForContent(weekNumber, platform, index),
          hashtags: generateHashtags(contentType, platform),
          aiGenerated: true
        }));

        weeklyContent.contentItems.push(...platformContent);
      });

      // Save to database
      const response = await fetch('/api/campaigns/hierarchical-navigation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create-weekly-content',
          campaignId,
          weekNumber,
          theme: weeklyContent.theme,
          focusArea: weeklyContent.focusArea,
          contentItems: weeklyContent.contentItems
        })
      });

      if (response.ok) {
        onContentIntegrated(weekNumber, weeklyContent);
        alert(`Week ${weekNumber} content generated successfully!`);
      }

    } catch (error) {
      console.error('Error generating weekly content:', error);
      alert('Error generating weekly content');
    } finally {
      setIsProcessing(false);
    }
  };

  const getDayForContent = (weekNumber: number, platform: string, index: number) => {
    const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    return days[index % 7];
  };

  const generateHashtags = (contentType: string, platform: string) => {
    const baseHashtags = ['#content', '#marketing', '#socialmedia'];
    const platformHashtags = {
      linkedin: ['#linkedin', '#professional', '#business'],
      instagram: ['#instagram', '#visual', '#creative'],
      facebook: ['#facebook', '#community', '#engagement'],
      twitter: ['#twitter', '#tips', '#insights'],
      youtube: ['#youtube', '#video', '#tutorial']
    };
    
    return [...baseHashtags, ...(platformHashtags[platform] || [])];
  };

  const generateAllWeeks = async () => {
    setIsProcessing(true);
    
    try {
      for (let week = 1; week <= weeks; week++) {
        await generateWeeklyContent(week);
        // Small delay to avoid overwhelming the API
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      
      alert(`All ${weeks} weeks of content generated successfully!`);
    } catch (error) {
      console.error('Error generating all weeks:', error);
      alert('Error generating all weeks');
    } finally {
      setIsProcessing(false);
    }
  };

  if (!processedContent) {
    return (
      <div className="bg-white rounded-lg shadow-md p-6">
        <div className="text-center">
          <RefreshCw className="w-8 h-8 animate-spin text-orange-500 mx-auto mb-4" />
          <p className="text-gray-600">Processing AI content...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* AI Content Preview */}
      <div className="bg-white rounded-lg shadow-md p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-gray-900 flex items-center">
            <Sparkles className="w-5 h-5 mr-2 text-purple-500" />
            AI Content Integration
          </h3>
          <div className="flex space-x-2">
            <button
              onClick={generateAllWeeks}
              disabled={isProcessing}
              className="flex items-center px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors disabled:opacity-50"
            >
              <Plus className="w-4 h-4 mr-2" />
              Generate All Weeks
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
          {Object.entries(processedContent.platforms).map(([platform, data]: [string, any]) => (
            <div key={platform} className="border rounded-lg p-4">
              <h4 className="font-semibold text-gray-900 capitalize mb-2">{platform}</h4>
              <p className="text-sm text-gray-600 mb-3">{data.frequency}</p>
              <div className="space-y-1">
                {data.contentTypes.slice(0, 3).map((type: string, index: number) => (
                  <div key={index} className="text-xs text-gray-700 bg-gray-50 px-2 py-1 rounded">
                    {type}
                  </div>
                ))}
                {data.contentTypes.length > 3 && (
                  <div className="text-xs text-gray-500">+{data.contentTypes.length - 3} more...</div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Week Selection */}
      <div className="bg-white rounded-lg shadow-md p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Generate Weekly Content</h3>
        
        <div className="flex items-center space-x-4 mb-4">
          <label className="text-sm font-medium text-gray-700">Select Week:</label>
          <select
            value={selectedWeek}
            onChange={(e) => setSelectedWeek(parseInt(e.target.value))}
            className="border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-orange-500 focus:border-transparent"
          >
            {Array.from({ length: weeks }, (_, i) => i + 1).map(week => (
              <option key={week} value={week}>Week {week}</option>
            ))}
          </select>
        </div>

        <div className="flex space-x-3">
          <button
            onClick={() => generateWeeklyContent(selectedWeek)}
            disabled={isProcessing}
            className="flex items-center px-4 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700 transition-colors disabled:opacity-50"
          >
            {isProcessing ? (
              <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <Plus className="w-4 h-4 mr-2" />
            )}
            Generate Week {selectedWeek} Content
          </button>
          
          <button
            onClick={() => window.location.href = `/campaign-planning/hierarchical?campaignId=${campaignId}&week=${selectedWeek}`}
            className="flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            <Eye className="w-4 h-4 mr-2" />
            View Week {selectedWeek}
          </button>
        </div>
      </div>

      {/* Instructions */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <h4 className="font-semibold text-blue-900 mb-2">How to Use:</h4>
        <ol className="text-sm text-blue-800 space-y-1">
          <li>1. Review the AI-generated content suggestions above</li>
          <li>2. Select a week number (1-12) to generate content for</li>
          <li>3. Click &quot;Generate Week X Content&quot; to create weekly content</li>
          <li>4. Click &quot;View Week X&quot; to see the generated content in hierarchical view</li>
          <li>5. Or click &quot;Generate All 12 Weeks&quot; to create the complete campaign</li>
        </ol>
      </div>
    </div>
  );
}
