-- Add brand customization to forms table
-- Run after leads.sql

ALTER TABLE forms ADD COLUMN IF NOT EXISTS brand JSONB NOT NULL DEFAULT '{}';

-- brand shape:
-- {
--   heading?:         string   -- form title shown to visitors (e.g. "Get in Touch")
--   description?:     string   -- short tagline below heading
--   submit_label?:    string   -- button text (default "Submit")
--   success_message?: string   -- shown after successful submit
--   primary_color?:   string   -- hex color for button + focus ring (default #6366f1)
--   font?:            'system' | 'sans' | 'serif'
-- }
