import type { NextApiHandler, NextApiRequest, NextApiResponse } from 'next';
import { withApiObservability } from '../../backend/observability';

export function withContract(handler: NextApiHandler): NextApiHandler {
  // HARDEN-001: transparently instrument every route that already opts into the
  // shared contract wrapper. withApiObservability only observes (duration /
  // status / payload size) and forwards the request+response verbatim — no
  // contract, header, status, or body change.
  const contractHandler = async function contractHandler(req: NextApiRequest, res: NextApiResponse) {
    return handler(req, res);
  };
  return withApiObservability(contractHandler);
}
