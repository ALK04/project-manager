-- Enum types
create type priority_enum as enum ('must', 'should', 'could', 'wont');
create type status_enum as enum ('todo', 'in_progress', 'blocked', 'done');

-- Tasks table
create table if not exists public.tasks (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  priority    priority_enum not null default 'should',
  status      status_enum not null default 'todo',t
  due_date    date,
  completed_at timestamptz,
  created_at  timestamptz not null default now()
);

-- Auto-fill completed_at when status changes to 'done'
create or replace function handle_task_completion()
returns trigger language plpgsql as $$
begin
  if new.status = 'done' and (old.status is null or old.status <> 'done') then
    new.completed_at = now();
  elsif new.status <> 'done' then
    new.completed_at = null;
  end if;
  return new;
end;
$$;

create or replace trigger on_task_status_change
  before update on public.tasks
  for each row
  execute function handle_task_completion();

-- RLS (Row Level Security)
alter table public.tasks enable row level security;

-- Allow all operations for now (no auth required)
-- You can tighten this later with auth.uid() policies
create policy "Allow all" on public.tasks
  for all using (true) with check (true);

-- Index for ordering
create index if not exists tasks_created_at_idx on public.tasks(created_at desc);
create index if not exists tasks_status_idx on public.tasks(status);
