/**
 * Health check endpoint that verifies Next.js is fully ready
 * Use this to gate incoming traffic until Turbopack compilation is complete
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import fs from 'fs';
import path from 'path';

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    // Check if routes-manifest.json exists (indicates Turbopack ready)
    const manifestPath = path.join(process.cwd(), '.next/dev/routes-manifest.json');
    const exists = fs.existsSync(manifestPath);
    
    if (!exists) {
      return res.status(503).json({
        status: 'initializing',
        message: 'Next.js is still initializing. Please try again in a moment.',
        ok: false,
      });
    }

    res.status(200).json({
      status: 'ready',
      message: 'Next.js is fully initialized and ready.',
      ok: true,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      message: error instanceof Error ? error.message : 'Unknown error',
      ok: false,
    });
  }
}
