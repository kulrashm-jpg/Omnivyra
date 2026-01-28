/**
 * Media Uploader Component
 * 
 * Drag-and-drop media upload component supporting:
 * - Images (JPG, PNG, GIF, WebP)
 * - Videos (MP4, MOV, AVI, WebM)
 * - Audio (MP3, WAV, OGG, M4A)
 * - Documents (PDF)
 * 
 * Features:
 * - Drag & drop support
 * - File picker
 * - Preview before upload
 * - Platform-specific validation
 * - Upload progress
 * - Multiple file support
 */

import { useState, useRef, useCallback } from 'react';
import { Upload, X, Image, Video, Music, File, Loader2, CheckCircle, AlertCircle } from 'lucide-react';

interface MediaUploaderProps {
  userId: string;
  campaignId?: string;
  platform?: string;
  onUploadComplete?: (mediaFiles: MediaFile[]) => void;
  onError?: (error: string) => void;
  maxFiles?: number;
  allowedTypes?: ('image' | 'video' | 'audio' | 'document')[];
  className?: string;
}

interface MediaFile {
  id: string;
  file_name: string;
  file_url: string;
  media_type: 'image' | 'video' | 'audio' | 'document';
  file_size: number;
  width?: number;
  height?: number;
  duration?: number;
}

interface UploadingFile {
  file: File;
  preview?: string;
  progress: number;
  status: 'pending' | 'uploading' | 'success' | 'error';
  error?: string;
}

