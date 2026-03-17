import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import { enforceRole, Role } from '../../../backend/services/rbacService';
import { getForm, updateForm, deleteForm, FormField } from '../../../backend/services/leadService';

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
  const id = typeof req.query.id === 'string' ? req.query.id : null;
  if (!id) return res.status(400).json({ error: 'id is required' });

  const companyId =
    typeof req.query.company_id === 'string' ? req.query.company_id :
    typeof req.body?.company_id === 'string' ? req.body.company_id : null;
  if (!companyId) return res.status(400).json({ error: 'company_id is required' });

  const access = await enforceCompanyAccess({ req, res, companyId });
  if (!access) return;

  if (req.method === 'GET') {
    const form = await getForm(id, companyId);
    if (!form) return res.status(404).json({ error: 'Form not found' });
    return res.status(200).json({ form });
  }

  // Mutations require admin
  const roleGate = await enforceRole({
    req, res, companyId,
    allowedRoles: [Role.COMPANY_ADMIN, Role.SUPER_ADMIN],
  });
  if (!roleGate) return;

  if (req.method === 'PUT' || req.method === 'PATCH') {
    const { name, fields, integration_id, brand } = req.body || {};
    const updates: { name?: string; fields?: FormField[]; brand?: object; integration_id?: string | null } = {};

    if (name && typeof name === 'string') updates.name = name.trim();
    if (fields !== undefined) {
      if (!validateFields(fields) || fields.length === 0) {
        return res.status(400).json({ error: 'fields must be a non-empty array of valid field objects' });
      }
      updates.fields = fields;
    }
    if (brand !== undefined && typeof brand === 'object' && brand !== null) {
      updates.brand = brand;
    }
    if (integration_id !== undefined) {
      updates.integration_id = integration_id && typeof integration_id === 'string' ? integration_id : null;
    }
    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'Nothing to update' });
    }

    try {
      const form = await updateForm(id, companyId, updates);
      return res.status(200).json({ form });
    } catch (err) {
      return res.status(500).json({ error: err instanceof Error ? err.message : 'Update failed' });
    }
  }

  if (req.method === 'DELETE') {
    try {
      await deleteForm(id, companyId);
      return res.status(200).json({ status: 'deleted' });
    } catch (err) {
      return res.status(500).json({ error: err instanceof Error ? err.message : 'Delete failed' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
