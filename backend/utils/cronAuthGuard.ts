import type { NextApiRequest, NextApiResponse } from 'next';
import { verifyCronSource } from './cronSourceVerification';

export class CronAuthError extends Error {
  statusCode: number;

  constructor(message: string, statusCode = 401) {
    super(message);
    this.name = 'CronAuthError';
    this.statusCode = statusCode;
  }
}

export function assertCronAuthorized(req: NextApiRequest): void {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    throw new CronAuthError('CRON_SECRET is required', 500);
  }

  const authorization = req.headers.authorization;
  if (authorization !== `Bearer ${secret}`) {
    throw new CronAuthError('Unauthorized', 401);
  }

  verifyCronSource(req, req.url || 'unknown');
}

export function rejectCronUnauthorized(res: NextApiResponse, error: unknown): boolean {
  if (!(error instanceof CronAuthError)) return false;
  res.status(error.statusCode);
  res.json({ error: error.message });
  return true;
}
