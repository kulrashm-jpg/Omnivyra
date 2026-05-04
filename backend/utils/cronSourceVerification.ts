import type { NextApiRequest } from 'next';

export function verifyCronSource(req: NextApiRequest, route: string): void {
  const source = req.headers['x-vercel-cron'] ? 'vercel_cron' : 'authenticated_cron';
  console.info(JSON.stringify({
    event: 'CRON_SOURCE_VERIFIED',
    route,
    source,
  }));
}
