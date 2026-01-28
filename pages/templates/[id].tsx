/**
 * Template Editor Page
 * 
 * Create or edit content templates
 * - Template name, platform, content type
 * - Content editor with variable support
 * - Variable preview
 * - Template rendering preview
 */

import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { Save, X, Eye, AlertCircle } from 'lucide-react';

interface Template {
  id?: string;
  name: string;
  platform: string;
  content_type: string;
  content: string;
  variables?: string[];
  tags?: string[];
  is_public?: boolean;
}

export default function TemplateEditor() {
  const router = useRouter();
  const { id } = router.query;
  const isEditing = id !== 'new';

  const [template, setTemplate] = useState<Template>({
    name: '',
    platform: 'linkedin',
    content_type: 'post',
    content: '',
    variables: [],
    tags: [],
    is_public: false,
  });

  const [renderedPreview, setRenderedPreview] = useState<string>('');
  const [showPreview, setShowPreview] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [userId, setUserId] = useState<string>('');

  useEffect(() => {
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

      if (isEditing && id) {
        loadTemplate(id as string);
      }
    };

    fetchUserId();
  }, [isEditing, id]);

  const loadTemplate = async (templateId: string) => {
    setLoading(true);
    try {
      const response = await fetch(`/api/templates/${templateId}`);
      if (response.ok) {
        const data = await response.json();
        setTemplate(data.data || template);
      }
    } catch (error) {
      console.error('Failed to load template:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // Extract variables from content (e.g., {brand_name}, {product_name})
    const variableRegex = /\{(\w+)\}/g;
    const matches = Array.from(template.content.matchAll(variableRegex));
    const variables = [...new Set(matches.map((m) => m[1]))];
    setTemplate((prev) => ({ ...prev, variables }));
  }, [template.content]);

  const handlePreview = async () => {
    if (!id && template.id) return; // Can't preview new templates without saving

    try {
      // Use sample data for preview
      const sampleData: Record<string, string> = {};
      template.variables?.forEach((varName) => {
        sampleData[varName] = `Sample${varName.charAt(0).toUpperCase() + varName.slice(1)}`;
      });

      const response = await fetch(`/api/templates/${id || 'preview'}/render`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ variables: sampleData }),
      });

      if (response.ok) {
        const data = await response.json();
        setRenderedPreview(data.data?.rendered_content || '');
        setShowPreview(true);
      } else {
        // For new templates, do simple variable replacement
        let preview = template.content;
        template.variables?.forEach((varName) => {
          preview = preview.replace(
            new RegExp(`\\{${varName}\\}`, 'g'),
            `Sample${varName.charAt(0).toUpperCase() + varName.slice(1)}`
          );
        });
        setRenderedPreview(preview);
        setShowPreview(true);
      }
    } catch (error) {
      console.error('Preview error:', error);
      // Fallback to simple replacement
      let preview = template.content;
      template.variables?.forEach((varName) => {
        preview = preview.replace(
          new RegExp(`\\{${varName}\\}`, 'g'),
          `Sample${varName.charAt(0).toUpperCase() + varName.slice(1)}`
        );
      });
      setRenderedPreview(preview);
      setShowPreview(true);
    }
  };

  const handleSave = async () => {
    if (!template.name || !template.content || !userId) {
      alert('Please fill in all required fields');
      return;
    }

    setSaving(true);
    try {
      const url = isEditing ? `/api/templates/${id}` : '/api/templates';
      const method = isEditing ? 'PUT' : 'POST';

      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: userId, ...template }),
      });

      if (response.ok) {
        const data = await response.json();
        if (!isEditing) {
          router.push(`/templates/${data.data.id}`);
        } else {
          alert('Template saved successfully!');
        }
      } else {
        const error = await response.json();
        alert(error.error || 'Failed to save template');
      }
    } catch (error) {
      console.error('Save error:', error);
      alert('Failed to save template');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-gray-500">Loading template...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 mb-2">
              {isEditing ? 'Edit Template' : 'Create Template'}
            </h1>
            <p className="text-gray-600">Build reusable content templates with variables</p>
          </div>
          <button
            onClick={() => router.push('/templates')}
            className="text-gray-600 hover:text-gray-800"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Form */}
        <div className="bg-white rounded-lg shadow p-6 space-y-6">
          {/* Basic Info */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Template Name *
              </label>
              <input
                type="text"
                value={template.name}
                onChange={(e) => setTemplate({ ...template, name: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="e.g., Product Launch Post"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Platform *
              </label>
              <select
                value={template.platform}
                onChange={(e) => setTemplate({ ...template, platform: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="linkedin">LinkedIn</option>
                <option value="twitter">Twitter/X</option>
                <option value="instagram">Instagram</option>
                <option value="facebook">Facebook</option>
                <option value="youtube">YouTube</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Content Type *
              </label>
              <select
                value={template.content_type}
                onChange={(e) => setTemplate({ ...template, content_type: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="post">Post</option>
                <option value="story">Story</option>
                <option value="reel">Reel</option>
                <option value="video">Video</option>
              </select>
            </div>
            <div className="flex items-end">
              <label className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  checked={template.is_public}
                  onChange={(e) => setTemplate({ ...template, is_public: e.target.checked })}
                  className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500"
                />
                <span className="text-sm text-gray-700">Make template public</span>
              </label>
            </div>
          </div>

          {/* Content Editor */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="block text-sm font-medium text-gray-700">
                Content *
              </label>
              <div className="text-xs text-gray-500">
                Use {'{variable_name}'} for variables
              </div>
            </div>
            <textarea
              value={template.content}
              onChange={(e) => setTemplate({ ...template, content: e.target.value })}
              rows={10}
              className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono text-sm"
              placeholder="Enter your template content here. Use {brand_name}, {product_name}, etc. for variables."
            />
          </div>

          {/* Variables Display */}
          {template.variables && template.variables.length > 0 && (
            <div className="bg-purple-50 border border-purple-200 rounded-lg p-4">
              <p className="text-sm font-medium text-purple-900 mb-2">Detected Variables:</p>
              <div className="flex flex-wrap gap-2">
                {template.variables.map((variable) => (
                  <span
                    key={variable}
                    className="px-3 py-1 bg-purple-100 text-purple-800 rounded text-sm"
                  >
                    {'{'}{variable}{'}'}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Preview */}
          {showPreview && (
            <div className="bg-gray-50 border rounded-lg p-4">
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-medium text-gray-700">Preview:</p>
                <button
                  onClick={() => setShowPreview(false)}
                  className="text-gray-500 hover:text-gray-700"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="bg-white border rounded p-3 text-sm text-gray-800 whitespace-pre-wrap">
                {renderedPreview || template.content}
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center justify-between pt-4 border-t">
            <button
              onClick={handlePreview}
              className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 font-medium flex items-center space-x-2"
            >
              <Eye className="w-4 h-4" />
              <span>Preview</span>
            </button>
            <div className="flex items-center space-x-3">
              <button
                onClick={() => router.push('/templates')}
                className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 font-medium"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium flex items-center space-x-2 disabled:opacity-50"
              >
                <Save className="w-4 h-4" />
                <span>{saving ? 'Saving...' : 'Save Template'}</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

