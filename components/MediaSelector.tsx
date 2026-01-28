/**
 * Media Selector Component
 * 
 * Component for selecting media files from library or uploading new ones
 * Used in post creation forms to attach media to posts
 */

import { useState, useEffect } from 'react';
import { X, Plus, Upload, Image, Video, Music, File as FileIcon } from 'lucide-react';
import MediaUploader from './MediaUploader';

interface MediaFile {
  id: string;
  file_name: string;
  file_url: string;
  media_type: 'image' | 'video' | 'audio' | 'document';
  file_size: number;
  width?: number;
  height?: number;
}

interface MediaSelectorProps {
  userId: string;
  campaignId?: string;
  platform?: string;
  selectedMediaIds: string[];
  onMediaChange: (mediaIds: string[]) => void;
  maxSelection?: number;
  allowedTypes?: ('image' | 'video' | 'audio' | 'document')[];
  className?: string;
}

export default function MediaSelector({
  userId,
  campaignId,
  platform,
  selectedMediaIds,
  onMediaChange,
  maxSelection = 10,
  allowedTypes = ['image', 'video', 'audio'],
  className = '',
}: MediaSelectorProps) {
  const [availableMedia, setAvailableMedia] = useState<MediaFile[]>([]);
  const [selectedMedia, setSelectedMedia] = useState<MediaFile[]>([]);
  const [showLibrary, setShowLibrary] = useState(false);
  const [showUploader, setShowUploader] = useState(false);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    loadMediaLibrary();
  }, [userId, campaignId]);

  useEffect(() => {
    // Sync selected media IDs with actual media objects
    if (selectedMediaIds.length > 0 && availableMedia.length > 0) {
      const selected = availableMedia.filter((m) => selectedMediaIds.includes(m.id));
      setSelectedMedia(selected);
    } else {
      setSelectedMedia([]);
    }
  }, [selectedMediaIds, availableMedia]);

  const loadMediaLibrary = async () => {
    if (!userId) return;

    setLoading(true);
    try {
      const params = new URLSearchParams({ user_id: userId });
      if (campaignId) params.append('campaign_id', campaignId);
      
      // Filter by allowed types
      allowedTypes.forEach((type) => {
        params.append('media_type', type);
      });

      const response = await fetch(`/api/media/list?${params.toString()}`);
      if (response.ok) {
        const data = await response.json();
        setAvailableMedia(data.data || []);
      }
    } catch (error) {
      console.error('Failed to load media library:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSelectMedia = (media: MediaFile) => {
    if (selectedMediaIds.length >= maxSelection) {
      alert(`Maximum ${maxSelection} media files allowed`);
      return;
    }

    if (!selectedMediaIds.includes(media.id)) {
      const newSelection = [...selectedMediaIds, media.id];
      onMediaChange(newSelection);
    }
  };

  const handleRemoveMedia = (mediaId: string) => {
    const newSelection = selectedMediaIds.filter((id) => id !== mediaId);
    onMediaChange(newSelection);
  };

  const handleUploadComplete = (files: MediaFile[]) => {
    setAvailableMedia((prev) => [...files, ...prev]);
    // Auto-select uploaded files
    const newIds = [...selectedMediaIds, ...files.map((f) => f.id)];
    onMediaChange(newIds.slice(0, maxSelection));
    setShowUploader(false);
  };

  const filteredMedia = availableMedia.filter((media) => {
    if (searchQuery) {
      return media.file_name.toLowerCase().includes(searchQuery.toLowerCase());
    }
    return true;
  });

  const getMediaIcon = (type: string) => {
    switch (type) {
      case 'image':
        return <Image className="w-5 h-5" />;
      case 'video':
        return <Video className="w-5 h-5" />;
      case 'audio':
        return <Music className="w-5 h-5" />;
      case 'document':
        return <FileIcon className="w-5 h-5" />;
      default:
        return <FileIcon className="w-5 h-5" />;
    }
  };

  return (
    <div className={className}>
      {/* Selected Media Preview */}
      {selectedMedia.length > 0 && (
        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Selected Media ({selectedMedia.length}/{maxSelection})
          </label>
          <div className="flex flex-wrap gap-3">
            {selectedMedia.map((media) => (
              <div
                key={media.id}
                className="relative border rounded-lg overflow-hidden group"
              >
                {media.media_type === 'image' && (
                  <img
                    src={media.file_url}
                    alt={media.file_name}
                    className="w-24 h-24 object-cover"
                  />
                )}
                {media.media_type === 'video' && (
                  <div className="w-24 h-24 bg-gray-900 flex items-center justify-center">
                    <Video className="w-8 h-8 text-white" />
                  </div>
                )}
                {media.media_type === 'audio' && (
                  <div className="w-24 h-24 bg-gray-100 flex items-center justify-center">
                    <Music className="w-8 h-8 text-gray-400" />
                  </div>
                )}
                {media.media_type === 'document' && (
                  <div className="w-24 h-24 bg-gray-100 flex items-center justify-center">
                    <FileIcon className="w-8 h-8 text-gray-400" />
                  </div>
                )}
                <button
                  onClick={() => handleRemoveMedia(media.id)}
                  className="absolute top-1 right-1 bg-red-600 text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Action Buttons */}
      <div className="flex items-center space-x-3 mb-4">
        <button
          onClick={() => setShowLibrary(!showLibrary)}
          className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 font-medium flex items-center space-x-2"
        >
          <Plus className="w-4 h-4" />
          <span>Select from Library</span>
        </button>
        <button
          onClick={() => setShowUploader(!showUploader)}
          className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 font-medium flex items-center space-x-2"
        >
          <Upload className="w-4 h-4" />
          <span>Upload New</span>
        </button>
      </div>

      {/* Media Uploader */}
      {showUploader && (
        <div className="mb-4 border rounded-lg p-4 bg-gray-50">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-medium">Upload New Media</h3>
            <button
              onClick={() => setShowUploader(false)}
              className="text-gray-500 hover:text-gray-700"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
          <MediaUploader
            userId={userId}
            campaignId={campaignId}
            platform={platform}
            onUploadComplete={handleUploadComplete}
            allowedTypes={allowedTypes}
          />
        </div>
      )}

      {/* Media Library */}
      {showLibrary && (
        <div className="border rounded-lg p-4 bg-white">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-medium">Media Library</h3>
            <button
              onClick={() => setShowLibrary(false)}
              className="text-gray-500 hover:text-gray-700"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Search */}
          <input
            type="text"
            placeholder="Search media..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full px-3 py-2 border rounded-lg mb-4 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />

          {/* Media Grid */}
          {loading ? (
            <div className="text-center py-8 text-gray-500">Loading...</div>
          ) : filteredMedia.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              {searchQuery ? 'No media found' : 'No media in library'}
            </div>
          ) : (
            <div className="grid grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-2 max-h-64 overflow-y-auto">
              {filteredMedia.map((media) => {
                const isSelected = selectedMediaIds.includes(media.id);
                return (
                  <button
                    key={media.id}
                    onClick={() => handleSelectMedia(media)}
                    className={`relative border-2 rounded-lg overflow-hidden transition-all ${
                      isSelected
                        ? 'border-blue-600 ring-2 ring-blue-200'
                        : 'border-gray-200 hover:border-gray-300'
                    }`}
                    disabled={isSelected || selectedMediaIds.length >= maxSelection}
                  >
                    {media.media_type === 'image' && (
                      <img
                        src={media.file_url}
                        alt={media.file_name}
                        className="w-full h-20 object-cover"
                      />
                    )}
                    {media.media_type === 'video' && (
                      <div className="w-full h-20 bg-gray-900 flex items-center justify-center">
                        <Video className="w-6 h-6 text-white" />
                      </div>
                    )}
                    {media.media_type === 'audio' && (
                      <div className="w-full h-20 bg-gray-100 flex items-center justify-center">
                        <Music className="w-6 h-6 text-gray-400" />
                      </div>
                    )}
                    {media.media_type === 'document' && (
                      <div className="w-full h-20 bg-gray-100 flex items-center justify-center">
                        <FileIcon className="w-6 h-6 text-gray-400" />
                      </div>
                    )}
                    {isSelected && (
                      <div className="absolute inset-0 bg-blue-600 bg-opacity-30 flex items-center justify-center">
                        <div className="w-6 h-6 bg-blue-600 rounded-full flex items-center justify-center">
                          <X className="w-4 h-4 text-white" />
                        </div>
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

