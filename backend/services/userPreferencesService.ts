/**
 * User Preferences Service
 * 
 * Manages user UI preferences:
 * - default_landing: where to redirect after login ('command_center' or 'dashboard')
 * - command_center_pinned: whether to show/hide command center
 */

import { supabase } from '../db/supabaseClient';

export interface UserPreferences {
  id: string;
  user_id: string;
  default_landing: 'command_center' | 'dashboard';
  command_center_pinned: boolean;
  created_at: string;
  updated_at: string;
}

/**
 * Get user preferences by user ID
 * Returns null if no preferences found (new user)
 */
export async function getUserPreferences(userId: string): Promise<UserPreferences | null> {
  try {
    const { data, error } = await supabase
      .from('user_preferences')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();

    if (error) {
      console.warn('[userPreferencesService] getUserPreferences error:', error);
      return null;
    }

    return data ?? null;
  } catch (err) {
    console.error('[userPreferencesService] getUserPreferences exception:', err);
    return null;
  }
}

/**
 * Upsert (insert or update) user preferences
 * Auto-creates row if it doesn't exist
 */
export async function upsertUserPreferences(
  userId: string,
  updates: Partial<Omit<UserPreferences, 'id' | 'user_id' | 'created_at' | 'updated_at'>>,
): Promise<UserPreferences | null> {
  try {
    const { data, error } = await supabase
      .from('user_preferences')
      .upsert(
        {
          user_id: userId,
          ...updates,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id' },
      )
      .select()
      .maybeSingle();

    if (error) {
      console.warn('[userPreferencesService] upsertUserPreferences error:', error);
      return null;
    }

    return data ?? null;
  } catch (err) {
    console.error('[userPreferencesService] upsertUserPreferences exception:', err);
    return null;
  }
}

/**
 * Toggle command center pinning
 * If pinned=false, sets default_landing to 'dashboard'
 * If pinned=true, sets default_landing to 'command_center'
 */
export async function toggleCommandCenter(
  userId: string,
  pinned: boolean,
): Promise<UserPreferences | null> {
  return upsertUserPreferences(userId, {
    command_center_pinned: pinned,
    default_landing: pinned ? 'command_center' : 'dashboard',
  });
}

/**
 * Set default landing page
 */
export async function setDefaultLanding(
  userId: string,
  destination: 'command_center' | 'dashboard',
): Promise<UserPreferences | null> {
  return upsertUserPreferences(userId, {
    default_landing: destination,
  });
}

/**
 * Get the post-login route based on preferences
 * Returns either '/command-center' or '/dashboard'
 * 
 * Logic:
 * - If command_center_pinned = true → '/command-center'
 * - If command_center_pinned = false → '/dashboard'
 * - If no preferences (new user) → '/command-center' (default)
 */
export async function getPostLoginRoute(userId: string): Promise<'/command-center' | '/dashboard'> {
  const prefs = await getUserPreferences(userId);

  // New user defaults to command center
  if (!prefs) {
    return '/command-center';
  }

  // Return based on pinned state
  return prefs.command_center_pinned ? '/command-center' : '/dashboard';
}
