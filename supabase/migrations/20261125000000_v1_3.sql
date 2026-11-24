-- =====================================================================
-- AU MENU v1.3 — communautés (cercles de partage) et partage par défaut
-- =====================================================================
-- Une communauté regroupe des foyers. Les recettes partagées ne sont
-- visibles que par les foyers de la MÊME communauté.

create table if not exists public.communities (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 80),
  created_at timestamptz not null default now()
);
alter table public.communities enable row level security;

alter table public.households add column if not exists community_id uuid references public.communities on delete set null;
create index if not exists households_community_idx on public.households (community_id);

-- Communauté de départ : tous les foyers existants y sont placés
do $$
declare c uuid;
begin
  if not exists (select 1 from public.communities) then
    insert into public.communities (name) values ('Ateliers du Champ Libre') returning id into c;
    update public.households set community_id = c where community_id is null;
  end if;
end $$;

-- Communauté d'un foyer (security definer : la RLS des foyers ne montre que le sien)
create or replace function public.household_community(p_household uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select community_id from public.households where id = p_household
$$;
create or replace function public.my_community()
returns uuid language sql stable security definer set search_path = public as $$
  select public.household_community(public.my_household())
$$;
revoke execute on function public.household_community(uuid), public.my_community() from public, anon;
grant execute on function public.household_community(uuid), public.my_community() to authenticated, service_role;

drop policy if exists "communaute lecture" on public.communities;
create policy "communaute lecture" on public.communities for select to authenticated
  using (id = public.my_community() or public.is_admin());
revoke all on public.communities from anon, authenticated;
grant select on public.communities to authenticated;
grant all on public.communities to service_role;

-- Les membres ne peuvent pas changer eux-mêmes la communauté de leur foyer
revoke update on public.households from authenticated;
grant update (name, settings) on public.households to authenticated;

-- Recettes : celles du foyer + celles partagées par les foyers de la même communauté
drop policy if exists "recettes lecture" on public.recipes;
create policy "recettes lecture" on public.recipes for select to authenticated
  using (
    household_id = public.my_household()
    or (shared and public.my_community() is not null
        and public.household_community(household_id) = public.my_community())
  );

-- Les nouveaux foyers créés avec le code d'inscription vont dans la première communauté
create or replace function public.create_household(p_name text, p_group_code text)
returns public.households language plpgsql security definer set search_path = public as $$
declare h public.households; expected text;
begin
  if auth.uid() is null then raise exception 'Non connecté'; end if;
  if public.too_many_attempts() then raise exception 'Trop de tentatives, réessayez dans une heure'; end if;
  select group_code into expected from public.app_config;
  if expected is null or p_group_code is distinct from expected then
    insert into public.join_attempts (user_id) values (auth.uid());
    return null;
  end if;
  insert into public.households (name, community_id, settings) values (left(trim(p_name), 80),
    (select id from public.communities order by created_at limit 1),
    jsonb_build_object(
    'stores', jsonb_build_array('Maxi', 'IGA', 'Costco'),
    'category_store', jsonb_build_object(),
    'plan_days', jsonb_build_array(0,1,2,3,4,5,6),
    'servings', 4, 'max_minutes_weekday', 40, 'max_minutes_weekend', 90,
    'health', jsonb_build_array('Réduire les glucides', 'Réduire le sucre'),
    'avoid', '', 'likes', ''
  )) returning * into h;
  update public.profiles set household_id = h.id where id = auth.uid();
  return h;
end $$;

-- Recettes partagées avec la communauté par défaut
alter table public.recipes alter column shared set default true;
