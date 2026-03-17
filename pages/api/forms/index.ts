import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import { enforceRole, Role } from '../../../backend/services/rbacService';
import { createForm, getForms, FormField } from '../../../backend/services/leadService';

const VALID_FIELD_TYPES = ['text', 'email', 'phone'];

function validateFields(fields: unknown): fields is FormField[] {
  if (!Array.isArray(fields)) return false;
  return fields.every(
    (f) =>
      f && typeof f === 'object' &&
      typeof f.name === 'string' && f.name.trim() &&
      typeof f.label === 'string' && f.label.trim() &&
      VALID_FIELD_TYPES.includes(f.type) &&
      typeof f.required === 'boolean',
  );
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const companyId =
    typeof req.query.company_id === 'string' ? req.query.company_id :
    typeof req.body?.company_id === 'string' ? req.body.company_id : null;
  if (!companyId) return res.status(400).json({ error: 'company_id is required' });

  const access = await enforceCompanyAccess({ req, res, companyId });
  if (!access) return;

  // GET — any company member can list forms
  if (req.method === 'GET') {
    try {
      const forms = await getForms(companyId);
      return res.status(200).json({ forms });
    } catch (err) {
      return res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to load forms' });
    }
  }

  // POST — admin only
  if (req.method === 'POST') {
    const roleGate = await enforceRole({
      req, res, companyId,
      allowedRoles: [Role.COMPANY_ADMIN, Role.SUPER_ADMIN],
    });
    if (!roleGate) return;

    const { name, fields, integration_id, brand } = req.body || {};
    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'name is required' });
    }
    if (!validateFields(fields)) {
      return res.status(400).json({ error: 'fields must be an array of {name, label, type, required} objects' });
    }
    if (fields.length === 0) {
      return res.status(400).json({ error: 'at least one field is required' });
    }

    try {
      const form = await createForm(
        companyId,
        roleGate.userId,
        name.trim(),
        fields,
        integration_id && typeof integration_id === 'string' ? integration_id : null,
        typeof brand === 'object' && brand !== null ? brand : {},
      );
      return res.status(201).json({ form });
    } catch (err) {
      return res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to create form' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
