-- =====================================================================
-- Soupers · Ateliers du Champ Libre — schéma de base de données
-- Principe : tout est privé par défaut (RLS). Seuls les membres d'un
-- foyer voient les données de ce foyer. Les recettes « partagées » sont
-- visibles uniquement par les utilisateurs qui ont un foyer (= le cercle).
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------- Configuration privée (jamais exposée à l'API) ----------
create table if not exists public.app_config (
  id boolean primary key default true check (id),
  group_code text not null,               -- code secret pour créer un foyer
  ai_daily_limit int not null default 40, -- appels IA max par foyer et par jour
  join_attempts_per_hour int not null default 10
);
alter table public.app_config enable row level security; -- aucune politique = inaccessible

-- Code lisible, sans caractères ambigus (0/O, 1/I/L)
create or replace function public.gen_code(n int default 8)
returns text language sql volatile as $$
  select string_agg(substr('ABCDEFGHJKMNPQRSTUVWXYZ23456789', 1 + floor(random() * 31)::int, 1), '')
  from generate_series(1, n)
$$;

-- ---------- Foyers ----------
create table if not exists public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 80),
  invite_code text not null unique default public.gen_code(8),
  settings jsonb not null default '{}'::jsonb check (octet_length(settings::text) < 20000),
  created_at timestamptz not null default now()
);

-- ---------- Profils ----------
create table if not exists public.profiles (
  id uuid primary key references auth.users on delete cascade,
  display_name text check (char_length(display_name) <= 60),
  household_id uuid references public.households on delete set null,
  created_at timestamptz not null default now()
);

create or replace function public.my_household()
returns uuid language sql stable security definer set search_path = public as $$
  select household_id from public.profiles where id = auth.uid()
$$;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, left(coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)), 60))
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- Journal des tentatives (anti-force brute) et quotas IA ----------
create table if not exists public.join_attempts (
  user_id uuid not null, at timestamptz not null default now()
);
create index if not exists join_attempts_idx on public.join_attempts (user_id, at);
alter table public.join_attempts enable row level security;

create table if not exists public.ai_usage (
  household_id uuid not null references public.households on delete cascade,
  day date not null default current_date,
  calls int not null default 0,
  primary key (household_id, day)
);
alter table public.ai_usage enable row level security;
drop policy if exists "usage lecture" on public.ai_usage;
create policy "usage lecture" on public.ai_usage for select to authenticated using (household_id = public.my_household());

-- Consomme une unité du quota IA du foyer; renvoie false si la limite du jour est atteinte
create or replace function public.consume_ai_quota()
returns boolean language plpgsql security definer set search_path = public as $$
declare h uuid := public.my_household(); lim int; used int;
begin
  if h is null then return false; end if;
  select ai_daily_limit into lim from public.app_config;
  insert into public.ai_usage (household_id, day, calls) values (h, current_date, 1)
    on conflict (household_id, day) do update set calls = public.ai_usage.calls + 1
    returning calls into used;
  return used <= coalesce(lim, 40);
end $$;

-- ---------- Créer / rejoindre un foyer ----------
-- Important : en cas de code invalide, on N'ÉMET PAS d'exception (elle annulerait l'enregistrement
-- de la tentative) : on journalise la tentative et on renvoie NULL.
create or replace function public.too_many_attempts()
returns boolean language sql stable security definer set search_path = public as $$
  select count(*) >= coalesce((select join_attempts_per_hour from public.app_config), 10)
  from public.join_attempts where user_id = auth.uid() and at > now() - interval '1 hour'
