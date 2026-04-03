
// API Endpoint for Platform Account Management
import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '@/backend/db/supabaseClient';
import { getPlatformRules } from '@/backend/services/platformIntelligenceService';
import { getSupabaseUserFromRequest } from '../../../backend/services/supabaseAuthService';

async function requireUserId(req: NextApiRequest, res: NextApiResponse): Promise<string | null> {
  const { user, error } = await getSupabaseUserFromRequest(req);
  if (error || !user?.id) {
    res.status(401).json({ success: false, error: 'UNAUTHORIZED' });
    return null;
  }
  return user.id;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { platform } = req.query;

  if (!platform || typeof platform !== 'string') {
    return res.status(400).json({
      success: false,
      error: 'Platform is required',
    });
  }

  try {
    const bundle = await getPlatformRules(platform);
    if (!bundle) {
      return res.status(400).json({
        success: false,
        error: `Platform ${platform} not supported`,
      });
    }
    const canonical = String(bundle.platform.canonical_key || '').toLowerCase().trim();
    const platformCandidates = canonical === 'x' ? ['twitter', 'x'] : [canonical];

    switch (req.method) {
      case 'GET':
        // Get account info for platform (DB-backed)
        const userId = await requireUserId(req, res);
        if (!userId) return;

        const { data: accounts, error } = await supabase
          .from('social_accounts')
          .select('id, account_name, username, follower_count, is_active, last_sync_at, platform')
          .eq('user_id', userId)
          .eq('is_active', true)
          .in('platform', platformCandidates)
          .order('created_at', { ascending: false })
          .limit(1);

        if (error) {
          return res.status(500).json({ success: false, error: error.message });
        }

        const account = (accounts || [])[0] as any;
        const accountInfo = account
          ? {
              id: String(account.id),
              name: String(account.account_name || `Your ${canonical} Account`),
              username: account.username ? String(account.username) : null,
              followers: Number(account.follower_count ?? 0),
              isActive: Boolean(account.is_active),
              lastPosted: account.last_sync_at ? new Date(account.last_sync_at).toISOString() : null,
            }
          : null;
        
        res.status(200).json({
          success: true,
          data: accountInfo,
        });
        break;

      case 'POST':
        // Connect/authenticate account
        const { code, state } = req.body;
        
        // Mock OAuth flow - in production, implement real OAuth
        console.log(`Connecting ${canonical} account with code:`, code);
        
        // Simulate account connection
        const mockAccountInfo = {
          id: `${canonical}_account_${Date.now()}`,
          name: `Your ${canonical.charAt(0).toUpperCase() + canonical.slice(1)} Account`,
          username: `@your-${canonical}-username`,
          followers: Math.floor(Math.random() * 10000),
          isActive: true,
          lastPosted: null,
        };
        
        res.status(200).json({
          success: true,
          data: mockAccountInfo,
          message: `${canonical.charAt(0).toUpperCase() + canonical.slice(1)} account connected successfully`,
        });
        break;

      case 'DELETE': {
        const deleteUserId = await requireUserId(req, res);
        if (!deleteUserId) return;

        const { data: accountRow, error: findError } = await supabase
          .from('social_accounts')
          .select('id')
          .eq('user_id', deleteUserId)
          .in('platform', platformCandidates)
          .eq('is_active', true)
          .limit(1)
          .maybeSingle();

        if (findError) {
          return res.status(500).json({ success: false, error: findError.message });
        }
        if (!accountRow?.id) {
          return res.status(404).json({ success: false, error: 'Account not found' });
        }

        const { error: updateError } = await supabase
          .from('social_accounts')
          .update({
            is_active: false,
            access_token: null,
            refresh_token: null,
            token_expires_at: null,
            updated_at: new Date().toISOString(),
          })
          .eq('id', accountRow.id);

        if (updateError) {
          return res.status(500).json({ success: false, error: updateError.message });
        }

        return res.status(200).json({
          success: true,
          message: 'Account disconnected',
        });
      }

      default:
        res.setHeader('Allow', ['GET', 'POST', 'DELETE']);
        res.status(405).json({ error: 'Method not allowed' });
    }
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
}
