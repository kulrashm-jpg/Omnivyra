import type { NextApiRequest, NextApiResponse } from 'next';

export const ROUTE_STATUS = 'archived';

export default function handler(_req: NextApiRequest, res: NextApiResponse) {
  return res.status(410).json({
    ok: false,
    error: {
      code: 'ROUTE_DEPRECATED',
      message: 'This endpoint is no longer active',
    },
  });
}
