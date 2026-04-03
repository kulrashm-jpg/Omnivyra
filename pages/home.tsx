import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import Link from 'next/link';
import { 
  Bookmark, BookmarkCheck, CheckCircle2, Circle, Loader2, 
  ChevronDown, ChevronUp, ArrowRight, Zap 
} from 'lucide-react';
import { getSupabaseBrowser } from '../lib/supabaseBrowser';

interface SetupTask {
  id: string;
  name: string;
  description?: string;
  status: 'not_started' | 'in_progress' | 'completed';
  category: 'initial' | 'content' | 'integrations' | 'advanced';
}

interface SetupCard {
  id: string;
  title: string;
  description: string;
  icon: string;
  category: 'initial' | 'content' | 'integrations' | 'advanced';
  tasks: SetupTask[];
  isExpanded: boolean;
}

const SETUP_CARDS: SetupCard[] = [
  {
    id: 'initial',
    title: 'Initial Setup',
    description: 'Start with the essentials - website and social presence',
    icon: '🚀',
    category: 'initial',
    tasks: [
      { id: 'website-domain', name: 'Website Domain', description: 'Add your primary website URL', status: 'not_started', category: 'initial' },
      { id: 'free-report', name: 'Generate Free Report', description: 'Start with a complimentary content analysis', status: 'not_started', category: 'initial' },
      { id: 'social-urls', name: 'Social Media URLs', description: 'Connect your social profiles (LinkedIn, Twitter, Facebook, Instagram)', status: 'not_started', category: 'initial' },
    ],
    isExpanded: true,
  },
  {
    id: 'content',
    title: 'Content & Company Setup',
    description: 'Establish your content foundation and brand profile',
    icon: '📝',
    category: 'content',
    tasks: [
      { id: 'company-profile', name: 'Company Profile', description: 'Create your company profile (auto-syncs across all cards when completed)', status: 'not_started', category: 'content' },
      { id: 'blog-setup', name: 'Blog Setup', description: 'Configure your blog platform and settings', status: 'not_started', category: 'content' },
      { id: 'story-integration', name: 'Story Integration', description: 'Enable story publishing and tracking', status: 'not_started', category: 'content' },
      { id: 'article-integration', name: 'Article Integration', description: 'Connect article publishing platforms', status: 'not_started', category: 'content' },
    ],
    isExpanded: false,
  },
  {
    id: 'integrations',
    title: 'Intelligence & Insights Linkage',
    description: 'Connect data sources and intelligence APIs',
    icon: '🔗',
    category: 'integrations',
    tasks: [
      { id: 'blogs-insights', name: 'Blogs & Insights Connection', description: 'Link blog articles with AI insights', status: 'not_started', category: 'integrations' },
      { id: 'company-profile-link', name: 'Company Profile', description: 'Synced when completed in Content setup', status: 'not_started', category: 'integrations' },
      { id: 'trend-apis', name: 'Trend APIs', description: 'Connect trend and market intelligence tools', status: 'not_started', category: 'integrations' },
      { id: 'social-apis-intel', name: 'Social Media APIs', description: 'Integrate with social platform APIs for data sync', status: 'not_started', category: 'integrations' },
      { id: 'community-apis-intel', name: 'Community APIs', description: 'Enable community engagement tracking', status: 'not_started', category: 'integrations' },
      { id: 'image-apis-intel', name: 'Image APIs', description: 'Connect image generation and optimization tools', status: 'not_started', category: 'integrations' },
      { id: 'lead-capture', name: 'Lead Capture Integration', description: 'Setup lead capture pages and forms', status: 'not_started', category: 'integrations' },
    ],
    isExpanded: false,
  },
  {
    id: 'advanced',
    title: 'Advanced Integrations',
    description: 'Enable premium features and automations',
    icon: '⚙️',
    category: 'advanced',
    tasks: [
      { id: 'social-apis-advanced', name: 'Social Media APIs', description: 'Advanced social media platform connections', status: 'not_started', category: 'advanced' },
      { id: 'chrome-extension', name: 'Chrome Extension', description: 'Install and activate browser extension', status: 'not_started', category: 'advanced' },
      { id: 'community-apis-advanced', name: 'Community APIs', description: 'Advanced community management tools', status: 'not_started', category: 'advanced' },
      { id: 'image-apis-advanced', name: 'Image APIs', description: 'Advanced image processing and generation', status: 'not_started', category: 'advanced' },
      { id: 'social-connection', name: 'Social Media Connection', description: 'Full social media account synchronization', status: 'not_started', category: 'advanced' },
      { id: 'llm-key', name: 'LLM Key Integration', description: 'Add your AI model keys for enhanced features', status: 'not_started', category: 'advanced' },
    ],
    isExpanded: false,
  },
];

