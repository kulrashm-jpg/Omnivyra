import type { NextApiRequest, NextApiResponse } from 'next';

/**
 * Deprecated standalone Creator generation endpoint.
 *
 * Unified creator execution now only runs through the BOLT pipeline and
 * `daily_content_plans` using `campaign_mode: 'creator'`.
 */
export default async function handler(_req: NextApiRequest, res: NextApiResponse) {
  return res.status(410).json({
    error: 'Standalone creator generation has been deprecated.',
    message: 'Use BOLT Creator pipeline execution through daily_content_plans.',
    pipeline_only: true,
  });
}
