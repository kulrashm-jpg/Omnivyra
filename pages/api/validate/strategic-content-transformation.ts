import type { NextApiRequest, NextApiResponse } from 'next';
import {
  validateStrategicContentTransformation,
  type StrategicContentTransformationValidationResult,
} from '../../../backend/services/strategicContentTransformationValidator';

type ErrorResponse = {
  error: string;
};

export default function handler(
  req: NextApiRequest,
  res: NextApiResponse<StrategicContentTransformationValidationResult | ErrorResponse>,
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const strategicSource = req.body?.strategic_source;
  const finalContent = req.body?.final_content;

  if (!strategicSource || finalContent == null) {
    return res.status(400).json({ error: 'strategic_source and final_content are required' });
  }

  const result = validateStrategicContentTransformation({
    strategic_source: strategicSource,
    final_content: finalContent,
  });

  return res.status(200).json(result);
}