export default function Home() {
  const router = useRouter();
  const [cards, setCards] = useState<SetupCard[]>(SETUP_CARDS);
  const [isPinned, setIsPinned] = useState(false);
  const [completedTasks, setCompletedTasks] = useState<Set<string>>(new Set());
  const [inProgressTasks, setInProgressTasks] = useState<Set<string>>(new Set());
  const [userName, setUserName] = useState('');

  // Load pinned state and auth from localStorage
  useEffect(() => {
    const saved = localStorage.getItem('pin_home');
    if (saved) setIsPinned(JSON.parse(saved));
    
    const savedCompleted = localStorage.getItem('setup-completed-tasks');
    if (savedCompleted) setCompletedTasks(new Set(JSON.parse(savedCompleted)));
    
    const savedInProgress = localStorage.getItem('setup-in-progress-tasks');
    if (savedInProgress) setInProgressTasks(new Set(JSON.parse(savedInProgress)));

    // Auth guard
    getSupabaseBrowser().auth.getSession().then(({ data }) => {
      if (!data.session) { router.replace('/login'); return; }
      const name = data.session.user.user_metadata?.full_name as string | undefined;
      if (name) setUserName(name.split(' ')[0]);
    });
  }, [router]);

  // Save pinned state
  const handlePin = () => {
    const newState = !isPinned;
    setIsPinned(newState);
    localStorage.setItem('pin_home', JSON.stringify(newState));
  };

  // Toggle task status (not_started -> in_progress -> completed)
  const handleTaskClick = (taskId: string) => {
    const newCompleted = new Set(completedTasks);
    const newInProgress = new Set(inProgressTasks);

    if (newCompleted.has(taskId)) {
      // Completed -> Not Started
      newCompleted.delete(taskId);
      newInProgress.delete(taskId);
    } else if (newInProgress.has(taskId)) {
      // In Progress -> Completed
      newInProgress.delete(taskId);
      newCompleted.add(taskId);
    } else {
      // Not Started -> In Progress
      newInProgress.add(taskId);
    }

    setCompletedTasks(newCompleted);
    setInProgressTasks(newInProgress);
    localStorage.setItem('setup-completed-tasks', JSON.stringify(Array.from(newCompleted)));
    localStorage.setItem('setup-in-progress-tasks', JSON.stringify(Array.from(newInProgress)));

    // Handle company profile special case - auto-mark as complete in integrations
    if (taskId === 'company-profile' && newCompleted.has(taskId)) {
      const newInProg = new Set(newInProgress);
      newInProg.delete('company-profile-link');
      setInProgressTasks(newInProg);
      newCompleted.add('company-profile-link');
      setCompletedTasks(newCompleted);
      localStorage.setItem('setup-completed-tasks', JSON.stringify(Array.from(newCompleted)));
      localStorage.setItem('setup-in-progress-tasks', JSON.stringify(Array.from(newInProg)));
    }
  };

  // Toggle card expansion
  const toggleCard = (cardId: string) => {
    setCards(cards.map(card => 
      card.id === cardId 
        ? { ...card, isExpanded: !card.isExpanded }
        : card
    ));
  };

  // Calculate progress for each card
  const getCardProgress = (card: SetupCard) => {
    const completed = card.tasks.filter(t => completedTasks.has(t.id)).length;
    const total = card.tasks.length;
    return { completed, total };
  };

  // Get status color helpers
  const getStatusBg = (taskId: string) => {
    if (completedTasks.has(taskId)) return 'bg-green-50 border-green-200 hover:bg-green-100';
    if (inProgressTasks.has(taskId)) return 'bg-blue-50 border-blue-200 hover:bg-blue-100';
    return 'bg-white border-gray-200 hover:bg-gray-50';
  };

  return (
    <>
      <Head>
        <title>Welcome | Virality</title>
      </Head>
      
      <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-gray-100 py-8 px-3 sm:px-4 lg:px-6">
        <div className="max-w-7xl mx-auto">
          
          {/* Header with Pin Button */}
          <div className="flex justify-between items-center mb-8">
            <div>
              <h1 className="text-4xl font-bold text-gray-900">Welcome {userName && `back, ${userName}`}! 👋</h1>
              <p className="text-gray-600 mt-2">Let's get your account set up and ready to create amazing content</p>
            </div>
            <button
              onClick={handlePin}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg font-semibold transition-all ${
                isPinned
                  ? 'bg-blue-600 text-white shadow-lg hover:bg-blue-700'
                  : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
              }`}
              title={isPinned ? 'This page is pinned as your login landing page' : 'Pin this page as your login landing page'}
            >
              {isPinned ? <BookmarkCheck size={20} /> : <Bookmark size={20} />}
              {isPinned ? 'Pinned as Home' : 'Pin as Home'}
            </button>
          </div>

          {/* Main Layout: Welcome + Setup Cards */}
          <div className="grid grid-cols-3 gap-6 mb-12">
            {/* Welcome Section - Left Side (1 column) */}
            <div className="col-span-1">
              <div className="bg-white rounded-xl shadow-lg p-8 sticky top-24 border-2 border-gray-200">
                <div className="mb-6">
                  <div className="text-5xl mb-4">🎯</div>
                  <h2 className="text-2xl font-bold text-gray-900 mb-2">Welcome to Virality</h2>
                  <p className="text-gray-600 text-sm leading-relaxed">
                    Start your journey to creating data-driven content that ranks and converts.
                  </p>
                </div>

                <div className="space-y-4 border-t pt-6">
                  <div>
                    <h3 className="font-semibold text-gray-900 text-sm mb-3">🚀 Quick Start Steps:</h3>
                    <ol className="text-gray-700 text-sm space-y-2.5">
                      <li className="flex gap-3">
                        <span className="font-bold text-blue-600 flex-shrink-0">1.</span>
                        <span>Complete initial setup</span>
                      </li>
                      <li className="flex gap-3">
                        <span className="font-bold text-blue-600 flex-shrink-0">2.</span>
                        <span>Generate your free content report</span>
                      </li>
                      <li className="flex gap-3">
                        <span className="font-bold text-blue-600 flex-shrink-0">3.</span>
                        <span>Explore insights and gaps found</span>
                      </li>
                      <li className="flex gap-3">
                        <span className="font-bold text-blue-600 flex-shrink-0">4.</span>
                        <span>Create and publish content</span>
                      </li>
                    </ol>
                  </div>
                </div>

                <div className="mt-8 pt-6 border-t space-y-3">
                  <button
                    onClick={() => router.push('/command-center')}
                    className="w-full bg-gradient-to-r from-blue-600 to-purple-600 text-white font-bold py-3 rounded-lg hover:shadow-lg transition-all flex items-center justify-center gap-2 hover:from-blue-700 hover:to-purple-700"
                  >
                    <ArrowRight size={18} />
                    Go to Dashboard
                  </button>
                  <Link 
                    href="/dashboard"
                    className="w-full bg-gray-200 text-gray-700 font-semibold py-2.5 rounded-lg hover:bg-gray-300 transition-all text-center"
                  >
                    View Full Dashboard
                  </Link>
                </div>
              </div>
            </div>

            {/* Setup Cards - Right Side (2 columns) */}
            <div className="col-span-2 space-y-4">
              {cards.map((card) => {
                const progress = getCardProgress(card);
                const progressPercent = (progress.completed / progress.total) * 100;

                return (
                  <div
                    key={card.id}
                    className="bg-white rounded-xl shadow-md border-2 border-gray-200 overflow-hidden hover:shadow-lg transition-shadow"
                  >
                    {/* Card Header */}
                    <button
                      onClick={() => toggleCard(card.id)}
                      className="w-full px-6 py-5 flex items-center justify-between hover:bg-gray-50 transition-colors border-b border-gray-100"
                    >
                      <div className="flex items-center gap-4 flex-1 text-left">
                        <span className="text-2xl">{card.icon}</span>
                        <div>
                          <h3 className="font-bold text-gray-900 text-lg">{card.title}</h3>
                          <p className="text-gray-600 text-sm">{card.description}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-4">
                        {/* Progress Indicator */}
                        <div className="text-right">
                          <div className="text-sm font-bold text-gray-900">
                            {progress.completed}/{progress.total}
                          </div>
                          <div className="w-16 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-gradient-to-r from-blue-600 to-purple-600 transition-all"
                              style={{ width: `${progressPercent}%` }}
                            />
                          </div>
                        </div>
                        {card.isExpanded ? (
                          <ChevronUp size={20} className="text-gray-600 flex-shrink-0" />
                        ) : (
                          <ChevronDown size={20} className="text-gray-600 flex-shrink-0" />
                        )}
                      </div>
                    </button>

                    {/* Card Content - Expandable */}
                    {card.isExpanded && (
                      <div className="px-6 py-4 space-y-2 bg-gray-50">
                        {card.tasks.map((task) => (
                          <button
                            key={task.id}
                            onClick={() => handleTaskClick(task.id)}
                            className={`w-full flex items-start gap-3 p-3 rounded-lg border-2 text-left transition-all ${getStatusBg(
                              task.id
                            )}`}
                          >
                            {completedTasks.has(task.id) ? (
                              <CheckCircle2 size={20} className="text-green-600 flex-shrink-0 mt-0.5" />
                            ) : inProgressTasks.has(task.id) ? (
                              <Loader2 size={20} className="text-blue-600 flex-shrink-0 mt-0.5 animate-spin" />
                            ) : (
                              <Circle size={20} className="text-gray-400 flex-shrink-0 mt-0.5" />
                            )}
                            <div className="flex-1">
                              <div className={`font-semibold text-sm ${
                                completedTasks.has(task.id)
                                  ? 'text-green-600 line-through'
                                  : inProgressTasks.has(task.id)
                                  ? 'text-blue-700'
                                  : 'text-gray-900'
                              }`}>
                                {task.name}
                              </div>
                              {task.description && (
                                <div className="text-xs text-gray-600 mt-1">
                                  {task.description}
                                </div>
                              )}
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}

              {/* Additional Info Card */}
              <div className="bg-gradient-to-br from-yellow-50 to-orange-50 rounded-xl p-5 border-2 border-yellow-200">
                <div className="flex gap-3">
                  <Zap size={20} className="text-yellow-600 flex-shrink-0 mt-0.5" />
                  <div className="text-sm">
                    <h4 className="font-bold text-yellow-900 mb-1">💡 Smart Setup Tips</h4>
                    <p className="text-yellow-800">
                      Complete <strong>Initial Setup</strong> first to unlock advanced features. Your company profile will automatically sync across all cards when completed.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
