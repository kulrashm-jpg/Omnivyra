/**
 * Health check endpoint that verifies Next.js is fully ready
 * Use this to gate incoming traffic until compilation is complete
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import fs from 'fs';
import path from 'path';

// In dev, Next.js 16 writes to .next/dev; in prod it writes to .next.
// `build-manifest.json` is produced in both modes once the server is up,
// unlike `routes-manifest.json` which is a production-only artifact.
const CANDIDATE_MANIFESTS = [
  '.next/dev/build-manifest.json',
  '.next/build-manifest.json',
];

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const manifestReady = CANDIDATE_MANIFESTS.some((rel) =>
      fs.existsSync(path.join(process.cwd(), rel))
    );

    if (!manifestReady) {
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
