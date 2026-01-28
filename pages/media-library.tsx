/**
 * Media Library Page
 * 
 * Browse, manage, and upload media files
 * - View all uploaded media
 * - Upload new files
 * - Filter by type, campaign, date
 * - Delete media files
 * - Link media to posts
 */

import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { Upload, Search, Filter, Grid, List, Trash2, Link as LinkIcon, Download, Video, Music, File as FileIcon } from 'lucide-react';
import MediaUploader from '../components/MediaUploader';

interface MediaFile {
  id: string;
  file_name: string;
  file_url: string;
  media_type: 'image' | 'video' | 'audio' | 'document';
  file_size: number;
  width?: number;
  height?: number;
  duration?: number;
  campaign_id?: string;
  created_at: string;
}

export default function MediaLibrary() {
  const router = useRouter();
  const [mediaFiles, setMediaFiles] = useState<MediaFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [filterType, setFilterType] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  const [showUploader, setShowUploader] = useState(false);
  const [userId, setUserId] = useState<string>('');

  useEffect(() => {
    // Get user ID (from session or props)
    const fetchUserId = async () => {
      try {
        // TODO: Get from auth session
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
      loadMediaFiles();
    };

    fetchUserId();
  }, []);

  const loadMediaFiles = async () => {
    if (!userId) return;

    setLoading(true);
    try {
      const params = new URLSearchParams({ user_id: userId });
      if (filterType !== 'all') {
        params.append('media_type', filterType);
      }

      const response = await fetch(`/api/media/list?${params.toString()}`);
      if (response.ok) {
        const data = await response.json();
        setMediaFiles(data.data || []);
      }
    } catch (error) {
      console.error('Failed to load media:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadMediaFiles();
  }, [filterType, userId]);

  const handleDelete = async (fileId: string) => {
    if (!confirm('Are you sure you want to delete this file?')) return;

    try {
      const response = await fetch(`/api/media/${fileId}`, {
        method: 'DELETE',
      });

      if (response.ok) {
        setMediaFiles((prev) => prev.filter((f) => f.id !== fileId));
      } else {
        alert('Failed to delete file');
      }
    } catch (error) {
      console.error('Delete error:', error);
      alert('Failed to delete file');
    }
  };

  const handleUploadComplete = (files: MediaFile[]) => {
    setMediaFiles((prev) => [...files, ...prev]);
    setShowUploader(false);
  };

  const filteredFiles = mediaFiles.filter((file) => {
    if (searchQuery) {
      return file.file_name.toLowerCase().includes(searchQuery.toLowerCase());
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
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h1 className="text-3xl font-bold text-gray-900 mb-2">Media Library</h1>
              <p className="text-gray-600">
                Manage your images, videos, audio files, and documents
              </p>
            </div>
            <button
              onClick={() => setShowUploader(!showUploader)}
              className="px-6 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 font-medium flex items-center space-x-2"
            >
              <Upload className="w-5 h-5" />
              <span>Upload Media</span>
            </button>
          </div>

          {/* Filters */}
          <div className="flex items-center space-x-4 bg-white p-4 rounded-lg shadow-sm">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
              <input
                type="text"
                placeholder="Search files..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <select
              value={filterType}
              onChange={(e) => setFilterType(e.target.value)}
              className="px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="all">All Types</option>
              <option value="image">Images</option>
              <option value="video">Videos</option>
              <option value="audio">Audio</option>
              <option value="document">Documents</option>
            </select>
            <div className="flex items-center space-x-2 border rounded-lg p-1">
              <button
                onClick={() => setViewMode('grid')}
                className={`p-2 rounded ${viewMode === 'grid' ? 'bg-blue-100 text-blue-600' : 'text-gray-600'}`}
              >
                <Grid className="w-5 h-5" />
              </button>
              <button
                onClick={() => setViewMode('list')}
                className={`p-2 rounded ${viewMode === 'list' ? 'bg-blue-100 text-blue-600' : 'text-gray-600'}`}
              >
                <List className="w-5 h-5" />
              </button>
            </div>
          </div>
        </div>

        {/* Uploader */}
        {showUploader && (
          <div className="mb-8 bg-white p-6 rounded-lg shadow-sm">
            <MediaUploader
              userId={userId}
              onUploadComplete={handleUploadComplete}
              onError={(error) => alert(error)}
            />
          </div>
        )}

        {/* Media Grid/List */}
        {loading ? (
          <div className="text-center py-12">
            <div className="text-gray-500">Loading media files...</div>
          </div>
        ) : filteredFiles.length === 0 ? (
          <div className="text-center py-12 bg-white rounded-lg">
            <Upload className="w-16 h-16 mx-auto text-gray-400 mb-4" />
            <p className="text-lg text-gray-600 mb-2">No media files found</p>
            <p className="text-sm text-gray-500 mb-4">
              {searchQuery ? 'Try a different search term' : 'Upload your first media file to get started'}
            </p>
            {!searchQuery && (
              <button
                onClick={() => setShowUploader(true)}
                className="px-6 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
              >
                Upload Media
              </button>
            )}
          </div>
        ) : (
          <div
            className={
              viewMode === 'grid'
                ? 'grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4'
                : 'space-y-2'
            }
          >
            {filteredFiles.map((file) => (
              <div
                key={file.id}
                className={`bg-white border rounded-lg overflow-hidden hover:shadow-md transition-shadow ${
                  viewMode === 'list' ? 'flex items-center p-4' : ''
                }`}
              >
                {viewMode === 'grid' ? (
                  <>
                    {file.media_type === 'image' && (
                      <img
                        src={file.file_url}
                        alt={file.file_name}
                        className="w-full h-48 object-cover"
                      />
                    )}
                    {file.media_type === 'video' && (
                      <div className="w-full h-48 bg-gray-900 flex items-center justify-center">
                        <Video className="w-16 h-16 text-white" />
                      </div>
                    )}
                    {file.media_type === 'audio' && (
                      <div className="w-full h-48 bg-gray-100 flex items-center justify-center">
                        <Music className="w-16 h-16 text-gray-400" />
                      </div>
                    )}
                    {file.media_type === 'document' && (
                      <div className="w-full h-48 bg-gray-100 flex items-center justify-center">
                        <FileIcon className="w-16 h-16 text-gray-400" />
                      </div>
                    )}
                    <div className="p-3">
                      <p className="text-sm font-medium truncate" title={file.file_name}>
                        {file.file_name}
                      </p>
                      <div className="flex items-center justify-between mt-2">
                        <p className="text-xs text-gray-500">
                          {(file.file_size / 1024 / 1024).toFixed(2)} MB
                        </p>
                        <div className="flex items-center space-x-1">
                          <button
                            onClick={() => handleDelete(file.id)}
                            className="text-red-600 hover:text-red-800"
                            title="Delete"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="flex items-center space-x-4 flex-1">
                      {file.media_type === 'image' && (
                        <img
                          src={file.file_url}
                          alt={file.file_name}
                          className="w-20 h-20 object-cover rounded"
                        />
                      )}
                      <div className="flex-1">
                        <p className="font-medium">{file.file_name}</p>
                        <p className="text-sm text-gray-500">
                          {file.media_type} • {(file.file_size / 1024 / 1024).toFixed(2)} MB
                          {file.width && file.height && ` • ${file.width}x${file.height}`}
                        </p>
                        <p className="text-xs text-gray-400">
                          {new Date(file.created_at).toLocaleDateString()}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center space-x-2">
                      <a
                        href={file.file_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-600 hover:text-blue-800"
                        title="Open"
                      >
                        <Download className="w-5 h-5" />
                      </a>
                      <button
                        onClick={() => handleDelete(file.id)}
                        className="text-red-600 hover:text-red-800"
                        title="Delete"
                      >
                        <Trash2 className="w-5 h-5" />
                      </button>
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Stats */}
        {filteredFiles.length > 0 && (
          <div className="mt-6 bg-white p-4 rounded-lg shadow-sm">
            <p className="text-sm text-gray-600">
              Showing {filteredFiles.length} of {mediaFiles.length} files
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

