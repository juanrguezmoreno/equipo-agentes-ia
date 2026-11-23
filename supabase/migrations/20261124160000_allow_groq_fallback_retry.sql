do $$
declare
  v_function_definition text;
  v_updated_definition text;
  v_pattern text := 'v_next_attempt > 3';
begin
  select pg_get_functiondef(
    'public.claim_next_agent_step(uuid,uuid,integer)'::regprocedure
  )
  into v_function_definition;

  if length(v_function_definition)
      - length(replace(v_function_definition, v_pattern, ''))
      <> length(v_pattern) then
    raise exception 'Expected one provider-attempt limit in claim_next_agent_step';
  end if;

  v_updated_definition := replace(
    v_function_definition,
    v_pattern,
    'v_next_attempt > 4'
  );
  execute v_updated_definition;
end;
$$;

create or replace function public.fail_agent_step(
  p_attempt_id uuid,
  p_error_code text,
  p_retryable boolean,
  p_retry_after_seconds integer default 2,
  p_error_summary text default 'The agent step failed.'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempt public.step_attempts%rowtype;
  v_run_id uuid;
  v_summary text;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service_role is required' using errcode = '42501';
  end if;
  if p_error_code is null or p_error_code !~ '^[a-z][a-z0-9_]{0,63}$' then
    raise exception 'Invalid error code' using errcode = '22023';
  end if;

  select run_id into v_run_id
  from public.step_attempts
  where id = p_attempt_id;
  if not found then
    raise exception 'Step attempt not found' using errcode = 'P0002';
  end if;

  perform 1
  from public.agent_runs
  where id = v_run_id
  for update;
  if not found then
    raise exception 'Run not found' using errcode = 'P0002';
  end if;

  select * into v_attempt
  from public.step_attempts
  where id = p_attempt_id
  for update;
  if not found then
    raise exception 'Step attempt not found' using errcode = 'P0002';
  end if;

  if v_attempt.status <> 'running' then
    return jsonb_build_object('status', v_attempt.status);
  end if;

  v_summary := left(coalesce(p_error_summary, 'The agent step failed.'), 1000);
  if p_retryable and v_attempt.attempt_number < 4 then
    update public.step_attempts
    set status = 'retry_wait',
        next_attempt_at = now() + make_interval(
          secs => greatest(1, least(coalesce(p_retry_after_seconds, 2), 60))
        ),
        lease_expires_at = null,
        error_code = p_error_code,
        output_summary = v_summary,
        finished_at = now()
    where id = p_attempt_id
    returning * into v_attempt;

    update public.agent_runs
    set status = 'retry_wait', error_message = null
    where id = v_attempt.run_id;
    insert into public.agent_events (
      run_id, task_id, agent, event_type, output_summary,
      metadata
    )
    values (
      v_attempt.run_id, v_attempt.task_id, v_attempt.agent,
      'retry_scheduled', v_summary,
      jsonb_build_object(
        'attempt', v_attempt.attempt_number,
        'retryAt', v_attempt.next_attempt_at,
        'errorCode', p_error_code
      )
    );

    return jsonb_build_object(
      'status', 'retry_wait',
      'retryAt', v_attempt.next_attempt_at
    );
  end if;

  update public.step_attempts
  set status = 'failed',
      next_attempt_at = null,
      lease_expires_at = null,
      error_code = p_error_code,
      output_summary = v_summary,
      finished_at = now()
  where id = p_attempt_id;

  if v_attempt.task_id is not null then
    update public.agent_tasks
    set status = 'failed'
    where id = v_attempt.task_id and status <> 'completed';
  end if;
  update public.agent_runs
  set status = 'failed',
      error_message = 'Agent step failed: ' || p_error_code
  where id = v_attempt.run_id;
  insert into public.agent_events (
    run_id, task_id, agent, event_type, output_summary,
    metadata
  )
  values (
    v_attempt.run_id, v_attempt.task_id, v_attempt.agent,
    'agent_failed', v_summary,
    jsonb_build_object(
      'attempt', v_attempt.attempt_number,
      'errorCode', p_error_code
    )
  );

  return jsonb_build_object('status', 'failed');
end;
$$;
