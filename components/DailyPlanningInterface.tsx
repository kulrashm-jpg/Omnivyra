import React, { useState, useEffect } from 'react';
import { 
  Calendar, 
  Clock, 
  Users, 
  Target, 
  Plus, 
  Edit3, 
  Trash2, 
  Save, 
  Sparkles,
  CheckCircle,
  AlertCircle,
  Brain,
  Eye,
  Lock,
  Unlock,
  Loader2,
  Mic,
  FileText,
  Video,
  Image
} from 'lucide-react';
import ContentCreationPanel from './ContentCreationPanel';
import VoiceNotesComponent from './VoiceNotesComponent';

interface DailyActivity {
  id: string;
  day: string;
  date: string;
  time: string;
  platform: string;
  contentType: string;
  title: string;
  description: string;
  status: 'planned' | 'in-progress' | 'completed' | 'committed';
  aiSuggested: boolean;
  aiEdited: boolean;
  content?: any;
  voiceNotes?: any[];
}

interface DailyPlanningInterfaceProps {
  week: any;
  onSave: (weekData: any) => void;
  campaignId: string | null;
  campaignData: any;
}

export default function DailyPlanningInterface({ week, onSave, campaignId, campaignData }: DailyPlanningInterfaceProps) {
  const [dailyActivities, setDailyActivities] = useState<DailyActivity[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [aiSuggestions, setAiSuggestions] = useState<any[]>([]);
  const [showAiSuggestions, setShowAiSuggestions] = useState(false);
  const [aiEditPermission, setAiEditPermission] = useState(false);
  const [isGeneratingSuggestions, setIsGeneratingSuggestions] = useState(false);
  const [activeTab, setActiveTab] = useState<'planning' | 'content' | 'voice'>('planning');
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [showContentPanel, setShowContentPanel] = useState(false);

  const daysOfWeek = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const platforms = ['linkedin', 'facebook', 'instagram', 'twitter', 'youtube', 'tiktok'];
  
  // Platform-specific content types
  const platformContentTypes = {
    linkedin: ['post', 'article', 'video', 'poll', 'document', 'event', 'live'],
    facebook: ['post', 'video', 'story', 'live', 'event', 'poll', 'carousel'],
    instagram: ['post', 'story', 'reel', 'igtv', 'live', 'carousel', 'guide'],
    twitter: ['tweet', 'thread', 'poll', 'spaces', 'fleets', 'video'],
    youtube: ['video', 'short', 'live', 'premiere', 'community_post'],
    tiktok: ['video', 'live', 'story', 'duet', 'stitch']
  };

  const getAllContentTypes = () => {
    return [...new Set(Object.values(platformContentTypes).flat())];
  };

  useEffect(() => {
    initializeDailyActivities();
  }, [week]);

  const initializeDailyActivities = () => {
    const activities: DailyActivity[] = [];
    
    // Generate activities for each day of the week
    daysOfWeek.forEach((day, dayIndex) => {
      const date = new Date(week.dates?.start || new Date());
      date.setDate(date.getDate() + dayIndex);
      
      // Distribute week content across days
      const dayContent = week.content?.slice(dayIndex, dayIndex + 1) || [];
      
      dayContent.forEach((content: any, contentIndex: number) => {
        activities.push({
          id: `${week.weekNumber}-${dayIndex}-${contentIndex}`,
          day: day,
          date: date.toISOString().split('T')[0],
          time: `${9 + contentIndex}:00`,
          platform: content.platform || 'linkedin',
          contentType: content.type || 'post',
          title: content.description || `${day} ${content.type}`,
          description: content.description || `Content for ${day}`,
          status: 'planned',
          aiSuggested: false,
          aiEdited: false
        });
      });
    });

    setDailyActivities(activities);
  };

  const generateAISuggestions = async () => {
    setIsGeneratingSuggestions(true);
    try {
      const response = await fetch('/api/ai/generate-content', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          campaignId,
          weekNumber: week.weekNumber,
          weekData: week,
          campaignData,
          campaignGoals: campaignData.goals || [],
          brandVoice: 'DrishiQ - clarity engine that solves life miseries',
          useAI: true,
          requestType: 'daily-suggestions'
        })
      });

      if (response.ok) {
        const result = await response.json();
        setAiSuggestions(result.suggestions || []);
        setShowAiSuggestions(true);
      }
    } catch (error) {
      console.error('Error generating AI suggestions:', error);
    } finally {
      setIsGeneratingSuggestions(false);
    }
  };

  const improveDailyPlan = async (day: string) => {
    try {
      const response = await fetch('/api/ai/daily-amendment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          campaignId,
          weekNumber: week.weekNumber,
          day,
          currentDailyActivities: dailyActivities.filter(activity => activity.day === day),
          campaignData,
          weekData: week
        })
      });

      if (response.ok) {
        const result = await response.json();
        
        // Show improvement preview
        const confirmed = window.confirm(
          `AI suggests these improvements for ${day}:\n\n${result.improvements}\n\nApply these changes?`
        );

        if (confirmed) {
          // Apply the improvements
          const improvedActivities = result.improvedActivities || [];
          setDailyActivities(prev => 
            prev.filter(activity => activity.day !== day).concat(improvedActivities)
          );
          alert(`✅ ${day} plan improved successfully!`);
        }
      }
    } catch (error) {
      console.error('Error improving daily plan:', error);
      alert('❌ Failed to improve daily plan. Please try again.');
    }
  };

  const commitDailyPlan = async (day: string) => {
    const dayActivities = dailyActivities.filter(activity => activity.day === day);
    
    try {
      const response = await fetch('/api/campaigns/commit-daily-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          campaignId,
          weekNumber: week.weekNumber,
          day,
          activities: dayActivities,
          commitType: 'finalize'
        })
      });

      if (response.ok) {
        alert(`✅ ${day} plan committed successfully!`);
        // Update local state to mark as committed
        setDailyActivities(prev => 
          prev.map(activity => 
            activity.day === day 
              ? { ...activity, status: 'committed' }
              : activity
          )
        );
      } else {
        throw new Error('Failed to commit plan');
      }
    } catch (error) {
      console.error('Error committing daily plan:', error);
      alert('❌ Failed to commit daily plan. Please try again.');
    }
  };

  const applyAISuggestion = (suggestion: any) => {
    const newActivity: DailyActivity = {
      id: `${week.weekNumber}-${Date.now()}`,
      day: suggestion.day || 'Monday',
      date: suggestion.date || new Date().toISOString().split('T')[0],
      time: suggestion.time || '09:00',
      platform: suggestion.platform || 'linkedin',
      contentType: suggestion.contentType || 'post',
      title: suggestion.title || 'AI Suggested Content',
      description: suggestion.description || suggestion.content || '',
      status: 'planned',
      aiSuggested: true,
      aiEdited: false
    };

    setDailyActivities(prev => [...prev, newActivity]);
  };

  const updateActivity = (id: string, updates: Partial<DailyActivity>) => {
    setDailyActivities(prev => 
      prev.map(activity => 
        activity.id === id ? { ...activity, ...updates } : activity
      )
    );
  };

  const deleteActivity = async (id: string) => {
    // Check if user is super admin
    try {
      const response = await fetch('/api/admin/check-super-admin');
      const result = await response.json();
      
      if (!result.isSuperAdmin) {
        alert('Access Denied: Only super admins can delete activities. Please contact your administrator.');
        return;
      }
    } catch (error) {
      console.error('Error checking super admin status:', error);
      alert('Error verifying permissions. Please try again.');
      return;
    }

    if (confirm('Are you sure you want to delete this activity?')) {
      try {
        // Use the super admin delete API for activities
        const deleteResponse = await fetch('/api/admin/delete-activity', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            activityId: id,
            reason: prompt('Please provide a reason for deleting this activity:') || 'No reason provided',
            ipAddress: '127.0.0.1',
            userAgent: navigator.userAgent
          })
        });

        if (deleteResponse.ok) {
          const deleteResult = await deleteResponse.json();
          if (deleteResult.success) {
            setDailyActivities(prev => prev.filter(activity => activity.id !== id));
            alert('Activity deleted successfully');
          } else {
            alert(`Error: ${deleteResult.error}`);
          }
        } else {
          alert('Failed to delete activity');
        }
      } catch (error) {
        console.error('Error deleting activity:', error);
        alert('Failed to delete activity. Please try again.');
      }
    }
  };

  const addNewActivity = (day: string) => {
    const date = new Date(week.dates?.start || new Date());
    const dayIndex = daysOfWeek.indexOf(day);
    date.setDate(date.getDate() + dayIndex);

    const newActivity: DailyActivity = {
      id: `${week.weekNumber}-${Date.now()}`,
      day: day,
      date: date.toISOString().split('T')[0],
      time: '09:00',
      platform: 'linkedin',
      contentType: 'post',
      title: 'New Activity',
      description: '',
      status: 'planned',
      aiSuggested: false,
      aiEdited: false,
      content: null,
      voiceNotes: []
    };

    setDailyActivities(prev => [...prev, newActivity]);
  };

  const openContentPanel = (day: string) => {
    setSelectedDay(day);
    setShowContentPanel(true);
    setActiveTab('content');
  };

  const openVoiceNotes = (day: string) => {
    setSelectedDay(day);
    setActiveTab('voice');
  };

  const handleContentSave = (content: any[]) => {
    if (selectedDay) {
      setDailyActivities(prev => 
        prev.map(activity => 
          activity.day === selectedDay 
            ? { ...activity, content: content }
            : activity
        )
      );
    }
  };

  const handleVoiceTranscription = (transcription: any) => {
    if (selectedDay) {
      setDailyActivities(prev => 
        prev.map(activity => 
          activity.day === selectedDay 
            ? { 
                ...activity, 
                voiceNotes: [...(activity.voiceNotes || []), transcription],
                description: activity.description + '\n\nVoice Note: ' + transcription.text
              }
            : activity
        )
      );
    }
  };

  const saveDailyPlan = () => {
    const weekData = {
      ...week,
      dailyActivities: dailyActivities,
      dailyPlanned: true
    };
    onSave(weekData);
  };

  const getActivitiesForDay = (day: string) => {
    return dailyActivities.filter(activity => activity.day === day);
  };

  return (
    <div className="space-y-6">
      {/* Header with Tabs */}
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-gradient-to-r from-purple-500 to-indigo-600 rounded-lg">
              <Calendar className="h-5 w-5 text-white" />
            </div>
            <div>
              <h3 className="font-semibold text-gray-900">Week {week.weekNumber} Daily Planning</h3>
              <p className="text-sm text-gray-600">Plan your daily activities and content</p>
            </div>
          </div>
          
          <div className="flex items-center gap-2">
            <button
              onClick={() => setAiEditPermission(!aiEditPermission)}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                aiEditPermission 
                  ? 'bg-green-100 text-green-700 hover:bg-green-200' 
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              {aiEditPermission ? <Unlock className="h-4 w-4" /> : <Lock className="h-4 w-4" />}
              {aiEditPermission ? 'AI Can Edit' : 'AI Read Only'}
            </button>
            <button
              onClick={generateAISuggestions}
              disabled={isGeneratingSuggestions}
              className="bg-gradient-to-r from-purple-500 to-indigo-600 hover:from-purple-600 hover:to-indigo-700 disabled:opacity-50 text-white px-4 py-2 rounded-lg font-medium transition-all duration-200 flex items-center gap-2"
            >
              {isGeneratingSuggestions ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Generating...
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4" />
                  Get AI Suggestions
                </>
              )}
            </button>
          </div>
        </div>
        
        {/* Navigation Tabs */}
        <div className="flex space-x-1 bg-gray-100 rounded-lg p-1">
          {[
            { id: 'planning', label: 'Daily Planning', icon: Calendar },
            { id: 'content', label: 'Content Creation', icon: FileText },
            { id: 'voice', label: 'Voice Notes', icon: Mic }
          ].map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-all duration-200 ${
                  activeTab === tab.id
                    ? 'bg-white text-purple-600 shadow-sm'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                <Icon className="h-4 w-4" />
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* AI Suggestions Panel */}
      {showAiSuggestions && aiSuggestions.length > 0 && activeTab === 'planning' && (
        <div className="bg-gradient-to-r from-blue-50 to-cyan-50 rounded-xl p-4 border border-blue-200">
          <h4 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-blue-600" />
            AI Suggestions for Week {week.weekNumber}
          </h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {aiSuggestions.map((suggestion, index) => (
              <div key={index} className="bg-white rounded-lg p-3 border border-blue-200">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-gray-700">{suggestion.day}</span>
                  <button
                    onClick={() => applyAISuggestion(suggestion)}
                    className="text-blue-600 hover:text-blue-700 text-sm font-medium"
                  >
                    Apply
                  </button>
                </div>
                <p className="text-sm text-gray-600">{suggestion.description}</p>
                <div className="flex items-center gap-2 mt-2">
                  <span className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded">
                    {suggestion.platform}
                  </span>
                  <span className="text-xs bg-green-100 text-green-700 px-2 py-1 rounded">
                    {suggestion.contentType}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Content Creation Panel */}
      {activeTab === 'content' && (
        <ContentCreationPanel
          context="daily"
          campaignId={campaignId}
          weekNumber={week.weekNumber}
          dayNumber={selectedDay ? daysOfWeek.indexOf(selectedDay) + 1 : undefined}
          onContentSave={handleContentSave}
        />
      )}

      {/* Voice Notes Panel */}
      {activeTab === 'voice' && (
        <VoiceNotesComponent
          context="daily"
          campaignId={campaignId}
          weekNumber={week.weekNumber}
          dayNumber={selectedDay ? daysOfWeek.indexOf(selectedDay) + 1 : undefined}
          onTranscriptionComplete={handleVoiceTranscription}
        />
      )}

      {/* Daily Activities Grid */}
      {activeTab === 'planning' && (
        <div className="grid grid-cols-1 lg:grid-cols-7 gap-4">
          {daysOfWeek.map((day, dayIndex) => {
            const dayActivities = getActivitiesForDay(day);
            const date = new Date(week.dates?.start || new Date());
            date.setDate(date.getDate() + dayIndex);
            
            return (
              <div key={day} className="bg-gray-50 rounded-xl p-4 border border-gray-200">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <h4 className="font-semibold text-gray-900">{day}</h4>
                    <p className="text-xs text-gray-500">{date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</p>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => improveDailyPlan(day)}
                      className="p-1 hover:bg-purple-100 rounded text-purple-600"
                      title="AI Improve Day Plan"
                    >
                      <Plus className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => openContentPanel(day)}
                      className="p-1 hover:bg-blue-100 rounded text-blue-600"
                      title="Add Content"
                    >
                      <FileText className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => openVoiceNotes(day)}
                      className="p-1 hover:bg-purple-100 rounded text-purple-600"
                      title="Voice Notes"
                    >
                      <Mic className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => addNewActivity(day)}
                      className="p-1 hover:bg-gray-200 rounded text-gray-600"
                      title="Add Activity"
                    >
                      <Plus className="h-4 w-4" />
                    </button>
                    {dayActivities.length > 0 && dayActivities.some(a => a.status !== 'committed') && (
                      <button
                        onClick={() => commitDailyPlan(day)}
                        className="px-2 py-1 bg-green-100 text-green-700 rounded text-xs font-medium hover:bg-green-200"
                        title="Commit Day Plan"
                      >
                        Commit
                      </button>
                    )}
                  </div>
                </div>

              <div className="space-y-2">
                {dayActivities.map((activity) => (
                  <div key={activity.id} className="bg-white rounded-lg p-3 border border-gray-200">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-medium text-gray-700">{activity.time}</span>
                        {activity.aiSuggested && (
                          <div title="AI Suggested">
                            <Sparkles className="h-3 w-3 text-purple-500" />
                          </div>
                        )}
                        {activity.aiEdited && (
                          <div title="AI Edited">
                            <Brain className="h-3 w-3 text-blue-500" />
                          </div>
                        )}
                        {activity.content && (
                          <div title="Has Content">
                            <FileText className="h-3 w-3 text-green-500" />
                          </div>
                        )}
                        {activity.voiceNotes && activity.voiceNotes.length > 0 && (
                          <div title="Has Voice Notes">
                            <Mic className="h-3 w-3 text-purple-500" />
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => updateActivity(activity.id, { status: 'completed' })}
                          className="p-1 hover:bg-green-100 rounded text-green-600"
                        >
                          <CheckCircle className="h-3 w-3" />
                        </button>
                        <button
                          onClick={() => deleteActivity(activity.id)}
                          className="p-1 hover:bg-red-100 rounded text-red-600"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <input
                        type="text"
                        value={activity.title}
                        onChange={(e) => updateActivity(activity.id, { title: e.target.value })}
                        className="w-full text-sm font-medium border-none bg-transparent focus:outline-none"
                        placeholder="Activity title"
                      />
                      
                      <div className="flex gap-2">
                        <select
                          value={activity.platform}
                          onChange={(e) => updateActivity(activity.id, { platform: e.target.value })}
                          className="text-xs border border-gray-200 rounded px-2 py-1"
                        >
                          {platforms.map(platform => (
                            <option key={platform} value={platform}>{platform}</option>
                          ))}
                        </select>
                        <select
                          value={activity.contentType}
                          onChange={(e) => updateActivity(activity.id, { contentType: e.target.value })}
                          className="text-xs border border-gray-200 rounded px-2 py-1"
                        >
                          {(platformContentTypes[activity.platform as keyof typeof platformContentTypes] || getAllContentTypes()).map(type => (
                            <option key={type} value={type}>{type}</option>
                          ))}
                        </select>
                      </div>

                      <textarea
                        value={activity.description}
                        onChange={(e) => updateActivity(activity.id, { description: e.target.value })}
                        className="w-full text-xs border border-gray-200 rounded px-2 py-1 h-16 resize-none"
                        placeholder="Activity description..."
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
        </div>
      )}

      {/* Save Button */}
      <div className="flex justify-end">
        <button
          onClick={saveDailyPlan}
          className="bg-gradient-to-r from-purple-500 to-indigo-600 hover:from-purple-600 hover:to-indigo-700 text-white px-6 py-3 rounded-xl font-semibold shadow-lg hover:shadow-xl transform hover:scale-105 transition-all duration-200 flex items-center gap-2"
        >
          <Save className="h-5 w-5" />
          Save Daily Plan
        </button>
      </div>
    </div>
  );
}




