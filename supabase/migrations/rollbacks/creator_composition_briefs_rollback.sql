-- Rollback for 20261222000000_creator_composition_briefs.sql
-- Drops the brief store. The API degrades to browser-session briefs when the
-- table is absent (reads return null, writes report the store unavailable).
DROP TABLE IF EXISTS public.creator_composition_briefs;
