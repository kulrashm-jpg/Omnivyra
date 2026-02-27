/**
 * Templates List Page
 * 
 * View, create, edit, and manage content templates
 * - Template library
 * - Create new templates
 * - Edit existing templates
 * - Preview templates
 * - Variable substitution
 */

import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { Plus, Edit, Trash2, Eye, Copy, Search, Filter, FileText } from 'lucide-react';

interface Template {
  id: string;
  name: string;
  platform: string;
  content_type: string;
  content: string;
  variables?: string[];
  tags?: string[];
  usage_count?: number;
  created_at: string;
  updated_at: string;
}

export default function Templates() {
  const router = useRouter();
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterPlatform, setFilterPlatform] = useState<string>('all');
  const [filterType, setFilterType] = useState<string>('all');
  const [userId, setUserId] = useState<string>('');
  const [notice, setNotice] = useState<{ type: 'success' | 'error' | 'info'; message: string } | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const notify = (type: 'success' | 'error' | 'info', message: string) => setNotice({ type, message });

  useEffect(() => {
    if (!notice) return;
    const t = window.setTimeout(() => setNotice(null), 3200);
    return () => window.clearTimeout(t);
  }, [notice]);

  useEffect(() => {
    // Get user ID
    const fetchUserId = async () => {
      try {
        const response = await fetch('/api/auth/me');
        if (response.ok) {
          const data = await response.json();
          setUserId(data.user_id || process.env.DEFAULT_USER_ID || '');
        } else {
          setUserId(process.env.DEFAULT_USER_ID || '');
        }
      } catch (error) {
        setUserId(process.env.DEFAULT_USER_ID || '');
      }
      loadTemplates();
    };

    fetchUserId();
  }, []);

  useEffect(() => {
    loadTemplates();
  }, [userId, filterPlatform, filterType]);

  const loadTemplates = async () => {
    if (!userId) return;

    setLoading(true);
    try {
      const params = new URLSearchParams({ user_id: userId });
      if (filterPlatform !== 'all') params.append('platform', filterPlatform);
      // Note: content_type filter might need API update

      const response = await fetch(`/api/templates?${params.toString()}`);
      if (response.ok) {
        const data = await response.json();
        setTemplates(data.data || []);
      }
    } catch (error) {
      console.error('Failed to load templates:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = (templateId: string) => {
    setPendingDeleteId(templateId);
  };

  const confirmDeleteTemplate = async () => {
    if (!pendingDeleteId) return;
    const templateId = pendingDeleteId;
    setPendingDeleteId(null);
    try {
      const response = await fetch(`/api/templates/${templateId}`, { method: 'DELETE' });
      if (response.ok) {
        setTemplates((prev) => prev.filter((t) => t.id !== templateId));
        notify('success', 'Template deleted.');
      } else {
        notify('error', 'Failed to delete template.');
      }
    } catch (error) {
      console.error('Delete error:', error);
      notify('error', 'Failed to delete template.');
    }
  };

  const handlePreview = async (templateId: string) => {
    // Open preview modal or navigate to preview page
    router.push(`/templates/${templateId}/preview`);
  };

  const handleDuplicate = async (template: Template) => {
    // Create a copy with new name
    const newTemplate = {
      ...template,
      name: `${template.name} (Copy)`,
    };
    delete (newTemplate as any).id;
    delete (newTemplate as any).created_at;
    delete (newTemplate as any).updated_at;

    try {
      const response = await fetch('/api/templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: userId, ...newTemplate }),
      });

      if (response.ok) {
        loadTemplates();
      }
    } catch (error) {
      console.error('Duplicate error:', error);
    }
  };

  const filteredTemplates = templates.filter((template) => {
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      return (
        template.name.toLowerCase().includes(query) ||
        template.content.toLowerCase().includes(query) ||
        template.tags?.some((tag) => tag.toLowerCase().includes(query))
      );
    }
    return true;
  });

  if (!userId) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-lg text-gray-500">Loading...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-7xl mx-auto">
        {notice && (
          <div className={`mb-4 rounded-lg border px-3 py-2 text-sm ${notice.type === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : notice.type === 'error' ? 'border-red-200 bg-red-50 text-red-800' : 'border-indigo-200 bg-indigo-50 text-indigo-800'}`} role="status" aria-live="polite">{notice.message}</div>
        )}
        {pendingDeleteId && (
          <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm flex items-center justify-between">
            <span className="text-amber-900">Delete this template?</span>
            <div className="flex gap-2">
              <button type="button" onClick={() => setPendingDeleteId(null)} className="px-3 py-1.5 rounded border border-amber-300 bg-white hover:bg-amber-100">Cancel</button>
              <button type="button" onClick={confirmDeleteTemplate} className="px-3 py-1.5 rounded bg-red-600 text-white hover:bg-red-700">Delete</button>
            </div>
          </div>
        )}
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h1 className="text-3xl font-bold text-gray-900 mb-2">Content Templates</h1>
              <p className="text-gray-600">Create and manage reusable content templates</p>
            </div>
            <button
              onClick={() => router.push('/templates/new')}
              className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium flex items-center space-x-2"
            >
              <Plus className="w-5 h-5" />
              <span>New Template</span>
            </button>
          </div>

          {/* Filters */}
          <div className="flex items-center space-x-4 bg-white p-4 rounded-lg shadow-sm">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
              <input
                type="text"
                placeholder="Search templates..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <select
              value={filterPlatform}
              onChange={(e) => setFilterPlatform(e.target.value)}
              className="px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="all">All Platforms</option>
              <option value="linkedin">LinkedIn</option>
              <option value="twitter">Twitter/X</option>
              <option value="instagram">Instagram</option>
              <option value="facebook">Facebook</option>
              <option value="youtube">YouTube</option>
            </select>
          </div>
        </div>

        {/* Templates Grid */}
        {loading ? (
          <div className="text-center py-12">
            <div className="text-gray-500">Loading templates...</div>
          </div>
        ) : filteredTemplates.length === 0 ? (
          <div className="text-center py-12 bg-white rounded-lg">
            <FileText className="w-16 h-16 mx-auto text-gray-400 mb-4" />
            <p className="text-lg text-gray-600 mb-2">No templates found</p>
            <p className="text-sm text-gray-500 mb-4">
              {searchQuery ? 'Try a different search term' : 'Create your first template to get started'}
            </p>
            {!searchQuery && (
              <button
                onClick={() => router.push('/templates/new')}
                className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
              >
                Create Template
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredTemplates.map((template) => (
              <div
                key={template.id}
                className="bg-white border rounded-lg p-6 hover:shadow-md transition-shadow"
              >
                <div className="flex items-start justify-between mb-4">
                  <div className="flex-1">
                    <h3 className="font-bold text-lg mb-1">{template.name}</h3>
                    <div className="flex items-center space-x-2 mb-2">
                      <span className="px-2 py-1 bg-blue-100 text-blue-800 rounded text-xs font-medium capitalize">
                        {template.platform}
                      </span>
                      <span className="px-2 py-1 bg-gray-100 text-gray-800 rounded text-xs capitalize">
                        {template.content_type}
                      </span>
                    </div>
                  </div>
                </div>

                <p className="text-sm text-gray-600 mb-4 line-clamp-3">
                  {template.content.substring(0, 150)}...
                </p>

                {template.variables && template.variables.length > 0 && (
                  <div className="mb-4">
                    <p className="text-xs text-gray-500 mb-2">Variables:</p>
                    <div className="flex flex-wrap gap-1">
                      {template.variables.map((variable, idx) => (
                        <span
                          key={idx}
                          className="px-2 py-1 bg-purple-100 text-purple-800 rounded text-xs"
                        >
                          {variable}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                <div className="flex items-center justify-between pt-4 border-t">
                  <div className="text-xs text-gray-500">
                    {template.usage_count || 0} uses
                  </div>
                  <div className="flex items-center space-x-2">
                    <button
                      onClick={() => handlePreview(template.id)}
                      className="text-blue-600 hover:text-blue-800"
                      title="Preview"
                    >
                      <Eye className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => router.push(`/templates/${template.id}`)}
                      className="text-gray-600 hover:text-gray-800"
                      title="Edit"
                    >
                      <Edit className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleDuplicate(template)}
                      className="text-green-600 hover:text-green-800"
                      title="Duplicate"
                    >
                      <Copy className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleDelete(template.id)}
                      className="text-red-600 hover:text-red-800"
                      title="Delete"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Stats */}
        {filteredTemplates.length > 0 && (
          <div className="mt-6 bg-white p-4 rounded-lg shadow-sm">
            <p className="text-sm text-gray-600">
              Showing {filteredTemplates.length} of {templates.length} templates
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

