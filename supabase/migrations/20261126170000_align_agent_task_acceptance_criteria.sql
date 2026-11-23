alter table public.agent_tasks
  drop constraint agent_tasks_acceptance_criteria_check;

update public.agent_tasks
set acceptance_criteria = jsonb_build_object(
  'criteria', acceptance_criteria,
  'checks', '[]'::jsonb
)
where jsonb_typeof(acceptance_criteria) = 'array';

alter table public.agent_tasks
  add constraint agent_tasks_acceptance_criteria_check
  check (
    jsonb_typeof(acceptance_criteria) = 'object'
    and jsonb_typeof(acceptance_criteria -> 'criteria') = 'array'
    and jsonb_typeof(acceptance_criteria -> 'checks') = 'array'
  );

alter table public.agent_tasks
  alter column acceptance_criteria
  set default '{"criteria":[],"checks":[]}'::jsonb;
