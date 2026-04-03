
/**
 * POST /api/admin/blog/rewrite-hook
 *
 * Rewrites only the first paragraph of a blog post to strengthen the hook.
 * Uses gpt-4o-mini for a fast, focused rewrite.
 *
 * Body:
 * {
 *   company_id:   string,
 *   content_html: string,
 *   topic:        string,
 *   angle_type?:  string,
 * }
 *
 * Response:
 * { new_hook: string }  — the replacement <p>…</p> HTML
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../../backend/services/userContextService';
import { enforceRole, Role } from '../../../../backend/services/rbacService';
import { runCompletionWithOperation } from '../../../../backend/services/aiGateway';

function extractFirstParagraph(html: string): string {
  const m = html.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
  return m ? m[1].replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim() : '';
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { company_id, content_html, topic, angle_type } = req.body ?? {};

  if (!company_id || typeof company_id !== 'string') {
    return res.status(400).json({ error: 'company_id required' });
  }
  if (!content_html || typeof content_html !== 'string') {
    return res.status(400).json({ error: 'content_html required' });
  }
  if (!topic || typeof topic !== 'string') {
    return res.status(400).json({ error: 'topic required' });
  }

  const access = await enforceCompanyAccess({ req, res, companyId: company_id });
  if (!access) return;

  const roleGate = await enforceRole({
    req, res, companyId: company_id,
    allowedRoles: [Role.COMPANY_ADMIN, Role.SUPER_ADMIN],
  });
  if (!roleGate) return;

  const currentHook = extractFirstParagraph(content_html);
  if (!currentHook) {
    return res.status(422).json({ error: 'No opening paragraph found in content_html' });
  }

  const angleContext = angle_type ? `\nEditorial angle: ${angle_type}` : '';

  try {
    const result = await runCompletionWithOperation({
      operation:       'blogGeneration',
      companyId:       company_id,
      model:           'gpt-4o-mini',
      temperature:     0.7,
      response_format: { type: 'json_object' },
      messages: [
        {
          role:    'system',
          content: `You are an expert blog editor specialising in opening hooks.
Rewrite the provided opening paragraph so it becomes STRONG.

STRONG hook criteria:
- Opens with a specific claim, counterintuitive insight, concrete problem, or surprising data point
- Creates immediate tension or curiosity — the reader MUST continue
- Does NOT start with "In today's", "Have you ever", or any generic AI-sounding filler
- Stays under 60 words
- Matches the blog topic and editorial angle provided

Return ONLY valid JSON: { "new_hook": "<p>…rewritten paragraph…</p>" }
The value must be a complete <p> tag with the rewritten text inside. No markdown, no extra keys.`,
        },
        {
          role:    'user',
          content: `Topic: ${topic}${angleContext}\n\nCurrent opening paragraph:\n"${currentHook}"`,
        },
      ],
    });

    const raw = result.output ? JSON.parse(result.output) : null;
    if (raw && typeof raw.new_hook === 'string' && raw.new_hook.trim()) {
      return res.status(200).json({ new_hook: raw.new_hook.trim() });
    }
    return res.status(502).json({ error: 'AI returned unexpected output' });
  } catch {
    return res.status(500).json({ error: 'Hook rewrite failed' });
  }
}
