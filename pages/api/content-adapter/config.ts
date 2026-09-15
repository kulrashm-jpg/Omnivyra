import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';

/**
 * Content Adapter Configuration API
 * GET /api/content-adapter/config - Get adapter configurations
 * POST /api/content-adapter/config - Save adapter configuration
 */

import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import { getSupabaseUserFromRequest } from '../../../backend/services/supabaseAuthService';

interface AdapterConfig {
  platform: string;
  autoTruncate: boolean;
  autoFormatHashtags: boolean;
  preserveLinks: boolean;
  customRules: Record<string, any>;
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  // ROUTE-AUTH-001 (STEP 3AH-85): adapter_configs rows are owned by user_id.
  // The route used to read AND upsert any user's rows by a client-supplied
  // ?user_id with no authentication. The owner is now the authenticated
  // caller; a client-supplied user_id is ignored (the only UI caller,
  // pages/content-adapter-config.tsx, never sent one).
  const { user } = await getSupabaseUserFromRequest(req);
  if (!user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const user_id = user.id;

  if (req.method === 'GET') {
    try {
      // Get configurations from database
      const { data: dbConfigs, error: fetchError } = await supabase
        .from('adapter_configs')
        .select('*')
        .eq('user_id', user_id);

      if (fetchError && !fetchError.message.includes('does not exist')) {
        throw fetchError;
      }

      // Convert database rows to config format
      const userConfigs: Record<string, AdapterConfig> = {};
      if (dbConfigs) {
        dbConfigs.forEach((row: any) => {
          userConfigs[row.platform] = {
            platform: row.platform,
            autoTruncate: row.auto_truncate ?? true,
            autoFormatHashtags: row.auto_format_hashtags ?? true,
            preserveLinks: row.preserve_links ?? true,
            customRules: row.custom_rules || {},
          };
        });
      }

      // Merge with default configurations for all platforms
      const platforms = ['linkedin', 'twitter', 'x', 'instagram', 'facebook', 'youtube', 'tiktok', 'spotify', 'pinterest', 'starmaker', 'suno'];
      const configs: Record<string, AdapterConfig> = {};

      platforms.forEach((platform) => {
        configs[platform] = userConfigs[platform] || {
          platform,
          autoTruncate: true,
          autoFormatHashtags: true,
          preserveLinks: true,
          customRules: {},
        };
      });

      res.status(200).json({
        success: true,
        configs,
      });
    } catch (error: any) {
      console.error('Get config error:', error);
      res.status(500).json({
        error: 'Failed to get configurations',
        message: error.message,
      });
    }
  } else if (req.method === 'POST') {
    try {
      const { platform, config } = req.body;

      if (!platform || !config) {
        return res.status(400).json({ error: 'platform and config are required' });
      }

      // Save configuration to database
      const { error: upsertError } = await supabase
        .from('adapter_configs')
        .upsert(
          {
            user_id,
            platform,
            auto_truncate: config.autoTruncate,
            auto_format_hashtags: config.autoFormatHashtags,
            preserve_links: config.preserveLinks,
            custom_rules: config.customRules,
            updated_at: new Date().toISOString(),
          },
          {
            onConflict: 'user_id,platform',
          }
        );

      if (upsertError) {
        throw upsertError;
      }

      res.status(200).json({
        success: true,
        message: 'Configuration saved successfully',
      });
    } catch (error: any) {
      console.error('Save config error:', error);
      res.status(500).json({
        error: 'Failed to save configuration',
        message: error.message,
      });
    }
  } else {
    res.status(405).json({ error: 'Method not allowed' });
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/content-adapter/config' });