$$;

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
  insert into public.households (name, settings) values (left(trim(p_name), 80), jsonb_build_object(
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

create or replace function public.join_household(p_code text)
returns public.households language plpgsql security definer set search_path = public as $$
declare h public.households;
begin
  if auth.uid() is null then raise exception 'Non connecté'; end if;
  if public.too_many_attempts() then raise exception 'Trop de tentatives, réessayez dans une heure'; end if;
  select * into h from public.households where invite_code = upper(trim(p_code));
  if h.id is null then
    insert into public.join_attempts (user_id) values (auth.uid());
    return null;
  end if;
  update public.profiles set household_id = h.id where id = auth.uid();
  return h;
end $$;

-- Nouveau code d'invitation (si l'ancien a circulé)
create or replace function public.rotate_invite_code()
returns text language plpgsql security definer set search_path = public as $$
declare c text := public.gen_code(8);
begin
  update public.households set invite_code = c where id = public.my_household();
  return c;
end $$;

-- ---------- Recettes ----------
create table if not exists public.recipes (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households on delete cascade default public.my_household(),
  created_by uuid default auth.uid() references auth.users on delete set null,
  author_name text check (char_length(author_name) <= 60),
  title text not null check (char_length(title) between 1 and 200),
  description text check (char_length(description) <= 1000),
  source_url text check (source_url is null or source_url ~* '^https?://'),
  file_path text,
  servings int check (servings between 1 and 100),
  prep_minutes int check (prep_minutes between 0 and 2000),
  ingredients jsonb not null default '[]'::jsonb check (jsonb_typeof(ingredients) = 'array' and octet_length(ingredients::text) < 30000),
  steps jsonb not null default '[]'::jsonb check (jsonb_typeof(steps) = 'array' and octet_length(steps::text) < 30000),
  tags text[] not null default '{}',
  health_notes text check (char_length(health_notes) <= 1000),
  rating int check (rating between 1 and 5),
  shared boolean not null default false,
  copied_from uuid,
  created_at timestamptz not null default now()
);
create index if not exists recipes_household_idx on public.recipes (household_id);
create index if not exists recipes_shared_idx on public.recipes (shared) where shared;

-- ---------- Inventaire ----------
create table if not exists public.inventory_items (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households on delete cascade default public.my_household(),
  name text not null check (char_length(name) between 1 and 120),
  category text check (char_length(category) <= 60),
  location text not null default 'Congélateur' check (char_length(location) <= 40),
  quantity numeric not null default 1 check (quantity >= 0 and quantity < 100000),
  unit text check (char_length(unit) <= 40),
  added_on date not null default current_date,
  best_before date,
  notes text check (char_length(notes) <= 500),
  created_at timestamptz not null default now()
);
create index if not exists inventory_household_idx on public.inventory_items (household_id);

-- ---------- Planification ----------
create table if not exists public.meal_plans (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households on delete cascade default public.my_household(),
  week_start date not null,
  status text not null default 'brouillon' check (status in ('brouillon', 'approuvé')),
  days jsonb not null default '[]'::jsonb check (octet_length(days::text) < 100000),
  summary text check (char_length(summary) <= 2000),
  thaw jsonb not null default '[]'::jsonb check (octet_length(thaw::text) < 20000),
  created_at timestamptz not null default now(),
  unique (household_id, week_start)
);

-- ---------- Épicerie ----------
create table if not exists public.shopping_items (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households on delete cascade default public.my_household(),
  plan_id uuid references public.meal_plans on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  quantity text check (char_length(quantity) <= 60),
  category text check (char_length(category) <= 60),
  store text check (char_length(store) <= 60),
  checked boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists shopping_household_idx on public.shopping_items (household_id);

-- ---------- Commentaires (pour les itérations) ----------
create table if not exists public.feedback (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households on delete cascade default public.my_household(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  author_name text,
  screen text check (char_length(screen) <= 40),
  message text not null check (char_length(message) between 1 and 4000),
  app_version text,
  done boolean not null default false,
  created_at timestamptz not null default now()
);

-- ---------- Sécurité (RLS) ----------
alter table public.households enable row level security;
alter table public.profiles enable row level security;
alter table public.recipes enable row level security;
alter table public.inventory_items enable row level security;
alter table public.meal_plans enable row level security;
alter table public.shopping_items enable row level security;
alter table public.feedback enable row level security;

-- Foyers : lecture/modification par les membres seulement, et seulement le nom et les réglages
drop policy if exists "foyer lecture" on public.households;
create policy "foyer lecture" on public.households for select to authenticated using (id = public.my_household());
drop policy if exists "foyer maj" on public.households;
create policy "foyer maj" on public.households for update to authenticated
  using (id = public.my_household()) with check (id = public.my_household());
revoke insert, update, delete on public.households from anon, authenticated;
grant select on public.households to authenticated;
grant update (name, settings) on public.households to authenticated;

-- Profils : chacun voit les membres de son foyer; on ne modifie que son nom ou on quitte son foyer
drop policy if exists "profils lecture" on public.profiles;
create policy "profils lecture" on public.profiles for select to authenticated
  using (id = auth.uid() or household_id = public.my_household());
drop policy if exists "profil maj" on public.profiles;
create policy "profil maj" on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid() and (household_id is null or household_id = public.my_household()));
revoke insert, update, delete on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
grant update (display_name, household_id) on public.profiles to authenticated;

-- Recettes : celles du foyer + celles partagées par le cercle (il faut avoir un foyer)
drop policy if exists "recettes lecture" on public.recipes;
create policy "recettes lecture" on public.recipes for select to authenticated
  using (household_id = public.my_household() or (shared and public.my_household() is not null));
drop policy if exists "recettes ecriture" on public.recipes;
create policy "recettes ecriture" on public.recipes for all to authenticated
  using (household_id = public.my_household()) with check (household_id = public.my_household());

drop policy if exists "inventaire foyer" on public.inventory_items;
create policy "inventaire foyer" on public.inventory_items for all to authenticated
  using (household_id = public.my_household()) with check (household_id = public.my_household());

drop policy if exists "plans foyer" on public.meal_plans;
create policy "plans foyer" on public.meal_plans for all to authenticated
  using (household_id = public.my_household()) with check (household_id = public.my_household());

drop policy if exists "epicerie foyer" on public.shopping_items;
create policy "epicerie foyer" on public.shopping_items for all to authenticated
  using (household_id = public.my_household()) with check (household_id = public.my_household());

drop policy if exists "commentaires foyer" on public.feedback;
create policy "commentaires foyer" on public.feedback for all to authenticated
  using (household_id = public.my_household()) with check (household_id = public.my_household() and user_id = auth.uid());

-- Droits explicites (ne dépend pas de l'option « Grant API access to new tables automatically »)
grant usage on schema public to authenticated;
grant select, insert, update, delete on public.recipes, public.inventory_items, public.meal_plans,
  public.shopping_items, public.feedback to authenticated;
grant select on public.ai_usage to authenticated;

-- Aucun accès anonyme aux tables; tables internes inaccessibles à l'API
revoke all on all tables in schema public from anon;
revoke all on public.app_config, public.join_attempts from authenticated;
revoke insert, update, delete on public.ai_usage from authenticated;

-- Fonctions : réservées aux utilisateurs connectés
revoke execute on all functions in schema public from public, anon;
grant execute on function public.my_household(), public.create_household(text, text), public.join_household(text),
  public.rotate_invite_code(), public.consume_ai_quota() to authenticated;

-- ---------- Stockage des PDF/photos : privé, 10 Mo max, types limités ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('recipe-files', 'recipe-files', false, 10485760,
  array['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "fichiers foyer lecture" on storage.objects;
create policy "fichiers foyer lecture" on storage.objects for select to authenticated
  using (bucket_id = 'recipe-files' and (storage.foldername(name))[1] = public.my_household()::text);
drop policy if exists "fichiers foyer ajout" on storage.objects;
create policy "fichiers foyer ajout" on storage.objects for insert to authenticated
  with check (bucket_id = 'recipe-files' and (storage.foldername(name))[1] = public.my_household()::text);
drop policy if exists "fichiers foyer suppression" on storage.objects;
create policy "fichiers foyer suppression" on storage.objects for delete to authenticated
  using (bucket_id = 'recipe-files' and (storage.foldername(name))[1] = public.my_household()::text);

-- ---------- Synchro en temps réel de la liste d'épicerie ----------
do $$ begin
  alter publication supabase_realtime add table public.shopping_items;
exception when others then null; end $$;

-- ---------- Petite fonction de « réveil » (empêche la mise en pause du plan gratuit) ----------
create or replace function public.ping() returns text language sql stable as $$ select 'ok' $$;
grant usage on schema public to anon;
grant execute on function public.ping() to anon, authenticated;
