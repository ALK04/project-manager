-- ═══════════════════════════════════════════════════════════════
-- Calendrier d'alternance — persistance des jours peints
-- Idempotent : ré-exécutable sans risque.
-- ═══════════════════════════════════════════════════════════════

create table if not exists alternance_days (
    user_id    uuid        not null references auth.users(id) on delete cascade,
    day        date        not null,
    type       text        not null,
    updated_at timestamptz not null default now(),
    primary key (user_id, day)
);

-- Contrainte sur les types de jour (idempotente)
do $$ begin
    if not exists (select 1 from pg_constraint where conname = 'alternance_days_type_check') then
        alter table alternance_days add constraint alternance_days_type_check
            check (type in ('libre','formation','entreprise','teletravail','ferme'));
    end if;
end $$;

create index if not exists idx_alternance_days_user_id on alternance_days(user_id);

-- Trigger updated_at (réutilise set_updated_at() créé par le setup des tâches)
drop trigger if exists alternance_days_updated_at on alternance_days;
create trigger alternance_days_updated_at
    before update on alternance_days
    for each row execute function set_updated_at();

-- ═══════════════════════════════════════════════════════════════
-- Row Level Security : chacun ne voit que ses propres jours
-- ═══════════════════════════════════════════════════════════════
alter table alternance_days enable row level security;

drop policy if exists "own_alternance_days" on alternance_days;
create policy "own_alternance_days"
    on alternance_days for all to authenticated
    using (auth.uid() = user_id) with check (auth.uid() = user_id);
