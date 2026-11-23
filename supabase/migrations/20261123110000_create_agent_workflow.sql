create type public.run_status as enum (
  'planning',
  'running',
  'retry_wait',
  'completed',
  'failed',
  'cancelled'
);

create type public.task_status as enum (
  'pending',
  'developing',
  'testing',
  'failed',
  'completed'
);

create type public.agent_name as enum (
  'orchestrator',
  'develop',
  'testing',
  'system'
);

create type public.step_status as enum (
  'pending',
  'running',
  'retry_wait',
  'succeeded',
  'failed'
);

create table public.agent_runs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  request text not null check (char_length(request) between 1 and 4000),
  status public.run_status not null default 'planning',
  schema_version smallint not null default 1 check (schema_version > 0),
  max_task_iterations smallint not null default 3
    check (max_task_iterations between 1 and 5),
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.agent_tasks (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.agent_runs (id) on delete cascade,
  sequence integer not null check (sequence > 0),
  title text not null check (char_length(title) between 1 and 160),
  description text not null check (char_length(description) between 1 and 4000),
  acceptance_criteria jsonb not null default '[]'::jsonb
    check (jsonb_typeof(acceptance_criteria) = 'array'),
  status public.task_status not null default 'pending',
  iteration_count smallint not null default 0 check (iteration_count >= 0),
  max_iterations smallint not null default 3 check (max_iterations between 1 and 5),
  last_test_report jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (run_id, sequence),
  unique (id, run_id)
);

create table public.task_dependencies (
  run_id uuid not null references public.agent_runs (id) on delete cascade,
  task_id uuid not null,
  depends_on_task_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (task_id, depends_on_task_id),
  check (task_id <> depends_on_task_id),
  foreign key (task_id, run_id)
    references public.agent_tasks (id, run_id) on delete cascade,
  foreign key (depends_on_task_id, run_id)
    references public.agent_tasks (id, run_id) on delete cascade
);

create table public.artifacts (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.agent_runs (id) on delete cascade,
  task_id uuid,
  path text not null
    check (
      char_length(path) between 1 and 240
      and path ~ '^[A-Za-z0-9._/-]+$'
      and path !~ '(^/|/$|//|(^|/)\.\.?(/|$))'
    ),
  revision integer not null check (revision > 0),
  content text not null check (char_length(content) <= 65536),
  created_by public.agent_name not null,
  created_at timestamptz not null default now(),
  unique (run_id, path, revision),
  foreign key (task_id, run_id)
    references public.agent_tasks (id, run_id) on delete cascade
);

create table public.agent_events (
  id bigint generated always as identity primary key,
  run_id uuid not null references public.agent_runs (id) on delete cascade,
  task_id uuid,
  agent public.agent_name not null,
  event_type text not null
    check (event_type ~ '^[a-z][a-z0-9_]{0,63}$'),
  input_summary text check (char_length(input_summary) <= 4000),
  output_summary text check (char_length(output_summary) <= 4000),
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  foreign key (task_id, run_id)
    references public.agent_tasks (id, run_id) on delete cascade
);

create table public.step_attempts (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.agent_runs (id) on delete cascade,
  task_id uuid,
  agent public.agent_name not null,
  idempotency_key text not null
    check (char_length(idempotency_key) between 1 and 160),
  attempt_number smallint not null check (attempt_number > 0),
  status public.step_status not null default 'pending',
  lease_expires_at timestamptz,
  next_attempt_at timestamptz,
  error_code text,
  input_summary text check (char_length(input_summary) <= 4000),
  output_summary text check (char_length(output_summary) <= 4000),
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  unique (run_id, idempotency_key, attempt_number),
  foreign key (task_id, run_id)
    references public.agent_tasks (id, run_id) on delete cascade
);

create index agent_runs_owner_created_idx
  on public.agent_runs (owner_id, created_at desc);
create index agent_tasks_run_status_idx
  on public.agent_tasks (run_id, status, sequence);
create index task_dependencies_run_idx
  on public.task_dependencies (run_id, task_id);
create index artifacts_run_path_revision_idx
  on public.artifacts (run_id, path, revision desc);
create index agent_events_run_created_idx
  on public.agent_events (run_id, created_at);
create index step_attempts_ready_idx
  on public.step_attempts (status, next_attempt_at, lease_expires_at);

create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger set_agent_runs_updated_at
  before update on public.agent_runs
  for each row execute function public.set_updated_at();

create trigger set_agent_tasks_updated_at
  before update on public.agent_tasks
  for each row execute function public.set_updated_at();

revoke all on function public.set_updated_at() from public, anon, authenticated;

alter table public.agent_runs enable row level security;
alter table public.agent_tasks enable row level security;
alter table public.task_dependencies enable row level security;
alter table public.artifacts enable row level security;
alter table public.agent_events enable row level security;
alter table public.step_attempts enable row level security;

revoke all on public.agent_runs, public.agent_tasks, public.task_dependencies,
  public.artifacts, public.agent_events, public.step_attempts
  from anon, authenticated;

grant select on public.agent_runs, public.agent_tasks, public.task_dependencies,
  public.artifacts, public.agent_events, public.step_attempts to authenticated;

create policy "owners can read agent runs"
  on public.agent_runs
  for select
  to authenticated
  using ((select auth.uid()) = owner_id);

create policy "owners can read agent tasks"
  on public.agent_tasks
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.agent_runs
      where agent_runs.id = agent_tasks.run_id
        and agent_runs.owner_id = (select auth.uid())
    )
  );

create policy "owners can read task dependencies"
  on public.task_dependencies
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.agent_runs
      where agent_runs.id = task_dependencies.run_id
        and agent_runs.owner_id = (select auth.uid())
    )
  );

create policy "owners can read artifacts"
  on public.artifacts
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.agent_runs
      where agent_runs.id = artifacts.run_id
        and agent_runs.owner_id = (select auth.uid())
    )
  );

create policy "owners can read agent events"
  on public.agent_events
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.agent_runs
      where agent_runs.id = agent_events.run_id
        and agent_runs.owner_id = (select auth.uid())
    )
  );

create policy "owners can read step attempts"
  on public.step_attempts
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.agent_runs
      where agent_runs.id = step_attempts.run_id
        and agent_runs.owner_id = (select auth.uid())
    )
  );

alter publication supabase_realtime
  add table public.agent_runs, public.agent_tasks, public.artifacts, public.agent_events;
