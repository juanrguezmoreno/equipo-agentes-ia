grant execute on function public.set_updated_at() to service_role;

create function public.create_agent_run(
  p_owner_id uuid,
  p_request text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run_id uuid;
  v_recent_run_count integer;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service_role is required' using errcode = '42501';
  end if;

  if p_owner_id is null or p_request is null
    or char_length(btrim(p_request)) not between 1 and 4000 then
    raise exception 'Invalid run request' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_owner_id::text, 0));
  select count(*) into v_recent_run_count
  from public.agent_runs
  where owner_id = p_owner_id
    and created_at >= now() - interval '1 hour';
  if v_recent_run_count >= 5 then
    raise exception 'RUN_RATE_LIMIT' using errcode = 'P0001';
  end if;

  insert into public.agent_runs (owner_id, request)
  values (p_owner_id, btrim(p_request))
  returning id into v_run_id;

  insert into public.agent_events (
    run_id,
    agent,
    event_type,
    input_summary
  )
  values (
    v_run_id,
    'system',
    'run_created',
    'A new agent run was created.'
  );

  return v_run_id;
end;
$$;

create function public.claim_next_agent_step(
  p_run_id uuid,
  p_owner_id uuid,
  p_lease_seconds integer default 45
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run public.agent_runs%rowtype;
  v_task public.agent_tasks%rowtype;
  v_attempt public.step_attempts%rowtype;
  v_agent public.agent_name;
  v_step_key text;
  v_next_attempt integer;
  v_task_json jsonb;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service_role is required' using errcode = '42501';
  end if;
  if p_lease_seconds not between 5 and 60 then
    raise exception 'Lease must be between 5 and 60 seconds'
      using errcode = '22023';
  end if;

  select * into v_run
  from public.agent_runs
  where id = p_run_id
  for update;

  if not found or v_run.owner_id <> p_owner_id then
    raise exception 'Run not found' using errcode = 'P0002';
  end if;

  if v_run.status in ('completed', 'failed', 'cancelled') then
    return jsonb_build_object('status', v_run.status);
  end if;

  if exists (
    select 1 from public.agent_tasks
    where run_id = p_run_id and status = 'failed'
  ) then
    update public.agent_runs set status = 'failed'
    where id = p_run_id and status <> 'failed';
    return jsonb_build_object('status', 'failed');
  end if;

  if not exists (
    select 1 from public.agent_tasks where run_id = p_run_id
  ) then
    if v_run.status not in ('planning', 'retry_wait') then
      raise exception 'Run has no plan but is not planning'
        using errcode = '40001';
    end if;
    v_agent := 'orchestrator';
    v_step_key := 'orchestrator:plan:v1';
  else
    select t.* into v_task
    from public.agent_tasks t
    where t.run_id = p_run_id
      and (
        t.status in ('developing', 'testing')
        or (
          t.status = 'pending'
          and not exists (
            select 1
            from public.task_dependencies d
            join public.agent_tasks dependency
              on dependency.id = d.depends_on_task_id
            where d.task_id = t.id
              and dependency.status <> 'completed'
          )
        )
      )
    order by
      case when t.status in ('developing', 'testing') then 0 else 1 end,
      t.sequence
    limit 1
    for update;

    if not found then
      if exists (
        select 1 from public.agent_tasks
        where run_id = p_run_id and status = 'pending'
      ) then
        update public.agent_runs
        set status = 'failed',
            error_message = 'Task dependencies could not be resolved.'
        where id = p_run_id;
        insert into public.agent_events (
          run_id, agent, event_type, output_summary
        )
        values (
          p_run_id, 'system', 'workflow_failed',
          'Task dependencies could not be resolved.'
        );
        return jsonb_build_object(
          'status', 'failed',
          'error', 'unresolved_dependencies'
        );
      end if;

      update public.agent_runs
      set status = 'completed', error_message = null
      where id = p_run_id;
      insert into public.agent_events (
        run_id, agent, event_type, output_summary
      )
      values (
        p_run_id, 'system', 'run_completed',
        'All planned tasks passed testing.'
      );
      return jsonb_build_object('status', 'completed');
    end if;

    if v_task.status = 'pending' then
      update public.agent_tasks
      set status = 'developing', iteration_count = 1
      where id = v_task.id
      returning * into v_task;
    end if;

    if v_task.status = 'developing' then
      v_agent := 'develop';
      v_step_key := 'task:' || v_task.id::text || ':develop:'
        || v_task.iteration_count::text;
    else
      v_agent := 'testing';
      v_step_key := 'task:' || v_task.id::text || ':test:'
        || v_task.iteration_count::text;
    end if;
  end if;

  select a.* into v_attempt
  from public.step_attempts a
  where a.run_id = p_run_id and a.idempotency_key = v_step_key
  order by a.attempt_number desc
  limit 1
  for update;

  if found and v_attempt.status = 'running' then
    if v_attempt.lease_expires_at is not null
      and v_attempt.lease_expires_at > now() then
      return jsonb_build_object(
        'status', 'busy',
        'leaseExpiresAt', v_attempt.lease_expires_at
      );
    end if;

    update public.step_attempts
    set status = 'retry_wait',
        next_attempt_at = now(),
        lease_expires_at = null,
        error_code = 'lease_expired',
        finished_at = now()
    where id = v_attempt.id
    returning * into v_attempt;
  end if;

  if found and v_attempt.status = 'retry_wait'
    and v_attempt.next_attempt_at > now() then
    return jsonb_build_object(
      'status', 'waiting',
      'retryAt', v_attempt.next_attempt_at
    );
  end if;

  if found and v_attempt.status in ('failed', 'succeeded') then
    raise exception 'Step state does not match workflow state'
      using errcode = '40001';
  end if;

  v_next_attempt := coalesce(v_attempt.attempt_number, 0) + 1;
  if v_next_attempt > 3 then
    update public.step_attempts
    set status = 'failed',
        next_attempt_at = null,
        lease_expires_at = null,
        error_code = 'provider_attempts_exhausted',
        finished_at = now()
    where id = v_attempt.id;

    if v_task.id is not null then
      update public.agent_tasks set status = 'failed' where id = v_task.id;
    end if;
    update public.agent_runs
    set status = 'failed',
        error_message = 'The agent step exhausted its retry limit.'
    where id = p_run_id;
    insert into public.agent_events (
      run_id, task_id, agent, event_type, output_summary
    )
    values (
      p_run_id, v_task.id, v_agent, 'agent_failed',
      'The agent step exhausted its retry limit.'
    );
    return jsonb_build_object('status', 'failed');
  end if;

  if v_run.status = 'retry_wait' then
    update public.agent_runs
    set status = case when v_agent = 'orchestrator' then 'planning' else 'running' end,
        error_message = null
    where id = p_run_id;
  elsif v_agent <> 'orchestrator' and v_run.status = 'planning' then
    update public.agent_runs set status = 'running' where id = p_run_id;
  end if;

  insert into public.step_attempts (
    run_id,
    task_id,
    agent,
    idempotency_key,
    attempt_number,
    status,
    lease_expires_at,
    input_summary
  )
  values (
    p_run_id,
    v_task.id,
    v_agent,
    v_step_key,
    v_next_attempt,
    'running',
    now() + make_interval(secs => p_lease_seconds),
    case
      when v_agent = 'orchestrator' then 'Create an ordered task plan.'
      when v_agent = 'develop' then 'Implement task ' || v_task.sequence::text || '.'
      else 'Test task ' || v_task.sequence::text || '.'
    end
  )
  returning * into v_attempt;

  insert into public.agent_events (
    run_id, task_id, agent, event_type, input_summary, metadata
  )
  values (
    p_run_id,
    v_task.id,
    v_agent,
    'step_started',
    v_attempt.input_summary,
    jsonb_build_object(
      'attempt', v_attempt.attempt_number,
      'stepKey', v_step_key
    )
  );

  if v_task.id is null then
    v_task_json := null;
  else
    v_task_json := jsonb_build_object(
      'id', v_task.id,
      'sequence', v_task.sequence,
      'title', v_task.title,
      'description', v_task.description,
      'acceptanceCriteria', v_task.acceptance_criteria,
      'iteration', v_task.iteration_count,
      'maxIterations', v_task.max_iterations,
      'previousTestReport', v_task.last_test_report
    );
  end if;

  return jsonb_build_object(
    'status', 'claimed',
    'attemptId', v_attempt.id,
    'agent', v_agent,
    'stepKey', v_step_key,
    'attemptNumber', v_attempt.attempt_number,
    'request', v_run.request,
    'task', v_task_json
  );
end;
$$;

create function public.complete_agent_step(
  p_attempt_id uuid,
  p_result jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempt public.step_attempts%rowtype;
  v_run public.agent_runs%rowtype;
  v_task public.agent_tasks%rowtype;
  v_task_json jsonb;
  v_file jsonb;
  v_dependency jsonb;
  v_file_path text;
  v_revision integer;
  v_new_task_id uuid;
  v_created_task_ids uuid[] := array[]::uuid[];
  v_index integer;
  v_passed boolean;
  v_expected_pass boolean;
  v_summary text;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service_role is required' using errcode = '42501';
  end if;
  if jsonb_typeof(p_result) is distinct from 'object' then
    raise exception 'Step result must be a JSON object' using errcode = '22023';
  end if;

  select * into v_attempt
  from public.step_attempts
  where id = p_attempt_id;
  if not found then
    raise exception 'Step attempt not found' using errcode = 'P0002';
  end if;

  select * into v_run
  from public.agent_runs
  where id = v_attempt.run_id
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

  if v_attempt.status = 'succeeded' then
    return jsonb_build_object('status', 'already_completed');
  end if;
  if v_attempt.status <> 'running' then
    return jsonb_build_object('status', 'not_running');
  end if;

  if v_run.status in ('completed', 'failed', 'cancelled') then
    return jsonb_build_object('status', v_run.status);
  end if;

  if exists (
    select 1 from public.step_attempts newer
    where newer.run_id = v_attempt.run_id
      and newer.idempotency_key = v_attempt.idempotency_key
      and newer.attempt_number > v_attempt.attempt_number
      and newer.status in ('running', 'succeeded')
  ) then
    update public.step_attempts
    set status = 'failed',
        lease_expires_at = null,
        error_code = 'lease_superseded',
        finished_at = now()
    where id = v_attempt.id;
    return jsonb_build_object('status', 'superseded');
  end if;

  if v_attempt.agent = 'orchestrator' then
    if jsonb_typeof(p_result -> 'tasks') is distinct from 'array' then
      raise exception 'Plan tasks must be an array' using errcode = '22023';
    end if;
    if jsonb_array_length(p_result -> 'tasks') not between 1 and 5 then
      raise exception 'Plan must contain between 1 and 5 tasks'
        using errcode = '22023';
    end if;

    for v_index in 0..jsonb_array_length(p_result -> 'tasks') - 1 loop
      v_task_json := p_result -> 'tasks' -> v_index;
      if jsonb_typeof(v_task_json) is distinct from 'object'
        or jsonb_typeof(v_task_json -> 'dependsOn') is distinct from 'array' then
        raise exception 'Invalid task dependencies' using errcode = '22023';
      end if;
      if jsonb_array_length(v_task_json -> 'dependsOn') > 4 then
        raise exception 'Invalid task dependencies' using errcode = '22023';
      end if;

      insert into public.agent_tasks (
        run_id,
        sequence,
        title,
        description,
        acceptance_criteria,
        max_iterations
      )
      values (
        v_attempt.run_id,
        v_index + 1,
        v_task_json ->> 'title',
        v_task_json ->> 'description',
        jsonb_build_object(
          'criteria', v_task_json -> 'acceptanceCriteria',
          'checks', v_task_json -> 'checks'
        ),
        v_run.max_task_iterations
      )
      returning id into v_new_task_id;

      v_created_task_ids := array_append(v_created_task_ids, v_new_task_id);
    end loop;

    for v_index in 0..jsonb_array_length(p_result -> 'tasks') - 1 loop
      v_task_json := p_result -> 'tasks' -> v_index;
      for v_dependency in
        select value from jsonb_array_elements(v_task_json -> 'dependsOn')
      loop
        if jsonb_typeof(v_dependency) is distinct from 'number'
          or (v_dependency #>> '{}') !~ '^[1-5]$' then
          raise exception 'Task dependency is invalid' using errcode = '22023';
        end if;
        if (v_dependency #>> '{}')::integer > array_length(v_created_task_ids, 1)
          or (v_dependency #>> '{}')::integer = v_index + 1 then
          raise exception 'Task dependency is invalid' using errcode = '22023';
        end if;
        insert into public.task_dependencies (
          run_id, task_id, depends_on_task_id
        )
        values (
          v_attempt.run_id,
          v_created_task_ids[v_index + 1],
          v_created_task_ids[(v_dependency #>> '{}')::integer]
        );
      end loop;
    end loop;

    if exists (
      with recursive dependency_walk(task_id, depends_on_task_id, visited, cycle) as (
        select
          d.task_id,
          d.depends_on_task_id,
          array[d.task_id, d.depends_on_task_id],
          d.task_id = d.depends_on_task_id
        from public.task_dependencies d
        where d.run_id = v_attempt.run_id
        union all
        select
          walk.task_id,
          d.depends_on_task_id,
          walk.visited || d.depends_on_task_id,
          d.depends_on_task_id = any(walk.visited)
        from dependency_walk walk
        join public.task_dependencies d
          on d.run_id = v_attempt.run_id
          and d.task_id = walk.depends_on_task_id
        where not walk.cycle
      )
      select 1 from dependency_walk where cycle
    ) then
      raise exception 'Task dependencies contain a cycle' using errcode = '22023';
    end if;

    update public.agent_runs
    set status = 'running', error_message = null
    where id = v_attempt.run_id;
    v_summary := left(coalesce(p_result ->> 'summary', 'Plan created.'), 4000);
    update public.step_attempts
    set status = 'succeeded',
        lease_expires_at = null,
        output_summary = v_summary,
        finished_at = now()
    where id = v_attempt.id;
    insert into public.agent_events (
      run_id, agent, event_type, output_summary,
      metadata
    )
    values (
      v_attempt.run_id, 'orchestrator', 'plan_completed', v_summary,
      jsonb_build_object('taskCount', array_length(v_created_task_ids, 1))
    );
    return jsonb_build_object(
      'status', 'completed',
      'taskCount', array_length(v_created_task_ids, 1)
    );
  end if;

  if v_attempt.task_id is null then
    raise exception 'Task step is missing its task id' using errcode = '23514';
  end if;
  select * into v_task
  from public.agent_tasks
  where id = v_attempt.task_id and run_id = v_attempt.run_id
  for update;
  if not found then
    raise exception 'Task not found' using errcode = 'P0002';
  end if;

  if v_attempt.agent = 'develop' then
    if v_task.status <> 'developing'
      or jsonb_typeof(p_result -> 'files') is distinct from 'array' then
      raise exception 'Development result does not match task state'
        using errcode = '22023';
    end if;
    if jsonb_array_length(p_result -> 'files') not between 1 and 4 then
      raise exception 'Development result does not match task state'
        using errcode = '22023';
    end if;

    for v_file in
      select value from jsonb_array_elements(p_result -> 'files')
    loop
      v_file_path := v_file ->> 'path';
      if v_file_path is null
        or char_length(v_file_path) not between 1 and 240
        or v_file_path !~ '^[A-Za-z0-9._/-]+$'
        or v_file_path ~ '(^/|/$|//|(^|/)\.\.?(/|$))'
        or v_file_path !~ '\.(ts|tsx|css|json|md)$'
        or char_length(coalesce(v_file ->> 'content', '')) not between 1 and 24000 then
        raise exception 'Development artifact path or content is invalid'
          using errcode = '22023';
      end if;

      select coalesce(max(revision), 0) + 1 into v_revision
      from public.artifacts
      where run_id = v_attempt.run_id and path = v_file_path;

      insert into public.artifacts (
        run_id, task_id, path, revision, content, created_by
      )
      values (
        v_attempt.run_id, v_task.id, v_file_path, v_revision,
        v_file ->> 'content', 'develop'
      );
    end loop;

    update public.agent_tasks set status = 'testing' where id = v_task.id;
    v_summary := left(coalesce(p_result ->> 'summary', 'Development completed.'), 4000);
    update public.step_attempts
    set status = 'succeeded',
        lease_expires_at = null,
        output_summary = v_summary,
        finished_at = now()
    where id = v_attempt.id;
    insert into public.agent_events (
      run_id, task_id, agent, event_type, output_summary,
      metadata
    )
    values (
      v_attempt.run_id, v_task.id, 'develop', 'development_completed',
      v_summary,
      jsonb_build_object('fileCount', jsonb_array_length(p_result -> 'files'))
    );
    return jsonb_build_object('status', 'testing');
  end if;

  if v_attempt.agent <> 'testing' or v_task.status <> 'testing'
    or jsonb_typeof(p_result -> 'passed') is distinct from 'boolean'
    or jsonb_typeof(p_result -> 'deterministicChecks') is distinct from 'array'
    or (
      jsonb_typeof(p_result -> 'review') is distinct from 'object'
      and jsonb_typeof(p_result -> 'review') is distinct from 'null'
    ) then
    raise exception 'Test report does not match task state'
      using errcode = '22023';
  end if;

  v_passed := (p_result ->> 'passed')::boolean;
  if jsonb_array_length(p_result -> 'deterministicChecks') = 0 then
    raise exception 'At least one deterministic check is required'
      using errcode = '22023';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_result -> 'deterministicChecks') check_result
    where jsonb_typeof(check_result) is distinct from 'object'
      or jsonb_typeof(check_result -> 'passed') is distinct from 'boolean'
  ) then
    raise exception 'Deterministic check result is invalid'
      using errcode = '22023';
  end if;
  if jsonb_typeof(p_result -> 'review') = 'object'
    and jsonb_typeof(p_result -> 'review' -> 'passed') is distinct from 'boolean' then
    raise exception 'Testing review result is invalid' using errcode = '22023';
  end if;

  v_expected_pass :=
    not exists (
      select 1
      from jsonb_array_elements(p_result -> 'deterministicChecks') check_result
      where check_result -> 'passed' <> 'true'::jsonb
    )
    and coalesce(
      p_result -> 'review' -> 'passed' = 'true'::jsonb,
      false
    );
  if v_passed is distinct from v_expected_pass then
    raise exception 'Test report pass state is inconsistent with its results'
      using errcode = '22023';
  end if;

  update public.agent_tasks
  set status = case
        when v_passed then 'completed'::public.task_status
        when iteration_count < max_iterations then 'developing'::public.task_status
        else 'failed'::public.task_status
      end,
      iteration_count = case
        when not v_passed and iteration_count < max_iterations
          then iteration_count + 1
        else iteration_count
      end,
      last_test_report = p_result
  where id = v_task.id
  returning * into v_task;

  if v_task.status = 'failed' then
    update public.agent_runs
    set status = 'failed',
        error_message = 'Task iteration limit reached after failed testing.'
    where id = v_attempt.run_id;
  end if;

  v_summary := left(coalesce(p_result ->> 'summary', 'Testing completed.'), 4000);
  update public.step_attempts
  set status = 'succeeded',
      lease_expires_at = null,
      output_summary = v_summary,
      finished_at = now()
  where id = v_attempt.id;
  insert into public.agent_events (
    run_id, task_id, agent, event_type, output_summary,
    metadata
  )
  values (
    v_attempt.run_id,
    v_task.id,
    'testing',
    case when v_passed then 'testing_passed' else 'testing_failed' end,
    v_summary,
    jsonb_build_object(
      'passed', v_passed,
      'iteration', v_task.iteration_count,
      'maxIterations', v_task.max_iterations
    )
  );

  return jsonb_build_object(
    'status', case when v_passed then 'completed' else v_task.status::text end,
    'passed', v_passed,
    'iteration', v_task.iteration_count
  );
end;
$$;

create function public.fail_agent_step(
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
  if p_retryable and v_attempt.attempt_number < 3 then
    update public.step_attempts
    set status = 'retry_wait',
        next_attempt_at = now() + make_interval(
          secs => greatest(1, least(coalesce(p_retry_after_seconds, 2), 60))
        ),
        lease_expires_at = null,
        error_code = p_error_code,
        output_summary = v_summary,
        finished_at = now()
    where id = v_attempt.id
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
  where id = v_attempt.id;

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

revoke all on function public.create_agent_run(uuid, text)
  from public, anon, authenticated;
revoke all on function public.claim_next_agent_step(uuid, uuid, integer)
  from public, anon, authenticated;
revoke all on function public.complete_agent_step(uuid, jsonb)
  from public, anon, authenticated;
revoke all on function public.fail_agent_step(uuid, text, boolean, integer, text)
  from public, anon, authenticated;

grant execute on function public.create_agent_run(uuid, text) to service_role;
grant execute on function public.claim_next_agent_step(uuid, uuid, integer)
  to service_role;
grant execute on function public.complete_agent_step(uuid, jsonb)
  to service_role;
grant execute on function public.fail_agent_step(uuid, text, boolean, integer, text)
  to service_role;
