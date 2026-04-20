import { supabase } from '../db/supabaseClient';

export interface EngagementPlatformPreference {
  id: string;
  company_id: string;
  user_id: string;
  platform: string;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

export async function getEngagementPlatformPreferences(
  companyId: string,
  userId: string
): Promise<EngagementPlatformPreference[]> {
  try {
    const { data, error } = await supabase
      .from('engagement_platform_preferences')
      .select('*')
      .eq('company_id', companyId)
      .eq('user_id', userId)
      .order('platform', { ascending: true });

    if (error) {
      console.warn('[engagementPlatformPreferenceService] get error:', error);
      return [];
    }

    return (data ?? []) as EngagementPlatformPreference[];
  } catch (err) {
    console.error('[engagementPlatformPreferenceService] get exception:', err);
    return [];
  }
}

export async function upsertEngagementPlatformPreference(input: {
  companyId: string;
  userId: string;
  platform: string;
  enabled: boolean;
}): Promise<EngagementPlatformPreference | null> {
  try {
    const { data, error } = await supabase
      .from('engagement_platform_preferences')
      .upsert(
        {
          company_id: input.companyId,
          user_id: input.userId,
          platform: input.platform,
          enabled: input.enabled,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'company_id,user_id,platform' }
      )
      .select('*')
      .maybeSingle();

    if (error) {
      console.warn('[engagementPlatformPreferenceService] upsert error:', error);
      return null;
    }

    return (data as EngagementPlatformPreference | null) ?? null;
  } catch (err) {
    console.error('[engagementPlatformPreferenceService] upsert exception:', err);
    return null;
  }
}
