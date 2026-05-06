import { supabase } from '../../backend/db/supabaseClient';

function normalizeEmail(email?: string | null): string | null {
  return email ? email.trim().toLowerCase() : null;
}

function normalizePhone(phone?: string | null): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  return digits.length > 0 ? digits : null;
}

export async function ensureUnifiedPerson({
  email,
  phone,
  companyId,
}: {
  email?: string | null;
  phone?: string | null;
  companyId?: string | null;
}): Promise<string | null> {
  if (!companyId) return null;

  const normEmail = normalizeEmail(email);
  const normPhone = normalizePhone(phone);

  if (!normEmail && !normPhone) {
    throw new Error('IDENTITY_INSUFFICIENT_DATA');
  }

  if (normEmail) {
    const { data } = await supabase
      .from('unified_persons')
      .select('id')
      .eq('company_id', companyId)
      .eq('primary_email', normEmail)
      .maybeSingle();

    if ((data as { id?: string } | null)?.id) {
      return (data as { id: string }).id;
    }
  }

  if (normPhone) {
    const { data } = await supabase
      .from('unified_persons')
      .select('id')
      .eq('company_id', companyId)
      .eq('primary_phone', normPhone)
      .maybeSingle();

    if ((data as { id?: string } | null)?.id) {
      return (data as { id: string }).id;
    }
  }

  const { data, error } = await supabase
    .from('unified_persons')
    .insert({
      company_id: companyId,
      primary_email: normEmail,
      primary_phone: normPhone,
      source_of_truth: 'runtime',
    })
    .select('id')
    .single();

  if (error || !(data as { id?: string } | null)?.id) {
    throw new Error('IDENTITY_CREATION_FAILED');
  }

  return (data as { id: string }).id;
}
