do $$
declare
  v_definition text;
  v_fixed_definition text;
begin
  -- Guard the targeted source rewrites so unexpected migration history fails.
  select pg_get_functiondef(
    'public.claim_next_agent_step(uuid,uuid,integer)'::regprocedure
  )
  into v_definition;

  v_fixed_definition := replace(
    v_definition,
    'set status = case when v_agent = ''orchestrator'' then ''planning'' else ''running'' end,',
    'set status = case when v_agent = ''orchestrator'' then ''planning''::public.run_status else ''running''::public.run_status end,'
  );
  if v_fixed_definition = v_definition then
    raise exception 'Could not locate the expected run-status expression';
  end if;
  execute v_fixed_definition;

  select pg_get_functiondef(
    'public.complete_agent_step(uuid,jsonb)'::regprocedure
  )
  into v_definition;

  v_fixed_definition := replace(
    v_definition,
    E'  v_index integer;\r\n',
    ''
  );
  v_fixed_definition := replace(
    v_fixed_definition,
    E'  v_index integer;\n',
    ''
  );
  if v_fixed_definition = v_definition then
    raise exception 'Could not locate the unused loop variable';
  end if;
  execute v_fixed_definition;
end;
$$;
