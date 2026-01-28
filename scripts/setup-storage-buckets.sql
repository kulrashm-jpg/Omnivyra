-- =====================================================
-- SETUP SUPABASE STORAGE BUCKETS FOR MEDIA
-- =====================================================
-- Run this in Supabase SQL Editor to create storage buckets
-- for images, videos, audio, and documents
-- =====================================================

-- Note: Supabase Storage buckets are typically created via the Dashboard,
-- but this SQL shows the structure needed.

-- Buckets to create (via Supabase Dashboard > Storage):
-- 1. media-images (public, for images)
-- 2. media-videos (public, for videos)  
-- 3. media-audios (public, for audio files)
-- 4. media-documents (public, for PDFs and documents)

-- Storage Bucket Configuration:
-- 
-- Bucket Name: media-images
-- Public: Yes
-- File Size Limit: 10 MB
-- Allowed MIME Types: image/jpeg, image/png, image/gif, image/webp
--
-- Bucket Name: media-videos
-- Public: Yes
-- File Size Limit: 500 MB
-- Allowed MIME Types: video/mp4, video/mov, video/webm, video/avi
--
-- Bucket Name: media-audios
-- Public: Yes
-- File Size Limit: 50 MB
-- Allowed MIME Types: audio/mpeg, audio/mp3, audio/wav, audio/ogg, audio/m4a
--
-- Bucket Name: media-documents
-- Public: Yes
-- File Size Limit: 25 MB
-- Allowed MIME Types: application/pdf
--

-- RLS Policies for Storage (if needed):
-- Allow authenticated users to upload their own media
-- Allow public read access to media files

-- Example RLS Policy (created via Supabase Dashboard):
-- CREATE POLICY "Users can upload their own media"
-- ON storage.objects FOR INSERT
-- TO authenticated
-- WITH CHECK (bucket_id = 'media-images' OR bucket_id = 'media-videos' OR bucket_id = 'media-audios' OR bucket_id = 'media-documents');

-- CREATE POLICY "Public can read media"
-- ON storage.objects FOR SELECT
-- TO public
-- USING (bucket_id IN ('media-images', 'media-videos', 'media-audios', 'media-documents'));

-- =====================================================
-- INSTRUCTIONS:
-- =====================================================
-- 1. Open Supabase Dashboard
-- 2. Go to Storage section
-- 3. Create buckets manually with names:
--    - media-images
--    - media-videos
--    - media-audios
--    - media-documents
-- 4. Set each bucket to "Public"
-- 5. Configure file size limits and MIME types as shown above
-- =====================================================

