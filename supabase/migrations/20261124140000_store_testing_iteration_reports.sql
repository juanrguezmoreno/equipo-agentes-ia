do $$
declare
  v_definition text;
  v_fixed_definition text;
begin
  select pg_get_functiondef(
    'public.complete_agent_step(uuid,jsonb)'::regprocedure
  )
  into v_definition;

  v_fixed_definition := replace(
    v_definition,
    'iteration'', v_task.iteration_count',
    'iteration'', case when not v_passed and v_task.iteration_count < v_task.max_iterations then v_task.iteration_count - 1 else v_task.iteration_count end'
  );
  if v_fixed_definition = v_definition then
    raise exception 'Could not locate the testing-event iteration';
  end if;

  v_definition := v_fixed_definition;
  v_fixed_definition := replace(
    v_definition,
    'maxIterations'', v_task.max_iterations',
    'maxIterations'', v_task.max_iterations, ''report'', p_result'
  );
  if v_fixed_definition = v_definition then
    raise exception 'Could not locate the testing-event metadata';
  end if;

  execute v_fixed_definition;
end;
$$;