export default function MediaUploader({
  userId,
  campaignId,
  platform,
  onUploadComplete,
  onError,
  maxFiles = 10,
  allowedTypes = ['image', 'video', 'audio', 'document'],
  className = '',
}: MediaUploaderProps) {
  const [uploadingFiles, setUploadingFiles] = useState<UploadingFile[]>([]);
  const [uploadedFiles, setUploadedFiles] = useState<MediaFile[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Get accepted file types
  const acceptedTypes = allowedTypes.flatMap(type => {
    switch (type) {
      case 'image':
        return ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
      case 'video':
        return ['video/mp4', 'video/mov', 'video/quicktime', 'video/webm', 'video/avi'];
      case 'audio':
        return ['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/ogg', 'audio/m4a', 'audio/x-m4a'];
      case 'document':
        return ['application/pdf'];
      default:
        return [];
    }
  });

  const detectMediaType = (mimeType: string): 'image' | 'video' | 'audio' | 'document' | null => {
    if (mimeType.startsWith('image/')) return 'image';
    if (mimeType.startsWith('video/')) return 'video';
    if (mimeType.startsWith('audio/')) return 'audio';
    if (mimeType === 'application/pdf') return 'document';
    return null;
  };

  const validateFile = (file: File): { valid: boolean; error?: string } => {
    // Check if type is allowed
    const mediaType = detectMediaType(file.type);
    if (!mediaType || !allowedTypes.includes(mediaType)) {
      return { valid: false, error: `File type ${file.type} not allowed. Allowed: ${allowedTypes.join(', ')}` };
    }

    // Check file size limits
    const sizeLimits: Record<string, number> = {
      image: 10 * 1024 * 1024, // 10MB
      video: 500 * 1024 * 1024, // 500MB
      audio: 50 * 1024 * 1024, // 50MB
      document: 25 * 1024 * 1024, // 25MB
    };

    if (file.size > sizeLimits[mediaType]) {
      return {
        valid: false,
        error: `File size (${(file.size / 1024 / 1024).toFixed(2)}MB) exceeds limit (${sizeLimits[mediaType] / 1024 / 1024}MB)`,
      };
    }

    return { valid: true };
  };

  const createPreview = (file: File): Promise<string | undefined> => {
    return new Promise((resolve) => {
      if (file.type.startsWith('image/')) {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target?.result as string);
        reader.readAsDataURL(file);
      } else {
        resolve(undefined);
      }
    });
  };

  const handleFiles = useCallback(async (files: FileList | File[]) => {
    const fileArray = Array.from(files);
    const newFiles: UploadingFile[] = [];

    for (const file of fileArray) {
      const validation = validateFile(file);
      if (!validation.valid) {
        onError?.(validation.error || 'Invalid file');
        continue;
      }

      const preview = await createPreview(file);
      newFiles.push({
        file,
        preview,
        progress: 0,
        status: 'pending',
      });
    }

    setUploadingFiles((prev) => [...prev, ...newFiles]);

    // Upload files
    newFiles.forEach((uploadingFile, index) => {
      uploadFile(uploadingFile.file, index + uploadedFiles.length);
    });
  }, [uploadedFiles.length, allowedTypes, onError]);

  const uploadFile = async (file: File, index: number) => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('user_id', userId);
    if (campaignId) formData.append('campaign_id', campaignId);
    if (platform) formData.append('platform', platform);

    setUploadingFiles((prev) => {
      const updated = [...prev];
      updated[index] = { ...updated[index], status: 'uploading', progress: 0 };
      return updated;
    });

    try {
      const xhr = new XMLHttpRequest();

      // Track upload progress
      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable) {
          const progress = (e.loaded / e.total) * 100;
          setUploadingFiles((prev) => {
            const updated = [...prev];
            if (updated[index]) {
              updated[index] = { ...updated[index], progress };
            }
            return updated;
          });
        }
      });

      xhr.addEventListener('load', () => {
        if (xhr.status === 200) {
          const response = JSON.parse(xhr.responseText);
          const mediaFile: MediaFile = response.data;

          setUploadingFiles((prev) => {
            const updated = [...prev];
            updated[index] = { ...updated[index], status: 'success', progress: 100 };
            return updated;
          });

          setUploadedFiles((prev) => [...prev, mediaFile]);
          onUploadComplete?.([mediaFile]);
        } else {
          const error = JSON.parse(xhr.responseText).error || 'Upload failed';
          setUploadingFiles((prev) => {
            const updated = [...prev];
            updated[index] = { ...updated[index], status: 'error', error };
            return updated;
          });
          onError?.(error);
        }
      });

      xhr.addEventListener('error', () => {
        setUploadingFiles((prev) => {
          const updated = [...prev];
          updated[index] = { ...updated[index], status: 'error', error: 'Network error' };
          return updated;
        });
        onError?.('Network error during upload');
      });

      xhr.open('POST', '/api/media/upload');
      xhr.send(formData);
    } catch (error: any) {
      setUploadingFiles((prev) => {
        const updated = [...prev];
        updated[index] = { ...updated[index], status: 'error', error: error.message };
        return updated;
      });
      onError?.(error.message);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);

    const files = e.dataTransfer.files;
    if (files.length > 0) {
      handleFiles(files);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      handleFiles(files);
    }
  };

  const removeFile = (index: number) => {
    setUploadingFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const removeUploaded = (id: string) => {
    setUploadedFiles((prev) => prev.filter((f) => f.id !== id));
  };

  const getMediaIcon = (type: string) => {
    switch (type) {
      case 'image':
        return <Image className="w-5 h-5" />;
      case 'video':
        return <Video className="w-5 h-5" />;
      case 'audio':
        return <Music className="w-5 h-5" />;
      case 'document':
        return <File className="w-5 h-5" />;
      default:
        return <File className="w-5 h-5" />;
    }
  };

  return (
    <div className={className}>
      {/* Upload Area */}
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
          isDragging
            ? 'border-blue-500 bg-blue-50'
            : 'border-gray-300 hover:border-gray-400 bg-gray-50'
        }`}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept={acceptedTypes.join(',')}
          onChange={handleFileSelect}
          className="hidden"
        />

        <Upload className="w-12 h-12 mx-auto text-gray-400 mb-4" />
        <p className="text-lg font-medium text-gray-700 mb-2">
          Drag & drop files here, or click to select
        </p>
        <p className="text-sm text-gray-500 mb-4">
          Supported: Images, Videos, Audio, PDFs
        </p>
        <button
          onClick={() => fileInputRef.current?.click()}
          className="px-6 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 font-medium"
        >
          Select Files
        </button>
      </div>

      {/* Uploading Files */}
      {uploadingFiles.length > 0 && (
        <div className="mt-6">
          <h3 className="font-semibold mb-3">Uploading Files</h3>
          <div className="space-y-3">
            {uploadingFiles.map((item, index) => (
              <div
                key={index}
                className="bg-white border rounded-lg p-4 flex items-center justify-between"
              >
                <div className="flex items-center space-x-3 flex-1">
                  {item.preview ? (
                    <img
                      src={item.preview}
                      alt={item.file.name}
                      className="w-16 h-16 object-cover rounded"
                    />
                  ) : (
                    <div className="w-16 h-16 bg-gray-100 rounded flex items-center justify-center">
                      {getMediaIcon(detectMediaType(item.file.type) || 'document')}
                    </div>
                  )}
                  <div className="flex-1">
                    <p className="font-medium text-sm">{item.file.name}</p>
                    <p className="text-xs text-gray-500">
                      {(item.file.size / 1024 / 1024).toFixed(2)} MB
                    </p>
                    {item.status === 'uploading' && (
                      <div className="mt-2">
                        <div className="w-full bg-gray-200 rounded-full h-2">
                          <div
                            className="bg-blue-600 h-2 rounded-full transition-all"
                            style={{ width: `${item.progress}%` }}
                          />
                        </div>
                        <p className="text-xs text-gray-500 mt-1">{Math.round(item.progress)}%</p>
                      </div>
                    )}
                    {item.status === 'error' && item.error && (
                      <p className="text-xs text-red-600 mt-1 flex items-center">
                        <AlertCircle className="w-3 h-3 mr-1" />
                        {item.error}
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex items-center space-x-2">
                  {item.status === 'success' && (
                    <CheckCircle className="w-5 h-5 text-green-600" />
                  )}
                  {item.status === 'uploading' && (
                    <Loader2 className="w-5 h-5 text-blue-600 animate-spin" />
                  )}
                  {item.status === 'error' && (
                    <button
                      onClick={() => removeFile(index)}
                      className="text-red-600 hover:text-red-800"
                    >
                      <X className="w-5 h-5" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Uploaded Files */}
      {uploadedFiles.length > 0 && (
        <div className="mt-6">
          <h3 className="font-semibold mb-3">Uploaded Files</h3>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {uploadedFiles.map((file) => (
              <div
                key={file.id}
                className="bg-white border rounded-lg overflow-hidden relative group"
              >
                {file.media_type === 'image' && (
                  <img
                    src={file.file_url}
                    alt={file.file_name}
                    className="w-full h-32 object-cover"
                  />
                )}
                {file.media_type === 'video' && (
                  <div className="w-full h-32 bg-gray-900 flex items-center justify-center">
                    <Video className="w-12 h-12 text-white" />
                  </div>
                )}
                {file.media_type === 'audio' && (
                  <div className="w-full h-32 bg-gray-100 flex items-center justify-center">
                    <Music className="w-12 h-12 text-gray-400" />
                  </div>
                )}
                {file.media_type === 'document' && (
                  <div className="w-full h-32 bg-gray-100 flex items-center justify-center">
                    <File className="w-12 h-12 text-gray-400" />
                  </div>
                )}
                <div className="p-2">
                  <p className="text-xs font-medium truncate">{file.file_name}</p>
                  <p className="text-xs text-gray-500">
                    {(file.file_size / 1024 / 1024).toFixed(2)} MB
                  </p>
                </div>
                <button
                  onClick={() => removeUploaded(file.id)}
                  className="absolute top-2 right-2 bg-red-600 text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

