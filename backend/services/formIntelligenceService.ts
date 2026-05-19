import { ownedDbTable } from '../db/writeOwner';

export async function aggregateFormPerformance(input: {
  companyId: string;
  websiteId?: string | null;
  day?: string | null;
}) {
  const day = input.day ?? new Date().toISOString().slice(0, 10);
  const start = `${day}T00:00:00.000Z`;
  const end = `${day}T23:59:59.999Z`;

  let eventQuery = ownedDbTable('tracking_events')
    .select('*')
    .eq('company_id', input.companyId)
    .gte('occurred_at', start)
    .lte('occurred_at', end)
    .in('event_name', ['form_impression', 'form_start', 'form_field_focus', 'form_field_complete', 'form_abandon', 'form_submit', 'cta_click']);
  if (input.websiteId) eventQuery = eventQuery.eq('website_id', input.websiteId);
  const { data: events, error } = await eventQuery.limit(10000);
  if (error) throw new Error(error.message);

  let conversionQuery = ownedDbTable('form_conversions')
    .select('*')
    .eq('company_id', input.companyId)
    .gte('converted_at', start)
    .lte('converted_at', end);
  if (input.websiteId) conversionQuery = conversionQuery.eq('website_id', input.websiteId);
  const { data: conversions, error: conversionError } = await conversionQuery.limit(5000);
  if (conversionError) throw new Error(conversionError.message);

  const formStats = new Map<string, any>();
  const fieldStats = new Map<string, any>();
  const conversionSessions = new Set((conversions ?? []).map((row: any) => row.visitor_session_id).filter(Boolean));

  for (const event of (events ?? []) as any[]) {
    const formId = String(event.metadata?.form_id || event.metadata?.formId || '');
    if (!formId) continue;
    const key = `${event.website_id ?? 'none'}:${formId}`;
    const stats = formStats.get(key) ?? {
      company_id: input.companyId,
      website_id: event.website_id ?? input.websiteId ?? null,
      form_id: formId,
      day,
      impressions: 0,
      starts: 0,
      submissions: 0,
      abandonments: 0,
      cta_to_submit_count: 0,
      metadata: {},
    };
    if (event.event_name === 'form_impression') stats.impressions += 1;
    if (event.event_name === 'form_start') stats.starts += 1;
    if (event.event_name === 'form_abandon') stats.abandonments += 1;
    if (event.event_name === 'form_submit') stats.submissions += 1;
    if (event.event_name === 'cta_click' && event.visitor_session_id && conversionSessions.has(event.visitor_session_id)) {
      stats.cta_to_submit_count += 1;
    }
    formStats.set(key, stats);

    const fieldKey = String(event.metadata?.field_key || event.metadata?.field || '');
    if (fieldKey) {
      const fieldMapKey = `${key}:${fieldKey}`;
      const field = fieldStats.get(fieldMapKey) ?? {
        company_id: input.companyId,
        website_id: event.website_id ?? input.websiteId ?? null,
        form_id: formId,
        field_key: fieldKey,
        day,
        views: 0,
        starts: 0,
        completions: 0,
        dropoffs: 0,
        metadata: {},
      };
      if (event.event_name === 'form_field_focus') field.starts += 1;
      if (event.event_name === 'form_field_complete') field.completions += 1;
      if (event.event_name === 'form_abandon') field.dropoffs += 1;
      field.views += 1;
      fieldStats.set(fieldMapKey, field);
    }
  }

  for (const conversion of (conversions ?? []) as any[]) {
    const formId = conversion.form_id;
    if (!formId) continue;
    const key = `${conversion.website_id ?? 'none'}:${formId}`;
    const stats = formStats.get(key) ?? {
      company_id: input.companyId,
      website_id: conversion.website_id ?? input.websiteId ?? null,
      form_id: formId,
      day,
      impressions: 0,
      starts: 0,
      submissions: 0,
      abandonments: 0,
      cta_to_submit_count: 0,
      metadata: {},
    };
    stats.submissions += 1;
    formStats.set(key, stats);
  }

  const formRows = [...formStats.values()].map((row) => ({
    ...row,
    completion_rate: row.starts > 0 ? Number((row.submissions / row.starts).toFixed(4)) : 0,
    updated_at: new Date().toISOString(),
  }));
  const fieldRows = [...fieldStats.values()].map((row) => ({ ...row, updated_at: new Date().toISOString() }));

  if (formRows.length) {
    const { error: upsertError } = await ownedDbTable('form_performance_daily')
      .upsert(formRows, { onConflict: 'company_id,website_id,form_id,day' });
    if (upsertError) throw new Error(upsertError.message);
  }
  if (fieldRows.length) {
    const { error: fieldError } = await ownedDbTable('form_field_analytics')
      .upsert(fieldRows, { onConflict: 'company_id,website_id,form_id,field_key,day' });
    if (fieldError) throw new Error(fieldError.message);
  }
  return { day, forms: formRows.length, fields: fieldRows.length };
}

export async function getFormPerformance(input: {
  companyId: string;
  websiteId?: string | null;
  from?: string | null;
  to?: string | null;
}) {
  const from = input.from ?? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const to = input.to ?? new Date().toISOString().slice(0, 10);
  let query = ownedDbTable('form_performance_daily')
    .select('*')
    .eq('company_id', input.companyId)
    .gte('day', from)
    .lte('day', to)
    .order('day', { ascending: false });
  if (input.websiteId) query = query.eq('website_id', input.websiteId);
  const { data, error } = await query.limit(1000);
  if (error) throw new Error(error.message);
  return { rows: data ?? [], from, to };
}
