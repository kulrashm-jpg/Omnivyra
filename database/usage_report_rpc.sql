-- SQL-level aggregation for usage reporting. Called via supabase.rpc('get_usage_report', {...}).
-- Does not modify usage_events; read-only.

create or replace function get_usage_report(
  p_organization_id uuid,
  p_campaign_id uuid default null,
  p_process_type text default null,
  p_source_type text default null,
  p_provider_name text default null,
  p_model_name text default null,
  p_start_date timestamptz default null,
  p_end_date timestamptz default null,
  p_include_detail boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  base_where text := ' organization_id = $1 ';
  params jsonb;
  rec record;
  totals jsonb;
  by_provider_model jsonb := '[]'::jsonb;
  by_process jsonb := '[]'::jsonb;
  by_campaign jsonb := '[]'::jsonb;
  recent_events jsonb := '[]'::jsonb;
  total_events bigint;
  total_input bigint;
  total_output bigint;
  total_tokens bigint;
  total_cost numeric;
  avg_latency numeric;
  error_count bigint;
  detail_limit int := 100;
begin
  -- Build base filter (organization_id only here; extra filters in subqueries)
  -- Totals
  select
    count(*)::bigint,
    coalesce(sum(input_tokens), 0)::bigint,
    coalesce(sum(output_tokens), 0)::bigint,
    coalesce(sum(total_tokens), 0)::bigint,
    coalesce(sum(total_cost), 0),
    coalesce(avg(latency_ms), 0),
    count(*) filter (where error_flag = true)::bigint
  into total_events, total_input, total_output, total_tokens, total_cost, avg_latency, error_count
  from usage_events
  where organization_id = p_organization_id
    and (p_campaign_id is null or campaign_id = p_campaign_id)
    and (p_process_type is null or process_type = p_process_type)
    and (p_source_type is null or source_type = p_source_type)
    and (p_provider_name is null or provider_name = p_provider_name)
    and (p_model_name is null or model_name = p_model_name)
    and (p_start_date is null or created_at >= p_start_date)
    and (p_end_date is null or created_at <= p_end_date);

  totals := jsonb_build_object(
    'total_events', coalesce(total_events, 0),
    'total_input_tokens', coalesce(total_input, 0),
    'total_output_tokens', coalesce(total_output, 0),
    'total_tokens', coalesce(total_tokens, 0),
    'total_cost', coalesce(total_cost, 0),
    'avg_latency_ms', round(coalesce(avg_latency, 0)::numeric, 2),
    'error_rate_percent', case when coalesce(total_events, 0) = 0 then 0
      else round((coalesce(error_count, 0)::numeric / total_events::numeric * 100)::numeric, 2) end
  );

  -- By provider + model
  select coalesce(jsonb_agg(sub), '[]'::jsonb) into by_provider_model
  from (
    select jsonb_build_object(
      'provider_name', provider_name,
      'model_name', model_name,
      'total_tokens', coalesce(sum(total_tokens), 0)::bigint,
      'total_cost', coalesce(sum(total_cost), 0),
      'avg_latency_ms', round(coalesce(avg(latency_ms), 0)::numeric, 2),
      'error_rate_percent', case when count(*) = 0 then 0
        else round((count(*) filter (where error_flag = true)::numeric / count(*)::numeric * 100)::numeric, 2) end
    ) as sub
    from usage_events
    where organization_id = p_organization_id
      and (p_campaign_id is null or campaign_id = p_campaign_id)
      and (p_process_type is null or process_type = p_process_type)
      and (p_source_type is null or source_type = p_source_type)
      and (p_provider_name is null or provider_name = p_provider_name)
      and (p_model_name is null or model_name = p_model_name)
      and (p_start_date is null or created_at >= p_start_date)
      and (p_end_date is null or created_at <= p_end_date)
    group by provider_name, model_name
  ) x;

  -- By process_type
  select coalesce(jsonb_agg(sub), '[]'::jsonb) into by_process
  from (
    select jsonb_build_object(
      'process_type', process_type,
      'total_events', count(*)::bigint,
      'total_tokens', coalesce(sum(total_tokens), 0)::bigint,
      'total_cost', coalesce(sum(total_cost), 0),
      'avg_latency_ms', round(coalesce(avg(latency_ms), 0)::numeric, 2)
    ) as sub
    from usage_events
    where organization_id = p_organization_id
      and (p_campaign_id is null or campaign_id = p_campaign_id)
      and (p_process_type is null or process_type = p_process_type)
      and (p_source_type is null or source_type = p_source_type)
      and (p_provider_name is null or provider_name = p_provider_name)
      and (p_model_name is null or model_name = p_model_name)
      and (p_start_date is null or created_at >= p_start_date)
      and (p_end_date is null or created_at <= p_end_date)
    group by process_type
  ) x;

  -- By campaign_id
  select coalesce(jsonb_agg(sub), '[]'::jsonb) into by_campaign
  from (
    select jsonb_build_object(
      'campaign_id', campaign_id,
      'total_events', count(*)::bigint,
      'total_tokens', coalesce(sum(total_tokens), 0)::bigint,
      'total_cost', coalesce(sum(total_cost), 0),
      'avg_latency_ms', round(coalesce(avg(latency_ms), 0)::numeric, 2)
    ) as sub
    from usage_events
    where organization_id = p_organization_id
      and campaign_id is not null
      and (p_campaign_id is null or campaign_id = p_campaign_id)
      and (p_process_type is null or process_type = p_process_type)
      and (p_source_type is null or source_type = p_source_type)
      and (p_provider_name is null or provider_name = p_provider_name)
      and (p_model_name is null or model_name = p_model_name)
      and (p_start_date is null or created_at >= p_start_date)
      and (p_end_date is null or created_at <= p_end_date)
    group by campaign_id
  ) x;

  -- Recent events (last 100, for detail=true)
  if p_include_detail then
    select coalesce(jsonb_agg(row_to_json(t)::jsonb), '[]'::jsonb) into recent_events
    from (
      select id, organization_id, campaign_id, user_id, source_type, provider_name, model_name,
             source_name, process_type, input_tokens, output_tokens, total_tokens,
             latency_ms, error_flag, error_type, unit_cost, total_cost, pricing_snapshot,
             metadata, created_at
      from usage_events
      where organization_id = p_organization_id
        and (p_campaign_id is null or campaign_id = p_campaign_id)
        and (p_process_type is null or process_type = p_process_type)
        and (p_source_type is null or source_type = p_source_type)
        and (p_provider_name is null or provider_name = p_provider_name)
        and (p_model_name is null or model_name = p_model_name)
        and (p_start_date is null or created_at >= p_start_date)
        and (p_end_date is null or created_at <= p_end_date)
      order by created_at desc
      limit detail_limit
    ) t;
  end if;

  return jsonb_build_object(
    'totals', totals,
    'by_provider_model', by_provider_model,
    'by_process', by_process,
    'by_campaign', by_campaign,
    'recent_events', recent_events
  );
end;
$$;
