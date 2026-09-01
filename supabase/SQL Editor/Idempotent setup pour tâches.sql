
-- ═══════════════════════════════════════════════════════════════
-- 1. Extensions
-- ═══════════════════════════════════════════════════════════════
create extension if not exists "uuid-ossp";

  -- ═══════════════════════════════════════════════════════════════
  -- 2. Mise à jour de la table tasks existante
  --    (safe : utilise ADD COLUMN IF NOT EXISTS + IF NOT EXISTS)
  -- ═══════════════════════════════════════════════════════════════
alter table tasks
    add column if not exists user_id    uuid references auth.users(id) on delete cascade,
    add column if not exists updated_at timestamptz default now();

-- Contraintes métier (idempotentes)
do $$ begin
    if not exists (select 1 from pg_constraint where conname = 'tasks_priority_check') then
alter table tasks add constraint tasks_priority_check
    check (priority in ('must','should','could','wont'));
end if;
    if not exists (select 1 from pg_constraint where conname = 'tasks_status_check') then
alter table tasks add constraint tasks_status_check
    check (status in ('todo','in_progress','blocked','done'));
end if;
end $$;

  -- ═══════════════════════════════════════════════════════════════
  -- 3. Table absences (remplace le localStorage côté DB)
  -- ═══════════════════════════════════════════════════════════════
create table if not exists absences (
                                        id         uuid        primary key default gen_random_uuid(),
    user_id    uuid        references auth.users(id) on delete cascade,
    label      text        not null,
    start_date date        not null,
    end_date   date        not null,
    color      text        not null default '#f97316',
    created_at timestamptz default now(),
    constraint absences_valid_range check (end_date >= start_date)
    );

-- ═══════════════════════════════════════════════════════════════
-- 4. Table user_settings (remplace le localStorage)
-- ═══════════════════════════════════════════════════════════════
create table if not exists user_settings (
                                             user_id          uuid  primary key references auth.users(id) on delete cascade,
    project_end_date date  not null default (current_date + interval '180 days'),
    updated_at       timestamptz default now()
    );

-- ═══════════════════════════════════════════════════════════════
-- 5. Index de performance
-- ═══════════════════════════════════════════════════════════════
create index if not exists idx_tasks_user_id       on tasks(user_id);
create index if not exists idx_tasks_status        on tasks(status);
create index if not exists idx_tasks_created_at    on tasks(created_at);
create index if not exists idx_tasks_completed_at  on tasks(completed_at) where completed_at is not null;
create index if not exists idx_tasks_due_date      on tasks(due_date)     where due_date is not null;

create index if not exists idx_absences_user_id    on absences(user_id);
create index if not exists idx_absences_dates      on absences(user_id, start_date, end_date);

-- ═══════════════════════════════════════════════════════════════
-- 6. Trigger updated_at automatique
-- ═══════════════════════════════════════════════════════════════
create or replace function set_updated_at()
  returns trigger language plpgsql as $$
begin
    new.updated_at = now();
return new;
end;
  $$;

drop trigger if exists tasks_updated_at on tasks;
create trigger tasks_updated_at
    before update on tasks
    for each row execute function set_updated_at();

drop trigger if exists user_settings_updated_at on user_settings;
create trigger user_settings_updated_at
    before update on user_settings
    for each row execute function set_updated_at();

-- ═══════════════════════════════════════════════════════════════
-- 7. Row Level Security
-- ═══════════════════════════════════════════════════════════════

-- ── 7a. Mode actuel : usage perso sans auth (anon key)
--        Désactive le filtrage par user, tout le monde accède à tout.
--        Supprime ces policies quand tu actives l'auth.
-- ═══════════════════════════════════════════════════════════════
alter table tasks    enable row level security;
alter table absences enable row level security;
alter table user_settings enable row level security;

-- Politique temporaire anon (usage solo / développement)
drop policy if exists "anon_all_tasks"    on tasks;
  drop policy if exists "anon_all_absences" on absences;
  drop policy if exists "anon_all_settings" on user_settings;

  create policy "anon_all_tasks"
    on tasks for all to anon using (true) with check (true);
  create policy "anon_all_absences"
    on absences for all to anon using (true) with check (true);
  create policy "anon_all_settings"
    on user_settings for all to anon using (true) with check (true);

  -- ── 7b. Mode multi-utilisateur (décommenter quand auth activée)
  --        Remplace les policies anon ci-dessus par celles-ci.
  -- ═══════════════════════════════════════════════════════════════
  -- drop policy if exists "anon_all_tasks"    on tasks;
  -- drop policy if exists "anon_all_absences" on absences;
  -- drop policy if exists "anon_all_settings" on user_settings;
  --
  -- create policy "own_tasks"    on tasks
  --   for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
  -- create policy "own_absences" on absences
  --   for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
  -- create policy "own_settings" on user_settings
  --   for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
  --
  -- -- Auto-créer le profil settings à l'inscription
  -- create or replace function handle_new_user()
  -- returns trigger language plpgsql security definer as $$
  -- begin
  --   insert into user_settings(user_id) values (new.id) on conflict do nothing;
  --   return new;
  -- end;
  -- $$;
  -- drop trigger if exists on_auth_user_created on auth.users;
  -- create trigger on_auth_user_created
  --   after insert on auth.users
  --   for each row execute function handle_new_user();
