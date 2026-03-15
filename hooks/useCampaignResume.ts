/**
 * useCampaignResume
 * Saves the current campaign page/params to localStorage so users can resume later.
 * Call once per campaign page, passing the page identifier and current URL params.
 */

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/router';
import {
  saveCampaignResume,
  type CampaignPage,
} from '../lib/campaignResumeStore';

interface UseCampaignResumeOptions {
  campaignId: string | undefined | null;
  page: CampaignPage;
  /** Extra params to persist beyond what's in the URL (e.g. active tab state). */
  extraParams?: Record<string, string>;
}

export function useCampaignResume({
  campaignId,
  page,
  extraParams,
}: UseCampaignResumeOptions): void {
  const router = useRouter();
  const extraRef = useRef(extraParams);
  extraRef.current = extraParams;

  useEffect(() => {
    if (!campaignId) return;

    const save = () => {
      const urlParams: Record<string, string> = {};
      const query = router.query;
      for (const [k, v] of Object.entries(query)) {
        if (k !== 'id' && typeof v === 'string') urlParams[k] = v;
      }
      const merged = { ...urlParams, ...(extraRef.current ?? {}) };
      saveCampaignResume(campaignId, page, merged);
    };

    // Save immediately on mount
    save();

    // Save on route change (user navigating away)
    router.events.on('routeChangeStart', save);
    return () => {
      router.events.off('routeChangeStart', save);
    };
  }, [campaignId, page, router]);

  // Re-save when extraParams change (e.g. user switches tabs)
  useEffect(() => {
    if (!campaignId) return;
    const urlParams: Record<string, string> = {};
    const query = router.query;
    for (const [k, v] of Object.entries(query)) {
      if (k !== 'id' && typeof v === 'string') urlParams[k] = v;
    }
    const merged = { ...urlParams, ...(extraParams ?? {}) };
    saveCampaignResume(campaignId, page, merged);
  }, [campaignId, page, extraParams, router.query]);
}
