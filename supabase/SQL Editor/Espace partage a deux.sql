-- ═══════════════════════════════════════════════════════════════
-- Espace partagé à deux — profils, assignation, RLS, temps réel
-- Idempotent : ré-exécutable sans risque.
--
-- L'ordre n'a pas d'importance : l'étape 2 rattrape les comptes déjà
-- existants, l'étape 3 s'occupe des suivants.
--
-- Si « Add user » échoue avec « Database error creating new user »,
-- lancer CE script d'abord : un trigger sur auth.users plante et
-- annule la création du compte avec lui. L'étape 3 le remplace.
-- ═══════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════
-- 0. Helper updated_at (créé par le setup des tâches — redéfini ici
--    pour que ce script reste autonome)
-- ═══════════════════════════════════════════════════════════════
create or replace function set_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

-- ═══════════════════════════════════════════════════════════════
-- 1. Table profiles — un nom affichable + une couleur par compte
-- ═══════════════════════════════════════════════════════════════
create table if not exists profiles (
    id           uuid        primary key references auth.users(id) on delete cascade,
    display_name text        not null default '',
    color        text        not null default '#6366f1',
    created_at   timestamptz not null default now(),
    updated_at   timestamptz not null default now()
);

drop trigger if exists profiles_updated_at on profiles;
create trigger profiles_updated_at
    before update on profiles
    for each row execute function set_updated_at();

-- Couleur par défaut piochée dans une petite palette, déterministe par compte
-- (`search_path` figé : la fonction est appelée depuis un trigger security
-- definer, cf. étape 3.)
create or replace function default_profile_color(uid uuid)
returns text language sql immutable set search_path = '' as $$
    select (array['#6366f1','#f97316','#10b981','#ec4899','#0ea5e9','#a855f7'])
           [1 + (abs(pg_catalog.hashtext(uid::text)) % 6)];
$$;

-- ═══════════════════════════════════════════════════════════════
-- 2. Backfill : un profil pour chaque compte déjà existant
-- ═══════════════════════════════════════════════════════════════
insert into profiles (id, display_name, color)
select u.id,
       initcap(split_part(u.email, '@', 1)),
       default_profile_color(u.id)
from auth.users u
on conflict (id) do nothing;

-- ═══════════════════════════════════════════════════════════════
-- 3. Création automatique du profil à l'inscription
-- ═══════════════════════════════════════════════════════════════
-- ATTENTION : ce `create or replace` écrase la version installée par le
-- setup initial des tâches, qui créait la ligne `user_settings`. Les deux
-- insertions sont donc regroupées ici — ne pas en retirer une.
--
-- Deux précautions, parce qu'un trigger sur auth.users qui échoue fait
-- échouer la création du compte entière (« Database error creating new user ») :
--   1. `set search_path` : sans lui, la fonction s'exécute avec le search_path
--      de supabase_auth_admin et ne trouve plus les tables de public.
--   2. les blocs exception : au pire le profil manque — il sera recréé par le
--      backfill de l'étape 2 — mais le compte, lui, existe.
create or replace function handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
    begin
        insert into public.profiles (id, display_name, color)
        values (new.id,
                initcap(split_part(coalesce(new.email, ''), '@', 1)),
                public.default_profile_color(new.id))
        on conflict (id) do nothing;
    exception when others then
        raise warning 'profil non créé pour % : %', new.id, sqlerrm;
    end;

    begin
        insert into public.user_settings (user_id)
        values (new.id)
        on conflict do nothing;
    exception when others then
        raise warning 'user_settings non créé pour % : %', new.id, sqlerrm;
    end;

    return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
    after insert on auth.users
    for each row execute function handle_new_user();

-- PostgREST expose toute fonction de `public` en `/rest/v1/rpc/…`. Celle-ci est
-- `security definer` : elle n'a rien à faire dans l'API publique (un appel
-- direct échouerait de toute façon, `new` n'étant pas défini hors trigger).
revoke all on function handle_new_user() from public, anon, authenticated;

-- ═══════════════════════════════════════════════════════════════
-- 4. Assignation des tâches
--    on delete set null : supprimer un compte ne supprime pas les tâches
-- ═══════════════════════════════════════════════════════════════
alter table tasks
    add column if not exists assignee_id uuid references auth.users(id) on delete set null;

create index if not exists idx_tasks_assignee_id on tasks(assignee_id);

-- Les tâches existantes sont attribuées à leur créateur (une seule fois :
-- ne touche que les lignes non assignées).
update tasks set assignee_id = user_id
where assignee_id is null and user_id is not null;

-- ═══════════════════════════════════════════════════════════════
-- 5. Row Level Security — tableau partagé entre comptes connectés
--    tasks / absences : visibles et modifiables par les deux.
--    alternance_days  : reste strictement personnel (cf. son propre script).
-- ═══════════════════════════════════════════════════════════════
alter table tasks    enable row level security;
alter table absences enable row level security;
alter table profiles enable row level security;

-- Anciennes politiques ouvertes à `anon` : l'app exige maintenant une session.
drop policy if exists "Allow all"         on tasks;
drop policy if exists "anon_all_tasks"    on tasks;
drop policy if exists "anon_all_absences" on absences;

-- Anciennes politiques par compte (`auth.uid() = user_id`) et leurs doublons
-- permissifs : remplacées par `team_*` ci-dessous. Les laisser ne casserait
-- rien (les policies permissives s'additionnent) mais rend illisible la
-- réponse à « qui a le droit de quoi ».
drop policy if exists "own_tasks"     on tasks;
drop policy if exists "auth_tasks"    on tasks;
drop policy if exists "own_absences"  on absences;
drop policy if exists "auth_absences" on absences;

drop policy if exists "team_tasks" on tasks;
create policy "team_tasks"
    on tasks for all to authenticated
    using (true) with check (true);

drop policy if exists "team_absences" on absences;
create policy "team_absences"
    on absences for all to authenticated
    using (true) with check (true);

-- Chacun voit tous les profils (pour afficher les noms/couleurs)…
drop policy if exists "read_profiles" on profiles;
create policy "read_profiles"
    on profiles for select to authenticated
    using (true);

-- …mais ne modifie que le sien.
drop policy if exists "insert_own_profile" on profiles;
create policy "insert_own_profile"
    on profiles for insert to authenticated
    with check (auth.uid() = id);

drop policy if exists "update_own_profile" on profiles;
create policy "update_own_profile"
    on profiles for update to authenticated
    using (auth.uid() = id) with check (auth.uid() = id);

-- ═══════════════════════════════════════════════════════════════
-- 6. Temps réel — les deux tableaux se synchronisent sans refresh
-- ═══════════════════════════════════════════════════════════════
do $$ begin
    if not exists (
        select 1 from pg_publication_tables
        where pubname = 'supabase_realtime'
          and schemaname = 'public'
          and tablename = 'tasks'
    ) then
        alter publication supabase_realtime add table tasks;
    end if;
end $$;

-- ═══════════════════════════════════════════════════════════════
-- 7. Diagnostic — quels triggers sont branchés sur auth.users ?
--    Seul `on_auth_user_created` devrait apparaître. Tout autre
--    trigger est un reste d'une ancienne installation : c'est le
--    suspect n° 1 si la création de compte échoue encore.
-- ═══════════════════════════════════════════════════════════════
select tgname as trigger_name,
       pg_get_triggerdef(oid) as definition
from pg_trigger
where tgrelid = 'auth.users'::regclass
  and not tgisinternal;
