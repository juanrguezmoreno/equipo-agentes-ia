begin;

select plan(7);

insert into auth.users (id)
values
  ('00000000-0000-0000-0000-000000000001'),
  ('00000000-0000-0000-0000-000000000002');

insert into public.agent_runs (id, owner_id, request)
values
  (
    '10000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000001',
    'Run owned by user one'
  ),
  (
    '10000000-0000-0000-0000-000000000002',
    '00000000-0000-0000-0000-000000000002',
    'Run owned by user two'
  );

insert into public.agent_tasks (id, run_id, sequence, title, description)
values
  (
    '20000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000001',
    1,
    'First task',
    'Task owned by user one'
  ),
  (
    '20000000-0000-0000-0000-000000000002',
    '10000000-0000-0000-0000-000000000001',
    2,
    'Second task',
    'Second task owned by user one'
  ),
  (
    '20000000-0000-0000-0000-000000000003',
    '10000000-0000-0000-0000-000000000002',
    1,
    'Other user task',
    'Task owned by user two'
  );

insert into public.task_dependencies (run_id, task_id, depends_on_task_id)
values (
  '10000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000002',
  '20000000-0000-0000-0000-000000000001'
);

insert into public.artifacts (run_id, task_id, path, revision, content, created_by)
values (
  '10000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000001',
  'app/page.tsx',
  1,
  'export default function Page() { return null; }',
  'develop'
);

insert into public.agent_events (run_id, task_id, agent, event_type, output_summary)
values (
  '10000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000001',
  'develop',
  'artifact_created',
  'Created app/page.tsx'
);

insert into public.step_attempts (run_id, task_id, agent, idempotency_key, attempt_number)
values (
  '10000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000001',
  'develop',
  'rls-test-step',
  1
);

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '00000000-0000-0000-0000-000000000001',
  true
);

select is(
  (select count(*)::integer from public.agent_runs),
  1,
  'an authenticated user sees only their own run'
);
select is(
  (select count(*)::integer from public.agent_tasks),
  2,
  'an authenticated user sees only tasks from their runs'
);
select is(
  (select count(*)::integer from public.task_dependencies),
  1,
  'an authenticated user sees dependencies from their runs'
);
select is(
  (select count(*)::integer from public.artifacts),
  1,
  'an authenticated user sees artifacts from their runs'
);
select is(
  (select count(*)::integer from public.agent_events),
  1,
  'an authenticated user sees events from their runs'
);
select is(
  (select count(*)::integer from public.step_attempts),
  1,
  'an authenticated user sees attempts from their runs'
);

reset role;
set local role anon;
select throws_ok(
  'select count(*) from public.agent_runs',
  '42501',
  null,
  'unauthenticated clients cannot query agent runs'
);

select * from finish();
rollback;
