import type { NextApiHandler, NextApiRequest, NextApiResponse } from 'next';

export function withContract(handler: NextApiHandler): NextApiHandler {
  return async function contractHandler(req: NextApiRequest, res: NextApiResponse) {
    return handler(req, res);
  };
}
